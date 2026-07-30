# Step2 判定历史 — 规则命中记录

> 源文件：`bridge/src/step2-judge-history.ts`

```typescript
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

import { randomUUID } from 'node:crypto'

import { join } from 'node:path'

import { WORKSPACES_DIR } from './paths.js'



/** 版本目录：<WORKSPACES_DIR>/<projectKey>/versions/<sanitized versionId>

 *  与 step2-progress.ts / step2-finalize.ts 中的 versionDir 同语义。 */

function versionDir(projectKey: string, versionId: string) {

  const safe = versionId.replace(/[^a-zA-Z0-9._-]/g, '_')

  return join(WORKSPACES_DIR, projectKey, 'versions', safe)

}



/** 单条资格判定记录 */

export interface JudgeHistoryEntry {

  id: string // j-<uuid>

  text: string

  question?: string

  region: string

  /** 结构化地域 id（五级模型；旧记录无此字段） */

  region_id?: string

  /** 展示用地域全路径（如 "四川省 / 成都市 / 武侯区"；旧记录无此字段时展示 region） */

  display_name?: string

  /** 本次实际命中的规则 ID 列表 */

  matched_rule_ids: string[]

  /** 本次参与编译的规则 ID 列表 */

  total_rule_ids: string[]

  /** ISO 8601 时间戳 */

  created_at: string

}



/** 资格判定历史汇总 */

export interface JudgeHistorySnapshot {

  /** 最近 20 条 */

  entries: JudgeHistoryEntry[]

  /** 当前版本累计判定条数（永不递减） */

  total_count: number

  /** 累计命中过的去重规则 ID（不随 entries 截断丢失） */

  hit_rule_ids: string[]

  /** 累计参与编译的去重规则 ID（不随 entries 截断丢失） */

  total_rule_ids: string[]

}



const MAX_ENTRIES = 20



function atomicWriteJson(path: string, data: unknown) {

  mkdirSync(join(path, '..'), { recursive: true })

  const tmp = `${path}.tmp`

  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')

  renameSync(tmp, path)

}



function versionJsonPath(projectKey: string, versionId: string) {

  return join(versionDir(projectKey, versionId), 'version.json')

}



/**

 * 读取当前版本的资格判定历史。若版本或 version.json 不存在返回空快照；

 * 已存在 step2_judge_history 时做浅校验（缺字段补默认）。

 * 旧数据缺少 hit_rule_ids / total_rule_ids 时，从现存 entries 推导并集。

 */

export function readJudgeHistory(projectKey: string, versionId: string): JudgeHistorySnapshot {

  const p = versionJsonPath(projectKey, versionId)

  if (!existsSync(p)) return { entries: [], total_count: 0, hit_rule_ids: [], total_rule_ids: [] }

  try {

    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { step2_judge_history?: Partial<JudgeHistorySnapshot> }

    const h = raw.step2_judge_history ?? {}

    const entries = Array.isArray(h.entries) ? h.entries : []

    const total_count = typeof h.total_count === 'number' ? h.total_count : entries.length

    const hit_rule_ids = Array.isArray(h.hit_rule_ids)

      ? h.hit_rule_ids

      : [...new Set(entries.flatMap((e) => e.matched_rule_ids ?? []))]

    const total_rule_ids = Array.isArray(h.total_rule_ids)

      ? h.total_rule_ids

      : [...new Set(entries.flatMap((e) => e.total_rule_ids ?? []))]

    return { entries, total_count, hit_rule_ids, total_rule_ids }

  } catch {

    return { entries: [], total_count: 0, hit_rule_ids: [], total_rule_ids: [] }

  }

}



/**

 * 追加一条资格判定记录到 version.json.step2_judge_history。

 * - 超过 MAX_ENTRIES (20) 时截断最早的，保留最新 20 条

 * - total_count 永远累加（不随截断回退）

 * - 原子写入（.tmp + rename）

 * - 保留 version.json 的其他字段

 *

 * @throws 当 version.json 不存在或解析失败时抛出错误

 */

export function appendJudgeHistory(

  projectKey: string,

  versionId: string,

  entry: {

    text: string

    question?: string

    region: string

    region_id?: string

    display_name?: string

    matched_rule_ids: string[]

    total_rule_ids: string[]

  },

): JudgeHistorySnapshot {

  const p = versionJsonPath(projectKey, versionId)

  if (!existsSync(p)) {

    throw new Error(`version.json 不存在: ${projectKey}/${versionId}`)

  }



  let raw: Record<string, unknown>

  try {

    raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>

  } catch (e) {

    throw new Error(`version.json 解析失败: ${(e as Error).message}`)

  }



  const prev = (raw.step2_judge_history ?? {}) as Partial<JudgeHistorySnapshot>

  const prevEntries: JudgeHistoryEntry[] = Array.isArray(prev.entries) ? prev.entries : []

  const prevTotal = typeof prev.total_count === 'number' ? prev.total_count : prevEntries.length

  // 累计去重规则集合：优先取持久化值，旧数据从现存 entries 推导

  const prevHit = Array.isArray(prev.hit_rule_ids)

    ? prev.hit_rule_ids

    : [...new Set(prevEntries.flatMap((e) => e.matched_rule_ids ?? []))]

  const prevAll = Array.isArray(prev.total_rule_ids)

    ? prev.total_rule_ids

    : [...new Set(prevEntries.flatMap((e) => e.total_rule_ids ?? []))]



  const newEntry: JudgeHistoryEntry = {

    id: `j-${randomUUID()}`,

    text: entry.text,

    question: entry.question,

    region: entry.region,

    region_id: entry.region_id,

    display_name: entry.display_name,

    matched_rule_ids: entry.matched_rule_ids,

    total_rule_ids: entry.total_rule_ids,

    created_at: new Date().toISOString(),

  }



  // 追加 + 截断（保留最近 MAX_ENTRIES 条）

  const entries = [...prevEntries, newEntry]

  const truncated = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries



  const snapshot: JudgeHistorySnapshot = {

    entries: truncated,

    total_count: prevTotal + 1,

    hit_rule_ids: [...new Set([...prevHit, ...entry.matched_rule_ids])],

    total_rule_ids: [...new Set([...prevAll, ...entry.total_rule_ids])],

  }



  raw.step2_judge_history = snapshot

  atomicWriteJson(p, raw)

  return snapshot

}
```
