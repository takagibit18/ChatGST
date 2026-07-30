# -*- coding: utf-8 -*-
"""
gov_policy_to_okf.py — 政府政策网页 → OKF Markdown 转换器

将政府政策网页（HTML）转换为符合 Open Knowledge Format (OKF) 规范的 Markdown 文件。

用法:
  python gov_policy_to_okf.py --url <网页URL> --output <输出目录> [--region <地区>] [--type <类型>]
  python gov_policy_to_okf.py --file <本地HTML路径> --output <输出目录> [--region <地区>] [--type <类型>]
  python gov_policy_to_okf.py --batch <URL列表JSON> --output <输出目录>

OKF 规范要点:
  - YAML frontmatter: 必填 type, 推荐 title/description/resource/tags/timestamp/region
  - Markdown body: 结构化内容，保留标题层级、表格、列表、引用
  - 概念ID = 文件路径
  - index.md 做 Bundle 目录, log.md 做变更日志
"""

import argparse
import json
import os
import re
import sys
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup, Tag
from readability import Document
import html2text
from markitdown import MarkItDown

from app.services.http_utils import fetch_html_sync, fetch_raw_sync, is_bad_title as _is_bad_title
from app.services.export_assets import (
    ExportResourceOptions,
    process_export_resources,
    process_standalone_document,
)
from app.services.region_parser import extract_region_from_text
from app.services.web_capture import CapturedPage, capture_page_sync
from app.config import settings


# ── html2text 配置 ──────────────────────────────────────────
def _make_h2t() -> html2text.HTML2Text:
    h = html2text.HTML2Text()
    h.body_width = 0            # 不自动换行
    h.unicode_snob = True
    h.protect_links = True
    h.wrap_links = False
    h.mark_code = True
    h.decode_errors = "ignore"
    h.single_line_break = False
    h.skip_internal_links = True
    return h


# ── 网页抓取（委托给共享 http_utils 模块） ─────────────────────
def fetch_html(url: str, timeout: int = 30) -> tuple[str, str]:
    """抓取网页，返回 (html, final_url)，使用共享模块的 UA 轮换 + SSL 降级 + 编码检测"""
    html, final_url = fetch_html_sync(url, timeout=timeout)
    # 修复双重编码
    html = _fix_double_encoding(html)
    return html, final_url


def _fetch_raw(url: str, timeout: int = 30) -> httpx.Response:
    """发起 HTTP 请求返回原始 Response（委托给共享模块）"""
    return fetch_raw_sync(url, timeout=timeout)


# ── HTML 正文提取 ────────────────────────────────────────────

def _extract_policy_title(soup: BeautifulSoup) -> str:
    """从 HTML 正文尝试提取政策标题（优先级高于网页标题）"""
    # 1. 尝试找 <h1> 或 class 含 title 的元素
    for tag in soup.find_all(["h1", "h2"]):
        text = tag.get_text(strip=True)
        if text and 5 <= len(text) <= 100 and re.search(r"[\u4e00-\u9fff]", text):
            if not _is_bad_title(text):
                return text

    # 2. 尝试找 class 含 title 的 div/p（排除"办事指南"等通用标题）
    for tag in soup.find_all(["div", "p", "span"], class_=re.compile(r"title|heading|arti", re.I)):
        text = tag.get_text(strip=True)
        if text and 8 <= len(text) <= 100 and re.search(r"[\u4e00-\u9fff]", text):
            if not _is_bad_title(text) and text not in ("办事指南", "政策文件", "通知公告"):
                return text

    # 3. 尝试找 P_title 类（四川政务服务网特有）
    for tag in soup.find_all("p", class_=re.compile(r"P_title|task.*title", re.I)):
        text = tag.get_text(strip=True)
        if text and 5 <= len(text) <= 100 and re.search(r"[\u4e00-\u9fff]", text):
            if not _is_bad_title(text):
                return text

    # 4. 政务服务网特有：item-title / detail-title 类
    for tag in soup.find_all(["div", "p", "span"], class_=re.compile(r"item.*title|detail.*title|ywTrans.*title", re.I)):
        text = tag.get_text(strip=True)
        if text and 5 <= len(text) <= 100 and re.search(r"[\u4e00-\u9fff]", text):
            if not _is_bad_title(text) and text not in ("办事指南", "政策文件", "通知公告"):
                return text

    # 5. 尝试找加粗文本中的政策标题（常见于政府公文）
    for tag in soup.find_all(["strong", "b"]):
        text = tag.get_text(strip=True)
        # 政策标题通常含"方案""办法""细则"等关键词，且较长
        if (text and 8 <= len(text) <= 80
                and re.search(r"[\u4e00-\u9fff]", text)
                and re.search(r"实施方案|实施细则|政策解读|衔接办法", text)
                and not _is_bad_title(text)):
            return text

    return ""


def _extract_title_from_full_html(html: str) -> str:
    """从完整 HTML 中搜索政策标题（readibility 正文失败时的回退）"""
    full_soup = BeautifulSoup(html, "lxml")

    # 0. 政务服务网特殊处理：从特定位置提取实际业务标题
    # 政务服务网通常把标题放在 class 包含 "item-name"、"title"、"detail-title" 的元素中
    for selector in [
        {"tag": "div", "class": re.compile(r"item-name|item-title", re.I)},
        {"tag": "span", "class": re.compile(r"item-name|item-title", re.I)},
        {"tag": "div", "class": re.compile(r"detail-title|detail-title-text", re.I)},
        {"tag": "span", "class": re.compile(r"detail-title|detail-title-text", re.I)},
        {"tag": "div", "class": re.compile(r"ywTrans.*title|transition.*title", re.I)},
    ]:
        for tag in full_soup.find_all(selector["tag"], class_=selector["class"]):
            text = tag.get_text(strip=True)
            if text and 5 <= len(text) <= 100 and re.search(r"[\u4e00-\u9fff]", text):
                if not _is_bad_title(text) and text not in ("办事指南", "政策文件", "通知公告", "详情"):
                    return text

    # 0.5 政务服务网特殊处理：从"审批结果名称"表格行提取业务标题
    # 表格结构：
    # 审批结果类型 | 审批结果名称 | 审批结果样本
    # --- | --- | ---
    # 其他 | 80周岁以上老年人高龄津贴出资证明 | 无
    for table in full_soup.find_all("table"):
        rows = table.find_all("tr")
        for row_idx, row in enumerate(rows):
            cells = row.find_all(["td", "th"])
            # 查找包含"审批结果名称"或"事项名称"的单元格
            for i, cell in enumerate(cells):
                cell_text = cell.get_text(strip=True)
                if cell_text in ("审批结果名称", "事项名称", "业务名称"):
                    # 检查下一行（数据行）中对应位置的值
                    if row_idx + 1 < len(rows):
                        next_row = rows[row_idx + 1]
                        next_cells = next_row.find_all(["td", "th"])
                        if i < len(next_cells):
                            name_text = next_cells[i].get_text(strip=True)
                            if name_text and 5 <= len(name_text) <= 100 and name_text != "无":
                                # 去掉"出资证明"、"审批表"等后缀
                                clean_name = re.sub(r"(出资证明|审批表|登记表|证明书)$", "", name_text)
                                if len(clean_name) >= 5:
                                    return clean_name

    # 1. 找 article-content / arti-content / pages_content 等常见 CSS class
    for cls_pattern in [r"arti.*content", r"article.*content", r"content.*main", r"zoom", r"pages_content", r"article.*con", r"detail.*content"]:
        container = full_soup.find(class_=re.compile(cls_pattern, re.I))
        if container:
            title = _extract_policy_title(container)
            if title:
                return title

    # 2. 从全文找加粗政策标题
    title = _extract_policy_title(full_soup)
    if title:
        return title

    # 3. 从 <title> 标签中文部分提取
    title_tag = full_soup.find("title")
    if title_tag:
        raw = title_tag.get_text(strip=True)
        # 提取中书名号内容
        book_match = re.search(r"《(.+?)》", raw)
        if book_match:
            inner = book_match.group(1)
            suffix = ""
            # 尝试从原文推测类型——仅当书名号内容本身不包含该后缀时才拼接
            if "实施方案" in raw and "实施方案" not in inner:
                suffix = "实施方案"
            elif "实施细则" in raw and "实施细则" not in inner:
                suffix = "实施细则"
            elif "政策解读" in raw and "政策解读" not in inner:
                suffix = "政策解读"
            return f"{inner}{suffix}" if suffix else inner
        
        # 政务服务网格式："80周岁以上老年人高龄津贴发放-四川政务服务网"
        # 去掉"政务服务网"、"人民政府"等后缀
        title_from_tag = raw
        for suffix_pattern in [
            r"[-_|·—]\s*.+政务服务网.*$",
            r"[-_|·—]\s*.+人民政府.*$",
            r"[-_|·—]\s*.+政府网.*$",
            r"[-_|·—]\s*.+门户网站.*$",
        ]:
            new_title = re.sub(suffix_pattern, "", title_from_tag)
            if len(new_title) >= 5 and new_title != title_from_tag:
                title_from_tag = new_title
                break
        
        # 如果清理后的标题不是通用词，就使用它
        if title_from_tag and title_from_tag not in ("办事指南", "政策文件", "通知公告", "详情"):
            if not _is_bad_title(title_from_tag):
                return title_from_tag

    # 4. 从 meta description / og:title 中提取
    for meta in full_soup.find_all("meta"):
        name = (meta.get("name") or "").lower()
        prop = (meta.get("property") or "").lower()
        if name in ("description",) or prop in ("og:title",):
            content = meta.get("content", "")
            book_match = re.search(r"《(.+?)》", content)
            if book_match:
                return book_match.group(1)
            # 如果内容像标题（不太长且含中文）
            if content and 8 <= len(content) <= 80 and re.search(r"[\u4e00-\u9fff]", content):
                if not _is_bad_title(content):
                    return content

    return ""


def _clean_title(raw_title: str) -> str:
    """清理网页标题（去掉门户网站名等后缀）"""
    title = raw_title.strip()

    # 去掉面包屑导航
    if _is_bad_title(title):
        return ""

    # 政务服务网特殊处理：如果标题是"办事指南-四川政务服务网"这种格式
    # 说明这是通用标题，返回空让后续逻辑从正文提取
    if re.search(r"^办事指南[-_|·—].+政务服务网", title):
        return ""

    # 去掉标题末尾的日期+来源（如"2025-09-11来源：普陀区人民政府字号：大中小"）
    title = re.sub(r"\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*来源[：:]\s*.+$", "", title)
    title = re.sub(r"\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*来源[：:]\s*.+$", "", title)
    # 去掉"字号：大中小"等
    title = re.sub(r"字号[：:]\s*.+$", "", title)

    # 常见门户网站后缀模式
    patterns = [
        r"\s*[-_|·—]\s*.+(政府|门户|网|之窗|在线|资讯|频道|首页|网站).*$",
        r"\s*[-_|·—]\s*.+$",
    ]
    for pat in patterns:
        new = re.sub(pat, "", title)
        if len(new) >= 4:  # 清理后不要太短
            title = new
    return title.strip()


def _finalize_title(title: str) -> str:
    """对最终标题做去重后缀、去重前缀等标准化处理"""
    title = title.strip()
    # 去掉标题末尾的日期+来源（如"2025-09-11来源：普陀区人民政府字号：大中小"）
    title = re.sub(r"\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*来源[：:]\s*.+$", "", title)
    title = re.sub(r"\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*来源[：:]\s*.+$", "", title)
    title = re.sub(r"字号[：:]\s*.+$", "", title)
    # 标题中的管道符替换为破折号（避免 Markdown 表格和文件名冲突）
    title = title.replace("|", "—")
    # 去掉重复的政策类型后缀（如"实施方案实施方案"→"实施方案"）
    for kw in ["实施方案", "实施细则", "政策解读", "衔接办法", "通知", "公告"]:
        double = kw + kw
        if double in title:
            title = title.replace(double, kw)
    # 去掉重复/嵌套的前缀（如"政策解读：视频解读："→"视频解读："）
    prefix_patterns = [
        (r"政策解读[：:]\s*政策解读[：:]\s*", "政策解读："),
        (r"政策解读[：:]\s*视频解读[：:]\s*", "视频解读："),
        (r"视频解读[：:]\s*视频解读[：:]\s*", "视频解读："),
    ]
    for pat, repl in prefix_patterns:
        if re.search(pat, title):
            title = re.sub(pat, repl, title)
    return title


