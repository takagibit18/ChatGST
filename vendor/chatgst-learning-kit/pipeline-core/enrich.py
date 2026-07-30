"""政策详情自动补齐服务 — 从 policy_url 抓取网页，提取缺失字段并更新数据库"""
import os
import re
import ssl
import asyncio
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from loguru import logger

from app.services.http_utils import (
    fetch_html_sync, fetch_html_async, is_bad_title as _is_bad_title,
    infer_region_from_url, URL_REGION_MAP,
)
from app.services.region_parser import extract_region_hierarchy


# ── 字段提取 ─────────────────────────────────────────────────

def extract_file_name(soup: BeautifulSoup, html: str = "") -> str:
    """提取文件名称（政策标题）"""
    # 1. <h1> / <h2>
    for tag in soup.find_all(["h1", "h2"]):
        text = tag.get_text(strip=True)
        if text and 5 <= len(text) <= 100 and re.search(r"[\u4e00-\u9fff]", text):
            if not _is_bad_title(text):
                return text

    # 2. class 含 title/heading/arti 的 div/p
    for tag in soup.find_all(["div", "p", "span"], class_=re.compile(r"title|heading|arti", re.I)):
        text = tag.get_text(strip=True)
        if text and 8 <= len(text) <= 100 and re.search(r"[\u4e00-\u9fff]", text):
            if not _is_bad_title(text):
                return text

    # 3. <title> 标签提取中书名号内容
    title_tag = soup.find("title")
    if title_tag:
        raw = title_tag.get_text(strip=True)
        book_match = re.search(r"《(.+?)》", raw)
        if book_match:
            return book_match.group(1)
        # 去掉"- 网站名"后缀
        for sep in [" - ", "——", "_", "｜"]:
            if sep in raw:
                parts = raw.split(sep)
                candidate = parts[0].strip()
                if candidate and len(candidate) >= 5 and not _is_bad_title(candidate):
                    return candidate

    # 4. meta og:title / description
    for meta in soup.find_all("meta"):
        prop = (meta.get("property") or "").lower()
        name = (meta.get("name") or "").lower()
        if prop == "og:title" or name == "description":
            content = meta.get("content", "")
            book_match = re.search(r"《(.+?)》", content)
            if book_match:
                return book_match.group(1)
            if content and 8 <= len(content) <= 80 and re.search(r"[\u4e00-\u9fff]", content):
                if not _is_bad_title(content):
                    return content

    return ""


def extract_publish_unit(soup: BeautifulSoup) -> str:
    """提取发布单位"""
    # 1. meta name="source" 或 name="author"
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or "").lower()
        if name in ("source", "department"):
            content = meta.get("content", "")
            if content and 2 <= len(content) <= 60 and _looks_like_gov_unit(content):
                return content.strip()

    # 2. 正文中的"发布机关"/"来源"信息
    for tag in soup.find_all(["span", "p", "div"], class_=re.compile(r"source|author|unit|office|depart|info", re.I)):
        text = tag.get_text(strip=True)
        # 常见格式："来源：XXX厅" 或 "发文机关：XXX局"
        m = re.search(r"(?:发布机关|发布单位|发布部门|发文机关|来源单位)[：:]\s*(.+)", text)
        if m:
            unit = m.group(1).strip()
            if 2 <= len(unit) <= 60 and _looks_like_gov_unit(unit):
                return unit
        # "来源：XXX" —— 要求含机关关键词
        m = re.search(r"来源[：:]\s*(.+)", text)
        if m:
            unit = m.group(1).strip()
            if _looks_like_gov_unit(unit) and 4 <= len(unit) <= 60:
                return unit

    # 3. 搜索含"发文机关"/"发布单位"文本（更精确的关键词）
    all_text = soup.get_text()
    m = re.search(r"(?:发布机关|发布单位|发布部门|发文机关)[：:]\s*([\u4e00-\u9fff（）]+[\u4e00-\u9fff（）局厅部委办院府组]{{{0,5}})", all_text)
    if m:
        unit = m.group(1).strip()
        if 2 <= len(unit) <= 60 and _looks_like_gov_unit(unit):
            return unit

    # 4. 从URL域名推断（回退）
    return ""


