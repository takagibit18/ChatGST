# Step2 两阶段合并 — 预览→冲突决策→提交

> 源文件：`bridge/src/step2-merge.ts`

```typescript
import { proxyOnto } from './onto-platform.js'

import { loadStep2Config } from './step2-data-source.js'

import { writeStep2Progress } from './step2-progress.js'

import type { MergeSummary, Step2Config } from './types.js'



/**

 * merge-all 两阶段合并（merge2）。

 *

 * 背景：直接 dry_run:false 裸调 merge-all 时，任何规则冲突都会导致整批失败。

 * 平台契约支持「预览 → 逐项决策 → 提交」：dry_run:true 返回 plan_id + conflict_items，

 * 提交时带 plan_id + resolutions 即可按策略自动合并，plan_id 复用还能避免重复 LLM/KELE 准备。

 *

 * 本模块把该流程封装为单次调用，并按 config.json step2.merge_conflict_action

 * （默认 use_candidate）自动生成 resolutions，无需人工逐项处理。

 */



/** merge-all 预览/提交响应中与本流程相关的字段（平台契约见 /ref 文档） */

interface MergeAllResponse {

  ok?: boolean

  dry_run?: boolean

  plan_id?: string

  merged?: number

  failed?: number

  conflict_items?: { key?: string }[]

  blocked_rules?: unknown[]

  warnings?: string[]

  results?: { region?: string; ok?: boolean; reason?: string }[]

  error?: string

}



/** 预览失败 / 提交失败时抛出的错误信息上限 */

const MAX_ERR_TEXT = 300



function resolveConflictAction(): Step2Config['merge_conflict_action'] {

  const action = loadStep2Config().merge_conflict_action ?? 'use_candidate'

  if (action === 'use_candidate' || action === 'keep_existing' || action === 'skip') {

    return action

  }

  throw new Error(

    `step2.merge_conflict_action 配置无效: ${action}（仅支持 use_candidate / keep_existing / skip）`,

  )

}



/**

 * 执行两阶段合并：预览 → 自动生成冲突决策 → 提交。

 * 中间通过 writeStep2Progress 写 merge_stage / conflict_count 供前端展示。

 *

 * @returns MergeSummary（无论成败都返回结构化摘要；全败时 failed>0 且 merged=0）

 * @throws 仅在预览/提交请求本身失败（网络、平台 5xx、策略配置无效）时抛出

 */

export async function runMergeAllWithResolutions(

  projectKey: string,

  versionId: string,

  policyId: string,

): Promise<MergeSummary> {

  const action = resolveConflictAction()

  const finished = () => new Date().toISOString()



  // 阶段 1：预览（生成合并计划，不落盘）

  writeStep2Progress(projectKey, versionId, {

    phase: 'merge',

    merge_stage: 'preview',

    conflict_count: undefined,

  })

  const preview = (await proxyOnto('POST', `/api/policies/${policyId}/merge-all`, {

    dry_run: true,

    max_workers: 4,

  })) as MergeAllResponse | null

  if (!preview || preview.ok === false) {

    throw new Error(`merge-all 预览失败: ${(preview?.error ?? '无响应').slice(0, MAX_ERR_TEXT)}`)

  }



  // 阶段 2：有冲突则按策略自动生成 resolutions

  const conflictKeys = (preview.conflict_items ?? [])

    .map((c) => c.key)

    .filter((k): k is string => typeof k === 'string' && k.length > 0)

  if (conflictKeys.length > 0) {

    writeStep2Progress(projectKey, versionId, {

      merge_stage: 'resolving',

      conflict_count: conflictKeys.length,

    })

  }

  const resolutions =

    conflictKeys.length > 0

      ? Object.fromEntries(conflictKeys.map((k) => [k, { action }]))

      : undefined



  // 阶段 3：提交（复用 plan_id，避免重复 LLM/KELE 准备）

  writeStep2Progress(projectKey, versionId, { merge_stage: 'committing' })

  const commit = (await proxyOnto('POST', `/api/policies/${policyId}/merge-all`, {

    dry_run: false,

    plan_id: preview.plan_id,

    resolutions,

    max_workers: 4,

  })) as MergeAllResponse | null

  if (!commit || commit.ok === false) {

    throw new Error(`merge-all 提交失败: ${(commit?.error ?? '无响应').slice(0, MAX_ERR_TEXT)}`)

  }



  const results = commit.results ?? []

  const failedRegions = results

    .filter((r) => r.ok === false)

    .map((r) => ({ region: r.region ?? '(未知地域)', reason: r.reason ?? '(无原因)' }))



  return {

    merged: commit.merged ?? 0,

    failed: commit.failed ?? failedRegions.length,

    conflict_count: conflictKeys.length,

    conflict_action: action,

    overwritten_keys: conflictKeys,

    blocked_count: (commit.blocked_rules ?? []).length,

    warnings: commit.warnings ?? [],

    failed_regions: failedRegions,

    finished_at: finished(),

  }

}


```
