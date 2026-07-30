"""
OKF Markdown 导出资源处理。

职责：
- 补全网页中的相对链接；
- 将正文图片下载到 Markdown 旁边并保留图片引用；
- 发现、下载和解析 PDF/DOCX/XLSX/图片附件；
- 在提供 API Key 时调用内网大模型解析图片和扫描件。
"""
from __future__ import annotations

import base64
import hashlib
import io
import ipaddress
import json
import mimetypes
import os
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urljoin, urlparse
from xml.etree import ElementTree

import httpx
from bs4 import BeautifulSoup
from loguru import logger
from markitdown import MarkItDown

from app.config import settings
from app.services.http_utils import build_headers
from app.services.vision_parser import VisionLLMClient, VisionParseError, VisionResult


ATTACHMENT_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"}
CONTENT_TYPE_EXTENSIONS = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/webp": ".webp",
}
ATTACHMENT_TEXT_RE = re.compile(r"附件|下载|申请表|申报表|材料清单|表格|文件下载", re.I)
NOISE_IMAGE_RE = re.compile(r"logo|icon|favicon|avatar|banner|qrcode|qr-code|share|wechat|weibo", re.I)


@dataclass
class ExportResourceOptions:
    parse_attachments: bool = True
    localize_images: bool = True
    parse_images: bool = True
    download_originals: bool = True
    api_key: str = ""
    model: str = "GS/Qwen3.6-Plus"
    base_url: str = ""


@dataclass
class ResourceItem:
    kind: str
    source_url: str
    local_path: str = ""
    status: str = "success"
    title: str = ""
    error: str = ""