def _looks_like_gov_unit(text: str) -> bool:
    """判断文本是否像政府机构名称（而非编辑记者人名等）"""
    # 必须含机构关键词
    gov_keywords = [
        "部", "委", "局", "厅", "处", "办", "院", "府", "署", "所", "中心",
        "委员会", "办公室", "指挥部", "工作组", "小组", "总队", "大队",
        "人民", "政府", "国务院", "中央",
    ]
    for kw in gov_keywords:
        if kw in text:
            return True
    # 纯人名特征：2-3个汉字且不含机构词
    if re.match(r"^[\u4e00-\u9fff]{2,4}$", text) and not any(kw in text for kw in gov_keywords):
        return False
    return len(text) >= 4


def extract_publish_date(soup: BeautifulSoup) -> str:
    """提取发布日期，返回 YYYY-MM-DD 格式"""
    # 1. meta 中的日期
    for meta in soup.find_all("meta"):
        prop = (meta.get("property") or "").lower()
        name = (meta.get("name") or "").lower()
        if prop in ("article:published_time",) or name in ("pubdate", "publish-date", "date"):
            content = meta.get("content", "")
            if content:
                return _normalize_date(content)

    # 2. 正文中的日期信息
    for tag in soup.find_all(["span", "p", "div", "time"], class_=re.compile(r"date|time|publish|info|meta", re.I)):
        text = tag.get_text(strip=True)
        m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        m = re.search(r"(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})", text)
        if m:
            return _normalize_date(m.group(1))

    # 3. 全文搜索日期
    all_text = soup.get_text()
    # 优先找"发布日期：XXXX年X月X日"
    m = re.search(r"(?:发布日期|发布时间|发布日期|成文日期|印发日期)[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", all_text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"(?:发布日期|发布时间|成文日期|印发日期)[：:]\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})", all_text)
    if m:
        return _normalize_date(m.group(1))

    # 4. 一般中文日期
    m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", all_text[:2000])
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

    return ""


def extract_publish_region(soup: BeautifulSoup, url: str = "") -> str:
    """提取发布地区（优先正文语义解析，其次结构化标签，最后 URL 域名推断）"""
    from app.services.region_parser import extract_region_from_text

    body_text = soup.get_text(separator="\n", strip=True)

    # 1. 从正文中解析省/市/区/街道
    region = extract_region_from_text(body_text)
    if region:
        return region

    # 2. 正文中的结构化地区信息
    for tag in soup.find_all(["span", "p", "div"], class_=re.compile(r"region|area|location|source|info", re.I)):
        text = tag.get_text(strip=True)
        m = re.search(r"(?:地区|区域|省份|所属)[：:]\s*(.+)", text)
        if m:
            region = m.group(1).strip()
            if 2 <= len(region) <= 30:
                return region

    # 3. 从 URL 域名推断（使用共享模块）
    if url:
        region = infer_region_from_url(url)
        if region:
            return region

    return ""


