"""数据导出路由（Excel / Markdown / OKF）"""
import os
import asyncio
import io
import sqlite3
import logging
import json
import threading
import uuid
from datetime import datetime
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, Query, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from urllib.parse import quote

logger = logging.getLogger(__name__)
from app.config import get_vision_config, settings
from app.routers.db_sync import get_sync_conn

router = APIRouter(prefix="/api/export", tags=["数据导出"])

_thread_pool = ThreadPoolExecutor(max_workers=4)


class ExportByIdsRequest(BaseModel):
    policy_ids: list[int]


class ExcelExportRequest(BaseModel):
    policy_ids: list[int] = Field(default_factory=list)


class OkfExportRequest(BaseModel):
    policy_ids: list[int]


class MarkdownTaskRequest(BaseModel):
    # 工作空间只是业务系统的可选隔离维度。留空时导出全局数据并写入 export 根目录。
    workspace: str = ""
    policy_ids: list[int] = Field(default_factory=list)
    verify_status: Optional[str] = "qualified"
    one_thing_name: Optional[str] = None
    subsidy_item_name: Optional[str] = None
    api_key: Optional[str] = ""
    model: str = "GS/Qwen3.6-Plus"
    parse_attachments: bool = True
    localize_images: bool = True
    parse_images: bool = True
    download_originals: bool = True


class VisionTestRequest(BaseModel):
    api_key: Optional[str] = None
    model: str = "GS/Qwen3.6-Plus"


class WorkspaceRequest(BaseModel):
    workspace: str


_export_tasks: dict[str, dict] = {}
_export_task_handles: dict[str, asyncio.Task] = {}
_export_tasks_lock = threading.Lock()


def _update_export_task(task_id: str, **changes) -> None:
    with _export_tasks_lock:
        state = _export_tasks.get(task_id)
        if state is not None:
            state.update(changes)


def _export_task_snapshot(task_id: str) -> Optional[dict]:
    with _export_tasks_lock:
        state = _export_tasks.get(task_id)
        return dict(state) if state is not None else None


@router.post("/workspace/register")
async def register_workspace(body: WorkspaceRequest):
    """注册工作空间：在export目录下创建对应文件夹"""
    import re
    workspace = body.workspace.strip()
    if not workspace:
        raise HTTPException(400, "工作空间名称不能为空")
    if not re.match(r'^[\u4e00-\u9fa5a-zA-Z0-9_\-]+$', workspace):
        raise HTTPException(400, "工作空间名称只能包含中文、字母、数字、下划线和连字符")
    
    workspace_dir = os.path.join(settings.EXPORT_DIR, workspace)
    if os.path.exists(workspace_dir):
        raise HTTPException(400, f"工作空间 '{workspace}' 已存在")
    
    os.makedirs(workspace_dir, exist_ok=True)
    return {"message": f"工作空间 '{workspace}' 创建成功", "workspace": workspace, "path": workspace_dir}


@router.delete("/workspace/{workspace}")
async def delete_workspace(workspace: str):
    """删除工作空间：删除对应文件夹"""
    import shutil
    workspace_dir = os.path.join(settings.EXPORT_DIR, workspace)
    if not os.path.exists(workspace_dir):
        raise HTTPException(404, f"工作空间 '{workspace}' 不存在")
    
    shutil.rmtree(workspace_dir)
    return {"message": f"工作空间 '{workspace}' 已删除"}


@router.get("/workspaces")
async def list_workspaces():
    """列出所有工作空间"""
    export_dir = settings.EXPORT_DIR
    if not os.path.exists(export_dir):
        return {"workspaces": []}
    
    workspaces = []
    for item in os.listdir(export_dir):
        item_path = os.path.join(export_dir, item)
        if os.path.isdir(item_path) and item not in ("__pycache__",):
            file_count = sum(1 for f in os.listdir(item_path) if f.endswith(".md"))
            workspaces.append({
                "name": item,
                "path": item_path,
                "file_count": file_count,
            })
    
    return {"workspaces": sorted(workspaces, key=lambda x: x["name"])}


EXCEL_COLUMNS = [
    ("ID", "id"),
    ('"一件事"名称', "one_thing_name"),
    ("补贴事项名称", "subsidy_item_name"),
    ("文件类型", "file_type"),
    ("文件名称", "file_name"),
    ("发布地区", "publish_region"),
    ("发布单位", "publish_unit"),
    ("发布日期", "publish_date"),
    ("补贴对象", "subsidy_target"),
    ("补贴标准", "subsidy_standard"),
    ("申报期限", "apply_period"),
    ("申报条件", "apply_condition"),
    ("所需材料名称", "required_materials"),
    ("发放时间", "distribute_time"),
    ("发放渠道", "distribute_channel"),
    ("申领程序", "apply_procedure"),
    ("办理渠道", "handle_channel"),
    ("线上办理入口", "online_entry"),
    ("政策原文链接", "policy_url"),
    ("工作空间", "workspace"),
    ("核验状态", "verify_status"),
    ("驳回原因", "reject_reason"),
    ("核验备注", "verify_note"),
    ("核验人", "verified_by"),
    ("核验时间", "verified_at"),
    ("数据来源", "source_sheet"),
    ("采集时间", "scraped_at"),
]