@dataclass
class ResourceReport:
    attachments: list[ResourceItem] = field(default_factory=list)
    images: list[ResourceItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    image_understanding_blocks: list[str] = field(default_factory=list)
    attachment_markdown: str = ""
    extra_image_markdown: str = ""

    def summary_markdown(self) -> str:
        parts = [part for part in (self.extra_image_markdown,) if part.strip()]
        if self.image_understanding_blocks:
            parts.append("## 图片 OCR 与结构化理解\n\n" + "\n\n".join(self.image_understanding_blocks))
        parts.extend(part for part in (self.attachment_markdown,) if part.strip())
        if self.warnings:
            warning_lines = "\n".join(f"- {item}" for item in self.warnings)
            parts.append(f"## 资源处理说明\n\n{warning_lines}")
        return "\n\n".join(parts).strip()


@dataclass
class DownloadedResource:
    url: str
    data: bytes
    content_type: str
    filename: str
    extension: str


def normalize_resource_url(value: str, base_url: str, base_href: str = "") -> str:
    value = (value or "").strip().strip('"\'')
    if not value or value.startswith(("javascript:", "mailto:", "tel:", "#")):
        return ""
    if value.startswith("data:"):
        return value
    base = urljoin(base_url, base_href) if base_href else base_url
    absolute = urljoin(base, value)
    parsed = urlparse(absolute)
    return absolute if parsed.scheme in ("http", "https") else ""


def _srcset_candidate(value: str) -> str:
    candidates = []
    for part in (value or "").split(","):
        tokens = part.strip().split()
        if not tokens:
            continue
        weight = 0.0
        if len(tokens) > 1:
            token = tokens[-1].lower()
            try:
                weight = float(token[:-1]) * (1000 if token.endswith("w") else 1)
            except (TypeError, ValueError):
                weight = 0.0
        candidates.append((weight, tokens[0]))
    return max(candidates, default=(0.0, ""), key=lambda item: item[0])[1]


def _image_source(tag) -> str:
    for name in ("data-original", "data-src", "data-lazy-src", "data-url"):
        if tag.get(name):
            return str(tag.get(name))
    if tag.get("srcset"):
        candidate = _srcset_candidate(str(tag.get("srcset")))
        if candidate:
            return candidate
    if tag.get("src"):
        return str(tag.get("src"))
    parent = tag.parent
    if parent and getattr(parent, "name", "") == "picture":
        source = parent.find("source")
        if source:
            return _srcset_candidate(str(source.get("srcset") or source.get("data-srcset") or ""))
    return ""


def _safe_name(value: str, fallback: str) -> str:
    value = unquote(value or "")
    value = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", value)
    value = re.sub(r"\s+", " ", value).strip(" ._")
    return (value[:120] or fallback).strip()


def _content_disposition_filename(value: str) -> str:
    if not value:
        return ""
    match = re.search(r"filename\*\s*=\s*UTF-8''([^;]+)", value, re.I)
    if match:
        return unquote(match.group(1).strip())
    match = re.search(r'filename\s*=\s*"?([^";]+)', value, re.I)
    return unquote(match.group(1).strip()) if match else ""


def _magic_extension(data: bytes) -> str:
    if data.startswith(b"%PDF"):
        return ".pdf"
    if data.startswith(b"\xff\xd8"):
        return ".jpg"
    if data.startswith(b"\x89PNG"):
        return ".png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data.startswith(b"BM"):
        return ".bmp"
    if data.startswith((b"II*\x00", b"MM\x00*")):
        return ".tiff"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
                if "word/document.xml" in names:
                    return ".docx"
                if "xl/workbook.xml" in names:
                    return ".xlsx"
                if "ppt/presentation.xml" in names:
                    return ".pptx"
        except zipfile.BadZipFile:
            pass
    return ""


def _extension(url: str, content_type: str, data: bytes, filename: str = "") -> str:
    for source in (filename, urlparse(url).path):
        ext = Path(source).suffix.lower()
        if ext in ATTACHMENT_EXTENSIONS:
            return ext
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    return CONTENT_TYPE_EXTENSIONS.get(mime) or _magic_extension(data)


def _decode_data_image(url: str) -> DownloadedResource:
    match = re.match(r"data:(image/[^;,]+);base64,(.+)", url, re.I | re.S)
    if not match:
        raise ValueError("不支持的 data URI")
    data = base64.b64decode(match.group(2))
    content_type = match.group(1).lower()
    ext = CONTENT_TYPE_EXTENSIONS.get(content_type, ".png")
    return DownloadedResource(url=url, data=data, content_type=content_type, filename=f"image{ext}", extension=ext)


def _ensure_public_url(url: str) -> None:
    """防止被抓取页面通过附件/图片链接访问本机或内网服务。"""
    parsed = urlparse(url)
    host = (parsed.hostname or "").strip().lower()
    if not host or host == "localhost" or host.endswith(".local"):
        raise ValueError("禁止下载本机或内网资源")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)}
    except socket.gaierror:
        return  # 交给 HTTP 层返回更准确的 DNS 错误。
    for value in addresses:
        address = ipaddress.ip_address(value)
        if not address.is_global:
            raise ValueError("禁止下载本机或内网资源")