def extract_main_content(html: str) -> tuple[str, BeautifulSoup]:
    """用 readability 提取主体内容，返回 (标题, 正文soup)
    
    特殊处理：保留原始 HTML 中的表格元素（readability 可能会过滤掉）
    """
    doc = Document(html)
    raw_title = _clean_title(doc.title())
    summary_html = doc.summary()
    soup = BeautifulSoup(summary_html, "lxml")

    # 检查 readability 提取的正文是否过短
    text_len = len(soup.get_text(strip=True))
    
    # 如果正文太短（少于200字），尝试从原始HTML提取主要内容
    if text_len < 200:
        print(f"[DEBUG] readability提取正文过短({text_len}字)，尝试备用提取方案")
        soup = _extract_content_fallback(html, soup)

    # 从原始 HTML 提取表格（readability 可能会过滤掉）
    original_soup = BeautifulSoup(html, "lxml")
    original_tables = original_soup.find_all("table")
    
    if original_tables:
        # 检查 readability 提取结果中是否缺少表格
        extracted_tables = soup.find_all("table")
        if len(extracted_tables) < len(original_tables):
            # 将原始表格追加到正文末尾
            for table in original_tables:
                # 移除表格中的脚本和样式
                for script in table.find_all("script"):
                    script.decompose()
                for style in table.find_all("style"):
                    style.decompose()
                soup.append(table)

    # 尝试从正文提取更好标题
    body_title = _extract_policy_title(soup)
    if not body_title:
        # 回退：从完整 HTML 搜索
        body_title = _extract_title_from_full_html(html)
    title = body_title if body_title else raw_title
    # 对最终标题应用清理（去重后缀和前缀）
    title = _finalize_title(title)

    return title, soup


def _extract_content_fallback(html: str, current_soup: BeautifulSoup) -> BeautifulSoup:
    """当readability提取内容过短时，尝试从原始HTML提取主要内容"""
    original_soup = BeautifulSoup(html, "lxml")
    
    # 移除导航、脚本、样式等无关元素
    for tag in original_soup.find_all(["nav", "script", "style", "header", "footer"]):
        tag.decompose()
    
    # 政务网站的常见正文容器优先级。问答页面正文可能只有几十字，
    # 因此对明确的正文 ID/class 使用较低阈值；通用 content 容器仍保持
    # 较高阈值，避免把导航栏误当正文。
    content_selectors = [
        ("#mainText", 10),
        (".TRS_UEDITOR", 10),
        (".TRS_Editor", 10),
        ("[class*='article-content']", 20),
        ("[class*='article_content']", 20),
        ("article", 20),
        (".main-content", 40),
        (".detail-content", 40),
        ("#content", 80),
        (".contentBox", 80),
        (".article", 80),
        (".content", 120),
        ("[class*='article']", 120),
        ("[class*='content']", 120),
        ("[class*='detail']", 120),
    ]

    for selector, min_text_length in content_selectors:
        container = original_soup.select_one(selector)
        if not container:
            continue
        text_length = len(container.get_text(strip=True))
        has_resource = bool(container.find(["img", "table", "video", "audio", "iframe"]))
        if text_length >= min_text_length or has_resource:
            print(
                f"[DEBUG] 从备用容器提取到内容: selector={selector} "
                f"text_len={text_length}"
            )
            return BeautifulSoup(str(container), "lxml")
    
    # 如果都没找到，返回原始HTML（已移除导航等）
    print(f"[DEBUG] 备用提取方案也未找到合适内容，使用清理后的HTML")
    return original_soup


# ── 表格修复 ────────────────────────────────────────────────
def fix_tables(soup: BeautifulSoup) -> None:
    """修复 HTML 表格：确保 thead/tbody 结构正确，合并单元格标记"""
    for table in soup.find_all("table"):
        # 确保第一行在 thead
        if not table.find("thead"):
            first_tr = table.find("tr")
            if first_tr:
                thead = soup.new_tag("thead")
                first_tr.wrap(thead)
                # 将 th/td 转为 th
                for cell in first_tr.find_all(["td", "th"]):
                    cell.name = "th"
        # 剩余行放 tbody
        if not table.find("tbody"):
            tbody = soup.new_tag("tbody")
            trs = table.find_all("tr")
            for tr in trs[1:]:
                tbody.append(tr.extract())
            if tbody.contents:
                table.append(tbody)


# ── 清理 Markdown ───────────────────────────────────────────
def clean_markdown(md_text: str) -> str:
    """清理和美化 Markdown 输出"""
    lines = md_text.split("\n")
    cleaned = []
    prev_blank = False

    for line in lines:
        stripped = line.strip()

        # 跳过连续空行（最多保留1个空行）
        if not stripped:
            if not prev_blank:
                cleaned.append("")
            prev_blank = True
            continue
        prev_blank = False

        # 修复 html2text 产生的行内样式残留
        stripped = re.sub(r"\{[^}]*\}", "", stripped)

        # 清理残留 HTML 标签（保留 <br> 等无害标签）
        stripped = re.sub(r"</?(?:span|div|font|em|i|strong|b|u|sub|sup)\b[^>]*>", "", stripped)

        # 清理多余的 &nbsp;
        stripped = stripped.replace("\xa0", " ")

        # 清理 markdown 图片中的 data: URI（过长）
        stripped = re.sub(r"!\[([^\]]*)\]\(data:[^)]+\)", r"![\1]", stripped)

        # 清理残留的 readability 标记
        if stripped.startswith("<!--") or stripped.startswith("//<![CDATA"):
            continue

        cleaned.append(stripped)

    result = "\n".join(cleaned)

    # 标题前后加空行
    result = re.sub(r"(\n)(#{1,6}\s)", r"\1\n\2", result)
    result = re.sub(r"(#{1,6}\s[^\n]+)(\n[^#\n])", r"\1\n\2", result)

    return result.strip() + "\n"


# ── 从网页内容推断政策类型 ──────────────────────────────────
def infer_policy_type(title: str, content: str) -> str:
    """根据标题和内容推断政策文档类型
    
    限定范围：法律法规、政策规章、官方解读、办事指南、其它
    """
    title_lower = title.lower() if title else ""
    content_lower = content[:2000].lower() if content else ""

    # 按优先级顺序匹配
    type_keywords = {
        "法律法规": ["法律", "法规", "条例", "规定", "办法", "决定", "条例"],
        "政策规章": ["政策", "规章", "制度", "规范", "意见", "通知", "公告", "通告", "实施方案", "实施细则", "操作细则"],
        "官方解读": ["解读", "政策解读", "问答", "常见问题", "faq", "一图读懂"],
        "办事指南": ["办事指南", "办理指南", "申领指南", "操作指南", "申请指南", "服务指南"],
    }
    
    # 先匹配标题
    for ptype, keywords in type_keywords.items():
        for kw in keywords:
            if kw in title_lower:
                return ptype

    # 再匹配内容
    for ptype, keywords in type_keywords.items():
        for kw in keywords:
            if kw in content_lower:
                return ptype

    return "其它"


# ── 从内容推断地区 ──────────────────────────────────────────
# 地区规范化映射：短名 → 全称（带行政层级）
REGION_FULL_NAMES = {
    # 直辖市
    "北京": "北京市",
    "天津": "天津市",
    "上海": "上海市",
    "重庆": "重庆市",
    # 省份
    "河北": "河北省",
    "山西": "山西省",
    "辽宁": "辽宁省",
    "吉林": "吉林省",
    "黑龙江": "黑龙江省",
    "江苏": "江苏省",
    "浙江": "浙江省",
    "安徽": "安徽省",
    "福建": "福建省",
    "江西": "江西省",
    "山东": "山东省",
    "河南": "河南省",
    "湖北": "湖北省",
    "湖南": "湖南省",
    "广东": "广东省",
    "海南": "海南省",
    "四川": "四川省",
    "贵州": "贵州省",
    "云南": "云南省",
    "陕西": "陕西省",
    "甘肃": "甘肃省",
    "青海": "青海省",
    "台湾": "台湾省",
    # 自治区
    "内蒙古": "内蒙古自治区",
    "广西": "广西壮族自治区",
    "西藏": "西藏自治区",
    "宁夏": "宁夏回族自治区",
    "新疆": "新疆维吾尔自治区",
    # 计划单列市/省会
    "深圳": "深圳市",
    "杭州": "杭州市",
    "成都": "成都市",
    "武汉": "武汉市",
    "南京": "南京市",
    "广州": "广州市",
}

