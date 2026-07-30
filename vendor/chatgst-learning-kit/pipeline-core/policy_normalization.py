"""政策分类字段的统一规范，供所有入库渠道复用。"""
from __future__ import annotations

import re
import unicodedata
from typing import Any


_QUOTE_TRANSLATION = str.maketrans({
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‘": "'", "’": "'", "＂": '"', "＇": "'",
})

# 业务上确认属于同一个“一件事”的历史别名。新增别名时只在这里维护，
# Excel、手工录入、自动采集和编辑保存都会同步生效。
_ONE_THING_ALIASES = {
    "育儿补贴申请一件事": "育儿补贴申领一件事",
}


def normalise_label(value: Any) -> str:
    """统一 Unicode、引号和空白，但不改变普通字段的业务语义。"""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).translate(_QUOTE_TRANSLATION)
    return re.sub(r"\s+", " ", text).strip()


def canonical_one_thing_name(value: Any) -> str:
    """返回“一件事”名称的唯一展示/存储形式。"""
    text = normalise_label(value)
    # 名称里的引号仅是“一件事”的排版差异，不应产生新的分类选项。
    text = re.sub(r'''["'`]+''', "", text)
    text = re.sub(r"\s+", "", text)
    return _ONE_THING_ALIASES.get(text, text)


def normalise_policy_identity(data: dict[str, Any]) -> dict[str, Any]:
    """原地规范化各来源待写入的分类字段，并返回该字典。"""
    if "one_thing_name" in data:
        data["one_thing_name"] = canonical_one_thing_name(data["one_thing_name"])
    if "subsidy_item_name" in data:
        data["subsidy_item_name"] = normalise_label(data["subsidy_item_name"])
    return data


def reconcile_stored_one_thing_names(connection: Any) -> int:
    """将历史记录升级为规范名称；只更新名称字段，不合并或删除政策记录。"""
    cursor = connection.cursor()
    cursor.execute(
        "SELECT id, one_thing_name FROM subsidy_policies "
        "WHERE one_thing_name IS NOT NULL AND TRIM(one_thing_name) != ''"
    )
    updates = [
        (canonical, row_id)
        for row_id, raw_name in cursor.fetchall()
        if (canonical := canonical_one_thing_name(raw_name)) and canonical != raw_name
    ]
    if updates:
        cursor.executemany("UPDATE subsidy_policies SET one_thing_name=? WHERE id=?", updates)
    return len(updates)
