# Step2 进度管理 — 状态读写与断点续跑

> 源文件：`bridge/src/step2-progress.ts`

```typescript
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'

import { join } from 'node:path'

import { WORKSPACES_DIR } from './paths.js'

import type { Step2Progress } from './types.js'



/** 版本目录：<WORKSPACES_DIR>/<projectKey>/versions/<sanitized versionId>

 *  与 projects.ts 中的 versionDir 同语义；本地实现以避免跨文件依赖 */

function versionDir(projectKey: string, versionId: string) {

  const safe = versionId.replace(/[^a-zA-Z0-9._-]/g, '_')

  return join(WORKSPACES_DIR, projectKey, 'versions', safe)

}



function versionJsonPath(projectKey: string, versionId: string) {

  return join(versionDir(projectKey, versionId), 'version.json')

}



function doneCachePath(projectKey: string, versionId: string) {

  return join(versionDir(projectKey, versionId), '_step2_done.json')

}



function readVersionJson(projectKey: string, versionId: string): Record<string, unknown> {

  const p = versionJsonPath(projectKey, versionId)

  if (!existsSync(p)) return {}

  try {

    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>

  } catch {

    return {}

  }

}



function writeVersionJson(projectKey: string, versionId: string, data: Record<string, unknown>) {

  const p = versionJsonPath(projectKey, versionId)

  mkdirSync(join(p, '..'), { recursive: true })

  const tmp = `${p}.tmp`

  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')

  renameSync(tmp, p)

}



export function readStep2Progress(projectKey: string, versionId: string): Step2Progress | null {

  const v = readVersionJson(projectKey, versionId)

  return (v.step2_progress as Step2Progress | undefined) ?? null

}



export function writeStep2Progress(

  projectKey: string,

  versionId: string,

  patch: Partial<Step2Progress>,

): Step2Progress {

  const v = readVersionJson(projectKey, versionId)

  const current = (v.step2_progress as Step2Progress | undefined) ?? {

    phase: 'idle',

    total_files: 0,

    processed: 0,

    errors: [],

  }

  const merged: Step2Progress = { ...current, ...patch, errors: patch.errors ?? current.errors }

  v.step2_progress = merged

  writeVersionJson(projectKey, versionId, v)

  return merged

}



export function markStep2FileDone(projectKey: string, versionId: string, relPath: string) {

  const p = doneCachePath(projectKey, versionId)

  let set: string[] = []

  if (existsSync(p)) {

    try {

      set = JSON.parse(readFileSync(p, 'utf-8')) as string[]

    } catch {

      set = []

    }

  }

  if (!set.includes(relPath)) {

    set.push(relPath)

    const tmp = `${p}.tmp`

    writeFileSync(tmp, JSON.stringify(set, null, 2) + '\n', 'utf-8')

    renameSync(tmp, p)

  }

}



export function isStep2FileDone(projectKey: string, versionId: string, relPath: string): boolean {

  const p = doneCachePath(projectKey, versionId)

  if (!existsSync(p)) return false

  try {

    const set = JSON.parse(readFileSync(p, 'utf-8')) as string[]

    return set.includes(relPath)

  } catch {

    return false

  }

}


```