def extract_subsidy_fields(soup: BeautifulSoup) -> dict:
    """从正文中提取补贴相关字段：补贴对象、补贴标准、申报条件、申领程序等"""
    result = {}
    all_text = soup.get_text()

    # 补贴对象
    m = re.search(r"(?:补贴对象|保障对象|救助对象|享受对象|适用对象)[：:]\s*(.+?)(?:\n|$)", all_text)
    if m and len(m.group(1).strip()) <= 200:
        result["subsidy_target"] = m.group(1).strip()

    # 补贴标准
    m = re.search(r"(?:补贴标准|保障标准|救助标准|发放标准)[：:]\s*(.+?)(?:\n|$)", all_text)
    if m and len(m.group(1).strip()) <= 200:
        result["subsidy_standard"] = m.group(1).strip()

    # 申报条件
    m = re.search(r"(?:申报条件|申请条件|资格条件|办理条件)[：:]\s*(.+?)(?:\n|$)", all_text)
    if m and len(m.group(1).strip()) <= 200:
        result["apply_condition"] = m.group(1).strip()

    # 申领程序
    m = re.search(r"(?:申领程序|办理程序|申请流程|办理流程|申报程序)[：:]\s*(.+?)(?:\n|$)", all_text)
    if m and len(m.group(1).strip()) <= 200:
        result["apply_procedure"] = m.group(1).strip()

    # 申报期限
    m = re.search(r"(?:申报期限|申请期限|办理期限|受理期限)[：:]\s*(.+?)(?:\n|$)", all_text)
    if m and len(m.group(1).strip()) <= 200:
        result["apply_period"] = m.group(1).strip()

    # 所需材料
    m = re.search(r"(?:所需材料|申请材料|申报材料|办理材料)[：:]\s*(.+?)(?:\n|$)", all_text)
    if m and len(m.group(1).strip()) <= 200:
        result["required_materials"] = m.group(1).strip()

    return result


def _normalize_date(raw: str) -> str:
    """将各种日期格式标准化为 YYYY-MM-DD"""
    raw = raw.strip()
    # YYYY年M月D日
    m = re.match(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    # YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
    m = re.match(r"(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    # ISO datetime
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})[T ]", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return raw[:10]


# ── 核心补齐逻辑 ─────────────────────────────────────────────

def enrich_single_policy(url: str) -> dict:
    """抓取单个政策URL，提取可用字段"""
    try:
        html, final_url = fetch_html_sync(url)
    except Exception as e:
        logger.warning(f"抓取失败 {url[:60]}: {e}")
        return {"error": str(e)[:200]}

    soup = BeautifulSoup(html, "lxml")
    result = {}

    # 提取字段
    title = extract_file_name(soup, html)
    if title:
        result["file_name"] = title

    unit = extract_publish_unit(soup)
    if unit:
        result["publish_unit"] = unit

    date = extract_publish_date(soup)
    if date:
        result["publish_date"] = date

    region = extract_publish_region(soup, final_url)
    if region:
        result["publish_region"] = region
        result["extra"] = {"region": extract_region_hierarchy(soup.get_text(separator="\n", strip=True))}

    # 补贴相关字段
    subsidy_fields = extract_subsidy_fields(soup)
    result.update(subsidy_fields)

    return result


async def enrich_single_policy_async(url: str) -> dict:
    """异步抓取单个政策URL，提取可用字段（不阻塞事件循环）"""
    try:
        html, final_url = await fetch_html_async(url)
    except Exception as e:
        logger.warning(f"抓取失败 {url[:60]}: {e}")
        return {"error": str(e)[:200]}

    soup = BeautifulSoup(html, "lxml")
    result = {}

    title = extract_file_name(soup, html)
    if title:
        result["file_name"] = title

    unit = extract_publish_unit(soup)
    if unit:
        result["publish_unit"] = unit

    date = extract_publish_date(soup)
    if date:
        result["publish_date"] = date

    region = extract_publish_region(soup, final_url)
    if region:
        result["publish_region"] = region
        result["extra"] = {"region": extract_region_hierarchy(soup.get_text(separator="\n", strip=True))}

    subsidy_fields = extract_subsidy_fields(soup)
    result.update(subsidy_fields)

    return result