def _legacy_tls_context() -> ssl.SSLContext:
    """兼容仍使用弱 DH 参数的少数政府网站。

    资源下载已关闭证书校验且会做 SSRF 防护；这里仅在正常 TLS 握手
    失败后使用，将 OpenSSL 安全级别降到 1，解决 ``DH_KEY_TOO_SMALL``。
    """
    context = ssl.create_default_context()
    context.set_ciphers("DEFAULT:@SECLEVEL=1")
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def _download_resource_once(
    url: str,
    referer: str,
    limit: int,
    verify: bool | ssl.SSLContext,
) -> DownloadedResource:
    headers = build_headers(referer=referer)
    headers["Accept"] = "*/*"
    current_url = url
    with httpx.Client(follow_redirects=False, timeout=60, verify=verify) as client:
        for _ in range(6):
            _ensure_public_url(current_url)
            response = client.build_request("GET", current_url, headers=headers)
            response = client.send(response, stream=True)
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location", "")
                response.close()
                if not location:
                    raise ValueError("资源重定向缺少 Location")
                current_url = urljoin(current_url, location)
                continue
            response.raise_for_status()
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > limit:
                    response.close()
                    raise ValueError(f"资源超过 {settings.EXPORT_MAX_DOWNLOAD_MB}MB 限制")
                chunks.append(chunk)
            data = b"".join(chunks)
            content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            filename = _content_disposition_filename(response.headers.get("content-disposition", ""))
            final_url = str(response.url)
            response.close()
            break
        else:
            raise ValueError("资源重定向次数过多")
    if not filename:
        filename = Path(unquote(urlparse(final_url).path)).name
    ext = _extension(final_url, content_type, data, filename)
    if ext and not filename.lower().endswith(ext):
        filename = f"{Path(filename).stem or 'attachment'}{ext}"
    return DownloadedResource(
        url=final_url,
        data=data,
        content_type=content_type,
        filename=_safe_name(filename, f"attachment{ext or '.bin'}"),
        extension=ext,
    )


def download_resource(url: str, referer: str = "", max_bytes: int | None = None) -> DownloadedResource:
    if url.startswith("data:"):
        return _decode_data_image(url)
    limit = max_bytes or settings.EXPORT_MAX_DOWNLOAD_MB * 1024 * 1024
    try:
        return _download_resource_once(url, referer, limit, verify=False)
    except (httpx.TransportError, ssl.SSLError, OSError) as exc:
        logger.info("资源下载 TLS 兼容重试: url={} error={}", url, exc)
        return _download_resource_once(url, referer, limit, verify=_legacy_tls_context())


def _relative_url(path: Path, markdown_path: Path) -> str:
    relative = os.path.relpath(path, markdown_path.parent).replace("\\", "/")
    # Markdown 相对路径使用 URL 形式，空格等交给渲染器处理。
    return relative


def _save_download(resource: DownloadedResource, directory: Path, preferred_name: str = "") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(resource.data).hexdigest()[:12]
    base_name = _safe_name(preferred_name or resource.filename, f"resource{resource.extension or '.bin'}")
    if resource.extension and not base_name.lower().endswith(resource.extension):
        base_name = f"{Path(base_name).stem}{resource.extension}"
    path = directory / f"{digest}_{base_name}"
    if not path.exists():
        path.write_bytes(resource.data)
    return path


def _markitdown_bytes(data: bytes, extension: str) -> str:
    path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=extension or ".bin", delete=False) as handle:
            handle.write(data)
            path = handle.name
        result = MarkItDown().convert(path)
        return str(result.text_content or "").strip()
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


def _pdf_text_fallback(data: bytes) -> str:
    """用已随应用打包的 PyMuPDF 提取 PDF 文字，避免依赖 MarkItDown[pdf]。"""
    try:
        import fitz

        document = fitz.open(stream=data, filetype="pdf")
        try:
            pages = [page.get_text("text").strip() for page in document]
        finally:
            document.close()
        return "\n\n".join(page for page in pages if page).strip()
    except Exception as exc:
        logger.debug("PyMuPDF PDF 文本提取失败: {}", exc)
        return ""


def _decode_document_text(data: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "gbk"):
        try:
            return data.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace").strip()