# 地级市/州 → 所属省份
CITY_TO_PROVINCE = {
    # 四川省
    "成都市": "四川省", "自贡市": "四川省", "攀枝花市": "四川省",
    "泸州市": "四川省", "德阳市": "四川省", "绵阳市": "四川省",
    "广元市": "四川省", "遂宁市": "四川省", "内江市": "四川省",
    "乐山市": "四川省", "南充市": "四川省", "眉山市": "四川省",
    "宜宾市": "四川省", "广安市": "四川省", "达州市": "四川省",
    "雅安市": "四川省", "巴中市": "四川省", "资阳市": "四川省",
    "阿坝州": "四川省", "甘孜州": "四川省", "凉山州": "四川省",
    # 广东省
    "广州市": "广东省", "深圳市": "广东省", "珠海市": "广东省",
    "汕头市": "广东省", "佛山市": "广东省", "韶关市": "广东省",
    "湛江市": "广东省", "肇庆市": "广东省", "江门市": "广东省",
    "茂名市": "广东省", "惠州市": "广东省", "梅州市": "广东省",
    "汕尾市": "广东省", "河源市": "广东省", "阳江市": "广东省",
    "清远市": "广东省", "东莞市": "广东省", "中山市": "广东省",
    "潮州市": "广东省", "揭阳市": "广东省", "云浮市": "广东省",
    # 江苏省
    "南京市": "江苏省", "无锡市": "江苏省", "徐州市": "江苏省",
    "常州市": "江苏省", "苏州市": "江苏省", "南通市": "江苏省",
    "连云港市": "江苏省", "淮安市": "江苏省", "盐城市": "江苏省",
    "扬州市": "江苏省", "镇江市": "江苏省", "泰州市": "江苏省",
    "宿迁市": "江苏省",
    # 浙江省
    "杭州市": "浙江省", "宁波市": "浙江省", "温州市": "浙江省",
    "嘉兴市": "浙江省", "湖州市": "浙江省", "绍兴市": "浙江省",
    "金华市": "浙江省", "衢州市": "浙江省", "舟山市": "浙江省",
    "台州市": "浙江省", "丽水市": "浙江省",
    # 湖北省
    "武汉市": "湖北省", "黄石市": "湖北省", "十堰市": "湖北省",
    "宜昌市": "湖北省", "襄阳市": "湖北省", "鄂州市": "湖北省",
    "荆门市": "湖北省", "孝感市": "湖北省", "荆州市": "湖北省",
    "黄冈市": "湖北省", "咸宁市": "湖北省", "随州市": "湖北省",
    # 山东省
    "济南市": "山东省", "青岛市": "山东省", "淄博市": "山东省",
    "枣庄市": "山东省", "东营市": "山东省", "烟台市": "山东省",
    "潍坊市": "山东省", "济宁市": "山东省", "泰安市": "山东省",
    "威海市": "山东省", "日照市": "山东省", "临沂市": "山东省",
    "德州市": "山东省", "聊城市": "山东省", "滨州市": "山东省",
    "菏泽市": "山东省",
    # 河南省
    "郑州市": "河南省", "开封市": "河南省", "洛阳市": "河南省",
    "平顶山市": "河南省", "安阳市": "河南省", "鹤壁市": "河南省",
    "新乡市": "河南省", "焦作市": "河南省", "濮阳市": "河南省",
    "许昌市": "河南省", "漯河市": "河南省", "三门峡市": "河南省",
    "南阳市": "河南省", "商丘市": "河南省", "信阳市": "河南省",
    "周口市": "河南省", "驻马店市": "河南省",
    # 湖南省
    "长沙市": "湖南省", "株洲市": "湖南省", "湘潭市": "湖南省",
    "衡阳市": "湖南省", "邵阳市": "湖南省", "岳阳市": "湖南省",
    "常德市": "湖南省", "张家界市": "湖南省", "益阳市": "湖南省",
    "郴州市": "湖南省", "永州市": "湖南省", "怀化市": "湖南省",
    "娄底市": "湖南省",
    # 河北省
    "石家庄市": "河北省", "唐山市": "河北省", "秦皇岛市": "河北省",
    "邯郸市": "河北省", "邢台市": "河北省", "保定市": "河北省",
    "张家口市": "河北省", "承德市": "河北省", "沧州市": "河北省",
    "廊坊市": "河北省", "衡水市": "河北省",
    # 陕西省
    "西安市": "陕西省", "铜川市": "陕西省", "宝鸡市": "陕西省",
    "咸阳市": "陕西省", "渭南市": "陕西省", "延安市": "陕西省",
    "汉中市": "陕西省", "榆林市": "陕西省", "安康市": "陕西省",
    "商洛市": "陕西省",
    # 福建省
    "福州市": "福建省", "厦门市": "福建省", "莆田市": "福建省",
    "三明市": "福建省", "泉州市": "福建省", "漳州市": "福建省",
    "南平市": "福建省", "龙岩市": "福建省", "宁德市": "福建省",
    # 安徽省
    "合肥市": "安徽省", "芜湖市": "安徽省", "蚌埠市": "安徽省",
    "淮南市": "安徽省", "马鞍山市": "安徽省", "淮北市": "安徽省",
    "铜陵市": "安徽省", "安庆市": "安徽省", "黄山市": "安徽省",
    "滁州市": "安徽省", "阜阳市": "安徽省", "宿州市": "安徽省",
    "六安市": "安徽省", "亳州市": "安徽省", "池州市": "安徽省",
    "宣城市": "安徽省",
    # 江西省
    "南昌市": "江西省", "景德镇市": "江西省", "萍乡市": "江西省",
    "九江市": "江西省", "新余市": "江西省", "鹰潭市": "江西省",
    "赣州市": "江西省", "吉安市": "江西省", "宜春市": "江西省",
    "抚州市": "江西省", "上饶市": "江西省",
    # 辽宁省
    "沈阳市": "辽宁省", "大连市": "辽宁省", "鞍山市": "辽宁省",
    "抚顺市": "辽宁省", "本溪市": "辽宁省", "丹东市": "辽宁省",
    "锦州市": "辽宁省", "营口市": "辽宁省", "阜新市": "辽宁省",
    "辽阳市": "辽宁省", "盘锦市": "辽宁省", "铁岭市": "辽宁省",
    "朝阳市": "辽宁省", "葫芦岛市": "辽宁省",
    # 吉林省
    "长春市": "吉林省", "吉林市": "吉林省", "四平市": "吉林省",
    "辽源市": "吉林省", "通化市": "吉林省", "白山市": "吉林省",
    "松原市": "吉林省", "白城市": "吉林省",
    # 黑龙江省
    "哈尔滨市": "黑龙江省", "齐齐哈尔市": "黑龙江省", "鸡西市": "黑龙江省",
    "鹤岗市": "黑龙江省", "双鸭山市": "黑龙江省", "大庆市": "黑龙江省",
    "伊春市": "黑龙江省", "佳木斯市": "黑龙江省", "七台河市": "黑龙江省",
    "牡丹江市": "黑龙江省", "黑河市": "黑龙江省", "绥化市": "黑龙江省",
    # 云南省
    "昆明市": "云南省", "曲靖市": "云南省", "玉溪市": "云南省",
    "保山市": "云南省", "昭通市": "云南省", "丽江市": "云南省",
    "普洱市": "云南省", "临沧市": "云南省",
    "楚雄州": "云南省", "红河州": "云南省", "文山州": "云南省",
    "西双版纳州": "云南省", "大理州": "云南省", "德宏州": "云南省",
    "怒江州": "云南省", "迪庆州": "云南省",
    # 贵州省
    "贵阳市": "贵州省", "六盘水市": "贵州省", "遵义市": "贵州省",
    "安顺市": "贵州省", "毕节市": "贵州省", "铜仁市": "贵州省",
    # 甘肃省
    "兰州市": "甘肃省", "嘉峪关市": "甘肃省", "金昌市": "甘肃省",
    "白银市": "甘肃省", "天水市": "甘肃省", "武威市": "甘肃省",
    "张掖市": "甘肃省", "平凉市": "甘肃省", "酒泉市": "甘肃省",
    "庆阳市": "甘肃省", "定西市": "甘肃省", "陇南市": "甘肃省",
    # 海南省
    "海口市": "海南省", "三亚市": "海南省", "三沙市": "海南省",
    "儋州市": "海南省",
    # 山西省
    "太原市": "山西省", "大同市": "山西省", "阳泉市": "山西省",
    "长治市": "山西省", "晋城市": "山西省", "朔州市": "山西省",
    "晋中市": "山西省", "运城市": "山西省", "忻州市": "山西省",
    "临汾市": "山西省", "吕梁市": "山西省",
    # 青海省
    "西宁市": "青海省",
    # 台湾省
    "台北市": "台湾省", "高雄市": "台湾省",
}

# 区县 → 所属地级市（部分常见区县）
DISTRICT_TO_CITY = {
    # 北京市辖区
    "东城区": "北京市", "西城区": "北京市", "朝阳区": "北京市",
    "丰台区": "北京市", "石景山区": "北京市", "海淀区": "北京市",
    "门头沟区": "北京市", "房山区": "北京市", "通州区": "北京市",
    "顺义区": "北京市", "昌平区": "北京市", "大兴区": "北京市",
    "怀柔区": "北京市", "平谷区": "北京市", "密云区": "北京市",
    "延庆区": "北京市",
    # 上海市辖区
    "黄浦区": "上海市", "徐汇区": "上海市", "长宁区": "上海市",
    "静安区": "上海市", "普陀区": "上海市", "虹口区": "上海市",
    "杨浦区": "上海市", "闵行区": "上海市", "宝山区": "上海市",
    "嘉定区": "上海市", "浦东新区": "上海市", "金山区": "上海市",
    "松江区": "上海市", "青浦区": "上海市", "奉贤区": "上海市",
    "崇明区": "上海市",
    # 天津市辖区
    "和平区": "天津市", "河东区": "天津市", "河西区": "天津市",
    "南开区": "天津市", "河北区": "天津市", "红桥区": "天津市",
    "东丽区": "天津市", "西青区": "天津市", "津南区": "天津市",
    "北辰区": "天津市", "武清区": "天津市", "宝坻区": "天津市",
    "滨海新区": "天津市",
    # 重庆市辖区
    "渝中区": "重庆市", "大渡口区": "重庆市", "江北区": "重庆市",
    "沙坪坝区": "重庆市", "九龙坡区": "重庆市", "南岸区": "重庆市",
    "北碚区": "重庆市", "渝北区": "重庆市", "巴南区": "重庆市",
    # 广东省广州市
    "天河区": "广州市", "海珠区": "广州市", "荔湾区": "广州市",
    "越秀区": "广州市", "黄埔区": "广州市", "白云区": "广州市",
    "番禺区": "广州市", "花都区": "广州市", "南沙区": "广州市",
    "增城区": "广州市", "从化区": "广州市",
    # 广东省深圳市
    "福田区": "深圳市", "罗湖区": "深圳市", "南山区": "深圳市",
    "盐田区": "深圳市", "宝安区": "深圳市", "龙岗区": "深圳市",
    "龙华区": "深圳市", "坪山区": "深圳市", "光明区": "深圳市",
    # 四川省成都市
    "锦江区": "成都市", "青羊区": "成都市", "金牛区": "成都市",
    "武侯区": "成都市", "成华区": "成都市", "龙泉驿区": "成都市",
    "青白江区": "成都市", "新都区": "成都市", "温江区": "成都市",
    "双流区": "成都市", "郫都区": "成都市", "新津区": "成都市",
    # 四川省眉山市
    "东坡区": "眉山市", "彭山区": "眉山市", "仁寿县": "眉山市",
    "洪雅县": "眉山市", "丹棱县": "眉山市", "青神县": "眉山市",
    # 江苏省南京市
    "玄武区": "南京市", "秦淮区": "南京市", "建邺区": "南京市",
    "鼓楼区": "南京市", "浦口区": "南京市", "栖霞区": "南京市",
    "雨花台区": "南京市", "江宁区": "南京市", "六合区": "南京市",
    "溧水区": "南京市", "高淳区": "南京市",
    # 浙江省杭州市
    "上城区": "杭州市", "拱墅区": "杭州市", "西湖区": "杭州市",
    "滨江区": "杭州市", "萧山区": "杭州市", "余杭区": "杭州市",
    "临平区": "杭州市", "钱塘区": "杭州市", "富阳区": "杭州市",
    "临安区": "杭州市",
    # 湖北省武汉市
    "江岸区": "武汉市", "江汉区": "武汉市", "硚口区": "武汉市",
    "汉阳区": "武汉市", "武昌区": "武汉市", "青山区": "武汉市",
    "洪山区": "武汉市", "东西湖区": "武汉市", "蔡甸区": "武汉市",
    "江夏区": "武汉市", "黄陂区": "武汉市", "新洲区": "武汉市",
    # 陕西省西安市
    "新城区": "西安市", "碑林区": "西安市", "莲湖区": "西安市",
    "灞桥区": "西安市", "未央区": "西安市", "雁塔区": "西安市",
    "阎良区": "西安市", "临潼区": "西安市", "长安区": "西安市",
    "高陵区": "西安市", "鄠邑区": "西安市",
    # 四川省凉山州
    "宁南县": "凉山州", "越西县": "凉山州", "西昌市": "凉山州",
    "会理市": "凉山州", "德昌县": "凉山州", "会东县": "凉山州",
    "普格县": "凉山州", "布拖县": "凉山州", "金阳县": "凉山州",
    "昭觉县": "凉山州", "喜德县": "凉山州", "冕宁县": "凉山州",
    "盐源县": "凉山州", "木里县": "凉山州", "甘洛县": "凉山州",
    "雷波县": "凉山州", "美姑县": "凉山州",
}

# 常见区级后缀关键词（按优先级排序：区/县优先于市，避免直辖市名被误匹配为区县）
DISTRICT_SUFFIXES = ["区", "县", "市"]

# 排除词（不是地名的词）
EXCLUDED_DISTRICTS = {
    "地区", "社区", "景区", "山区", "市区", "城区", "郊区",
    "开发区", "高新区", "经济区", "示范区", "试验区",
    # 经济区域概念词（不是行政区划）
    "西部地区", "东部地区", "中部地区", "东北地区",
}

def _build_full_region(district_or_city: str) -> str:
    """根据区县或地级市名称，构建完整的省_市_区县层级
    
    例如：
    - "眉山市" → "四川省_眉山市"
    - "东坡区" → "四川省_眉山市_东坡区"
    - "北京市" → "北京市"
    """
    # 直辖市直接返回
    if district_or_city in ("北京市", "天津市", "上海市", "重庆市"):
        return district_or_city
    
    # 如果是区县，查找所属市，再查找所属省
    if district_or_city in DISTRICT_TO_CITY:
        city = DISTRICT_TO_CITY[district_or_city]
        # 直辖市下的区县
        if city in ("北京市", "天津市", "上海市", "重庆市"):
            return f"{city}_{district_or_city}"
        province = CITY_TO_PROVINCE.get(city, "")
        if province:
            return f"{province}_{city}_{district_or_city}"
        return f"{city}_{district_or_city}"
    
    # 如果是地级市，查找所属省
    if district_or_city in CITY_TO_PROVINCE:
        province = CITY_TO_PROVINCE[district_or_city]
        return f"{province}_{district_or_city}"
    
    return district_or_city

def _normalize_region_format(region: str) -> str:
    """将无分隔符的地区名转换为 _ 分隔格式
    
    例如：
    - "上海市崇明区" → "上海市_崇明区"
    - "四川省眉山市" → "四川省_眉山市"
    - "四川省_眉山市" → "四川省_眉山市"（已经是正确格式）
    """
    if not region or "_" in region:
        return region
    
    # 尝试按行政层级分割
    parts = []
    remaining = region
    
    # 1. 提取省份
    for short_name, full_name in REGION_FULL_NAMES.items():
        if remaining.startswith(full_name):
            parts.append(full_name)
            remaining = remaining[len(full_name):]
            break
        if remaining.startswith(short_name):
            parts.append(full_name)
            remaining = remaining[len(short_name):]
            break
    
    # 2. 提取地级市/州
    for city in CITY_TO_PROVINCE:
        if remaining.startswith(city):
            parts.append(city)
            remaining = remaining[len(city):]
            break
    
    # 3. 剩余部分作为区县/街道
    if remaining:
        parts.append(remaining)
    
    if len(parts) > 1:
        return "_".join(parts)
    return region