def _excel_cell_value(row, field: str):
    """把 SQLite 值转成安全、可读的 Excel 单元格值。"""
    try:
        value = row[field]
    except (KeyError, IndexError):
        value = None

    if value is None:
        return ""
    if field == "verify_status":
        return {"pending": "待核验", "qualified": "合格", "rejected": "已驳回"}.get(str(value), str(value))
    if field == "reject_reason":
        return {"invalid": "无效", "needs_improvement": "待完善"}.get(str(value), str(value))
    if isinstance(value, bool):
        return "是" if value else "否"
    if hasattr(value, "isoformat"):
        try:
            value = value.isoformat(sep=" ")
        except TypeError:
            value = value.isoformat()

    text = str(value)
    # Excel 单元格最大长度为 32767；同时阻止普通文本被当成公式执行。
    text = text[:32767]
    if text.startswith(("=", "+", "-", "@")):
        text = "'" + text
    return text


def _build_excel_bytes(rows) -> bytes:
    """生成带筛选、冻结表头和可点击 URL 的 Excel 文件。"""
    from openpyxl import Workbook
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "政策数据"
    worksheet.freeze_panes = "A2"

    header_fill = PatternFill("solid", fgColor="1677FF")
    header_font = Font(color="FFFFFF", bold=True)
    for column_index, (title, _) in enumerate(EXCEL_COLUMNS, start=1):
        cell = worksheet.cell(row=1, column=column_index, value=title)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row_index, row in enumerate(rows, start=2):
        for column_index, (_, field) in enumerate(EXCEL_COLUMNS, start=1):
            value = _excel_cell_value(row, field)
            if isinstance(value, str):
                value = ILLEGAL_CHARACTERS_RE.sub("", value)
            cell = worksheet.cell(row=row_index, column=column_index, value=value)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            if field in ("policy_url", "online_entry") and isinstance(value, str) and value.startswith(("http://", "https://")):
                cell.hyperlink = value
                cell.style = "Hyperlink"

    worksheet.auto_filter.ref = f"A1:{get_column_letter(len(EXCEL_COLUMNS))}{len(rows) + 1}"
    worksheet.row_dimensions[1].height = 24

    compact_fields = {"id": 10, "file_type": 14, "publish_date": 14, "verify_status": 12, "reject_reason": 12}
    wide_fields = {
        "file_name": 36,
        "policy_url": 60,
        "online_entry": 42,
        "subsidy_target": 30,
        "subsidy_standard": 30,
        "apply_condition": 40,
        "required_materials": 36,
        "apply_procedure": 40,
        "handle_channel": 32,
        "verify_note": 30,
    }
    for column_index, (_, field) in enumerate(EXCEL_COLUMNS, start=1):
        worksheet.column_dimensions[get_column_letter(column_index)].width = (
            compact_fields.get(field) or wide_fields.get(field) or 22
        )

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


@router.post("/excel")
async def export_excel(
    body: ExcelExportRequest,
    workspace: Optional[str] = Query(None, description="工作空间名称"),
    verify_status: Optional[str] = Query(None, description="按核验状态筛选"),
    one_thing_name: Optional[str] = Query(None, description="按一件事名称筛选"),
    subsidy_item_name: Optional[str] = Query(None, description="按补贴事项名称筛选"),
):
    """导出政策 Excel；每一行都包含可点击的政策原文 URL。"""
    conn = get_sync_conn()
    cursor = conn.cursor()
    conditions = ["policy_url IS NOT NULL", "TRIM(policy_url) != ''"]
    params = []

    if workspace:
        conditions.append("workspace = ?")
        params.append(workspace)

    policy_ids = list(dict.fromkeys(body.policy_ids))
    if policy_ids:
        placeholders = ",".join(["?"] * len(policy_ids))
        conditions.append(f"id IN ({placeholders})")
        params.extend(policy_ids)
    else:
        if verify_status:
            conditions.append("verify_status = ?")
            params.append(verify_status)
        if one_thing_name:
            conditions.append("one_thing_name LIKE ?")
            params.append(f"%{one_thing_name}%")
        if subsidy_item_name:
            conditions.append("subsidy_item_name LIKE ?")
            params.append(f"%{subsidy_item_name}%")

    where_clause = " AND ".join(conditions)
    try:
        cursor.execute(f"SELECT * FROM subsidy_policies WHERE {where_clause} ORDER BY id", params)
        rows = cursor.fetchall()
    finally:
        conn.close()

    if not rows:
        raise HTTPException(404, "没有符合条件且包含政策原文链接的数据")

    content = _build_excel_bytes(rows)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    workspace_prefix = "".join(ch for ch in (workspace or "") if ch.isalnum() or ch in "-_")
    display_name = f"{workspace_prefix + '_' if workspace_prefix else ''}政策数据_{timestamp}.xlsx"
    ascii_name = f"policies_{timestamp}.xlsx"
    disposition = f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(display_name)}'
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": disposition,
            "Content-Length": str(len(content)),
            "X-Export-Count": str(len(rows)),
            "Access-Control-Expose-Headers": "Content-Disposition, X-Export-Count",
        },
    )


@router.post("/markdown")
async def export_markdown(
    workspace: Optional[str] = Query(None, description="工作空间名称（可选）"),
    verify_status: Optional[str] = Query("qualified", description="按核验状态筛选，默认合格"),
    one_thing_name: Optional[str] = Query(None, description="按一件事名称筛选"),
    subsidy_item_name: Optional[str] = Query(None, description="按补贴事项名称筛选"),
    background_tasks: BackgroundTasks = None,
):
    """兼容旧调用方的同步 Markdown 导出，并启用服务端配置的增强解析。"""
    return await _do_export_markdown(
        workspace=workspace,
        verify_status=verify_status,
        one_thing_name=one_thing_name,
        subsidy_item_name=subsidy_item_name,
        policy_ids=None,
        resource_options=_legacy_export_resource_options(),
    )


