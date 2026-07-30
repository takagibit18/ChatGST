import { get, post } from '@/utils/axios'
import type {
  ConfirmRuleBody,
  GoldenRunBody,
  InferPayload,
  InferResult,
  OntologyMeta,
  OntoOntology,
  OntoMeta,
  OntoConcept,
  OntoOperator,
  OntoRule,
  ReviewStatus,
  RuleToNl,
  Step2Progress,
} from '@/types/onto'

export const getOntology = () => get<OntoOntology>('/onto/ontology')

/** 按 policy_id 拉本体（用于 Step 2 完成后的本体浏览） */
export const getOntologyByPolicy = (projectId: string, versionId: string) =>
  get<OntoOntology>(
    `/projects/${projectId}/versions/${versionId}/onto/ontology`,
  )

/** 拉 meta（regions + operators 下拉数据源） */
export const getOntoMeta = () => get<OntoMeta>('/onto/meta')

export const infer = (
  payload: InferPayload,
  options?: { projectId?: string; versionId?: string },
) => {
  // 透传 projectId/versionId 给 bridge，由 bridge 注入 policy_id
  const params: Record<string, string> = {}
  if (options?.projectId) params.projectId = options.projectId
  if (options?.versionId) params.versionId = options.versionId
  return post<InferResult>('/onto/infer', payload as unknown as Record<string, unknown>, {
    params: Object.keys(params).length ? params : undefined,
  } as { timeoutMs?: number })
}

/** 自然语言 query（走 LLM）。question 为可选问题描述 */
export const query = (
  payload: { region: string; text: string; question?: string },
  options?: { projectId?: string; versionId?: string; timeoutMs?: number },
) => {
  const params: Record<string, string> = {}
  if (options?.projectId) params.projectId = options.projectId
  if (options?.versionId) params.versionId = options.versionId
  return post<InferResult>('/onto/query', payload as unknown as Record<string, unknown>, {
    params: Object.keys(params).length ? params : undefined,
    timeoutMs: options?.timeoutMs ?? 60000,
  } as { timeoutMs?: number; params?: Record<string, string> })
}

export const getExtractions = () => get<unknown>('/onto/extractions')

export const getDerivations = () => get<unknown>('/onto/derivations')

// 本体编辑
type PolicyCtx = { projectId?: string; versionId?: string }

export const saveConcept = (data: Partial<OntoConcept>, ctx?: PolicyCtx) => {
  const params: Record<string, string> = {}
  if (ctx?.projectId) params.projectId = ctx.projectId
  if (ctx?.versionId) params.versionId = ctx.versionId
  return post<unknown>('/onto/concept', data as Record<string, unknown>, {
    params: Object.keys(params).length ? params : undefined,
  } as { params?: Record<string, string> })
}
export const createConcept = (data: Partial<OntoConcept>, ctx?: PolicyCtx) => {
  const params: Record<string, string> = {}
  if (ctx?.projectId) params.projectId = ctx.projectId
  if (ctx?.versionId) params.versionId = ctx.versionId
  return post<unknown>('/onto/concept/create', data as Record<string, unknown>, {
    params: Object.keys(params).length ? params : undefined,
  } as { params?: Record<string, string> })
}
export const deleteConcept = (id: string) =>
  post<unknown>(`/onto/concept/${encodeURIComponent(id)}/delete`)

export const saveOperator = (data: Partial<OntoOperator>, ctx?: PolicyCtx) => {
  const params: Record<string, string> = {}
  if (ctx?.projectId) params.projectId = ctx.projectId
  if (ctx?.versionId) params.versionId = ctx.versionId
  return post<unknown>('/onto/operator', data as Record<string, unknown>, {
    params: Object.keys(params).length ? params : undefined,
  } as { params?: Record<string, string> })
}
export const createOperator = (data: Partial<OntoOperator>, ctx?: PolicyCtx) => {
  const params: Record<string, string> = {}
  if (ctx?.projectId) params.projectId = ctx.projectId
  if (ctx?.versionId) params.versionId = ctx.versionId
  return post<unknown>('/onto/operator/create', data as Record<string, unknown>, {
    params: Object.keys(params).length ? params : undefined,
  } as { params?: Record<string, string> })
}
export const deleteOperator = (id: string) =>
  post<unknown>(`/onto/operator/${encodeURIComponent(id)}/delete`)

// 上游本体平台规则 API 格式：POST /api/ontology/create/rule { item: { name, region, source, head, body } }
//                                       POST /api/ontology/save/rule   { name, patch: { ... } }
// head / body 都是 JSON 表达式（不是字符串），调用前需 JSON.parse
export interface RulePayload {
  name: string
  region: string
  source: string
  head: unknown
  body: unknown
  zh?: string
  /** 选填：不传则 bridge 从 version.json 注入 */
  policy_id?: string
}

export const createRule = (
  data: RulePayload,
  options?: { projectId?: string; versionId?: string },
) => {
  const params: Record<string, string> = {}
  if (options?.projectId) params.projectId = options.projectId
  if (options?.versionId) params.versionId = options.versionId
  return post<unknown>('/onto/rule/create', { item: data }, {
    params: Object.keys(params).length ? params : undefined,
  } as { params?: Record<string, string> })
}
export const saveRule = (
  name: string,
  patch: Omit<RulePayload, 'name'>,
  options?: { projectId?: string; versionId?: string },
) => {
  const params: Record<string, string> = {}
  if (options?.projectId) params.projectId = options.projectId
  if (options?.versionId) params.versionId = options.versionId
  return post<unknown>('/onto/rule', { name, patch }, {
    params: Object.keys(params).length ? params : undefined,
  } as { params?: Record<string, string> })
}
export const deleteRule = (id: string) =>
  post<unknown>(`/onto/rule/${encodeURIComponent(id)}/delete`)

export const ensureOntoPolicy = (projectId: string, versionId: string) =>
  post(`/projects/${projectId}/versions/${versionId}/onto/policy`)

export const startOntoBuild = (projectId: string, versionId: string) =>
  post(`/projects/${projectId}/versions/${versionId}/onto/build`)

export const getOntoProgress = (projectId: string, versionId: string) =>
  get<Step2Progress>(`/projects/${projectId}/versions/${versionId}/onto/progress`)

export const getReviewStatus = (projectId: string, versionId: string) =>
  get<ReviewStatus>(`/projects/${projectId}/versions/${versionId}/onto/review-status`)

/** 取单条规则的自然语言描述（人工审核详情面板） */
export const getRuleToNl = (projectId: string, versionId: string, name: string) =>
  get<RuleToNl>(
    `/projects/${projectId}/versions/${versionId}/onto/rule/to_nl`,
    { name },
  )

export const confirmRule = (projectId: string, versionId: string, body: ConfirmRuleBody) =>
  post(
    `/projects/${projectId}/versions/${versionId}/onto/rule/confirm`,
    body as unknown as Record<string, unknown>
  )

export const runGoldenTest = (projectId: string, versionId: string, body: GoldenRunBody = {}) =>
  post(
    `/projects/${projectId}/versions/${versionId}/onto/golden/run`,
    body as unknown as Record<string, unknown>
  )

export const finalizeOnto = (
  projectId: string,
  versionId: string,
  body: { regions: string[]; rule_count: number } = { regions: [], rule_count: 0 }
) =>
  post<OntologyMeta>(
    `/projects/${projectId}/versions/${versionId}/onto/finalize`,
    body as unknown as Record<string, unknown>
  )