def _is_province_only(region: str) -> bool:
    """判断地区是否只有省级（没有市/区/街道）"""
    if not region:
        return True
    
    # 直辖市特殊处理：如果只有"北京市"、"天津市"等，说明只有省级
    municipalities = {"北京市", "天津市", "上海市", "重庆市"}
    if region in municipalities:
        return True
    
    # 如果包含市/州/区/县/街道等，说明不止省级
    has_deeper = any(suffix in region for suffix in ["市", "州", "区", "县", "街道", "镇", "乡"])
    return not has_deeper

def _extract_from_closing(content: str) -> str:
    """从落款（发文机关、日期等）中提取地区信息
    
    常见格式：
    - "XX市XX区人民政府"
    - "XX省XX市XX局"
    - "XX县人民政府办公室"
    - "发文机关：XX市XX局"
    """
    # 匹配落款区域（通常在文档末尾）
    # 先提取最后 1000 字符作为落款区域
    closing_area = content[-1000:] if len(content) > 1000 else content
    
    # 匹配机关名称中的地区
    patterns = [
        # "XX市XX区人民政府"
        r"([\u4e00-\u9fff]+(?:省|市|州|区|县)(?:[\u4e00-\u9fff]+(?:市|州|区|县))?(?:人民政府|政府|局|委员会|办公室|厅))",
        # "发文机关：XX市XX局"
        r"发文机关[：:\s]*([\u4e00-\u9fff]+(?:省|市|州|区|县)[\u4e00-\u9fff]*)",
        # "发布机构：XX"
        r"发布机构[：:\s]*([\u4e00-\u9fff]+(?:省|市|州|区|县)[\u4e00-\u9fff]*)",
        # "XX省XX市XX局"
        r"([\u4e00-\u9fff]+省[\u4e00-\u9fff]+市[\u4e00-\u9fff]*(?:局|委|办|厅))",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, closing_area)
        if match:
            org_name = match.group(1)
            # 从机关名称中提取地区
            return _extract_region_from_text(org_name)
    
    return ""

def _extract_region_from_text(text: str) -> str:
    """从任意文本中提取地区层级（省_市_区县_街道）"""
    if not text:
        return ""
    
    region_parts = []
    found_city = ""
    found_district = ""
    remaining_text = text  # 用于后续匹配时排除已匹配部分
    
    # 1. 提取省份/直辖市
    is_municipality = False
    for short_name, full_name in REGION_FULL_NAMES.items():
        if full_name in text or short_name in text:
            region_parts.append(full_name)
            # 从剩余文本中移除已匹配的地区，避免重复匹配
            remaining_text = remaining_text.replace(full_name, "").replace(short_name, "")
            # 检查是否为直辖市
            if full_name in ("北京市", "天津市", "上海市", "重庆市"):
                is_municipality = True
            break
    
    # 2. 提取地级市/州（直辖市跳过）
    if not is_municipality:
        for city in CITY_TO_PROVINCE:
            if city in remaining_text:
                found_city = city
                region_parts.append(city)
                remaining_text = remaining_text.replace(city, "")
                break
    
    # 3. 提取区县（排除已匹配的省份/市名）
    for suffix in DISTRICT_SUFFIXES:
        pattern = rf"([\u4e00-\u9fff]{{2,4}}{suffix})"
        for match in re.finditer(pattern, remaining_text):
            district = match.group(1)
            # 排除已匹配的地区和排除词
            if district not in EXCLUDED_DISTRICTS and district not in region_parts:
                # 额外检查：不要匹配到省份名或城市名
                if district not in REGION_FULL_NAMES.values() and district not in CITY_TO_PROVINCE:
                    region_parts.append(district)
                    found_district = district
                    remaining_text = remaining_text.replace(district, "")
                    break
    
    # 4. 提取街道/镇/乡
    street_suffixes = ["街道", "镇", "乡", "办事处", "管委会"]
    for suffix in street_suffixes:
        pattern = rf"([\u4e00-\u9fff]{{2,6}}{suffix})"
        match = re.search(pattern, remaining_text)
        if match:
            street = match.group(1)
            if street not in EXCLUDED_DISTRICTS and street not in region_parts:
                region_parts.append(street)
                break
    
    # 如果没找到市，但找到了区县，尝试从区县反推市
    if not found_city and found_district:
        city = DISTRICT_TO_CITY.get(found_district, "")
        if city and city not in region_parts:
            # 插入到省份之后
            insert_pos = 1 if len(region_parts) > 1 else 0
            region_parts.insert(insert_pos, city)
            found_city = city
    
    # 如果缺少省份，尝试从市反推
    if region_parts and not any(p.endswith("省") or p in ("北京市", "天津市", "上海市", "重庆市") for p in region_parts):
        if found_city:
            province = CITY_TO_PROVINCE.get(found_city, "")
            if province:
                region_parts.insert(0, province)
    
    if region_parts:
        return "_".join(region_parts)
    return ""

def infer_region(title: str, content: str, policy_type: str = "") -> str:
    """从标题和内容推断政策所属地区，返回规范化全称（带行政层级）
    
    提取优先级：
    1. 落款/发文机关中的地区
    2. 标题中的地区
    3. 办事指南的"办理地点"字段
    4. 正文中的地区
    
    返回用 _ 分隔的层级字符串，例如：
    - "四川省_凉山州_越西县_越城镇"
    - "四川省_眉山市"
    - "四川省_眉山市_东坡区"
    - "北京市"
    - "全国"
    """
    print(f"[DEBUG] infer_region: title={title[:30]}, policy_type={policy_type}, content_len={len(content)}")
    
    # 全国
    if "全国" in (title or "") or "国务院" in (title or ""):
        return "全国"

    # 优先级 1：从落款/发文机关提取。标题和正文常出现政策适用地，
    # 不能优先于能表明发布主体的证据。
    closing_region = _extract_from_closing(content)
    if closing_region:
        print(f"[DEBUG] infer_region: 从落款提取到: {closing_region}")
        return closing_region

    # 优先级 2：标题只作为缺少发布主体信息时的回退。
    if title:
        title_region = _extract_region_from_text(title)
        if title_region:
            print(f"[DEBUG] infer_region: 从标题提取到: {title_region}")
            return title_region
    
    # 优先级 3：对于办事指南，从"办理地点"提取
    if policy_type == "办事指南":
        print(f"[DEBUG] infer_region: 办事指南类型，尝试从办理地点提取")
        location_region = _extract_from_location(content)
        if location_region:
            print(f"[DEBUG] infer_region: 从办理地点提取到: {location_region}")
            return location_region
        print(f"[DEBUG] infer_region: 办理地点提取失败，回退到实施主体提取")
    
    # 优先级 3.5：从"实施主体"提取乡镇/街道
    subject_region = _extract_from_implementation_subject(content)
    if subject_region:
        print(f"[DEBUG] infer_region: 从实施主体提取到: {subject_region}")
        return subject_region
    
    # 优先级 4：从正文提取
    text = content[:3000]
    
    # 1. 先尝试匹配区县（最细粒度）
    for suffix in DISTRICT_SUFFIXES:
        pattern = rf"([\u4e00-\u9fff]{{2,4}}{suffix})"
        for match in re.finditer(pattern, text):
            district = match.group(1)
            if district not in EXCLUDED_DISTRICTS:
                full = _build_full_region(district)
                if full != district:  # 成功找到上级
                    return full
    
    # 2. 匹配地级市
    for city in CITY_TO_PROVINCE:
        if city in text:
            full = _build_full_region(city)
            return full
    
    # 3. 匹配省级
    for short_name, full_name in REGION_FULL_NAMES.items():
        if full_name in text:
            return full_name
        if short_name in text:
            return full_name
    
    # 4. 回退：匹配到区县但没找到上级，直接返回区县名
    for suffix in DISTRICT_SUFFIXES:
        pattern = rf"([\u4e00-\u9fff]{{2,4}}{suffix})"
        match = re.search(pattern, text)
        if match:
            district = match.group(1)
            if district not in EXCLUDED_DISTRICTS:
                return district
    
    return ""

def _extract_from_location(content: str) -> str:
    """从办事指南的"办理地点"字段中提取地区信息（精确到街道）
    
    例如：
    - "四川省-凉山州-越西县-越城镇街道-高铁站1号" → "四川省凉山州越西县越城镇"
    - "详细地址：越西县高铁站站前广场二楼" → "四川省凉山州越西县"（需要结合上下文）
    """
    # 匹配"办理地点"、"受理地点"、"办理地址"等关键词后的内容
    location_patterns = [
        # Markdown 表格格式：关键词 | 内容
        r"办理地点\s*\|\s*([^\n|]+)",
        r"受理地点\s*\|\s*([^\n|]+)",
        r"办理地址\s*\|\s*([^\n|]+)",
        r"受理地址\s*\|\s*([^\n|]+)",
        r"办公地点\s*\|\s*([^\n|]+)",
        r"办公地址\s*\|\s*([^\n|]+)",
        r"实施地点\s*\|\s*([^\n|]+)",
        r"详细地址\s*\|\s*([^\n|]+)",
        # 键值对格式：关键词：内容
        r"办理地点[：:\s]*([^\n]+)",
        r"受理地点[：:\s]*([^\n]+)",
        r"办理地址[：:\s]*([^\n]+)",
        r"受理地址[：:\s]*([^\n]+)",
        r"办公地点[：:\s]*([^\n]+)",
        r"办公地址[：:\s]*([^\n]+)",
        r"实施地点[：:\s]*([^\n]+)",
        r"详细地址[：:\s]*([^\n]+)",
    ]
    
    print(f"[DEBUG] _extract_from_location: 开始匹配，内容长度={len(content)}")
    
    for pattern in location_patterns:
        match = re.search(pattern, content)
        if match:
            location_text = match.group(1).strip()
            print(f"[DEBUG] _extract_from_location: 匹配到 pattern={pattern}, location_text={location_text[:100]}")
            if location_text and len(location_text) > 3:
                result = _parse_location_text(location_text, content)
                print(f"[DEBUG] _extract_from_location: 解析结果={result}")
                return result
    
    print(f"[DEBUG] _extract_from_location: 未匹配到任何地点")
    return ""