def _legacy_doc_text(data: bytes) -> str:
    """解析旧版 OLE ``.doc`` 文件。

    旧 DOC 不是 DOCX 的 zip 格式，MarkItDown 也不保证支持。优先调用
    系统已有的安全本地转换器；macOS 自带 textutil，Linux/Windows 则可
    选用 antiword、catdoc 或 LibreOffice。找不到转换器时返回空字符串，
    调用方会保留原附件并标记为“内容解析未完成”。
    """
    source_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as handle:
            handle.write(data)
            source_path = handle.name

        commands = [
            ("textutil", ["textutil", "-convert", "txt", "-stdout", source_path]),
            ("antiword", ["antiword", "-w", "0", source_path]),
            ("catdoc", ["catdoc", "-w", source_path]),
        ]
        for executable, command in commands:
            if not shutil.which(executable):
                continue
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=90,
            )
            if result.returncode == 0 and result.stdout.strip():
                text = _decode_document_text(result.stdout)
                if text:
                    return text

        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        if soffice:
            with tempfile.TemporaryDirectory() as output_dir:
                result = subprocess.run(
                    [soffice, "--headless", "--convert-to", "txt:Text", "--outdir", output_dir, source_path],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                    timeout=120,
                )
                output_path = Path(output_dir) / f"{Path(source_path).stem}.txt"
                if result.returncode == 0 and output_path.is_file():
                    return _decode_document_text(output_path.read_bytes())
    except (OSError, subprocess.SubprocessError) as exc:
        logger.debug("旧 DOC 文本提取失败: {}", exc)
    finally:
        if source_path:
            try:
                os.unlink(source_path)
            except OSError:
                pass
    return ""


def _docx_fallback(data: bytes) -> str:
    paragraphs: list[str] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            root = ElementTree.fromstring(archive.read("word/document.xml"))
        ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        for paragraph in root.iter(f"{ns}p"):
            text = "".join(node.text or "" for node in paragraph.iter(f"{ns}t")).strip()
            if text:
                paragraphs.append(text)
    except Exception:
        return ""
    return "\n\n".join(paragraphs)


def _xlsx_markdown(data: bytes) -> str:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    for worksheet in workbook.worksheets:
        rows = []
        for row in worksheet.iter_rows(values_only=True):
            values = [
                "" if value is None else str(value).replace("|", "\\|").replace("\n", "<br>")
                for value in row
            ]
            while values and values[-1] == "":
                values.pop()
            if values:
                rows.append(values)
        if not rows:
            continue
        width = max(len(row) for row in rows)
        normalized = [row + [""] * (width - len(row)) for row in rows]
        parts.append(f"#### 工作表：{worksheet.title}")
        parts.append("| " + " | ".join(normalized[0]) + " |")
        parts.append("| " + " | ".join(["---"] * width) + " |")
        for row in normalized[1:]:
            parts.append("| " + " | ".join(row) + " |")
        parts.append("")
    return "\n".join(parts).strip()


def _embedded_images(data: bytes, extension: str) -> list[tuple[str, bytes]]:
    prefix = "word/media/" if extension == ".docx" else "xl/media/" if extension == ".xlsx" else ""
    if not prefix:
        return []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return [(Path(name).name, archive.read(name)) for name in archive.namelist() if name.startswith(prefix) and not name.endswith("/")]
    except Exception:
        return []


def _image_dimensions(data: bytes) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as image:
            return image.size
    except Exception:
        return 0, 0


def _vision_ready_bytes(data: bytes, mime_type: str) -> tuple[bytes, str]:
    # Base64 还会放大体积，接近模型上限时先压缩。
    if len(data) <= 6 * 1024 * 1024:
        return data, mime_type or "image/png"
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as image:
            image.thumbnail((3000, 3000))
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=88, optimize=True)
            return output.getvalue(), "image/jpeg"
    except Exception:
        return data, mime_type or "image/png"


def _image_mime(extension: str, content_type: str = "") -> str:
    if content_type.startswith("image/"):
        return content_type
    return mimetypes.guess_type(f"image{extension}")[0] or "image/png"


def _vision_markdown(client: VisionLLMClient | None, data: bytes, mime: str, context: str) -> tuple[str, str]:
    if client is None:
        return "", ""
    try:
        ready_data, ready_mime = _vision_ready_bytes(data, mime)
        result = client.parse_image(ready_data, ready_mime, context=context)
        return result.as_markdown(), ""
    except VisionParseError as exc:
        return "", str(exc)


