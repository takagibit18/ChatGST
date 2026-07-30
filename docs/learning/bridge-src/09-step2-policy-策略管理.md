# Step2 策略管理 — 创建/克隆本体策略

> 源文件：`bridge/src/step2-policy.ts`

```typescript
import { proxyOnto } from './onto-platform.js'

export interface OntoPolicyRef {
  policy_id: string
  canonical_name: string
  /** policy_snapshot 初始化时平台返回的复制数量 */
  seeded?: {
    concepts?: number
    operators?: number
    rules?: number
    regions?: number
  }
}

/**
 * 平台 POST /api/policies 的 initialization 字段（现为必填，三种初始化来源）。
 * - empty：仅 Bool/Number 基础概念（实测 seeded: 2 concepts / 0 operators）
 * - system_template：系统模板（template_id: "default"；实测 seeded: 19 concepts / 202 operators，
 *   与旧版本默认创建的基线一致 → 作为本系统的默认初始化方式）
 * - policy_snapshot：从已有策略快照克隆（需 source_hash 并发校验）
 */
export interface PolicyInitialization {
  type: 'empty' | 'system_template' | 'policy_snapshot'
  template_id?: string
  source_policy_id?: string
  source_version?: string | null
  source_hash?: string
  rule_selection?: {
    mode: 'none' | 'all' | 'selected'
    region_ids?: string[]
    rule_ids?: string[]
    include_dependencies?: boolean
  }
}

/** 平台已将 initialization 设为必填（缺省返回 400 initialization_required），统一默认系统模板 */
const DEFAULT_INITIALIZATION: PolicyInitialization = { type: 'system_template', template_id: 'default' }

/**
 * 在 onto-platform 创建一个新 policy。
 * canonicalName 通常是 "项目名 v版本号"。
 * 该调用正常应瞬时返回；平台挂死时 30s 快速失败（默认值曾导致创建版本接口长时间挂起）。
 *
 * 幂等保护：平台对同名不报错（自动加 -2 后缀），而「写入成功但响应丢失」
 * （超时/断连时平台侧实际已落盘）会让调用方误以为失败并重试，制造重复 policy。
 * 因此：创建前先按名领养；失败后再查一次——若已落盘则领养而不是抛错。
 */
export async function ensureOntoPolicy(
  canonicalName: string,
  description = '',
  initialization?: PolicyInitialization,
): Promise<OntoPolicyRef> {
  const existing = await findPolicyByName(canonicalName).catch(() => null)
  if (existing) return existing

  const body: Record<string, unknown> = {
    canonical_name: canonicalName,
    description,
    initialization: initialization ?? DEFAULT_INITIALIZATION,
  }
  // policy_snapshot 全量复制源策略（概念/算子/规则可达数百条），服务端耗时长，
  // 30s 默认值会导致「客户端超时但服务端后台写完」——克隆给足 180s
  const timeoutMs = body.initialization && (body.initialization as PolicyInitialization).type === 'policy_snapshot'
    ? 180_000
    : 30_000
  try {
    const result = await proxyOnto<{
      policy_id: string
      canonical_name: string
      seeded?: OntoPolicyRef['seeded']
    }>(
      'POST',
      '/api/policies',
      body,
      { timeoutMs },
    )
    if (!result || !result.policy_id) {
      throw new Error(`创建 policy 失败：${canonicalName}`)
    }
    return {
      policy_id: result.policy_id,
      canonical_name: canonicalName,
      seeded: result.seeded,
    }
  } catch (e) {
    // 响应丢失但写入可能已落盘：复查并按名领养，避免重复创建
    const landed = await findPolicyByName(canonicalName).catch(() => null)
    if (landed) return landed
    throw e
  }
}

/** GET /api/policies 按 canonical_name 精确匹配（领养已存在的 policy） */
async function findPolicyByName(canonicalName: string): Promise<OntoPolicyRef | null> {
  const resp = await proxyOnto<{ policies?: Array<{ id?: string; canonical_name?: string }> }>(
    'GET',
    '/api/policies',
    undefined,
    { timeoutMs: 15_000 },
  )
  const hit = (resp?.policies ?? []).find((p) => p.canonical_name === canonicalName)
  return hit?.id ? { policy_id: hit.id, canonical_name: canonicalName } : null
}

/** 拉取源策略的可复制内容（主要为了 source_hash 并发校验；计数供展示） */
export async function getInitializationSource(sourcePolicyId: string): Promise<{
  hash: string
  counts?: { concepts?: number; operators?: number; rules?: number }
}> {
  const resp = (await proxyOnto(
    'GET',
    `/api/policies/${sourcePolicyId}/initialization-source`,
  )) as {
    source?: { hash?: string }
    counts?: { concepts?: number; operators?: number; rules?: number }
  }
  const hash = resp?.source?.hash
  if (!hash) throw new Error(`源策略 initialization-source 未返回 hash：${sourcePolicyId}`)
  return { hash, counts: resp.counts }
}

```