@router.post("/markdown-by-ids")
async def export_markdown_by_ids(
    body: ExportByIdsRequest,
    workspace: Optional[str] = Query(None, description="工作空间名称（可选）"),
    background_tasks: BackgroundTasks = None,
):
    """兼容旧调用方按 ID 同步导出，并启用服务端配置的增强解析。"""
    return await _do_export_markdown(
        workspace=workspace,
        policy_ids=body.policy_ids,
        resource_options=_legacy_export_resource_options(),
    )


def _legacy_export_resource_options():
    """为不传请求体配置的历史接口提供服务端默认解析能力。

    历史调用方的请求契约不能增加 API Key 等字段；因此视觉解析所需的
    Key 仅从本地 config/vision.json 读取，绝不写入响应或日志。未配置 Key 时底层会保留
    图片和附件、跳过多模态识别，接口的请求和响应格式仍保持不变。
    """
    from app.services.export_assets import ExportResourceOptions

    vision_config = get_vision_config()
    return ExportResourceOptions(
        parse_attachments=settings.EXPORT_PARSE_ATTACHMENTS,
        localize_images=settings.EXPORT_LOCALIZE_IMAGES,
        parse_images=True,
        download_originals=True,
        api_key=vision_config["api_key"],
        model=vision_config["model"],
        base_url=vision_config["base_url"],
    )


@router.post("/vision-test")
async def test_export_vision(body: VisionTestRequest):
    """测试 OKF 导出使用的大模型连接，不记录 API Key。"""
    from app.services.vision_parser import VisionLLMClient, VisionParseError

    vision_config = get_vision_config()
    api_key = body.api_key if body.api_key else vision_config["api_key"]
    if not api_key:
        raise HTTPException(400, "未配置 API Key，请在 config/vision.json 中填入或在前端传入")

    try:
        client = VisionLLMClient(api_key=api_key, model=body.model)
        message = await asyncio.to_thread(client.test_connection)
        return {"success": True, "message": message, "model": body.model}
    except VisionParseError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/markdown/tasks", status_code=202)
async def create_markdown_task(body: MarkdownTaskRequest):
    """创建异步 Markdown 导出任务，避免动态渲染和多模态解析占用单次 HTTP 请求。"""
    from app.services.export_assets import ExportResourceOptions

    workspace = body.workspace.strip() or None

    task_id = uuid.uuid4().hex
    now = datetime.now().isoformat()
    with _export_tasks_lock:
        _export_tasks[task_id] = {
            "task_id": task_id,
            "status": "queued",
            "stage": "等待开始",
            "total": 0,
            "processed": 0,
            "exported": 0,
            "failed": 0,
            "current_policy_id": None,
            "current_url": "",
            "errors": [],
            "result": None,
            "cancel_requested": False,
            "created_at": now,
            "updated_at": now,
        }

    vision_config = get_vision_config()
    api_key = body.api_key.strip() if body.api_key else vision_config["api_key"]
    if not api_key:
        raise HTTPException(400, "未配置 API Key，请在 config/vision.json 中填入或在前端传入")

    vision_config = get_vision_config()
    options = ExportResourceOptions(
        parse_attachments=body.parse_attachments,
        localize_images=body.localize_images,
        parse_images=body.parse_images,
        download_originals=body.download_originals,
        api_key=api_key,
        model=body.model or settings.EXPORT_VISION_MODEL,
        base_url=vision_config["base_url"],
    )

    def progress(update: dict) -> None:
        # update 永远不含 API Key。
        update["updated_at"] = datetime.now().isoformat()
        _update_export_task(task_id, **update)

    def is_cancelled() -> bool:
        state = _export_task_snapshot(task_id)
        return bool(state and state.get("cancel_requested"))

    async def run_task() -> None:
        try:
            _update_export_task(task_id, status="running", stage="读取待导出政策", updated_at=datetime.now().isoformat())
            result = await _do_export_markdown(
                workspace=workspace,
                verify_status=body.verify_status,
                one_thing_name=body.one_thing_name,
                subsidy_item_name=body.subsidy_item_name,
                policy_ids=body.policy_ids or None,
                resource_options=options,
                progress_callback=progress,
                cancel_checker=is_cancelled,
            )
            final_status = "cancelled" if is_cancelled() else "completed"
            _update_export_task(
                task_id,
                status=final_status,
                stage="已取消" if final_status == "cancelled" else "导出完成",
                result=result,
                exported=result.get("exported", 0),
                failed=result.get("failed", 0),
                errors=result.get("errors", []),
                updated_at=datetime.now().isoformat(),
            )
        except Exception as exc:
            logger.exception("Markdown异步导出失败 task_id=%s", task_id)
            _update_export_task(
                task_id,
                status="failed",
                stage="导出失败",
                errors=[str(exc)],
                updated_at=datetime.now().isoformat(),
            )
        finally:
            _export_task_handles.pop(task_id, None)

    handle = asyncio.create_task(run_task())
    _export_task_handles[task_id] = handle
    return {"task_id": task_id, "status": "queued"}


@router.get("/markdown/tasks/{task_id}")
async def get_markdown_task(task_id: str):
    state = _export_task_snapshot(task_id)
    if state is None:
        raise HTTPException(404, "导出任务不存在")
    return state


@router.post("/markdown/tasks/{task_id}/cancel")
async def cancel_markdown_task(task_id: str):
    state = _export_task_snapshot(task_id)
    if state is None:
        raise HTTPException(404, "导出任务不存在")
    if state.get("status") in ("completed", "failed", "cancelled"):
        return state
    _update_export_task(
        task_id,
        cancel_requested=True,
        status="cancelling",
        stage="正在完成当前文件后取消",
        updated_at=datetime.now().isoformat(),
    )
    return _export_task_snapshot(task_id)