def _pdf_vision_markdown(client: VisionLLMClient | None, data: bytes, context: str) -> tuple[str, list[str]]:
    if client is None:
        return "", []
    try:
        import fitz
    except ImportError:
        return "", ["PDF 可能是扫描件，但未安装 PyMuPDF，无法分页识别"]
    pages: list[str] = []
    warnings: list[str] = []
    document = fitz.open(stream=data, filetype="pdf")
    try:
        for index, page in enumerate(document):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image_data = pixmap.tobytes("png")
            markdown, error = _vision_markdown(client, image_data, "image/png", f"{context}，PDF第{index + 1}页")
            if markdown:
                pages.append(f"#### PDF 第 {index + 1} 页\n\n{markdown}")
            if error:
                warnings.append(f"PDF第{index + 1}页：{error}")
    finally:
        document.close()
    return "\n\n".join(pages), warnings


def _parse_attachment(
    resource: DownloadedResource,
    client: VisionLLMClient | None,
    embedded_dir: Path,
    markdown_path: Path,
    context: str,
) -> tuple[str, list[str]]:
    warnings: list[str] = []
    ext = resource.extension
    text = ""
    if ext == ".xlsx":
        try:
            text = _xlsx_markdown(resource.data)
        except Exception as exc:
            warnings.append(f"XLSX表格解析失败：{exc}")
    elif ext == ".docx":
        try:
            text = _markitdown_bytes(resource.data, ext)
        except Exception:
            text = _docx_fallback(resource.data)
    elif ext == ".pdf":
        markitdown_error = ""
        try:
            text = _markitdown_bytes(resource.data, ext)
        except Exception as exc:
            markitdown_error = str(exc)
        if not text:
            text = _pdf_text_fallback(resource.data)
        if not text and markitdown_error:
            warnings.append(f"PDF文本解析失败：{markitdown_error}")
        # 文字极少时视为扫描件，逐页交给 Qwen，不设固定页数上限。
        chinese_count = len(re.findall(r"[\u4e00-\u9fff]", text))
        if chinese_count < 100:
            vision_text, pdf_warnings = _pdf_vision_markdown(client, resource.data, context)
            warnings.extend(pdf_warnings)
            if vision_text:
                text = vision_text
    elif ext in IMAGE_EXTENSIONS:
        text, error = _vision_markdown(client, resource.data, _image_mime(ext, resource.content_type), context)
        if error:
            warnings.append(error)
    elif ext == ".doc":
        try:
            text = _markitdown_bytes(resource.data, ext)
        except Exception:
            text = ""
        if not text:
            text = _legacy_doc_text(resource.data)
        if not text:
            warnings.append("DOC 文本解析失败：未找到可用的旧版 DOC 转换器")
    else:
        try:
            text = _markitdown_bytes(resource.data, ext)
        except Exception as exc:
            warnings.append(f"文档解析失败：{exc}")

    embedded_parts: list[str] = []
    for name, image_data in _embedded_images(resource.data, ext):
        image_ext = _magic_extension(image_data) or Path(name).suffix.lower() or ".png"
        image_resource = DownloadedResource(
            url=resource.url,
            data=image_data,
            content_type=_image_mime(image_ext),
            filename=name,
            extension=image_ext,
        )
        image_path = _save_download(image_resource, embedded_dir, name)
        relative = _relative_url(image_path, markdown_path)
        vision_text, error = _vision_markdown(client, image_data, _image_mime(image_ext), f"{context}，附件内嵌图片{name}")
        block = [f"![附件内嵌图片 {name}]({relative})"]
        if vision_text:
            block.append(vision_text)
        if error:
            warnings.append(f"{name}：{error}")
        embedded_parts.append("\n\n".join(block))

    parts = [part for part in (text.strip(), "\n\n".join(embedded_parts)) if part]
    return "\n\n".join(parts), warnings


