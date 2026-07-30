// 爬虫后端原始数据 → 我们项目 CrawlItem 的适配层
// 集中处理：字段名翻译、状态码翻译、来源/类型推断、时间格式化
import type { CrawlItem, VerifyStatus, CrawlSource, SubsidyType } from '@/types/project'

export type { CrawlItem, VerifyStatus, CrawlSource, SubsidyType } from '@/types/project'

// ============ 核验状态：爬虫 → UI ============
// 爬虫后端: pending / qualified / rejected / uncertain
// UI:       pending / approved / rejected / questionable
export const VERIFY_FROM_BACKEND: Record<string, VerifyStatus> = {
  pending: 'pending',
  qualified: 'approved',
  rejected: 'rejected',
  uncertain: 'questionable'
}

// UI → 爬虫（调用 API 时用）
export const VERIFY_TO_BACKEND: Record<VerifyStatus, string> = {
  pending: 'pending',
  approved: 'qualified',
  rejected: 'rejected',
  questionable: 'uncertain'
}

// 状态显示文案
export const VERIFY_LABEL: Record<VerifyStatus, string> = {
  pending: '待核验',
  approved: '已通过',
  rejected: '已驳回',
  questionable: '存疑'
}

// ============ 来源推断 ============
// 爬虫后端 source_sheet:
//   - "自动采集" → auto
//   - 含 "Sheet" / "一件事" → batch (Excel 导入)
//   - 其余 / 空 → manual
export function inferSource(sourceSheet: string | null | undefined): CrawlSource {
  if (!sourceSheet) return 'manual'
  if (sourceSheet === '自动采集') return 'auto'
  if (sourceSheet.includes('Sheet') || sourceSheet.includes('一件事') || sourceSheet.includes('-')) return 'batch'
  return 'manual'
}

export const SOURCE_LABEL: Record<CrawlSource, string> = {
  manual: '手动录入',
  auto: '自动采集',
  batch: '批量导入'
}

// ============ 补贴类型推断（爬虫后端无此字段，靠 subsidy_item_name 关键词）============
const TYPE_RULES: { type: SubsidyType; keywords: string[] }[] = [
  { type: '育儿补贴', keywords: ['育儿', '生育', '托育', '奶粉', '婴幼儿'] },
  { type: '住房补贴', keywords: ['住房', '租房', '购房', '公积金', '安家', '人才房', '公租房'] },
  { type: '就业补贴', keywords: ['就业', '社保', '稳岗', '求职', '见习', '创业'] },
  { type: '养老补贴', keywords: ['养老', '高龄', '失能', '敬老', '长护'] },
  { type: '医疗补贴', keywords: ['医疗', '医保', '罕见病', '门诊', '大病', '救助'] },
  { type: '教育补贴', keywords: ['教育', '助学', '学业', '保教', '幼儿'] }
]

export function inferSubsidyType(text: string | null | undefined): SubsidyType {
  if (!text) return '其他'
  for (const rule of TYPE_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) return rule.type
  }
  return '其他'
}

// ============ 主适配器：原始数据 → CrawlItem ============

export function fromCrawlerAPI(raw: any): CrawlItem {
  const verifyStatus: VerifyStatus = VERIFY_FROM_BACKEND[raw.verify_status] || 'pending'
  const source = inferSource(raw.source_sheet)
  const subsidyType = inferSubsidyType(raw.subsidy_item_name || raw.file_name)

  return {
    id: raw.id,
    oneThingName: raw.one_thing_name || '',
    subsidyItemName: raw.subsidy_item_name || '',
    fileType: raw.file_type,
    fileName: raw.file_name,
    publishRegion: raw.publish_region,
    publishUnit: raw.publish_unit,
    publishDate: raw.publish_date,
    subsidyTarget: raw.subsidy_target,
    subsidyStandard: raw.subsidy_standard,
    applyPeriod: raw.apply_period,
    applyCondition: raw.apply_condition,
    requiredMaterials: raw.required_materials,
    distributeTime: raw.distribute_time,
    distributeChannel: raw.distribute_channel,
    applyProcedure: raw.apply_procedure,
    handleChannel: raw.handle_channel,
    onlineEntry: raw.online_entry,
    policyUrl: raw.policy_url,
    sourceSheet: raw.source_sheet,
    subsidyType,
    verifyStatus,
    verifyNote: raw.verify_note,
    verifiedBy: raw.verified_by,
    verifiedAt: raw.verified_at,
    mdExported: raw.md_exported,
    mdStatus: raw.md_status,
    mdError: raw.md_error,
    source,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    // 兼容字段
    region: raw.publish_region,
    applyUrl: raw.online_entry,
    creator: raw.verified_by || 'admin'
  }
}

// 批量转换
export function fromCrawlerList(raws: any[]): CrawlItem[] {
  return raws.map(fromCrawlerAPI)
}

// ============ 反向：UI → 后端 payload ============

export function toCrawlerPayload(item: Partial<CrawlItem>): Record<string, string> {
  const out: Record<string, string> = {}
  if (item.oneThingName) out.one_thing_name = item.oneThingName
  if (item.subsidyItemName) out.subsidy_item_name = item.subsidyItemName
  if (item.fileType) out.file_type = item.fileType
  if (item.fileName) out.file_name = item.fileName
  if (item.publishRegion) out.publish_region = item.publishRegion
  if (item.publishUnit) out.publish_unit = item.publishUnit
  if (item.publishDate) out.publish_date = item.publishDate
  if (item.subsidyTarget) out.subsidy_target = item.subsidyTarget
  if (item.subsidyStandard) out.subsidy_standard = item.subsidyStandard
  if (item.applyPeriod) out.apply_period = item.applyPeriod
  if (item.applyCondition) out.apply_condition = item.applyCondition
  if (item.requiredMaterials) out.required_materials = item.requiredMaterials
  if (item.distributeTime) out.distribute_time = item.distributeTime
  if (item.distributeChannel) out.distribute_channel = item.distributeChannel
  if (item.applyProcedure) out.apply_procedure = item.applyProcedure
  if (item.handleChannel) out.handle_channel = item.handleChannel
  if (item.onlineEntry) out.online_entry = item.onlineEntry
  if (item.policyUrl) out.policy_url = item.policyUrl
  if (item.verifyNote) out.verify_note = item.verifyNote
  return out
}

// ============ 统计格式：爬虫 stats → UI 5 维 ============
export function mapStats(raw: { pending: number; qualified: number; rejected: number; uncertain: number; total: number }) {
  return {
    total: raw.total,
    pending: raw.pending,
    approved: raw.qualified,
    rejected: raw.rejected,
    questionable: raw.uncertain
  }
}

// ============ 时间格式化 ============
// 爬虫返回 "2026-07-16 17:06:29.590137" → "07-16 17:06"
export function formatCrawlerTime(s: string | null | undefined): string {
  if (!s) return ''
  // 截掉毫秒、统一分隔
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/)
  if (m) return `${m[2]}-${m[3]} ${m[4]}`
  return s
}