@router.post("/okf")
async def export_okf(
    body: OkfExportRequest,
    target_dir: str = Query(..., description="固化目标路径（绝对路径）"),
    workspace: Optional[str] = Query(None, description="工作空间名称"),
):
    """OKF固化导出：在target_dir下按bundles规范生成文件"""
    return await _do_okf_export(target_dir=target_dir, workspace=workspace, policy_ids=body.policy_ids)


async def _do_export_markdown(
    workspace: Optional[str] = None,
    verify_status: Optional[str] = "qualified",
    one_thing_name: Optional[str] = None,
    subsidy_item_name: Optional[str] = None,
    policy_ids: Optional[list[int]] = None,
    resource_options=None,
    progress_callback=None,
    cancel_checker=None,
):
    """Markdown导出内部实现（使用原生 sqlite3）"""
    from app.services.gov_policy_to_okf import convert_url_to_okf, generate_index, generate_log

    conn = get_sync_conn()
    cursor = conn.cursor()

    conditions = []
    params = []
    # 明确选中 ID 时允许重新导出，便于用新解析器更新历史 Markdown。
    if not policy_ids:
        conditions.append("md_status IN ('not_exported', 'failed')")

    if workspace:
        conditions.append("workspace = ?")
        params.append(workspace)

    if policy_ids:
        placeholders = ",".join(["?"] * len(policy_ids))
        conditions.append(f"id IN ({placeholders})")
        params.extend(policy_ids)
    else:
        if verify_status:
            conditions.append("verify_status = ?")
            params.append(verify_status)
        if one_thing_name:
            conditions.append("one_thing_name LIKE ?")
            params.append(f"%{one_thing_name}%")
        if subsidy_item_name:
            conditions.append("subsidy_item_name LIKE ?")
            params.append(f"%{subsidy_item_name}%")

    where_clause = " AND ".join(conditions)
    cursor.execute(f"SELECT * FROM subsidy_policies WHERE {where_clause} ORDER BY id", params)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        md_output_dir = os.path.join(settings.EXPORT_DIR, workspace) if workspace else settings.EXPORT_DIR
        os.makedirs(md_output_dir, exist_ok=True)
        return {
            "message": "没有需要导出的政策",
            "total": 0,
            "exported": 0,
            "failed": 0,
            "output_dir": md_output_dir,
            "errors": [],
        }

    # 在后台线程中执行耗时的网页抓取和转换
    policy_data = []
    for row in rows:
        policy_data.append({
            "id": row["id"],
            "policy_url": row["policy_url"],
            "publish_region": row["publish_region"] or "",
            "file_type": row["file_type"] or "",
            "subsidy_item_name": row["subsidy_item_name"] or "",
            "one_thing_name": row["one_thing_name"] or "",
            "workspace": workspace or "",
        })

    def do_convert():
        """在工作线程中运行独立事件循环，整批复用同一个浏览器。"""
        from app.config import settings
        from app.services.gov_policy_to_okf import CITY_TO_PROVINCE
        from app.services.web_capture import WebCaptureSession

        def _fill_province(region: str) -> str:
            """如果地区缺少省份，自动填充"""
            if not region or "_" in region:
                return region
            # 如果已经是完整省份，直接返回
            if any(region.startswith(p) for p in ["北京市", "天津市", "上海市", "重庆市"]):
                return region
            if "省" in region[:5]:
                return region
            # 尝试从市名反推省份
            for city, province in CITY_TO_PROVINCE.items():
                if region.startswith(city):
                    return f"{province}_{region}"
            return region

        async def run_batch():
            exported = 0
            failed = 0
            errors = []
            processed = 0
            md_output_dir = os.path.join(settings.EXPORT_DIR, workspace) if workspace else settings.EXPORT_DIR
            os.makedirs(md_output_dir, exist_ok=True)
            if progress_callback:
                progress_callback({"stage": "启动网页渲染器", "total": len(policy_data), "processed": 0})

            async with WebCaptureSession() as capture_session:
                for pdata in policy_data:
                    if cancel_checker and cancel_checker():
                        break
                    pid = pdata["id"]
                    url = pdata["policy_url"]
                    region = _fill_province(pdata["publish_region"])
                    ptype = pdata["file_type"]
                    policy_keyword = pdata["subsidy_item_name"] or pdata["one_thing_name"] or ""
                    if progress_callback:
                        progress_callback({
                            "stage": "渲染网页并发现附件/图片",
                            "total": len(policy_data),
                            "processed": processed,
                            "exported": exported,
                            "failed": failed,
                            "current_policy_id": pid,
                            "current_url": url,
                        })

                    captured_page = None
                    url_ext = os.path.splitext(url.split("?", 1)[0])[1].lower()
                    if url_ext not in {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".webp"}:
                        try:
                            captured_page = await capture_session.capture(url)
                        except Exception as exc:
                            logger.warning("预渲染失败，转换器将自动回退: %s", exc)

                    conn = get_sync_conn()
                    cursor = conn.cursor()
                    try:
                        if progress_callback:
                            progress_callback({"stage": "生成 Markdown 并解析资源"})
                        path = convert_url_to_okf(
                            url, md_output_dir,
                            region=region,
                            policy_type=ptype,
                            policy_id=pid,
                            policy_keyword=policy_keyword,
                            captured_page=captured_page,
                            resource_options=resource_options,
                        )
                        exported += 1
                        now = datetime.now().isoformat()
                        cursor.execute(
                            "UPDATE subsidy_policies SET md_exported=1, md_export_path=?, md_exported_at=?, md_status='success', md_error=NULL WHERE id=?",
                            [path, now, pid]
                        )
                        conn.commit()
                    except Exception as e:
                        failed += 1
                        err_msg = f"ID={pid} URL={url[:80]}: {str(e)[:300]}"
                        errors.append(err_msg)
                        now = datetime.now().isoformat()
                        cursor.execute(
                            "UPDATE subsidy_policies SET md_exported=0, md_status='failed', md_error=?, md_exported_at=? WHERE id=?",
                            [str(e)[:500], now, pid]
                        )
                        conn.commit()
                        logger.exception("Markdown转换失败 policy_id=%s", pid)
                    finally:
                        conn.close()
                        processed += 1
                        if progress_callback:
                            progress_callback({
                                "stage": "完成当前政策",
                                "processed": processed,
                                "exported": exported,
                                "failed": failed,
                            })

            try:
                generate_index(md_output_dir)
                generate_log(md_output_dir, action="批量Markdown导出", details=f"成功 {exported}，失败 {failed}")
            except Exception as exc:
                logger.warning("生成 Markdown 索引/日志失败: %s", exc)
            return exported, failed, errors, processed, md_output_dir

        return asyncio.run(run_batch())

    loop = asyncio.get_running_loop()
    exported, failed, errors, processed, md_output_dir = await loop.run_in_executor(_thread_pool, do_convert)

    cancelled = bool(cancel_checker and cancel_checker())
    if cancelled:
        message = f"Markdown导出已取消，已处理 {processed}/{len(policy_data)} 条"
    else:
        message = f"Markdown导出完成，成功 {exported}/{len(policy_data)} 条，失败 {failed} 条"
    return {
        "message": message,
        "total": len(policy_data),
        "processed": processed,
        "exported": exported,
        "failed": failed,
        "cancelled": cancelled,
        "output_dir": md_output_dir,
        "errors": errors[:30],
    }


