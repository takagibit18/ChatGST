// 爬虫系统 API 封装层（与 src/api/pipeline.ts 并列）
// 路径前缀统一为 /api/crawler，由 Vite 代理到爬虫后端
import { crawlerGet, crawlerPost, crawlerPut, crawlerDelete, crawlerUpload, crawlerHttp } from '@/utils/crawlerAxios'

// ============ 元数据 ============

export const getMetaAll = () => crawlerGet<{
  region_levels: unknown[]
  provinces: { code: string; name: string; is_municipality?: boolean }[]
  subsidy_types: Record<string, string[]>
  scraping_sources: unknown
}>('/api/meta/all')

export const getSubsidyTypes = () => crawlerGet<{ types: Record<string, string[]> }>('/api/meta/subsidy-types')

export const getProvinces = () => crawlerGet<{ provinces: { code: string; name: string }[] }>('/api/meta/provinces')

// ============ 政策管理（采集 + 核验 + 查询）============

export interface PolicyListParams {
  page?: number
  page_size?: number
  verify_status?: string
  one_thing_name?: string
  subsidy_item_name?: string
  keyword?: string
}

export interface PolicyListResponse {
  total: number
  page: number
  page_size: number
  items: any[] // 原始数据，让适配层处理
}

// 列表（分页）
export const listPolicies = (params: PolicyListParams = {}) =>
  crawlerHttp.get<PolicyListResponse>('/api/policies/', { params }).then((r) => r.data)

// 全部已采集（前端可能不需要分页时用）
export const listAllPolicies = async () => {
  const r = await listPolicies({ page: 1, page_size: 500 })
  return r.items
}

// 单条详情
export const getPolicy = (id: number) => crawlerGet<any>(`/api/policies/${id}`)

// 统计
export const getPolicyStats = () =>
  crawlerGet<{ pending: number; qualified: number; rejected: number; uncertain: number; total: number }>('/api/policies/stats')

// 元选项
export const getMetaOptions = () =>
  crawlerGet<{ one_thing_names: string[]; subsidy_item_names: string[]; file_types: string[] }>('/api/policies/meta-options')

// ============ 写操作 ============

// 手动录入
export interface PolicyCreatePayload {
  one_thing_name?: string
  subsidy_item_name?: string
  file_type?: string
  file_name?: string
  publish_region?: string
  publish_unit?: string
  publish_date?: string
  subsidy_target?: string
  subsidy_standard?: string
  apply_period?: string
  apply_condition?: string
  required_materials?: string
  distribute_time?: string
  distribute_channel?: string
  apply_procedure?: string
  handle_channel?: string
  online_entry?: string
  policy_url?: string
}
export const createPolicy = (payload: PolicyCreatePayload) =>
  crawlerPost<{ message: string; policy_id: number }>('/api/policies/', payload as any)

// Excel 批量导入（multipart/form-data，字段名 file）
export const importExcel = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return crawlerUpload<{
    message: string
    total_imported: number
    total_skipped: number
    errors: string[]
  }>('/api/policies/import-excel', fd)
}

// 自动采集
// 爬虫后端用 FastAPI Query() 接收参数，必须走 query string，不能放 body
export interface AutoCollectParams {
  subsidy_type: string
  region: string
  keyword?: string
  keyword_relation?: 'and' | 'or' // and=包含关系(同时匹配), or=并列关系(匹配任意)
  max_results?: number // 默认 20, 范围 1-100
  pages?: number // 搜索引擎爬取页数, 默认 5, 范围 1-30
  use_gov_search_scraper?: boolean // 默认 true(政府网站搜索), false=旧 lite_scraper
}
export const autoCollect = (params: AutoCollectParams) =>
  crawlerHttp.post<{
    message: string
    total_found: number
    saved: number
    skipped: number
    results: any[]
  }>('/api/policies/auto-collect', null, { params }).then((r) => r.data)

// 单条核验
export const verifyPolicy = (id: number, status: 'qualified' | 'rejected' | 'uncertain', note = '', verifier = 'admin') =>
  crawlerHttp.put<{ message: string; policy_id: number; status: string }>(
    `/api/policies/${id}/verify`,
    null,
    { params: { status, note, verifier } }
  ).then((r) => r.data)

// 批量核验
export const batchVerify = (ids: number[], status: 'qualified' | 'rejected' | 'uncertain', note = '') =>
  crawlerHttp.post<{ message: string; count: number }>(
    '/api/policies/batch-verify',
    ids,
    { params: { status, note } }
  ).then((r) => r.data)

// 编辑政策
export const updatePolicy = (id: number, payload: Partial<PolicyCreatePayload> & { verify_note?: string }) =>
  crawlerPut<{ message: string; policy_id: number }>(`/api/policies/${id}`, payload as any)

// 删除单条
export const deletePolicy = (id: number) => crawlerDelete<{ message: string }>(`/api/policies/${id}`)

// 批量删除
export const batchDelete = (ids: number[]) =>
  crawlerPost<{ message: string; count: number }>('/api/policies/batch-delete', ids as any)

// 重复检查
export interface CheckDuplicateParams {
  policy_url?: string
  file_name?: string
  publish_region?: string
}
export const checkDuplicate = (params: CheckDuplicateParams) =>
  crawlerPost<{ is_duplicate: boolean; matches: any[] }>('/api/policies/check-duplicate', params as any)

// ============ 导出 ============

// 触发 Markdown 导出
export const triggerMarkdownExport = (verify_status: 'qualified' | 'pending' | 'rejected' | 'uncertain' = 'qualified') =>
  crawlerHttp.post<{
    message: string
    total: number
    exported: number
    failed: number
    output_dir: string
    errors: string[]
  }>('/api/export/markdown', null, { params: { verify_status } }).then((r) => r.data)

// 按 ID 列表导出
export const exportByIds = (policy_ids: number[]) =>
  crawlerPost<{ message: string; total: number; exported: number; failed: number }>(
    '/api/export/markdown-by-ids',
    { policy_ids }
  )

// 已导出 MD 列表 + 批次
export const getMarkdownList = () =>
  crawlerGet<{
    files: any[]
    total: number
    verified: number
    issues: number
    batches: { batch: string; verified: number; issues: number; total: number }[]
  }>('/api/export/markdown-list')

// ============ 任务管理（参考用，自动采集直接走 policies.auto-collect）============

export const listTasks = (page = 1, page_size = 20) =>
  crawlerGet<{ total: number; items: any[] }>('/api/tasks/', { page, page_size })
