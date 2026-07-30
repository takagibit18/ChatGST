"""地区层级解析工具

基于 cpca 从文本中提取省、市、区，并在此基础上进一步抽取街道/镇/乡信息。
"""
import re
from typing import Optional

import cpca


# 街道/镇/乡/社区/村级后缀匹配
_STREET_PATTERNS = [
    r"[^，,。；;\n]*?(?:街道|镇|乡)",
    r"[^，,。；;\n]*?(?:社区|居委会|村委会|村)",
]
_STREET_RE = re.compile("(?:" + "|".join(_STREET_PATTERNS) + ")")


def extract_street(text: str) -> str:
    """从地址余文或全文中抽取街道/镇/乡/社区/村信息"""
    if not text:
        return ""
    m = _STREET_RE.search(text)
    if m:
        street = m.group(0).strip()
        # 去除开头无意义的前导词，保留核心名称+后缀
        street = re.sub(r"^(位于|地址|住址|居住地|所属)", "", street)
        if len(street) >= 2:
            return street
    return ""


def extract_region_hierarchy(text: str) -> dict:
    """从正文中解析地区层级。

    返回结构：
    {
        "province": "广东省",
        "city": "深圳市",
        "district": "南山区",
        "street": "粤海街道",
        "full": "广东省深圳市南山区粤海街道",
    }
    """
    if not text:
        return {"province": "", "city": "", "district": "", "street": "", "full": ""}

    try:
        # cpca 对长文本较慢，只取前 4000 字符
        sample = text[:4000]
        df = cpca.transform([sample])
        row = df.iloc[0]
        province = str(row.get("省", "")) or ""
        city = str(row.get("市", "")) or ""
        district = str(row.get("区", "")) or ""
        address_remainder = str(row.get("地址", "")) or ""
    except Exception:
        province = city = district = address_remainder = ""

    # 清洗 cpca 可能返回的 None/市辖区 等占位值
    if province in ("None", ""):
        province = ""
    if city in ("None", "市辖区", ""):
        city = ""
    if district in ("None", "市辖区", "", province, city):
        district = ""

    # 从地址余文抽取街道/镇/乡
    street = extract_street(address_remainder)
    # 如果地址余文里没有，再到全文里试一次
    if not street:
        street = extract_street(text)

    # 拼接完整地区字符串，避免直辖市重复
    parts = []
    if province:
        parts.append(province)
    if city and city != province:
        parts.append(city)
    if district and district != city:
        parts.append(district)
    if street and street not in parts:
        parts.append(street)

    full = "".join(parts)

    return {
        "province": province,
        "city": city,
        "district": district,
        "street": street,
        "full": full,
    }


def extract_region_from_text(text: str) -> str:
    """便捷函数：返回最完整的地区字符串"""
    return extract_region_hierarchy(text).get("full", "")