@router.get("/asset")
async def view_export_asset(
    path: str = Query(..., description="工作空间内的资源相对路径"),
    workspace: Optional[str] = Query(None, description="工作空间名称"),
):
    """预览 Markdown 时安全读取本地图片/附件。"""
    import mimetypes
    from pathlib import Path

    export_base = Path(os.path.join(settings.EXPORT_DIR, workspace)).resolve() if workspace else Path(settings.EXPORT_DIR).resolve()
    file_path = (export_base / path).resolve()
    if not file_path.is_relative_to(export_base):
        raise HTTPException(403, "禁止访问")
    if not file_path.is_file():
        raise HTTPException(404, "资源不存在")
    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    if media_type.startswith("image/"):
        return FileResponse(str(file_path), media_type=media_type)
    return FileResponse(str(file_path), media_type=media_type, filename=file_path.name)


@router.get("/markdown/{path:path}")
async def view_markdown(path: str, workspace: Optional[str] = Query(None, description="工作空间名称")):
    """查看 Markdown 文件内容（安全校验：防止路径遍历）"""
    from pathlib import Path
    import re as _re

    if workspace:
        export_base = Path(os.path.join(settings.EXPORT_DIR, workspace)).resolve()
    else:
        export_base = Path(settings.EXPORT_DIR).resolve()
    
    if not path.endswith(".md"):
        raise HTTPException(400, "仅支持 .md 文件")

    # 防止路径遍历：规范化后检查仍在 EXPORT_DIR 目录内
    file_path = (export_base / path).resolve()
    if not file_path.is_relative_to(export_base):
        raise HTTPException(403, "禁止访问")
    if not file_path.exists():
        raise HTTPException(404, "文件不存在")

    return FileResponse(
        str(file_path),
        media_type="text/markdown; charset=utf-8",
        filename=file_path.name,
    )


@router.delete("/markdown")
async def delete_markdown(paths: list[str], workspace: Optional[str] = Query(None, description="工作空间名称")):
    """批量删除已导出的 Markdown 文件，并同步更新数据库中的导出状态（使用原生 sqlite3）"""
    from pathlib import Path as P
    import re as _re
    import shutil
    
    if workspace:
        export_dir = P(os.path.join(settings.EXPORT_DIR, workspace))
    else:
        export_dir = P(settings.EXPORT_DIR)
    deleted = []
    errors = []
    for rel_path in paths:
        file_path = (export_dir / rel_path).resolve()
        # 安全校验：防止路径遍历
        if not file_path.is_relative_to(export_dir):
            errors.append({"path": rel_path, "error": "禁止访问"})
            continue
        if not file_path.exists():
            errors.append({"path": rel_path, "error": "文件不存在"})
            continue
        try:
            file_path.unlink()
            generated_assets = file_path.parent / f"{file_path.stem}_assets"
            if generated_assets.is_dir() and generated_assets.is_relative_to(export_dir.resolve()):
                shutil.rmtree(generated_assets)
            deleted.append(rel_path)
        except Exception as e:
            errors.append({"path": rel_path, "error": str(e)})

    # 同步更新数据库中对应记录的导出状态
    if deleted:
        conn = get_sync_conn()
        cursor = conn.cursor()
        for rel_p in deleted:
            rel_p_norm = rel_p.replace('\\', '/')
            full_p = str(export_dir / rel_p).replace('\\', '/')
            fname = rel_p_norm.split('/')[-1]
            id_match = _re.search(r'_(\d+)\.md$', fname)
            policy_id = int(id_match.group(1)) if id_match else None

            logger.info(f"删除文件匹配: rel_path={rel_p_norm}, policy_id={policy_id}")

            if policy_id:
                cursor.execute(
                    "UPDATE subsidy_policies SET md_exported=0, md_export_path=NULL, md_exported_at=NULL, md_status='not_exported', md_error=NULL, md_issue_type='' WHERE id=?",
                    [policy_id]
                )
            else:
                cursor.execute(
                    "UPDATE subsidy_policies SET md_exported=0, md_export_path=NULL, md_exported_at=NULL, md_status='not_exported', md_error=NULL, md_issue_type='' WHERE md_export_path=? OR md_export_path=?",
                    [rel_p_norm, full_p]
                )
        conn.commit()
        conn.close()

    return {"deleted": deleted, "errors": errors, "message": f"成功删除 {len(deleted)} 个文件"}


