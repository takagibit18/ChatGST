# Step2 自动建模编排 — extract→derive→merge

> 源文件：`bridge/src/step2-build.ts`

```typescript
import { proxyOnto, OntoRequestError } from './onto-platform.js'

import { scanDataDir } from './step2-data-source.js'

import { runMergeAllWithResolutions } from './step2-merge.js'

import { recordVersionOntoModeling } from './projects.js'

import {

  writeStep2Progress,

  markStep2FileDone,

  isStep2FileDone,

  readStep2Progress,

} from './step2-progress.js'

import type { RegionLevels, Step2Error } from './types.js'



/** 五级元组指纹（多文件地域 guard 判等用：完全相同才算同一地域） */

function levelsKey(levels: RegionLevels): string {

  return JSON.stringify([

    levels.province_level ?? null,

    levels.prefecture_level ?? null,

    levels.county_level ?? null,

    levels.township_level ?? null,

    levels.national ?? null,

  ])

}



/** 从 region_ambiguous 错误中提取候选列表 */

function extractAmbiguousCandidates(e: unknown): { region_id: string; display_name: string; rule_count?: number }[] {

  if (!(e instanceof OntoRequestError) || e.errorType !== 'region_ambiguous') return []

  const raw = (e.payload?.candidates ?? []) as {

    region_id?: string

    id?: string

    display_name?: string

    rule_count?: number

  }[]

  return raw

    .filter((c) => c && (c.region_id || c.id))

    .map((c) => ({

      region_id: (c.region_id ?? c.id)!,

      display_name: c.display_name ?? (c.region_id ?? c.id)!,

      rule_count: c.rule_count,

    }))

}



/**

 * 串行跑 Step 2-A 自动建模（merge2 流程）：

 *   阶段① 逐文件 extract → derive（成功即标记 done，支持断点续跑）

 *   阶段② 单次 merge-all 两阶段批量合并（预览 → 冲突自动策略 → 提交）

 * 状态持久化到 version.json.step2_progress。

 */

export async function runStep2AutoModeling(

  projectKey: string,

  versionId: string,

  policyId: string,

  dataRoot: string,

): Promise<void> {

  // 全量扫描确定总数；已完成文件仅用于断点续跑，不能从总数中扣除，

  // 否则刷新/重进触发续跑时 total_files 会越跑越小（如 20 → 17）

  const scanned = scanDataDir(dataRoot)

  const doneFlags = scanned.map((f) => isStep2FileDone(projectKey, versionId, f.relPath))

  const files = scanned.filter((_, i) => !doneFlags[i])

  const doneCount = doneFlags.filter(Boolean).length



  // 多文件地域 guard：merge-all 语义为「每地域取最新批次」，

  // 同地域（五级元组完全相等）多文件会丢早期文件，暂不支持，直接失败并给出明确指引

  const regionCount = new Map<string, { count: number; display: string }>()

  for (const f of scanned) {

    const key = levelsKey(f.levels)

    const cur = regionCount.get(key)

    regionCount.set(key, { count: (cur?.count ?? 0) + 1, display: f.display })

  }

  const multiRegions = [...regionCount.values()].filter((r) => r.count > 1)

  if (multiRegions.length > 0) {

    const detail = multiRegions.map((r) => `${r.display}（${r.count} 个文件）`).join('、')

    writeStep2Progress(projectKey, versionId, {

      phase: 'failed',

      finished_at: new Date().toISOString(),

      errors: [{

        file: multiRegions.map((r) => r.display).join('、'),

        stage: 'extract',

        message: `检测到同一地域包含多个政策文件：${detail}。merge-all 每地域仅合并最新推导批次，多文件地域暂不支持自动建模，请将每个地域的文件拆分为一个版本一个地域，或等待平台支持后再试。`,

        at: new Date().toISOString(),

      }],

    })

    return

  }



  // 全部文件已完成（标记 done 的算"成功"），无需重跑 extract/derive。

  // 但仍需触发一次 merge-all：之前可能因 crash/网络问题导致 merge 未真正生效，

  // 而 on_policy_id 已创建但 rules 为空，触发 review-status 返回 regions:[]。

  // 两阶段合并自带幂等与冲突自动决策；保留现有 total_files / processed 历史计数。

  if (files.length === 0) {

    const existing = readStep2Progress(projectKey, versionId)

    const now = new Date().toISOString()

    try {

      const summary = await runMergeAllWithResolutions(projectKey, versionId, policyId)

      if (summary.merged === 0 && summary.failed > 0) {

        writeStep2Progress(projectKey, versionId, {

          phase: 'failed',

          finished_at: now,

          merge_summary: summary,

          errors: summary.failed_regions.map((r) => ({

            file: r.region,

            stage: 'merge-all' as const,

            message: r.reason,

            at: now,

          })),

        })

        return

      }

      writeStep2Progress(projectKey, versionId, {

        phase: 'review',

        total_files: existing?.total_files ?? 0,

        processed: existing?.processed ?? 0,

        started_at: existing?.started_at ?? now,

        finished_at: existing?.finished_at ?? now,

        data_source_root: existing?.data_source_root ?? dataRoot,

        merge_summary: summary,

      })

      // 建模产出元数据入库（clone-sources 聚合用）；失败仅记日志

      void recordVersionOntoModeling(projectKey, versionId).catch(() => {})

    } catch (e) {

      writeStep2Progress(projectKey, versionId, {

        phase: 'failed',

        finished_at: now,

        errors: [{

          file: '*',

          stage: 'merge-all',

          message: String((e as Error).message),

          at: now,

        }],

      })

    }

    return

  }



  const now = new Date().toISOString()

  writeStep2Progress(projectKey, versionId, {

    phase: 'extract',

    total_files: scanned.length,

    processed: doneCount,

    started_at: now,

    current_file: undefined,

    current_region: undefined,

    data_source_root: dataRoot,

    merge_stage: undefined,

    conflict_count: undefined,

    merge_summary: undefined,

  })



  let processed = doneCount

  const newErrors: Step2Error[] = []



  // 阶段①：逐文件 extract → derive（不再逐文件 derive/merge）

  for (const f of files) {

    writeStep2Progress(projectKey, versionId, {

      current_file: f.relPath,

      current_region: f.display,

    })

    try {

      const ext = (await proxyOnto('POST', '/api/onto/extract', {

        region_selector: { levels: f.levels },

        title: f.title,

        text: f.text,

        doc_ref: f.relPath,

        policy_id: policyId,

      })) as { items?: unknown[]; id?: string } | null

      // spec: id 可选；但 derive 需要 id，所以 extract 必须返回 id 才算成功

      if (!ext?.id) throw new Error('extract 返回无 id')



      const der = (await proxyOnto('POST', '/api/onto/derive', {

        region_selector: { levels: f.levels },

        qa_items: ext.items ?? [],

        extraction_id: ext.id,

        doc_ref: f.relPath,

        policy_id: policyId,

      })) as { id?: string } | null

      // derive 返回的 id 是推导批次 id，merge-all 按批次合并，必填

      if (!der?.id) throw new Error('derive 返回无 id')



      // derive 成功即标记 done：批次已落在平台，续跑时 merge-all 会合并它

      markStep2FileDone(projectKey, versionId, f.relPath)

    } catch (e) {

      // 地域歧义：记录候选列表，不自动选择，待人工修正数据后重跑

      const candidates = extractAmbiguousCandidates(e)

      newErrors.push({

        file: f.relPath,

        stage: 'extract',

        message: candidates.length

          ? `地域歧义（region_ambiguous）：无法唯一确定地域，候选：${candidates.map((c) => c.display_name).join('、')}。请修正数据目录层级后重跑`

          : String((e as Error).message),

        at: new Date().toISOString(),

        ...(candidates.length ? { candidates } : {}),

      })

    }

    processed += 1

    writeStep2Progress(projectKey, versionId, { processed })

  }



  // 阶段②：merge-all 两阶段批量合并

  try {

    const summary = await runMergeAllWithResolutions(projectKey, versionId, policyId)

    const mergeErrors: Step2Error[] = summary.failed_regions.map((r) => ({

      file: r.region,

      stage: 'merge-all' as const,

      message: r.reason,

      at: summary.finished_at,

    }))



    if (summary.merged === 0 && summary.failed > 0) {

      // 全部批次合并失败

      writeStep2Progress(projectKey, versionId, {

        phase: 'failed',

        finished_at: summary.finished_at,

        merge_summary: summary,

        errors: [...newErrors, ...mergeErrors],

      })

      return

    }



    // 全部或部分成功：进入人工审核（部分失败的地域在 errors 可见）

    writeStep2Progress(projectKey, versionId, {

      phase: 'review',

      finished_at: summary.finished_at,

      merge_summary: summary,

      errors: [...newErrors, ...mergeErrors],

    })

    // 建模产出元数据入库（clone-sources 聚合用）；失败仅记日志

    void recordVersionOntoModeling(projectKey, versionId).catch(() => {})

  } catch (e) {

    writeStep2Progress(projectKey, versionId, {

      phase: 'failed',

      finished_at: new Date().toISOString(),

      errors: [

        ...newErrors,

        {

          file: '*',

          stage: 'merge-all',

          message: String((e as Error).message),

          at: new Date().toISOString(),

        },

      ],

    })

  }

}


```