async def enrich_policies(
    policy_ids: Optional[list[int]] = None,
    only_missing: bool = True,
    max_count: int = 100,
    delay: float = 1.0,
    workspace: Optional[str] = None,
) -> dict:
    """批量补齐政策缺失字段（使用原生 sqlite3）

    Args:
        policy_ids: 指定补齐的ID列表，为空则自动选择缺失字段的记录
        only_missing: 仅补齐缺失的字段（不覆盖已有值）
        max_count: 最大处理数量
        delay: 请求间隔秒数
        workspace: 工作空间名称
    """
    import json
    from app.routers.db_sync import get_sync_conn

    conn = get_sync_conn()
    cursor = conn.cursor()

    # 查询目标记录
    if policy_ids:
        placeholders = ",".join(["?"] * len(policy_ids))
        if workspace:
            cursor.execute(
                f"SELECT * FROM subsidy_policies WHERE id IN ({placeholders}) AND workspace=? LIMIT ?",
                policy_ids + [workspace, max_count]
            )
        else:
            cursor.execute(
                f"SELECT * FROM subsidy_policies WHERE id IN ({placeholders}) LIMIT ?",
                policy_ids + [max_count]
            )
    else:
        if workspace:
            cursor.execute(
                """SELECT * FROM subsidy_policies 
                   WHERE workspace=? AND policy_url IS NOT NULL AND policy_url != ''
                   AND (file_name IS NULL OR file_name = ''
                        OR publish_region IS NULL OR publish_region = ''
                        OR publish_unit IS NULL OR publish_unit = ''
                        OR publish_date IS NULL OR publish_date = '')
                   ORDER BY id LIMIT ?""",
                [workspace, max_count]
            )
        else:
            cursor.execute(
                """SELECT * FROM subsidy_policies 
                   WHERE policy_url IS NOT NULL AND policy_url != ''
                   AND (file_name IS NULL OR file_name = ''
                        OR publish_region IS NULL OR publish_region = ''
                        OR publish_unit IS NULL OR publish_unit = ''
                        OR publish_date IS NULL OR publish_date = '')
                   ORDER BY id LIMIT ?""",
                [max_count]
            )
    
    rows = cursor.fetchall()
    if not rows:
        conn.close()
        return {"total": 0, "updated": 0, "failed": 0, "errors": [], "message": "没有需要补齐的记录"}

    total = len(rows)
    updated_count = 0
    failed_count = 0
    errors = []

    for row in rows:
        pid = row["id"]
        url = row["policy_url"]
        if not url:
            continue

        try:
            # 使用异步抓取（不阻塞事件循环）
            info = await enrich_single_policy_async(url)
            if "error" in info:
                failed_count += 1
                errors.append(f"ID={pid}: {info['error']}")
                continue

            updated_fields = []
            set_parts = []
            values = []
            
            for field_name, value in info.items():
                if field_name == "error" or not value:
                    continue
                current = row[field_name]
                if only_missing and current and str(current).strip():
                    continue
                # extra 字段做合并
                if field_name == "extra" and isinstance(value, dict):
                    existing = current or {}
                    if isinstance(existing, str):
                        try:
                            existing = json.loads(existing)
                        except:
                            existing = {}
                    if not isinstance(existing, dict):
                        existing = {}
                    merged = {**existing, **value}
                    set_parts.append(f"extra = ?")
                    values.append(json.dumps(merged, ensure_ascii=False))
                else:
                    set_parts.append(f"{field_name} = ?")
                    values.append(value)
                updated_fields.append(field_name)

            if updated_fields:
                values.append(datetime.now().isoformat())
                set_parts.append("updated_at = ?")
                values.append(pid)
                set_clause = ", ".join(set_parts)
                cursor.execute(
                    f"UPDATE subsidy_policies SET {set_clause} WHERE id = ?",
                    values
                )
                conn.commit()
                updated_count += 1
                logger.info(f"ID={pid} 补齐字段: {updated_fields} <- {url[:60]}")

        except Exception as e:
            failed_count += 1
            errors.append(f"ID={pid}: {str(e)[:100]}")

        await asyncio.sleep(delay)

    conn.close()

    return {
        "total": total,
        "updated": updated_count,
        "failed": failed_count,
        "errors": errors[:20],
        "message": f"补齐完成：共处理 {total} 条，成功补齐 {updated_count} 条，失败 {failed_count} 条",
    }