@router.get("/markdown-list")
async def list_markdown(workspace: Optional[str] = Query(None, description="工作空间名称")):
    """列出已导出的Markdown文件（扫描指定工作空间或全部）"""
    from pathlib import Path as P
    import re as _re
    
    if workspace:
        export_dir = P(os.path.join(settings.EXPORT_DIR, workspace))
    else:
        export_dir = P(settings.EXPORT_DIR)
    
    if not export_dir.exists():
        return {"files": [], "total": 0, "verified": 0, "issues": 0, "batches": []}

    # 递归扫描所有 .md 文件
    files = []
    verified_count = 0
    issues_count = 0
    batch_map = {}  # 用于按批次分组

    for md_file in export_dir.rglob("*.md"):
        # 跳过 index.md 和 log.md
        if md_file.name in ("index.md", "log.md"):
            continue

        # 解析 frontmatter 获取 status 和 issue_type
        title = md_file.stem
        status = "verified"
        issue_type = ""
        try:
            with open(md_file, "r", encoding="utf-8") as fh:
                content = fh.read(2000)
                fm_match = _re.match(r"^---\n(.*?)\n---", content, _re.DOTALL)
                if fm_match:
                    for line in fm_match.group(1).split("\n"):
                        if line.startswith("title:"):
                            title = line.split(":", 1)[1].strip().strip('"')
                        elif line.startswith("status:"):
                            status = line.split(":", 1)[1].strip()
                        elif line.startswith("issue_type:"):
                            issue_type = line.split(":", 1)[1].strip()
        except:
            pass

        rel_path = str(md_file.relative_to(export_dir)).replace('\\', '/')
        file_size = md_file.stat().st_size
        modified_at = datetime.fromtimestamp(md_file.stat().st_mtime).isoformat()

        if status == "verified":
            verified_count += 1
        elif status in ("has_issues", "rejected"):
            issues_count += 1

        # 按目录分组（批次）
        parent_dir = str(md_file.parent.relative_to(export_dir)).replace('\\', '/')
        if parent_dir not in batch_map:
            batch_map[parent_dir] = {"batch": parent_dir, "total": 0, "files": []}
        batch_map[parent_dir]["total"] += 1
        batch_map[parent_dir]["files"].append(rel_path)

        files.append({
            "path": rel_path,
            "batch": parent_dir,
            "title": title,
            "status": status,
            "issue_type": issue_type,
            "size": file_size,
            "modified_at": modified_at,
        })

    batches = sorted(batch_map.values(), key=lambda x: x["batch"])

    return {
        "files": files,
        "total": len(files),
        "verified": verified_count,
        "issues": issues_count,
        "batches": batches,
    }


