"""图片 OCR 工具

将网页正文中的 <img> 标签替换为 OCR 识别后的文本，便于 Markdown 输出包含图片信息。
默认启用，可通过 Settings.OCR_ENABLED 关闭。
"""
import base64
import os
import re
import tempfile
from urllib.parse import urljoin, urlparse

from loguru import logger

from app.config import settings
from app.services.http_utils import fetch_raw_sync

_ocr_engine = None


def _get_ocr_engine():
    """懒加载 RapidOCR 引擎"""
    global _ocr_engine
    if _ocr_engine is not None:
        return _ocr_engine
    if not settings.OCR_ENABLED:
        return None
    try:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
        logger.info("RapidOCR 引擎加载成功")
    except Exception as e:
        logger.warning(f"RapidOCR 加载失败，图片 OCR 将跳过: {e}")
        _ocr_engine = False
    return _ocr_engine


def _decode_data_uri(src: str) -> bytes:
    """解析 data:image/xxx;base64,... 数据 URI"""
    m = re.match(r"data:image/[^;]+;base64,(.+)", src, re.IGNORECASE)
    if not m:
        return b""
    try:
        return base64.b64decode(m.group(1))
    except Exception:
        return b""


def _download_image(src: str, base_url: str) -> bytes:
    """下载图片，支持相对路径、绝对 URL 和 data URI"""
    if src.startswith("data:"):
        return _decode_data_uri(src)

    url = urljoin(base_url, src)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return b""

    try:
        resp = fetch_raw_sync(url, timeout=20)
        return resp.content
    except Exception as e:
        logger.debug(f"图片下载失败 {url[:80]}: {e}")
        return b""


def _ocr_image_bytes(image_bytes: bytes) -> str:
    """对图片字节流执行 OCR，返回识别到的文本"""
    if not image_bytes:
        return ""

    engine = _get_ocr_engine()
    if not engine:
        return ""

    # RapidOCR 需要文件路径，写入临时文件
    suffix = ".png"
    # 尝试根据 magic bytes 判断真实格式
    if image_bytes.startswith(b"\xff\xd8"):
        suffix = ".jpg"
    elif image_bytes.startswith(b"\x89PNG"):
        suffix = ".png"
    elif image_bytes.startswith(b"GIF"):
        suffix = ".gif"
    elif image_bytes.startswith(b"RIFF"):
        suffix = ".webp"

    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(image_bytes)
        result = engine(tmp_path)
        # result 格式：[[box, text, score], ...] 或 (result, elapse)
        if isinstance(result, tuple):
            result = result[0]
        texts = []
        if isinstance(result, list):
            for item in result:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    text = item[1]
                    if isinstance(text, str):
                        texts.append(text)
                elif isinstance(item, str):
                    texts.append(item)
        return "\n".join(texts).strip()
    except Exception as e:
        logger.debug(f"OCR 识别失败: {e}")
        return ""
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


def process_images_with_ocr(soup, base_url: str) -> None:
    """将 soup 中的图片替换为 OCR 文本"""
    if not settings.OCR_ENABLED:
        return

    max_size = 5 * 1024 * 1024  # 5MB
    max_images = 20  # 单页最多处理 20 张图片，避免过大开销

    for idx, img in enumerate(list(soup.find_all("img"))):
        if idx >= max_images:
            # 超出数量限制的图片保留原样，避免批量页面耗时过长
            break
        src = img.get("src") or img.get("data-src") or ""
        if not src:
            img.decompose()
            continue

        image_bytes = _download_image(src, base_url)
        if not image_bytes or len(image_bytes) > max_size:
            # 无法下载或过大时，保留 alt 文本作为fallback
            alt = img.get("alt", "")
            if alt:
                span = soup.new_tag("span")
                span.string = f"【图片：{alt}】"
                img.replace_with(span)
            else:
                img.decompose()
            continue

        text = _ocr_image_bytes(image_bytes)
        if text:
            div = soup.new_tag("div", **{"class": "ocr-result"})
            div.string = f"【图片内容】{text}"
            img.replace_with(div)
        else:
            alt = img.get("alt", "")
            if alt:
                span = soup.new_tag("span")
                span.string = f"【图片：{alt}】"
                img.replace_with(span)
            else:
                img.decompose()