def _build_vision_client(options: ExportResourceOptions, report: ResourceReport) -> VisionLLMClient | None:
    if not options.parse_images:
        return None
    if not options.api_key:
        report.warnings.append("未配置 API Key，已保留图片和附件，但未执行 OCR/多模态解析")
        return None
    try:
        kwargs: dict[str, Any] = {"api_key": options.api_key, "model": options.model}
        if options.base_url:
            kwargs["base_url"] = options.base_url
        return VisionLLMClient(**kwargs)
    except VisionParseError as exc:
        report.warnings.append(str(exc))
        return None


def process_export_resources(
    *,
    soup: BeautifulSoup,
    rendered_html: str,
    final_url: str,
    markdown_path: str | Path,
    options: ExportResourceOptions,
    discovered_links: list[dict[str, Any]] | None = None,
    discovered_images: list[dict[str, Any]] | None = None,
) -> ResourceReport:
    """修改 soup 中的链接/图片，并返回需要追加到 Markdown 的附件内容。"""
    markdown_path = Path(markdown_path)
    asset_root = markdown_path.parent / f"{markdown_path.stem}_assets"
    image_dir = asset_root / "images"
    attachment_dir = asset_root / "attachments"
    embedded_dir = attachment_dir / "embedded"
    report = ResourceReport()
    vision_client = _build_vision_client(options, report)

    full_soup = BeautifulSoup(rendered_html or "", "lxml")
    base_tag = full_soup.find("base", href=True)
    base_href = str(base_tag.get("href")) if base_tag else ""

    # 无论是否下载附件，Markdown 里的链接都必须是可打开的完整地址。
    for anchor in soup.find_all("a", href=True):
        absolute = normalize_resource_url(str(anchor.get("href")), final_url, base_href)
        if absolute:
            anchor["href"] = absolute

    processed_image_urls: set[str] = set()
    saved_image_hashes: dict[str, Path] = {}
    if options.localize_images:
        for image in list(soup.find_all("img")):
            raw_source = _image_source(image)
            absolute = normalize_resource_url(raw_source, final_url, base_href)
            if not absolute:
                continue
            processed_image_urls.add(absolute)
            try:
                resource = download_resource(absolute, referer=final_url)
                if resource.extension not in IMAGE_EXTENSIONS and not resource.content_type.startswith("image/"):
                    raise ValueError("资源不是图片")
                digest = hashlib.sha256(resource.data).hexdigest()
                image_path = saved_image_hashes.get(digest)
                if image_path is None:
                    preferred = Path(unquote(urlparse(absolute).path)).name or resource.filename
                    image_path = _save_download(resource, image_dir, preferred)
                    saved_image_hashes[digest] = image_path
                relative = _relative_url(image_path, markdown_path)
                image["src"] = relative
                for attr in ("srcset", "data-src", "data-original", "data-lazy-src", "data-url"):
                    image.attrs.pop(attr, None)
                alt = str(image.get("alt") or image.get("title") or "政策图片")
                image["alt"] = alt
                vision_text, error = _vision_markdown(
                    vision_client,
                    resource.data,
                    _image_mime(resource.extension, resource.content_type),
                    alt,
                )
                if vision_text:
                    # html2text 会将普通文本节点中的换行压成一行，Markdown 表格
                    # 和列表会因此失效。统一在 Markdown 汇总区原样追加视觉解析结果。
                    report.image_understanding_blocks.append(f"### {alt}\n\n{vision_text}")
                item = ResourceItem(kind="image", source_url=absolute, local_path=relative, title=alt)
                if error:
                    item.status = "partial"
                    item.error = error
                    report.warnings.append(f"图片 {absolute[:120]} OCR失败：{error}")
                report.images.append(item)
            except Exception as exc:
                image["src"] = absolute
                report.images.append(ResourceItem(
                    kind="image", source_url=absolute, status="failed", title=str(image.get("alt") or ""), error=str(exc),
                ))
                report.warnings.append(f"图片下载失败，已保留原地址 {absolute[:120]}：{exc}")
    else:
        for image in soup.find_all("img"):
            absolute = normalize_resource_url(_image_source(image), final_url, base_href)
            if absolute:
                image["src"] = absolute

    # Readability 可能丢掉只含图片的内容块。将原 DOM/Crawl4AI 发现的大图作为补充资源。
    extra_candidates: list[tuple[str, str, float]] = []
    for image in full_soup.find_all("img"):
        source = normalize_resource_url(_image_source(image), final_url, base_href)
        if source:
            extra_candidates.append((source, str(image.get("alt") or image.get("title") or ""), 0.0))
    style_urls = re.findall(r"background-image\s*:\s*url\((['\"]?)(.*?)\1\)", rendered_html or "", re.I)
    extra_candidates.extend((normalize_resource_url(value, final_url, base_href), "", 0.0) for _, value in style_urls)
    for item in discovered_images or []:
        source = normalize_resource_url(str(item.get("src") or item.get("url") or ""), final_url, base_href)
        try:
            score = float(item.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        extra_candidates.append((source, str(item.get("alt") or item.get("title") or ""), score))

    extra_blocks: list[str] = []
    seen_extra: set[str] = set()
    if options.localize_images:
        for absolute, alt, score in extra_candidates:
            if not absolute or absolute in processed_image_urls or absolute in seen_extra:
                continue
            seen_extra.add(absolute)
            if NOISE_IMAGE_RE.search(absolute) and score < 3:
                continue
            try:
                resource = download_resource(absolute, referer=final_url)
                width, height = _image_dimensions(resource.data)
                if score < 3 and width and height and (width < 200 or height < 120):
                    continue
                digest = hashlib.sha256(resource.data).hexdigest()
                image_path = saved_image_hashes.get(digest)
                if image_path is None:
                    image_path = _save_download(resource, image_dir, resource.filename)
                    saved_image_hashes[digest] = image_path
                relative = _relative_url(image_path, markdown_path)
                label = alt or "网页补充图片"
                vision_text, error = _vision_markdown(
                    vision_client, resource.data, _image_mime(resource.extension, resource.content_type), label,
                )
                block = [f"![{label}]({relative})"]
                if vision_text:
                    block.append(vision_text)
                extra_blocks.append("\n\n".join(block))
                report.images.append(ResourceItem(
                    kind="image", source_url=absolute, local_path=relative,
                    title=label, status="partial" if error else "success", error=error,
                ))
            except Exception as exc:
                report.warnings.append(f"补充图片下载失败 {absolute[:120]}：{exc}")
    if extra_blocks:
        report.extra_image_markdown = "## 网页图片\n\n" + "\n\n".join(extra_blocks)

    if options.parse_attachments:
        attachment_candidates: list[tuple[str, str]] = []
        for anchor in full_soup.find_all("a", href=True):
            href = normalize_resource_url(str(anchor.get("href")), final_url, base_href)
            text = anchor.get_text(" ", strip=True) or str(anchor.get("title") or "")
            ext = Path(urlparse(href).path).suffix.lower() if href else ""
            if href and (ext in ATTACHMENT_EXTENSIONS or ATTACHMENT_TEXT_RE.search(text)):
                attachment_candidates.append((href, text))
        for item in discovered_links or []:
            href = normalize_resource_url(str(item.get("href") or item.get("url") or ""), final_url, base_href)
            text = str(item.get("text") or item.get("title") or "")
            ext = Path(urlparse(href).path).suffix.lower() if href else ""
            if href and (ext in ATTACHMENT_EXTENSIONS or ATTACHMENT_TEXT_RE.search(text)):
                attachment_candidates.append((href, text))

        attachment_blocks: list[str] = []
        seen_attachments: set[str] = set()
        for source_url, link_text in attachment_candidates:
            if source_url in seen_attachments:
                continue
            seen_attachments.add(source_url)
            try:
                resource = download_resource(source_url, referer=final_url)
                if resource.extension not in ATTACHMENT_EXTENSIONS:
                    continue
                preferred = link_text or resource.filename
                local_path = _save_download(resource, attachment_dir, preferred) if options.download_originals else None
                relative = _relative_url(local_path, markdown_path) if local_path else ""
                parsed, warnings = _parse_attachment(
                    resource, vision_client, embedded_dir, markdown_path,
                    context=link_text or resource.filename,
                )
                report.warnings.extend(f"{resource.filename}：{warning}" for warning in warnings)
                title = _safe_name(link_text, resource.filename)
                block = [f"### {title}", f"- [原始附件]({source_url})"]
                if relative:
                    block.append(f"- [本地附件]({relative})")
                if parsed:
                    block.append(parsed)
                else:
                    block.append("> 附件已保存，但未提取到可用文字。")
                attachment_blocks.append("\n\n".join(block))
                report.attachments.append(ResourceItem(
                    kind="attachment", source_url=source_url, local_path=relative,
                    title=title, status="partial" if warnings else "success",
                    error="；".join(warnings),
                ))
            except Exception as exc:
                title = link_text or Path(urlparse(source_url).path).name or "附件"
                attachment_blocks.append(
                    f"### {title}\n\n- [原始附件]({source_url})\n\n> 附件下载或解析失败：{exc}"
                )
                report.attachments.append(ResourceItem(
                    kind="attachment", source_url=source_url, status="failed", title=title, error=str(exc),
                ))
                report.warnings.append(f"附件 {source_url[:120]} 处理失败：{exc}")
        if attachment_blocks:
            report.attachment_markdown = "## 附件\n\n" + "\n\n".join(attachment_blocks)

    if report.attachments or report.images or report.warnings:
        asset_root.mkdir(parents=True, exist_ok=True)
        manifest = {
            "source_url": final_url,
            "attachments": [asdict(item) for item in report.attachments],
            "images": [asdict(item) for item in report.images],
            "warnings": report.warnings,
        }
        (asset_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    return report


def process_standalone_document(
    *,
    data: bytes,
    source_url: str,
    content_type: str,
    extension: str,
    markdown_path: str | Path,
    options: ExportResourceOptions,
    title: str = "",
) -> tuple[str, ResourceReport]:
    """处理政策 URL 本身就是附件的情况。"""
    markdown_path = Path(markdown_path)
    asset_root = markdown_path.parent / f"{markdown_path.stem}_assets"
    attachment_dir = asset_root / "attachments"
    report = ResourceReport()
    vision_client = _build_vision_client(options, report)
    filename = Path(unquote(urlparse(source_url).path)).name or f"document{extension or '.bin'}"
    resource = DownloadedResource(
        url=source_url,
        data=data,
        content_type=content_type,
        filename=_safe_name(filename, f"document{extension or '.bin'}"),
        extension=extension or _extension(source_url, content_type, data, filename),
    )
    local_path = _save_download(resource, attachment_dir, resource.filename) if options.download_originals else None
    relative = _relative_url(local_path, markdown_path) if local_path else ""
    parsed, warnings = _parse_attachment(
        resource,
        vision_client,
        attachment_dir / "embedded",
        markdown_path,
        context=title or resource.filename,
    )
    report.warnings.extend(warnings)
    report.attachments.append(ResourceItem(
        kind="attachment",
        source_url=source_url,
        local_path=relative,
        title=title or resource.filename,
        status="partial" if warnings else "success",
        error="；".join(warnings),
    ))
    links = [f"- [原始文件]({source_url})"]
    if relative:
        links.append(f"- [本地文件]({relative})")
    report.attachment_markdown = "## 源文件\n\n" + "\n".join(links)

    asset_root.mkdir(parents=True, exist_ok=True)
    (asset_root / "manifest.json").write_text(json.dumps({
        "source_url": source_url,
        "attachments": [asdict(item) for item in report.attachments],
        "images": [],
        "warnings": report.warnings,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return parsed, report