def _extract_from_implementation_subject(content: str) -> str:
    """从办事指南的"实施主体"字段中提取地区信息（精确到乡镇/街道）
    
    例如：
    - "西昌市四合乡人民政府" → "四川省_凉山州_西昌市_四合乡"
    - "越西县越城镇人民政府" → "四川省_凉山州_越西县_越城镇"
    - "东坡区大石桥街道办事处" → "四川省_眉山市_东坡区_大石桥街道"
    """
    # 匹配"实施主体"字段（支持表格格式和键值对格式）
    subject_patterns = [
        # Markdown 表格格式（| 分隔）：实施主体 | 内容
        r"实施主体\s*\|\s*([^\n|]+)",
        r"实施机构\s*\|\s*([^\n|]+)",
        r"承办单位\s*\|\s*([^\n|]+)",
        r"办理单位\s*\|\s*([^\n|]+)",
        # TAB 分隔表格格式：实施主体\t内容\t...
        r"实施主体\s*[\t]+([^\t\n]+)",
        r"实施机构\s*[\t]+([^\t\n]+)",
        r"承办单位\s*[\t]+([^\t\n]+)",
        r"办理单位\s*[\t]+([^\t\n]+)",
        # 键值对格式：实施主体：内容
        r"实施主体[：:\s]*([^\n]+)",
        r"实施机构[：:\s]*([^\n]+)",
        r"承办单位[：:\s]*([^\n]+)",
        r"办理单位[：:\s]*([^\n]+)",
    ]
    
    subject_text = None
    for pattern in subject_patterns:
        match = re.search(pattern, content)
        if match:
            subject_text = match.group(1).strip()
            break
    
    # 如果没找到"实施主体"，尝试从全文搜索包含"人民政府"或"街道办事处"的文本
    if not subject_text:
        org_match = re.search(r'([\u4e00-\u9fff]+(?:市|县|区)[\u4e00-\u9fff]+(?:乡|镇|街道办事处)?人民政府)', content)
        if org_match:
            subject_text = org_match.group(1)
    
    if not subject_text or len(subject_text) < 4:
        print(f"[DEBUG] _extract_from_implementation_subject: 未找到实施主体")
        return ""
    
    print(f"[DEBUG] _extract_from_implementation_subject: 提取到实施主体={subject_text}")
    
    # 从实施主体名称中提取地区
    # 常见模式：{地区}+{乡镇/街道}+{人民政府/街道办事处}
    # 例如：西昌市四合乡人民政府、越西县越城镇人民政府、东坡区大石桥街道办事处
    
    # 先提取乡镇/街道级别（排除市/县/区等行政区划词）
    township_match = re.search(r'[^市区县]+?(?:乡|镇|街道办事处|街道)', subject_text)
    if not township_match:
        print(f"[DEBUG] _extract_from_implementation_subject: 未提取到乡镇")
        return ""
    
    township = township_match.group(0)
    normalized_township = _normalize_township(township)
    print(f"[DEBUG] _extract_from_implementation_subject: 提取到乡镇={township}, 规范化={normalized_township}")
    
    # 从实施主体中提取区县（用于构建完整路径）
    district = None
    for suffix in DISTRICT_SUFFIXES:
        pattern = rf"([\u4e00-\u9fff]{{2,4}}{suffix})"
        match = re.search(pattern, subject_text)
        if match:
            candidate = match.group(1)
            if candidate not in EXCLUDED_DISTRICTS:
                district = candidate
                break
    
    if district:
        # 构建 省_市_区县_乡镇
        full = _build_full_region(district)
        if full and full != district:
            return full + "_" + normalized_township
        # 如果 _build_full_region 失败，直接用区县+乡镇
        return district + "_" + normalized_township
    
    return ""


def _normalize_township(township: str) -> str:
    """规范化乡镇名称，提取乡镇名（不带后缀）
    
    例如：
    - "四合乡" → "四合乡"
    - "越城镇" → "越城镇"
    - "大石桥街道办事处" → "大石桥街道"
    - "大石桥街道" → "大石桥街道"
    """
    # 街道办事处 → 街道
    township = township.replace("街道办事处", "街道")
    return township


def _parse_location_text(location_text: str, full_content: str) -> str:
    """解析地点文本，提取省-市-区县-街道层级
    
    支持格式：
    - "四川省-凉山州-越西县-越城镇街道-高铁站1号"
    - "四川省凉山州越西县越城镇"
    - "越西县高铁站站前广场"
    
    返回：用 _ 分隔的层级字符串，如 "四川省_凉山州_越西县_越城镇"
    """
    # 清理分隔符，统一用 - 分割
    # 先提取逗号前的部分（通常地址在逗号前）
    before_comma = location_text.split(",")[0].split("，")[0]
    
    # 尝试用 - 分割
    if "-" in before_comma or "—" in before_comma:
        parts = before_comma.replace("—", "-").split("-")
        region_parts = []
        for part in parts:
            part = part.strip()
            if not part:
                continue
            # 跳过纯数字或太短的部分
            if len(part) < 2:
                continue
            # 检查是否是地区名（包含行政后缀）
            if any(suffix in part for suffix in ["省", "市", "州", "区", "县", "街道", "镇", "乡"]):
                region_parts.append(part)
        
        if region_parts:
            # 如果缺少省份，从全文补充
            if not any(p.endswith("省") for p in region_parts):
                for short_name, full_name in REGION_FULL_NAMES.items():
                    if full_name in full_content or short_name in full_content:
                        region_parts.insert(0, full_name)
                        break
            return "_".join(region_parts)
    
    # 如果没有 - 分隔符，尝试从文本中提取
    cleaned = before_comma
    
    # 从清理后的文本中提取地区
    region_parts = []
    
    # 1. 提取省份
    for short_name, full_name in REGION_FULL_NAMES.items():
        if full_name in cleaned or short_name in cleaned:
            region_parts.append(full_name)
            break
    
    # 2. 提取地级市/州
    found_city = ""
    for city in CITY_TO_PROVINCE:
        if city in cleaned:
            found_city = city
            region_parts.append(city)
            break
    
    # 3. 提取区县
    found_district = ""
    for suffix in DISTRICT_SUFFIXES:
        pattern = rf"([\u4e00-\u9fff]{{2,4}}{suffix})"
        for match in re.finditer(pattern, cleaned):
            district = match.group(1)
            if district not in EXCLUDED_DISTRICTS and district not in region_parts:
                region_parts.append(district)
                found_district = district
                break
    
    # 如果没找到市，但找到了区县，尝试从区县反推市
    if not found_city and found_district:
        city = DISTRICT_TO_CITY.get(found_district, "")
        if city:
            # 插入到省份之后、区县之前
            region_parts.insert(len(region_parts) - 1 if found_district else len(region_parts), city)
            found_city = city
    
    # 4. 提取街道/镇/乡
    street_suffixes = ["街道", "镇", "乡", "办事处", "管委会"]
    for suffix in street_suffixes:
        pattern = rf"([\u4e00-\u9fff]{{2,6}}{suffix})"
        match = re.search(pattern, cleaned)
        if match:
            street = match.group(1)
            if street not in EXCLUDED_DISTRICTS and street not in region_parts:
                region_parts.append(street)
                break
    
    # 如果提取到了部分信息，但缺少省份，尝试从全文补充
    if region_parts and not any(p.endswith("省") for p in region_parts):
        # 先尝试从已找到的市反推省
        if found_city:
            province = CITY_TO_PROVINCE.get(found_city, "")
            if province:
                region_parts.insert(0, province)
        # 再从全文找省份
        if not any(p.endswith("省") for p in region_parts):
            for short_name, full_name in REGION_FULL_NAMES.items():
                if full_name in full_content or short_name in full_content:
                    region_parts.insert(0, full_name)
                    break
    
    if region_parts:
        return "_".join(region_parts)
    
    return ""


# ── 推断政策标签 ────────────────────────────────────────────
def infer_tags(title: str, content: str, region: str, keyword: str = "", policy_type: str = "") -> list[str]:
    """推断政策标签
    
    规则：
    1. 「一件事名称」（keyword）作为必填项写入 tags
    2. 地区信息直接同步带入 tags
    3. 政策类型（与 type 一致）
    """
    tags = []
    
    # 1. 必填：一件事名称（用户搜索的关键字）
    if keyword:
        tags.append(keyword)
    
    # 2. 地区信息直接透传
    if region:
        tags.append(region)
    
    # 3. 政策类型（与 type 一致）
    if policy_type:
        tags.append(policy_type)

    return list(dict.fromkeys(tags))  # 去重保序


# ── 生成 OKF frontmatter ────────────────────────────────────
def build_frontmatter(
    title: str,
    description: str,
    resource: str,
    policy_type: str,
    region: str,
    tags: list[str],
    timestamp: str,
    status: str = "verified",
    issue_type: str = "",
) -> str:
    """生成 OKF YAML frontmatter
    
    status: verified (正常) | issue (有问题，需人工复核)
    issue_type: spa | list_page | image_only | low_quality_doc | "" (仅 status=issue 时有值)
    """
    fm = {
        "type": policy_type,
        "title": title,
        "status": status,
    }
    if status == "issue" and issue_type:
        fm["issue_type"] = issue_type
    if description:
        fm["description"] = description[:200]
    fm["resource"] = resource
    if region:
        fm["region"] = region
    if tags:
        fm["tags"] = tags
    if timestamp:
        fm["timestamp"] = timestamp

    lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, list):
            lines.append(f"{k}:")
            for item in v:
                lines.append(f"  - {item}")
        else:
            # 字符串值加引号防止 YAML 解析问题
            val = str(v)
            if any(c in val for c in ":{}[]&*?|-><!%@`#,"):
                val = f'"{val}"'
            elif val and not val[0].isdigit():
                pass  # 纯文本不需要引号
            elif val:
                val = f'"{val}"'
            lines.append(f"{k}: {val}")
    lines.append("---")
    return "\n".join(lines)


