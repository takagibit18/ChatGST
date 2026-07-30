# Step2 收尾 — 生成 ontology.json

> 源文件：`bridge/src/step2-finalize.ts`

```typescript
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'

import { join } from 'node:path'

import { WORKSPACES_DIR } from './paths.js'

import { readStep2Progress, writeStep2Progress } from './step2-progress.js'

import type { OntologyMeta } from './types.js'



/** 版本目录：<WORKSPACES_DIR>/<projectKey>/versions/<sanitized versionId>

 *  与 step2-progress.ts / projects.ts 中的 versionDir 同语义；本地实现以避免跨文件依赖 */

function versionDir(projectKey: string, versionId: string) {

  const safe = versionId.replace(/[^a-zA-Z0-9._-]/g, '_')

  return join(WORKSPACES_DIR, projectKey, 'versions', safe)

}



function readVersionMeta(projectKey: string, versionId: string): {

  on_policy_id?: string

  on_policy_canonical?: string

} {

  const p = join(versionDir(projectKey, versionId), 'version.json')

  if (!existsSync(p)) return {}

  try {

    return JSON.parse(readFileSync(p, 'utf-8')) as { on_policy_id?: string; on_policy_canonical?: string }

  } catch {

    return {}

  }

}



function atomicWriteJson(path: string, data: unknown) {

  mkdirSync(join(path, '..'), { recursive: true })

  const tmp = `${path}.tmp`

  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')

  renameSync(tmp, path)

}



/**

 * 收尾：写 ontology.json + 把 phase 切到 done。

 * 自动测试（golden run）已在用户侧隐藏，review.run_status 不参与收尾校验。

 */

export function finalizeStep2(

  projectKey: string,

  versionId: string,

  regions: string[],

  ruleCount: number,

): OntologyMeta {

  const progress = readStep2Progress(projectKey, versionId)

  if (!progress) throw new Error('step2 progress 不存在')

  const meta = readVersionMeta(projectKey, versionId)

  if (!meta.on_policy_id) throw new Error('缺少 on_policy_id')



  const startedAt = progress.started_at ?? new Date().toISOString()

  const finishedAt = new Date().toISOString()

  // review 可能为 undefined（未跑过自动测试），需 fallback

  const reviewStart = progress.review?.run_started_at ?? finishedAt

  const reviewEnd = progress.review?.run_finished_at ?? finishedAt



  const ontologyMeta: OntologyMeta = {

    policy_id: meta.on_policy_id,

    canonical_name: meta.on_policy_canonical ?? '',

    regions,

    started_at: startedAt,

    finished_at: finishedAt,

    step_durations: {

      extract_ms: 0,  // 由调用方提供更精确值（如需）

      derive_ms: 0,

      merge_ms: 0,

      review_ms: new Date(reviewEnd).getTime() - new Date(reviewStart).getTime(),

      golden_run_ms: new Date(reviewEnd).getTime() - new Date(reviewStart).getTime(),

    },

    file_count: progress.total_files,

    rule_count: ruleCount,

    golden_pass_rate: progress.review?.run_pass_rate,

  }



  const ontologyPath = join(versionDir(projectKey, versionId), 'ontology.json')

  atomicWriteJson(ontologyPath, ontologyMeta)



  writeStep2Progress(projectKey, versionId, {

    phase: 'done',

    finished_at: finishedAt,

  })



  return ontologyMeta

}
```