async def _do_okf_export(
    target_dir: str,
    workspace: Optional[str] = None,
    policy_ids: Optional[list[int]] = None,
):
    """OKF固化导出：在target_dir下按bundles规范生成文件"""
    import re
    from pathlib import Path

    # 安全校验：防止路径遍历
    target_path = Path(target_dir).resolve()
    if not target_path.is_absolute():
        raise HTTPException(400, "target_dir 必须是绝对路径")

    os.makedirs(target_path, exist_ok=True)

    conn = get_sync_conn()
    cursor = conn.cursor()

    conditions = []
    params = []
    if policy_ids:
        placeholders = ",".join(["?"] * len(policy_ids))
        conditions.append(f"id IN ({placeholders})")
        params.extend(policy_ids)

    if workspace:
        conditions.append("workspace = ?")
        params.append(workspace)

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    cursor.execute(f"SELECT * FROM subsidy_policies WHERE {where_clause} ORDER BY id", params)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "message": "没有需要固化的政策",
            "total": 0,
            "exported": 0,
            "failed": 0,
            "target_dir": str(target_path),
            "files": [],
            "errors": [],
        }

    # OKF"固化"现在会自动先生成缺失的Markdown，再执行固化
    # 第一步：检查哪些政策已有Markdown，哪些需要先生成
    policies_need_export = []  # 已有Markdown的政策
    policies_need_generate = []  # 需要先生成Markdown的政策
    
    for row in rows:
        row_data = dict(row)
        md_export_path = (row_data.get("md_export_path") or "").strip()
        source_path = Path(md_export_path) if md_export_path else None
        if source_path is not None and not source_path.is_absolute():
            source_path = Path(settings.EXPORT_DIR) / source_path
        
        has_valid_markdown = False
        if source_path and source_path.is_file():
            try:
                source_content = source_path.read_text(encoding="utf-8")
                source_body = re.sub(r'^---\s*\n.*?\n---\s*\n?', '', source_content, count=1, flags=re.DOTALL).strip()
                if source_body:
                    has_valid_markdown = True
            except (OSError, UnicodeError):
                pass
        
        if has_valid_markdown:
            policies_need_export.append(row_data)
        else:
            policies_need_generate.append(row_data)

    # 第二步：为缺少Markdown的政策生成Markdown（复用 _do_export_markdown）
    if policies_need_generate:
        logger.info(f"OKF固化导出：发现 {len(policies_need_generate)} 条政策需要先生成Markdown")
        generate_ids = [p["id"] for p in policies_need_generate]
        
        # 复用已有的Markdown导出逻辑
        await _do_export_markdown(
            workspace=workspace,
            policy_ids=generate_ids,
        )
        
        # 重新查询已生成Markdown的政策
        conn = get_sync_conn()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(generate_ids))
        cursor.execute(
            f"SELECT * FROM subsidy_policies WHERE id IN ({placeholders}) ORDER BY id",
            generate_ids
        )
        newly_generated = cursor.fetchall()
        conn.close()
        
        for row in newly_generated:
            row_data = dict(row)
            md_export_path = (row_data.get("md_export_path") or "").strip()
            source_path = Path(md_export_path) if md_export_path else None
            if source_path and not source_path.is_absolute():
                source_path = Path(settings.EXPORT_DIR) / source_path
            if source_path and source_path.is_file():
                policies_need_export.append(row_data)

    # 第三步：执行OKF固化导出
    if not policies_need_export:
        return {
            "message": "所有政策均未成功生成Markdown，无法固化",
            "total": len(rows),
            "exported": 0,
            "failed": len(rows),
            "target_dir": str(target_path),
            "files": [],
            "errors": ["所有政策都缺少有效的Markdown内容"],
        }
    
    rows = policies_need_export

    def _sanitize_name(name: str) -> str:
        """清理目录/文件名字符"""
        name = re.sub(r'[\\/:*?"<>|]', '', name)
        name = re.sub(r'\s+', ' ', name).strip()
        return name or "未命名"

    def _get_seq_in_dir(target_dir_path: Path) -> int:
        """在指定目录内扫描已有NNN序号，取max+1"""
        max_seq = 0
        if target_dir_path.exists():
            for f in target_dir_path.iterdir():
                if f.is_file() and f.suffix == ".md" and f.name != "INDEX.md":
                    m = re.match(r'^(\d{3})-', f.name)
                    if m:
                        max_seq = max(max_seq, int(m.group(1)))
        return max_seq + 1

    def _get_existing_seq_for_policy(policy_id: int) -> Optional[tuple]:
        """通过数据库 okf_export_path 查找已固化的序号（幂等）。"""
        conn = get_sync_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT okf_export_path FROM subsidy_policies WHERE id=? AND okf_export_path IS NOT NULL",
            [policy_id]
        )
        result = cursor.fetchone()
        conn.close()
        if result and result[0]:
            path_str = result[0]
            # 解析路径: bundles/补贴类型/省/市/001-地区-类型.md
            parts = path_str.replace('\\', '/').split('/')
            filename = parts[-1]
            m = re.match(r'^(\d{3})-', filename)
            if m:
                seq = int(m.group(1))
                # 返回目录路径（不含文件名）
                dir_path = '/'.join(parts[:-1])
                return seq, dir_path
        return None

    def _generate_index_md(dir_name: str, files: list, subdirs: list) -> str:
        """生成INDEX.md内容"""
        lines = [f"# {dir_name} 索引", ""]
        if files:
            lines.append("## 文件")
            for f in files:
                lines.append(f"- [{f['name']}]({f['name']}) — {f.get('title', '')}")
            lines.append("")
        if subdirs:
            lines.append("## 下级目录")
            for s in subdirs:
                lines.append(f"- [{s}]({s}/INDEX.md)")
            lines.append("")
        return "\n".join(lines)

    def _update_index_md(bundle_dir: Path):
        """更新所有层级的INDEX.md"""
        def _scan_and_update_index(current_dir: Path):
            if not current_dir.exists():
                return

            subdirs = []
            files = []

            for item in sorted(current_dir.iterdir()):
                if item.is_dir():
                    if item.name != "__pycache__":
                        subdirs.append(item.name)
                        _scan_and_update_index(item)
                elif item.suffix == ".md" and item.name != "INDEX.md":
                    try:
                        with open(item, 'r', encoding='utf-8') as fh:
                            content = fh.read(500)
                            title = ""
                            m = re.search(r'^title:\s*"?([^"\n]+)"?', content, re.MULTILINE)
                            if m:
                                title = m.group(1)
                            files.append({"name": item.name, "title": title})
                    except:
                        files.append({"name": item.name, "title": ""})

            index_content = _generate_index_md(
                current_dir.name,
                files,
                subdirs
            )
            index_path = current_dir / "INDEX.md"
            with open(index_path, 'w', encoding='utf-8') as fh:
                fh.write(index_content)

        _scan_and_update_index(bundle_dir)

    def do_okf_export():
        exported = 0
        failed = 0
        errors = []
        files_result = []

        bundles_dir = target_path / "bundles"
        os.makedirs(bundles_dir, exist_ok=True)

        for row in rows:
            try:
                # sqlite3.Row 转字典
                r = dict(row)
                policy_id = r["id"]
                file_type = r["file_type"] or "政策文件"
                file_name = r["file_name"] or ""
                subsidy_item = r["subsidy_item_name"] or ""
                one_thing = r["one_thing_name"] or ""
                region_raw = r["publish_region"] or ""
                policy_url = r["policy_url"] or ""
                verify_status = r["verify_status"] or "pending"
                created_at = r["created_at"] or datetime.now().isoformat()

                # 标题：file_name → subsidy_item_name → 政策 #{id}
                title = file_name or subsidy_item or f"政策 #{policy_id}"

                # 补贴类型目录
                bundle_name = _sanitize_name(subsidy_item or one_thing or "其他政策")
                bundle_dir = bundles_dir / bundle_name

                # region拆分
                region_parts = [p.strip() for p in region_raw.split("_") if p.strip()] if region_raw else []
                region_parts = [_sanitize_name(p) for p in region_parts]

                # 构建路径
                current_dir = bundle_dir
                for part in region_parts:
                    current_dir = current_dir / part

                os.makedirs(current_dir, exist_ok=True)

                # 查找已有序号（幂等）
                existing = _get_existing_seq_for_policy(policy_id)

                if existing:
                    seq, prev_dir_path = existing
                    # 如果路径变化，需要重新计算序号
                    expected_dir = '/'.join(['bundles', bundle_name] + region_parts)
                    if prev_dir_path == expected_dir:
                        # 同一路径，复用序号
                        pass
                    else:
                        # 路径变化，重新分配序号
                        seq = _get_seq_in_dir(current_dir)
                else:
                    seq = _get_seq_in_dir(current_dir)

                # 文件名
                type_cn = _sanitize_name(file_type)
                leaf_region = region_parts[-1] if region_parts else bundle_name
                filename = f"{seq:03d}-{leaf_region}-{type_cn}.md"
                file_path = current_dir / filename

                # 读取MD正文
                md_content = ""
                full_md_path = None
                source_title = ""
                source_description = ""
                md_export_path = r.get("md_export_path") or ""
                if md_export_path:
                    full_md_path = Path(md_export_path)
                    if not full_md_path.is_absolute():
                        full_md_path = Path(settings.EXPORT_DIR) / full_md_path
                    if full_md_path.exists():
                        try:
                            with open(full_md_path, 'r', encoding='utf-8') as fh:
                                content = fh.read()
                                # 去除原frontmatter
                                fm_match = re.match(r'^---\n.*?\n---\n', content, re.DOTALL)
                                if fm_match:
                                    source_frontmatter = fm_match.group(0)
                                    title_match = re.search(
                                        r'^title:\s*["\']?(.*?)["\']?\s*$',
                                        source_frontmatter,
                                        re.MULTILINE,
                                    )
                                    description_match = re.search(
                                        r'^description:\s*["\']?(.*?)["\']?\s*$',
                                        source_frontmatter,
                                        re.MULTILINE,
                                    )
                                    if title_match:
                                        source_title = title_match.group(1).strip().strip('"\'')
                                    if description_match:
                                        source_description = description_match.group(1).strip().strip('"\'')
                                    md_content = content[fm_match.end():].strip()
                                else:
                                    md_content = content.strip()
                        except (OSError, UnicodeError) as exc:
                            raise RuntimeError(f"读取 Markdown 源文件失败: {exc}") from exc

                # 页面重新抓取后的 Markdown 标题优先于数据库历史标题，
                # 可避免旧采集记录中的 mojibake 污染固化文件。
                if source_title:
                    title = source_title

                # 固化导出时同步复制 Markdown 的离线图片和附件，
                # 并将正文中的相对目录名重写为新文件名。
                if full_md_path and full_md_path.exists():
                    import shutil
                    source_assets = full_md_path.parent / f"{full_md_path.stem}_assets"
                    if source_assets.is_dir():
                        target_assets = current_dir / f"{file_path.stem}_assets"
                        shutil.copytree(source_assets, target_assets, dirs_exist_ok=True)
                        md_content = md_content.replace(
                            f"{full_md_path.stem}_assets/",
                            f"{file_path.stem}_assets/",
                        )

                # 生成description
                desc = source_description or f"这是{leaf_region}关于{bundle_name}的{type_cn}"

                # 生成tags
                tags = []
                if r.get("tags"):
                    try:
                        tags = json.loads(r["tags"]) if isinstance(r["tags"], str) else r["tags"]
                    except:
                        pass
                if bundle_name not in tags:
                    tags.append(bundle_name)
                if leaf_region not in tags:
                    tags.append(leaf_region)

                # region frontmatter
                region_fm = "/".join(region_parts) if region_parts else bundle_name

                # resource: 仅 http(s) URL，否则留空
                resource = policy_url if policy_url.startswith("http") else ""

                # 生成frontmatter
                timestamp = created_at if isinstance(created_at, str) else created_at.isoformat() if hasattr(created_at, 'isoformat') else datetime.now().isoformat()

                frontmatter = f"""---
type: "{type_cn}"
title: "{title}"
status: "{verify_status}"
description: "{desc}"
resource: "{resource}"
region: "{region_fm}"
tags: {json.dumps(tags, ensure_ascii=False)}
timestamp: "{timestamp}"
---
"""

                # 写入文件
                full_content = frontmatter + "\n" + md_content if md_content else frontmatter
                with open(file_path, 'w', encoding='utf-8') as fh:
                    fh.write(full_content)

                # 更新INDEX.md
                _update_index_md(bundle_dir)

                # 记录数据库
                okf_rel_path = str(file_path.relative_to(bundles_dir)).replace('\\', '/')
                conn = get_sync_conn()
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE subsidy_policies SET okf_export_path=? WHERE id=?",
                    [okf_rel_path, policy_id]
                )
                conn.commit()
                conn.close()

                exported += 1
                files_result.append({
                    "policy_id": policy_id,
                    "okf_path": okf_rel_path,
                    "seq": seq,
                })

            except Exception as e:
                failed += 1
                err_msg = f"ID={policy_id}: {str(e)[:200]}"
                errors.append(err_msg)
                logger.error(f"OKF导出失败: {err_msg}")

        return exported, failed, errors, files_result

    loop = asyncio.get_event_loop()
    exported, failed, errors, files_result = await loop.run_in_executor(_thread_pool, do_okf_export)

    return {
        "message": f"OKF固化导出完成，成功 {exported}/{len(rows)} 条，失败 {failed} 条",
        "total": len(rows),
        "exported": exported,
        "failed": failed,
        "target_dir": str(target_path),
        "files": files_result,
        "errors": errors[:30],
    }