# ── 生成简短描述 ────────────────────────────────────────────
def generate_description(title: str, content: str) -> str:
    """从内容中提取前200字作为描述"""
    # 去掉面包屑导航
    clean = re.sub(r"当前位置[：:].*?(?=\n|$)", "", content)
    # 去掉 Markdown 标记
    clean = re.sub(r"[#*>\-|`\[\]()]", " ", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    if len(clean) > 200:
        clean = clean[:197] + "..."
    return clean


# ── 推断时间戳 ──────────────────────────────────────────────
def infer_timestamp(content: str, source_path: str = "", policy_type: str = "") -> str:
    """推断 timestamp，按文件类型采用不同提取规则
    
    Args:
        content: Markdown 正文，用于提取日期
        source_path: 源文件路径（HTML/PDF等），取其 mtime
        policy_type: 文件类型（法律法规/政策规章/官方解读/办事指南/其它）
    
    规则：
    - 法律法规/政策规章：优先成文日期/印发日期，禁止取发布日期
    - 官方解读：提取发布时间
    - 办事指南：无明确发布时间时，用当天时间戳兜底
    """
    # 关键词匹配（成文/印发 vs 发布）
    doc_date_keywords = ["成文日期", "成文时间", "印发日期", "印发时间", "发文日期"]
    publish_date_keywords = ["发布时间", "发布日期", "公开时间", "更新时间", "生成时间"]
    
    # 1. 按类型选择优先关键词
    if policy_type in ("法律法规", "政策规章"):
        # 政策文件类：优先成文/印发日期
        primary_keywords = doc_date_keywords
        secondary_keywords = publish_date_keywords
    elif policy_type == "官方解读":
        # 官方解读：优先发布时间
        primary_keywords = publish_date_keywords
        secondary_keywords = doc_date_keywords
    elif policy_type == "办事指南":
        # 办事指南：优先发布时间，无则当天兜底
        primary_keywords = publish_date_keywords
        secondary_keywords = []
    else:
        # 其它：通用匹配
        primary_keywords = publish_date_keywords + doc_date_keywords
        secondary_keywords = []
    
    # 2. 从正文前3000字搜索日期（扩大搜索范围）
    search_text = content[:3000]
    
    # 先匹配 primary_keywords
    for kw in primary_keywords:
        # 匹配 "成文日期：2024年3月15日" 或 "发布时间: 2024-03-15" 等格式
        pattern = rf"{kw}[\s：:]*?(\d{{4}})\s*年\s*(\d{{1,2}})\s*月\s*(\d{{1,2}})\s*日"
        date_match = re.search(pattern, search_text)
        if date_match:
            return f"{date_match.group(1)}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}"
        
        # 也匹配 "2024-03-15" 格式
        pattern2 = rf"{kw}[\s：:]*?(\d{{4}})[-/.](\d{{1,2}})[-/.](\d{{1,2}})"
        date_match2 = re.search(pattern2, search_text)
        if date_match2:
            return f"{date_match2.group(1)}-{int(date_match2.group(2)):02d}-{int(date_match2.group(3)):02d}"
    
    # 再匹配 secondary_keywords
    for kw in secondary_keywords:
        pattern = rf"{kw}[\s：:]*?(\d{{4}})\s*年\s*(\d{{1,2}})\s*月\s*(\d{{1,2}})\s*日"
        date_match = re.search(pattern, search_text)
        if date_match:
            return f"{date_match.group(1)}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}"
        
        pattern2 = rf"{kw}[\s：:]*?(\d{{4}})[-/.](\d{{1,2}})[-/.](\d{{1,2}})"
        date_match2 = re.search(pattern2, search_text)
        if date_match2:
            return f"{date_match2.group(1)}-{int(date_match2.group(2)):02d}-{int(date_match2.group(3)):02d}"
    
    # 3. 通用中文日期匹配（无关键词时）
    date_match = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", search_text)
    if date_match:
        return f"{date_match.group(1)}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}"
    
    # 4. 从源文件最后修改时间获取
    if source_path and os.path.isfile(source_path):
        mtime = os.path.getmtime(source_path)
        return datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")
    
    # 5. 当前时间（办事指南兜底）
    return datetime.now().strftime("%Y-%m-%d")


# ── 文档 URL 下载 + MarkItDown 转换 ───────────────────────────
def _extract_title_from_url(url: str) -> str:
    """从URL路径中提取有意义的标题（用于PDF/文档URL）
    
    策略:
    1. URL中包含中文书名号《》→ 提取
    2. URL路径段中含中文 → 提取
    3. URL路径段为英文缩写 → 映射为中文标题
    4. URL含常见政策文档名 → 映射
    """
    from urllib.parse import unquote
    
    # 解码URL
    decoded_url = unquote(url)
    
    # 1. 从URL中找中文书名号
    book_match = re.search(r"《(.+?)》", decoded_url)
    if book_match:
        return _finalize_title(book_match.group(1))
    
    # 2. 从URL路径段中找中文段（如"/育儿补贴申领/办理指南"）
    parsed = urlparse(decoded_url)
    path_parts = [p for p in parsed.path.split("/") if p]
    # 去掉文件扩展名
    chinese_parts = []
    for part in path_parts:
        # 去掉扩展名
        stem = Path(part).stem if "." in part else part
        if re.search(r"[\u4e00-\u9fff]", stem):
            chinese_parts.append(stem)
    if chinese_parts:
        # 取最后一个中文段作为标题（通常最具体）
        return _finalize_title(chinese_parts[-1])
    
    # 3. 英文缩写/常见名称映射
    filename_stem = Path(parsed.path).stem.lower()
    abbrev_map = {
        "bszn": "办事指南",
        "bgzn": "办公指南",
        "blzn": "办理指南",
        "zcjd": "政策解读",
        "zcfg": "政策法规",
        "ssfa": "实施方案",
        "ssxf": "实施细则",
        "tzgg": "通知公告",
        "zcwj": "政策文件",
        "xxgk": "信息公开",
        "zwgk": "政务公开",
        "yjbt": "育儿补贴",
        "shbz": "生活保障",
    }
    if filename_stem in abbrev_map:
        return abbrev_map[filename_stem]
    
    # 4. 从URL path segments推断
    # 检查路径中的英文缩写段
    for part in reversed(path_parts):
        stem = Path(part).stem.lower() if "." in part else part.lower()
        if stem in abbrev_map:
            return abbrev_map[stem]
    
    # 5. 检查URL query中的name参数（某些政务网站用name参数传递标题）
    from urllib.parse import parse_qs
    qs = parse_qs(parsed.query)
    if "name" in qs:
        name = qs["name"][0]
        # 去掉「一件事」等后缀
        name = re.sub(r"[「」]", "", name)
        if name and 4 <= len(name) <= 80:
            return _finalize_title(name)
    
    return ""


def _convert_doc_url_to_okf(
    url: str,
    output_dir: str,
    region: str = "",
    policy_type: str = "",
    timestamp: str = "",
    pre_fetched: bytes | None = None,
    policy_id: int = None,
    policy_keyword: str = None,
    resource_options: ExportResourceOptions | None = None,
    pre_fetched_content_type: str = "",
) -> str:
    """下载远程文档（PDF/Word/图片），用 MarkItDown 转 OKF。
    PDF/文档类总是保存源文件到 issues/ 目录（MarkItDown 提取质量需要人工复核）。"""
    import tempfile
    
    # 下载到临时文件
    if pre_fetched is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        }
        with httpx.Client(follow_redirects=True, timeout=60, verify=False) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.content
    else:
        data = pre_fetched

    # 确定文件扩展名
    parsed = urlparse(url)
    ext = Path(parsed.path).suffix.lower()
    if not ext:
        mime = pre_fetched_content_type.lower()
        if "wordprocessingml" in mime:
            ext = ".docx"
        elif "spreadsheetml" in mime:
            ext = ".xlsx"
        elif "msword" in mime:
            ext = ".doc"
        elif "ms-excel" in mime:
            ext = ".xls"
        elif "image/png" in mime:
            ext = ".png"
        elif "image/jpeg" in mime:
            ext = ".jpg"
        elif "image/webp" in mime:
            ext = ".webp"
        else:
            ext = ".pdf"
    
    # 写入临时文件
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        # ── 从URL中提取更好标题 ──
        url_title = _extract_title_from_url(url)
        fallback_title = url_title or ""
        
        # 用 MarkItDown 转换
        md_converter = MarkItDown()
        try:
            result_md = md_converter.convert(tmp_path)
            md_body = clean_markdown(result_md.text_content or "")
        except Exception as exc:
            # 扫描 PDF/图片很可能没有可提取文本，后续交给 Qwen 视觉解析。
            print(f"[WARN] MarkItDown 未提取到文本: {exc}")
            md_body = ""

        # 从内容推断标题
        file_stem = Path(tmp_path).stem
        is_temp_name = bool(re.match(r"^tmp[a-z0-9]+$", file_stem, re.I))
        
        title = ""
        if fallback_title:
            title = fallback_title
        if not title:
            first_lines = md_body.split("\n")[:15]
            for line in first_lines:
                line_stripped = line.strip().lstrip("#").strip()
                if line_stripped and 5 <= len(line_stripped) <= 100 and re.search(r"[\u4e00-\u9fff]", line_stripped):
                    if not _is_bad_title(line_stripped):
                        title = line_stripped
                        break
        if not title and not is_temp_name:
            title = file_stem
        if not title:
            title = "政策文档"
        title = _finalize_title(title)

        # 质量分类 — PDF/文档总是放 issues/ 并保存源文件
        status, issue_type = _classify_quality(
            md_body=md_body, title=title, source_ext=ext,
        )
        # PDF/文档类一律放 issues（MarkItDown 质量不稳定），标记为 pdf_doc
        status = "issue"
        issue_type = "pdf_doc" if issue_type == "" else issue_type
        print(f"[问题] 文档类型 {ext}，输出到 issues/ 目录")

        # 推断元数据
        if not policy_type:
            policy_type = infer_policy_type(title, md_body)
        # 先规范化地区格式（无分隔符 → _ 分隔）
        region = _normalize_region_format(region)
        # 传入地区（包括省级）来自采集/核验数据，应保留其发布层级。
        # 仅在完全缺失时才从页面内容推断，避免把政策适用地写成发布地区。
        if not region:
            finer_region = infer_region(title, md_body, policy_type=policy_type)
            if finer_region:
                region = finer_region
        if not timestamp:
            timestamp = infer_timestamp(md_body, policy_type=policy_type)

        tags = infer_tags(title, md_body, region, keyword=policy_keyword, policy_type=policy_type)
        description = generate_description(title, md_body)

        frontmatter = build_frontmatter(
            title=title,
            description=description,
            resource=url,
            policy_type=policy_type,
            region=region,
            tags=tags,
            timestamp=timestamp,
            status=status,
            issue_type=issue_type,
        )

        # 计算路径（使用新格式）
        filepath = _compute_output_path(
            output_dir, title, region, url, status,
            policy_id=policy_id,
            policy_keyword=policy_keyword,
            file_type=policy_keyword,
            policy_type=policy_type,
        )

        options = resource_options or ExportResourceOptions(
            parse_attachments=True,
            localize_images=True,
            parse_images=False,
            download_originals=True,
            model=settings.EXPORT_VISION_MODEL,
        )
        parsed_doc, resource_report = process_standalone_document(
            data=data,
            source_url=url,
            content_type=pre_fetched_content_type or {
                ".pdf": "application/pdf",
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
            }.get(ext, ""),
            extension=ext,
            markdown_path=filepath,
            options=options,
            title=title,
        )
        # 图片/扫描件优先使用多模态结果；文本型文档仅在新解析结果更完整时替换。
        if parsed_doc and ext in {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"}:
            if len(parsed_doc) > len(md_body) or len(re.findall(r"[\u4e00-\u9fff]", md_body)) < 100:
                md_body = clean_markdown(parsed_doc)
        resource_markdown = resource_report.summary_markdown()
        if resource_markdown:
            md_body = clean_markdown(md_body.rstrip() + "\n\n" + resource_markdown)

        description = generate_description(title, md_body)
        frontmatter = build_frontmatter(
            title=title,
            description=description,
            resource=url,
            policy_type=policy_type,
            region=region,
            tags=tags,
            timestamp=timestamp,
            status=status,
            issue_type=issue_type,
        )
        full_md = frontmatter + "\n\n" + md_body

        with open(filepath, "wb") as f:
            f.write(full_md.encode("utf-8"))

        # 保存源文件（PDF/文档）
        _save_source_file(output_dir, filepath, data, ext)

        print(f"[完成] {filepath}")
        return filepath
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ── 单页转换核心 ────────────────────────────────────────────
def convert_url_to_okf(
    url: str,
    output_dir: str,
    region: str = "",
    policy_type: str = "",
    timestamp: str = "",
    policy_id: int = None,
    policy_keyword: str = None,
    captured_page: CapturedPage | None = None,
    resource_options: ExportResourceOptions | None = None,
) -> str:
    """将单个网页 URL 转换为 OKF Markdown 文件，返回输出路径。
    自动识别 PDF/非HTML URL，切换到 MarkItDown 处理。
    根据质量分类输出到 verified/ 或 issues/ 子目录，问题页面保存源文件。"""
    # 1. 抓取
    print(f"[抓取] {url}")
    
    # 检测 URL 是否指向非 HTML 文档（PDF/Word/图片等）
    parsed = urlparse(url)
    doc_extensions = {".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".xls",
                      ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"}
    url_ext = Path(parsed.path).suffix.lower()
    
    if url_ext in doc_extensions:
        print(f"[文档URL] 检测到 {url_ext} 文件，切换到文档模式")
        return _convert_doc_url_to_okf(url, output_dir, region, policy_type, timestamp,
                                       policy_id=policy_id, policy_keyword=policy_keyword,
                                       resource_options=resource_options)

    # 先抓取检查 Content-Type（使用 _fetch_raw 带 SSL 降级）
    resp = _fetch_raw(url)
    content_type = resp.headers.get("content-type", "")
    raw_bytes = resp.content
    
    # 如果 Content-Type 表明是 PDF 或其他非 HTML 文档
    if "pdf" in content_type.lower() or any(
        ext in content_type.lower() for ext in ["msword", "officedocument", "image/"]
    ):
        print(f"[文档URL] Content-Type={content_type}，切换到文档模式")
        return _convert_doc_url_to_okf(url, output_dir, region, policy_type, timestamp,
                                        pre_fetched=raw_bytes, policy_id=policy_id, policy_keyword=policy_keyword,
                                        resource_options=resource_options,
                                        pre_fetched_content_type=content_type)

    # 2. 正常 HTML 处理。Crawl4AI 只负责渲染和资源发现，
    # 后续仍使用本项目的 OKF 元数据、质量分类和路径规则。
    if captured_page is None:
        try:
            captured_page = capture_page_sync(url)
        except Exception as exc:
            print(f"[WARN] 渲染采集失败，使用原始 HTML: {exc}")

    if captured_page is not None and captured_page.html:
        html = captured_page.html
        final_url = captured_page.final_url or str(resp.url)
        print(f"[采集] {captured_page.capture_method} final_url={final_url}")
        if captured_page.warning:
            print(f"[WARN] {captured_page.warning}")
    else:
        # 尝试检测编码
        if "charset" not in content_type.lower():
            for enc in ("utf-8", "gbk", "gb2312", "gb18030"):
                try:
                    html = raw_bytes.decode(enc)
                    break
                except (UnicodeDecodeError, LookupError):
                    continue
            else:
                html = raw_bytes.decode("utf-8", errors="replace")
        else:
            html = resp.text
        final_url = str(resp.url)
    html = _fix_double_encoding(html)

    # 3. 提取正文
    title, soup = extract_main_content(html)

    # 4. 修复表格
    fix_tables(soup)

    # 5. 先生成基础 Markdown，用来推断地区和输出路径。
    h2t = _make_h2t()
    md_body = h2t.handle(str(soup))
    md_body = clean_markdown(md_body)

    # 6. 推断元数据
    if not policy_type:
        policy_type = infer_policy_type(title, md_body)
    # 先规范化地区格式（无分隔符 → _ 分隔）
    region = _normalize_region_format(region)
    print(f"[DEBUG] 地区推断前: region={region}")
    # 传入地区（包括省级）来自采集/核验数据，应保留其发布层级。
    # 仅在完全缺失时才从页面内容推断，避免把政策适用地写成发布地区。
    if not region:
        print(f"[DEBUG] 触发地区推断")
        finer_region = infer_region(title, md_body, policy_type=policy_type)
        if finer_region:
            print(f"[DEBUG] 地区推断成功: {finer_region}")
            region = finer_region
        else:
            print(f"[DEBUG] 地区推断失败，保持原地区: {region}")
    else:
        print(f"[DEBUG] 跳过地区推断（已有发布地区）")
    if not timestamp:
        timestamp = infer_timestamp(md_body, policy_type=policy_type)

    tags = infer_tags(title, md_body, region, keyword=policy_keyword, policy_type=policy_type)

    # 先按基础内容计算路径，图片和附件会保存在 Markdown 同级的 *_assets 目录。
    provisional_status, _ = _classify_quality(url=url, html=html, md_body=md_body, title=title)
    filepath = _compute_output_path(
        output_dir, title, region, url, provisional_status,
        policy_id=policy_id,
        policy_keyword=policy_keyword,
        file_type=policy_keyword,
        policy_type=policy_type,
    )

    # 7. 统一处理图片、相对链接和附件。图片保留在 Markdown 中，
    # OCR/多模态结果作为补充文本，不再替换或删除 <img>。
    options = resource_options or ExportResourceOptions(
        parse_attachments=settings.EXPORT_PARSE_ATTACHMENTS,
        localize_images=settings.EXPORT_LOCALIZE_IMAGES,
        parse_images=False,
        download_originals=True,
        model=settings.EXPORT_VISION_MODEL,
    )
    resource_report = process_export_resources(
        soup=soup,
        rendered_html=html,
        final_url=final_url,
        markdown_path=filepath,
        options=options,
        discovered_links=captured_page.links if captured_page else [],
        discovered_images=captured_page.images if captured_page else [],
    )
    md_body = clean_markdown(h2t.handle(str(soup)))
    resource_markdown = resource_report.summary_markdown()
    if resource_markdown:
        md_body = clean_markdown(md_body.rstrip() + "\n\n" + resource_markdown)

    # 8. 在附件和图片文本已合并后重新执行质量判定。
    status, issue_type = _classify_quality(url=url, html=html, md_body=md_body, title=title)
    if status == "issue":
        print(f"[问题] 检测到 {issue_type}，将输出到 issues/ 目录")
    else:
        print(f"[验证] 质量正常，将输出到 verified/ 目录")

    description = generate_description(title, md_body)
    frontmatter = build_frontmatter(
        title=title,
        description=description,
        resource=final_url,
        policy_type=policy_type,
        region=region,
        tags=tags,
        timestamp=timestamp,
        status=status,
        issue_type=issue_type,
    )
    full_md = frontmatter + "\n\n" + md_body

    with open(filepath, "wb") as f:
        f.write(full_md.encode("utf-8"))

    # 12. 问题页面保存源文件
    if status == "issue":
        source_ext = ".html"
        _save_source_file(output_dir, filepath, html.encode("utf-8", errors="replace"), source_ext)

    print(f"[完成] {filepath}")
    return filepath


# ── 页面质量检测 ────────────────────────────────────────────
def _is_spa_page(html: str, md_body: str) -> bool:
    """检测是否为SPA/JS动态渲染页面"""
    spa_signals = [
        "doesn't work properly without JavaScript",
        "需要启用JavaScript",
        "请启用JavaScript",
        "We're sorry but",
    ]
    for sig in spa_signals:
        if sig.lower() in html.lower():
            return True
    # 检测 <div id="app"> 空body模式
    if '<div id="app">' in html or '<div id="root">' in html:
        cn_chars = len(re.findall(r"[\u4e00-\u9fff]", md_body))
        if cn_chars < 100 and len(html) > 5000:
            return True
    return False


def _is_list_page(url: str, md_body: str) -> bool:
    """检测URL和内容是否为列表/索引页"""
    list_patterns = [r"/col/col\d+", r"/list\b", r"/index\b", r"/catalog"]
    parsed = urlparse(url)
    for pat in list_patterns:
        if re.search(pat, parsed.path, re.I):
            return True
    link_count = len(re.findall(r"\[.*?\]\(.*?\)", md_body))
    cn_chars = len(re.findall(r"[\u4e00-\u9fff]", md_body))
    if link_count > 5 and cn_chars < 200:
        return True
    return False


def _is_image_only_page(md_body: str, title: str = "") -> bool:
    """检测是否为纯图片页面（文字极少，主要靠图片传达信息）
    
    信号:
    - 标题含"一图读懂"/"图解"
    - 中文字符极少（<150）且含多个图片引用
    """
    image_keywords = ["一图读懂", "图解", "漫画", "长图"]
    title_lower = title.lower() if title else ""
    has_image_keyword = any(kw in title_lower for kw in image_keywords)
    
    cn_chars = len(re.findall(r"[\u4e00-\u9fff]", md_body))
    img_count = len(re.findall(r"!\[.*?\]\(.*?\)", md_body))
    
    # 标题含图片关键词 + 内容极少
    if has_image_keyword and cn_chars < 200:
        return True
    # 内容极少 + 有图片引用
    if cn_chars < 100 and img_count >= 2:
        return True
    
    return False


def _is_low_quality_doc(md_body: str, ext: str = "") -> bool:
    """检测文档转换后质量是否低下（内容太少或为空）
    
    适用于 PDF/Word/图片 经 MarkItDown 转换后的质量判定。
    """
    cn_chars = len(re.findall(r"[\u4e00-\u9fff]", md_body))
    # PDF/图片转换后中文字符极少
    if ext in (".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"):
        if cn_chars < 50:
            return True
    # 任意文档转换后几乎为空
    if cn_chars < 20 and len(md_body.strip()) < 100:
        return True
    return False


def _classify_quality(
    url: str = "",
    html: str = "",
    md_body: str = "",
    title: str = "",
    source_ext: str = "",
) -> tuple[str, str]:
    """统一页面/文档质量分类
    
    返回: (status, issue_type)
      status: "verified" | "issue"
      issue_type: "" | "spa" | "list_page" | "image_only" | "low_quality_doc"
    """
    # 按优先级检测：SPA > 列表页 > 纯图片页 > 文档低质量
    if html and _is_spa_page(html, md_body):
        return "issue", "spa"
    if url and _is_list_page(url, md_body):
        return "issue", "list_page"
    if _is_image_only_page(md_body, title):
        return "issue", "image_only"
    if _is_low_quality_doc(md_body, source_ext):
        return "issue", "low_quality_doc"
    return "verified", ""


# ── 输出路径计算 + 源文件保存 ────────────────────────────────
def _compute_output_path(
    output_dir: str,
    title: str,
    region: str,
    hash_source: str,
    status: str,
    policy_id: int = None,
    policy_keyword: str = None,
    file_type: str = None,
    policy_type: str = None,
) -> str:
    """根据配置计算输出路径。
    
    目录结构：按政策关键词 + 地区层级分目录
    示例：育儿补贴/安徽省/合肥市/蜀山区/蜀山区_官方解读_政策文件_30.md
          育儿补贴/四川省/凉山州/宁南县/宁南县_办事指南_办事指南_328.md
          就业补贴/四川省/凉山州/越西县/越西县_办事指南_办事指南_329.md
    """
    from app.config import settings
    
    # 清理文件名中的非法字符
    def sanitize_filename(name: str, max_len: int = 60) -> str:
        safe = re.sub(r'[\\/:*?"<>|]', '', name)[:max_len]
        safe = safe.encode("utf-8", errors="replace").decode("utf-8")
        safe = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', safe)
        return safe.strip()
    
    # 获取政策关键词（第一级目录）
    keyword = sanitize_filename(policy_keyword or "未知政策", max_len=50)
    safe_file_type = sanitize_filename(file_type or "政策文件", max_len=30)
    safe_policy_type = sanitize_filename(policy_type or "", max_len=30)
    
    # 解析地区层级（按 _ 分割）
    # 例如：四川省_凉山州_越西县 → ['四川省', '凉山州', '越西县']
    region_parts = [sanitize_filename(p, max_len=50) for p in region.split('_') if p.strip()] if region else []
    
    # 构建目录路径：育儿补贴/四川省/凉山州/越西县/
    # 如果地区为空，直接用政策关键词
    if region_parts:
        region_dir = os.path.join(keyword, *region_parts)
    else:
        region_dir = keyword
    
    # 构建文件名：{最细地区}_{政策类型}_{文件类型}_{编号}.md
    # 例如：越西县_办事指南_办事指南_329.md
    if region_parts:
        # 取最后一个地区（最细粒度）
        finest_region = region_parts[-1]
    else:
        finest_region = keyword
    
    safe_id = str(policy_id) if policy_id else hashlib.md5(hash_source.encode()).hexdigest()[:6]
    filename = f"{finest_region}_{safe_policy_type}_{safe_file_type}_{safe_id}.md"
    
    # 验证文件名编码
    try:
        filename.encode("gbk")
    except UnicodeEncodeError:
        # 如果GBK编码失败，使用哈希作为文件名
        url_hash = hashlib.md5(hash_source.encode()).hexdigest()[:6]
        filename = f"{finest_region}_{safe_policy_type}_{safe_file_type}_{url_hash}.md"
    
    # 完整路径
    full_path = os.path.join(output_dir, region_dir, filename)
    
    # 创建目录
    target_dir = os.path.dirname(full_path)
    os.makedirs(target_dir, exist_ok=True)
    
    return full_path


def _save_source_file(
    output_dir: str,
    md_filepath: str,
    source_data: bytes,
    source_ext: str,
) -> str:
    """在 issues/ 目录下保存原始源文件（HTML/PDF等），与 OKF 文件同名加 _source 后缀"""
    md_stem = Path(md_filepath).stem
    source_filename = f"{md_stem}_source{source_ext}"
    source_path = os.path.join(os.path.dirname(md_filepath), source_filename)
    with open(source_path, "wb") as f:
        f.write(source_data)
    print(f"[源文件] {source_path}")
    return source_path


# ── 编码自动修复 ────────────────────────────────────────────
def _fix_double_encoding(text: str) -> str:
    """检测并修复 UTF-8 双重编码（UTF-8 → Latin-1 → UTF-8）"""
    # 先去掉 BOM
    text = text.lstrip("\ufeff")
    try:
        # 尝试将看似乱码的文本编码回 Latin-1 再解码为 UTF-8
        fixed = text.encode("latin-1").decode("utf-8")
        # 如果解码成功且包含更多中文字符，说明确实是双重编码
        cn_before = len(re.findall(r"[\u4e00-\u9fff]", text))
        cn_after = len(re.findall(r"[\u4e00-\u9fff]", fixed))
        if cn_after > cn_before:
            return fixed
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return text


def _read_html_file(file_path: str) -> str:
    """读取HTML文件，自动检测并修复编码"""
    raw_bytes = Path(file_path).read_bytes()

    # 尝试多种编码
    for enc in ("utf-8", "gb18030", "gbk", "gb2312"):
        try:
            text = raw_bytes.decode(enc)
            # 检查是否有双重编码
            text = _fix_double_encoding(text)
            return text
        except (UnicodeDecodeError, LookupError):
            continue

    # 最后兜底
    return raw_bytes.decode("utf-8", errors="replace")


# ── 本地 HTML 文件转换 ──────────────────────────────────────
def convert_file_to_okf(
    file_path: str,
    output_dir: str,
    region: str = "",
    policy_type: str = "",
    timestamp: str = "",
) -> str:
    """将本地 HTML 文件转换为 OKF Markdown。
    根据质量分类输出到 verified/ 或 issues/ 子目录，问题页面保存源文件。"""
    print(f"[读取] {file_path}")
    html = _read_html_file(file_path)

    title, soup = extract_main_content(html)
    fix_tables(soup)

    h2t = _make_h2t()
    md_body = h2t.handle(str(soup))
    md_body = clean_markdown(md_body)

    # 质量分类
    status, issue_type = _classify_quality(
        html=html, md_body=md_body, title=title,
    )
    if status == "issue":
        print(f"[问题] 检测到 {issue_type}，输出到 issues/ 目录")
    else:
        print(f"[验证] 质量正常，输出到 verified/ 目录")

    if not policy_type:
        policy_type = infer_policy_type(title, md_body)
    # 传入地区（包括省级）来自采集/核验数据，仅在缺失时推断。
    if not region:
        finer_region = infer_region(title, md_body, policy_type=policy_type)
        if finer_region:
            region = finer_region
    if not timestamp:
        timestamp = infer_timestamp(md_body, source_path=file_path, policy_type=policy_type)

    tags = infer_tags(title, md_body, region, keyword=policy_keyword, policy_type=policy_type)
    description = generate_description(title, md_body)

    frontmatter = build_frontmatter(
        title=title,
        description=description,
        resource=file_path,
        policy_type=policy_type,
        region=region,
        tags=tags,
        timestamp=timestamp,
        status=status,
        issue_type=issue_type,
    )

    full_md = frontmatter + "\n\n" + md_body

    # 输出到 verified/ 或 issues/
    filepath = _compute_output_path(output_dir, title, region, os.path.abspath(file_path), status, policy_type=policy_type)

    with open(filepath, "wb") as f:
        f.write(full_md.encode("utf-8"))

    # 问题页面保存源文件
    if status == "issue":
        source_bytes = Path(file_path).read_bytes()
        _save_source_file(output_dir, filepath, source_bytes, ".html")

    print(f"[完成] {filepath}")
    return filepath


# ── 文档文件转换（PDF/Word/图片 → OKF）─────────────────────────
def convert_document_to_okf(
    file_path: str,
    output_dir: str,
    region: str = "",
    policy_type: str = "",
    timestamp: str = "",
    fallback_title: str = "",
) -> str:
    """将 PDF/Word/图片文件转换为 OKF Markdown（基于 MarkItDown）。
    文档类一律输出到 issues/ 目录，并保存源文件。"""
    ext = Path(file_path).suffix.lower()
    supported = {".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".xls",
                 ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"}
    if ext not in supported:
        raise ValueError(f"不支持的文件格式: {ext}，支持: {', '.join(sorted(supported))}")

    print(f"[文档转换] {file_path}")
    md_converter = MarkItDown()
    result = md_converter.convert(file_path)
    md_body = result.text_content

    # 清理 Markdown
    md_body = clean_markdown(md_body)

    # 从文件名和内容推断元数据
    file_stem = Path(file_path).stem
    title = ""
    is_temp_name = bool(re.match(r"^tmp[a-z0-9]+$", file_stem, re.I))
    
    # 优先使用 fallback_title（来自URL提取的标题）
    if fallback_title:
        title = fallback_title
    
    # 尝试从正文前几行提取更好标题
    if not title:
        first_lines = md_body.split("\n")[:15]
        for line in first_lines:
            line_stripped = line.strip().lstrip("#").strip()
            if line_stripped and 5 <= len(line_stripped) <= 100 and re.search(r"[\u4e00-\u9fff]", line_stripped):
                if not _is_bad_title(line_stripped):
                    title = line_stripped
                    break
    if not title and not is_temp_name:
        title = file_stem
    if not title:
        title = "政策文档"
    title = _finalize_title(title)

    # 质量分类 — 文档类一律放 issues/
    status, issue_type = _classify_quality(
        md_body=md_body, title=title, source_ext=ext,
    )
    status = "issue"
    issue_type = "pdf_doc" if issue_type == "" else issue_type
    print(f"[问题] 文档类型 {ext}，输出到 issues/ 目录")

    if not policy_type:
        policy_type = infer_policy_type(title, md_body)
    # 先规范化地区格式（无分隔符 → _ 分隔）
    region = _normalize_region_format(region)
    # 传入地区（包括省级）来自采集/核验数据，仅在缺失时推断。
    if not region:
        finer_region = infer_region(title, md_body, policy_type=policy_type)
        if finer_region:
            region = finer_region
    if not timestamp:
        timestamp = infer_timestamp(md_body, source_path=file_path, policy_type=policy_type)

    tags = infer_tags(title, md_body, region, keyword=policy_keyword, policy_type=policy_type)
    description = generate_description(title, md_body)

    frontmatter = build_frontmatter(
        title=title,
        description=description,
        resource=file_path,
        policy_type=policy_type,
        region=region,
        tags=tags,
        timestamp=timestamp,
        status=status,
        issue_type=issue_type,
    )

    full_md = frontmatter + "\n\n" + md_body

    # 输出到 issues/
    filepath = _compute_output_path(output_dir, title, region, os.path.abspath(file_path), status, policy_type=policy_type)

    with open(filepath, "wb") as f:
        f.write(full_md.encode("utf-8"))

    # 保存源文件
    source_bytes = Path(file_path).read_bytes()
    _save_source_file(output_dir, filepath, source_bytes, ext)

    print(f"[完成] {filepath}")
    return filepath


# ── 批量转换 ─────────────────────────────────────────────────
def batch_convert(batch_json: str, output_dir: str) -> list[str]:
    """批量转换: JSON 格式 [{"url":"..."} | {"file":"..."} | {"doc":"..."}, "region":"...", "type":"..."]"""
    with open(batch_json, "r", encoding="utf-8") as f:
        items = json.load(f)

    results = []
    for item in items:
        url = item.get("url", "")
        file_path = item.get("file", "")
        doc_path = item.get("doc", "")
        region = item.get("region", "")
        ptype = item.get("type", "")
        try:
            if doc_path:
                path = convert_document_to_okf(doc_path, output_dir, region=region, policy_type=ptype)
            elif file_path:
                path = convert_file_to_okf(file_path, output_dir, region=region, policy_type=ptype)
            elif url:
                path = convert_url_to_okf(url, output_dir, region=region, policy_type=ptype)
            else:
                continue
            results.append(path)
        except Exception as e:
            print(f"[错误] {url or file_path or doc_path}: {e}")
    return results


# ── 生成 index.md（OKF Bundle 目录）──────────────────────────
def generate_index(output_dir: str) -> str:
    """为输出目录生成 OKF index.md，递归扫描所有 .md 文件"""
    entries = []
    
    # 递归扫描所有 .md 文件（排除 index.md 和 log.md）
    for f in sorted(Path(output_dir).rglob("*.md")):
        if f.name in ("index.md", "log.md"):
            continue
        try:
            with open(f, "r", encoding="utf-8") as fh:
                content = fh.read()
        except:
            continue
            
        title = f.stem
        region = ""
        ptype = ""
        status = ""
        issue_type = ""
        fm_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        if fm_match:
            fm_text = fm_match.group(1)
            for line in fm_text.split("\n"):
                if line.startswith("title:"):
                    title = line.split(":", 1)[1].strip().strip('"')
                elif line.startswith("region:"):
                    region = line.split(":", 1)[1].strip().strip('"')
                elif line.startswith("type:"):
                    ptype = line.split(":", 1)[1].strip().strip('"')
                elif line.startswith("status:"):
                    status = line.split(":", 1)[1].strip().strip('"')
                elif line.startswith("issue_type:"):
                    issue_type = line.split(":", 1)[1].strip().strip('"')
        
        # 计算相对路径
        rel_path = str(f.relative_to(Path(output_dir)))
        entries.append({
            "title": title,
            "region": region,
            "type": ptype,
            "status": status,
            "issue_type": issue_type,
            "file": rel_path,
        })

    if not entries:
        return ""

    # 按政策关键词分组（从文件路径第一级提取）
    by_keyword: dict[str, list] = {}
    for e in entries:
        parts = Path(e["file"]).parts
        keyword = parts[0] if len(parts) > 1 else "未分类"
        by_keyword.setdefault(keyword, []).append(e)

    # OKF §6: index.md 不含 frontmatter
    lines = ["# 政策知识库目录\n"]

    for keyword, items in sorted(by_keyword.items()):
        lines.append(f"## {keyword}\n")
        # 按地区分组
        by_region: dict[str, list] = {}
        for e in items:
            r = e["region"] or "未分类"
            by_region.setdefault(r, []).append(e)
        for region, region_items in sorted(by_region.items()):
            lines.append(f"### {region}\n")
            for item in region_items:
                desc = item["type"] or ""
                lines.append(f"* [{item['title']}]({item['file']}) - {desc}")
            lines.append("")

    index_path = os.path.join(output_dir, "index.md")
    with open(index_path, "wb") as f:
        f.write("\n".join(lines).encode("utf-8"))

    print(f"[索引] {index_path}")
    # 打印统计
    print(f"[统计] 总条目: {len(entries)}")
    return index_path


# ── 生成 log.md ─────────────────────────────────────────────
def generate_log(output_dir: str, action: str, details: str = "") -> str:
    """追加 OKF log.md 变更记录（§7: 无 frontmatter，日期 YYYY-MM-DD）"""
    log_path = os.path.join(output_dir, "log.md")

    existing = ""
    if os.path.exists(log_path):
        with open(log_path, "r", encoding="utf-8") as f:
            existing = f.read()

    # OKF §7: log.md 无 frontmatter，以标题开头
    if not existing.strip():
        existing = "# Directory Update Log\n"

    now = datetime.now().strftime("%Y-%m-%d")  # §7: YYYY-MM-DD
    entry = f"\n## {now}\n\n* **{action}** {details}\n"

    with open(log_path, "wb") as f:
        f.write((existing + entry).encode("utf-8"))

    print(f"[日志] {log_path}")
    return log_path


# ── CLI 入口 ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="政府政策网页 → OKF Markdown 转换器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 单页转换
  python gov_policy_to_okf.py --url "https://wjw.beijing.gov.cn/xxgk/yebt_jiedu.html" --output ./okf_output --region 北京

  # 本地 HTML 转换
  python gov_policy_to_okf.py --file ./政策页面.html --output ./okf_output --region 上海

  # 文档转换（PDF/Word/图片）
  python gov_policy_to_okf.py --doc ./政策文件.pdf --output ./okf_output --region 广东

  # 批量转换
  python gov_policy_to_okf.py --batch urls.json --output ./okf_output

  # 指定类型和时间
  python gov_policy_to_okf.py --url "..." --output ./okf_output --type 官方解读 --timestamp 2025-08-01
        """,
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", help="政策网页 URL")
    group.add_argument("--file", help="本地 HTML 文件路径")
    group.add_argument("--doc", help="本地文档文件路径（PDF/Word/图片，使用 MarkItDown 转换）")
    group.add_argument("--batch", help="批量转换 JSON 文件（数组，每项含 url/file/region/type）")

    parser.add_argument("--output", "-o", required=True, help="输出目录")
    parser.add_argument("--region", "-r", default="", help="政策地区（如：北京、四川），为空则自动推断")
    parser.add_argument("--type", "-t", default="", help="政策类型（如：实施方案、官方解读），为空则自动推断")
    parser.add_argument("--timestamp", default="", help="发布日期（YYYY-MM-DD），为空则自动推断")
    parser.add_argument("--no-index", action="store_true", help="不生成 index.md")
    parser.add_argument("--no-log", action="store_true", help="不生成/更新 log.md")

    args = parser.parse_args()

    results = []
    if args.url:
        path = convert_url_to_okf(
            args.url, args.output,
            region=args.region, policy_type=args.type,
            timestamp=args.timestamp,
        )
        results.append(path)
    elif args.file:
        path = convert_file_to_okf(
            args.file, args.output,
            region=args.region, policy_type=args.type,
            timestamp=args.timestamp,
        )
        results.append(path)
    elif args.doc:
        path = convert_document_to_okf(
            args.doc, args.output,
            region=args.region, policy_type=args.type,
            timestamp=args.timestamp,
        )
        results.append(path)
    elif args.batch:
        results = batch_convert(args.batch, args.output)

    if not args.no_index:
        generate_index(args.output)

    if not args.no_log:
        # 统计 verified 与 issues
        v_count = len(list(Path(os.path.join(args.output, "verified")).glob("*.md"))) if os.path.isdir(os.path.join(args.output, "verified")) else 0
        i_count = len(list(Path(os.path.join(args.output, "issues")).glob("*.md"))) if os.path.isdir(os.path.join(args.output, "issues")) else 0
        generate_log(args.output, action="批量转换", 
                     details=f"共 {len(results)} 个文件 (已验证: {v_count}, 待复核: {i_count})")

    print(f"\n全部完成，共转换 {len(results)} 个文件 → {args.output}")
    print(f"  verified/ : 正常转换文件")
    print(f"  issues/   : 待复核文件（含源文件）")


if __name__ == "__main__":
    main()