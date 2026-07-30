import { get, post } from '@/utils/axios'
import type { DataSpacesData, DataSpaceDetailData, DataAssetsData, AssetDetailData } from '@/types/data'

export const getDataSpaces = () => get<DataSpacesData>('/data/spaces')

export const getDataSpaceDetail = (id: string) =>
  get<DataSpaceDetailData>(`/data/spaces/${encodeURIComponent(id)}`)

export const getDataAssets = () => get<DataAssetsData>('/data/assets')
export const getAssetDetail = (_type: string) => get<AssetDetailData>('/data/assets/ontology')

// ===== 独立数据空间（ds-XXX）=====

export interface CreateDataSpacePayload {
  name: string
  description?: string
}

export const createDataSpace = (payload: CreateDataSpacePayload) =>
  post<{ id: string; name: string; description?: string; createdAt: string; updatedAt: string }>(
    '/data/spaces',
    payload as unknown as Record<string, unknown>
  )

export const deleteDataSpace = (id: string) => {
  // 用 fetch 走 DELETE 方法
  return fetch(`/api/v1/data/spaces/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  }).then((r) => r.json())
}

// ===== Step1 数据空间固化：调 bridge 跨服务导入爬虫已通过政策 =====

export interface ImportFromCrawlerOptions {
  verify_status?: 'qualified' | 'all'
  one_thing_name?: string
  region?: string
  overwrite?: boolean
  include_unexported?: boolean
  policy_ids?: number[]
  // ===== 多空间版本（V1+）=====
  space_ids?: string[]                              // 多目标空间（≥1）
  overwrite_per_space?: Record<string, boolean>     // 按空间粒度 overwrite
}

/** 单空间结果（旧路由也复用此结构） */
export interface ImportFromCrawlerResult {
  total: number
  imported: number
  skipped: number
  failed: number
  files: { path: string; policy_id: number; size: number }[]
  duration_ms: number
  index_path: string
  error?: string   // 仅多空间版本会用：整空间失败时填
}

/** 多空间版本：单空间结果 */
export interface PerSpaceImportResult extends ImportFromCrawlerResult {}

/** 多空间版本：聚合结果 */
export interface MultiSpaceImportResult {
  per_space: Record<string, PerSpaceImportResult>
  total: { imported: number; skipped: number; failed: number; duration_ms: number }
  success: boolean
}

// 多空间导入：V1+ 新接口
// timeout 10 分钟：固化可能触发爬虫逐条抓 HTML (慢), 还要写文件 + 转换 OKF
export const importCrawlerToMultipleSpaces = (options: ImportFromCrawlerOptions) =>
  post<MultiSpaceImportResult>(
    '/data/spaces/import-from-crawler',
    options as unknown as Record<string, unknown>,
    { timeoutMs: 10 * 60 * 1000 }
  )

// 单空间导入（兼容旧调用方）：内部走新接口，返回扁平结构
export const importCrawlerToDataSpace = (
  spaceId: string,
  options: ImportFromCrawlerOptions = {}
) => importCrawlerToMultipleSpaces({
  ...options,
  space_ids: [spaceId],
  overwrite_per_space: { [spaceId]: options.overwrite ?? false }
})
