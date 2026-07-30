# 项目管理 — 项目/版本/流水线/审批

> 源文件：`bridge/src/projects.ts`

```typescript
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKSPACES_DIR, DATASPACES_DIR, ensureWorkspacesRoot, ensureDataspacesRoot, projectCwd, dataSpaceCwd } from './paths.js'
import { ensureOntoPolicy, getInitializationSource, type OntoPolicyRef } from './step2-policy.js'
import { OntoRequestError } from './onto-platform.js'
import { readStep2Progress, writeStep2Progress } from './step2-progress.js'
import { loadStep2Config, type Step2Config } from './step2-data-source.js'
import { readJudgeHistory } from './step2-judge-history.js'
import { copyDirSync } from './fs-safe.js'
import { listUsers, findUser } from './users-store.js'
import { findRole } from './roles-store.js'
import { copyVersionToDataSpace, readPublishFileForSpace } from './publish.js'
import { homedir } from 'node:os'
import {
  getProjectMeta,
  saveProjectMeta,
  deleteProjectMeta,
  listAllProjects,
  getVersionMeta,
  saveVersionMeta,
  listVersions,
  listAllReviews,
  saveReview,
  type StoredProject,
  type StoredVersion,
  type StoredReview,
} from './project-store.js'
import type { OntoCloneRecord, OntoRegionSummary } from './types.js'

const PIPELINE_TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'pipeline-template.json')
const GS_DIR = process.env.GS_PLATFORM_HOME || join(homedir(), '.gs_platform')

/** manifest.json：项目名 ↔ proj-UUID 映射 */
export interface ManifestEntry {
  name: string
  id: string
  dataSpaceIds?: string[] // 可选挂载的数据空间（ds-<UUID>）
}

/** 数据空间条目：独立于项目存在 */
export interface DataSpaceEntry {
  id: string // ds-<UUID>
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  fileCount?: number // 缓存
  /** 绑定的来源项目 key（proj-XXX）；审批通过自动生成的项目型数据空间会带此字段 */
  projectKey?: string
  /** 绑定的来源项目名（用于展示与远程目录命名） */
  projectName?: string
  /** 该数据空间已收录的已发布版本号列表 */
  publishedVersions?: string[]
}

export interface WorkspaceManifest {
  projects: ManifestEntry[]
  dataspaces: DataSpaceEntry[] // 独立数据空间段
}

export interface ProjectOwner {
  initials: string
  name: string
  color: string
}

/**
 * 计算用户头像缩写：
 * - 中文：取前两个字
 * - 英文：按空格拆分各取首字母（最多 2 位，大写）
 * - 空字符串/全空格：返回 "?"
 */
export function pickInitials(name: string): string {
  const trimmed = name.replace(/\s+/g, '').trim()
  if (!trimmed) return '?'
  if (/[一-龥]/.test(trimmed)) return trimmed.slice(0, 2)
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()
  return letters || trimmed.slice(0, 2).toUpperCase()
}

/**
 * 根据 username 计算头像背景色（哈希分桶到调色板，保证同一用户始终是同一种颜色）。
 */
export function pickColor(seed: string): string {
  const palette = ['#1B5BD9', '#C8311E', '#7E22CE', '#0E9F6E', '#D97706', '#0369A1']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export interface VersionMeta {
  id: string
  version: string
  changelog: string
  status: string
  statusVariant: string
  createdAt: string
  updatedAt: string
  steps: string[]
  running: boolean
  latest: boolean
  /** 每步的开始/结束时间（ISO），advancePipeline 时自动记录 */
  stepTimes?: Array<{ startedAt?: string; finishedAt?: string }>
  // Step 2: 本体建模回写（ensureOntoPolicy 写入；失败时为空）
  on_policy_id?: string
  on_policy_canonical?: string
  /** 建模产出元数据（DB 主存储；merge-all/finalize 成功后写入） */
  onto_rule_count?: number
  onto_region_count?: number
  onto_regions?: OntoRegionSummary[]
  onto_built_at?: string
  /** 克隆来源记录（创建版本时登记；fallback 重放依据） */
  onto_clone?: OntoCloneRecord
}

export interface ProjectMeta {
  key: string
  name: string
  description: string
  owner: ProjectOwner
  currentVersion: string
  createdAt: string
  updatedAt: string
  status: string
  statusVariant: string
  /** 规则引擎的 policy_id（如 "ontology_34d11e52f284"），工具运行时从 project.json 读取 */
  policyId?: string
}

function manifestPath() {
  return join(WORKSPACES_DIR, 'manifest.json')
}

function legacyRegistryPath() {
  return join(WORKSPACES_DIR, 'registry.json')
}

function emptyManifest(): WorkspaceManifest {
  return { projects: [], dataspaces: [] }
}

function projectMetaPath(key: string) {
  return join(projectCwd(key), 'project.json')
}

function versionsDir(key: string) {
  return join(projectCwd(key), 'versions')
}

function versionDir(key: string, versionId: string) {
  return join(versionsDir(key), sanitizeId(versionId))
}

function versionMetaPath(key: string, versionId: string) {
  return join(versionDir(key, versionId), 'version.json')
}

export function sanitizeId(id: string): string {
  // 允许中文字符、字母、数字、._-，其余替换为 _
  return id.replace(/[^\w\u4e00-\u9fa5.-]/g, '_').replace(/^_+|_+$/g, '') || 'item'
}

export function newProjectId(): string {
  return `proj-${randomUUID()}`
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, data: unknown) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

// ===== SQLite 存储适配（ProjectMeta/VersionMeta ↔ Stored*） =====

function projectToStored(p: ProjectMeta): StoredProject {
  return {
    key: p.key,
    name: p.name,
    description: p.description || '',
    owner: p.owner,
    currentVersion: p.currentVersion,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    status: p.status,
    statusVariant: p.statusVariant,
  }
}

function storedToProject(s: StoredProject): ProjectMeta {
  return {
    key: s.key,
    name: s.name,
    description: s.description,
    owner: s.owner as ProjectMeta['owner'],
    currentVersion: s.currentVersion,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    status: s.status,
    statusVariant: s.statusVariant || '',
  } as ProjectMeta
}

function versionToStored(projectKey: string, v: VersionMeta): StoredVersion {
  return {
    projectKey,
    id: v.id,
    version: v.version,
    changelog: v.changelog || '',
    status: v.status,
    statusVariant: v.statusVariant,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    steps: v.steps || [],
    running: !!v.running,
    latest: !!v.latest,
    stepTimes: v.stepTimes,
    on_policy_id: v.on_policy_id,
    on_policy_canonical: v.on_policy_canonical,
    onto_rule_count: v.onto_rule_count,
    onto_region_count: v.onto_region_count,
    onto_regions: v.onto_regions,
    onto_built_at: v.onto_built_at,
    onto_clone: v.onto_clone,
  }
}

function storedToVersion(s: StoredVersion): VersionMeta {
  return {
    id: s.id,
    version: s.version,
    changelog: s.changelog,
    status: s.status,
    statusVariant: s.statusVariant,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    steps: s.steps,
    running: s.running,
    latest: s.latest,
    stepTimes: s.stepTimes,
    on_policy_id: s.on_policy_id,
    on_policy_canonical: s.on_policy_canonical,
    onto_rule_count: s.onto_rule_count,
    onto_region_count: s.onto_region_count,
    onto_regions: s.onto_regions,
    onto_built_at: s.onto_built_at,
    onto_clone: s.onto_clone,
  }
}

/** 读取项目元数据（SQLite 优先，回退 JSON 文件兼容） */
function loadProjectMeta(key: string): ProjectMeta | null {
  const stored = getProjectMeta(key)
  if (stored) return storedToProject(stored)
  return readJson<ProjectMeta | null>(projectMetaPath(key), null)
}

/** 保存项目元数据（写 SQLite） */
function persistProjectMeta(p: ProjectMeta): void {
  saveProjectMeta(projectToStored(p))
  // 保留 JSON 镜像，兼容仍按工作区文件读取项目信息的接口（如规则引擎读取 policyId）。
  writeJson(projectMetaPath(p.key), p)
}

/** 读取版本元数据 */
function loadVersionMeta(key: string, versionId: string): VersionMeta | null {
  const stored = getVersionMeta(key, sanitizeId(versionId))
  if (stored) return storedToVersion(stored)
  return readJson<VersionMeta | null>(versionMetaPath(key, versionId), null)
}

/** 保存版本元数据（写 SQLite） */
function persistVersionMeta(key: string, v: VersionMeta): void {
  saveVersionMeta(versionToStored(key, v))
  // 保留 JSON 镜像，兼容 server.ts 等仍按工作区文件读取版本信息的接口。
  // 重要：必须先读原 JSON 合并扩展字段（如 step2_judge_history / step2_progress），
  // 否则会清空 judge-history 等独立写入的扩展数据。
  const path = versionMetaPath(key, v.id)
  let extra: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const prev = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
      for (const k of Object.keys(prev)) {
        if (k === 'id' || k === 'version' || k === 'changelog' || k === 'status' || k === 'statusVariant' ||
            k === 'createdAt' || k === 'updatedAt' || k === 'steps' || k === 'running' || k === 'latest' ||
            k === 'stepTimes' || k === 'on_policy_id' || k === 'on_policy_canonical' ||
            k === 'onto_rule_count' || k === 'onto_region_count' || k === 'onto_regions' ||
            k === 'onto_built_at' || k === 'onto_clone') continue
        extra[k] = prev[k]
      }
    } catch {
      // 解析失败则忽略扩展字段
    }
  }
  writeJson(path, { ...extra, ...v })
}

/**
 * 回写版本的 onto policy 引用（on_policy_id / on_policy_canonical）。
 * 供 createProject/createVersion 的 fire-and-forget 回调与 onto/build 兜底共用：
 * 先读当前 meta 再合并，避免覆盖异步期间更新的 steps 等字段。
 */
export function setVersionOntoPolicy(projectKey: string, versionId: string, ref: OntoPolicyRef): void {
  const cur = listVersionMetas(projectKey).find((v) => v.id === versionId || v.version === versionId)
  if (!cur) return
  persistVersionMeta(projectKey, {
    ...cur,
    on_policy_id: ref.policy_id,
    on_policy_canonical: ref.canonical_name,
  })
}

/**
 * 建模成功后拉取平台地域统计并写入 DB（onto_rule_count / onto_regions / onto_built_at）。
 * 供 step2-build 合并完成与 finalize 路由调用；失败仅记日志，不影响主流程。
 */
export async function recordVersionOntoModeling(projectKey: string, versionId: string): Promise<void> {
  const cur = listVersionMetas(projectKey).find((v) => v.id === versionId || v.version === versionId)
  if (!cur?.on_policy_id) return
  try {
    const { proxyOnto } = await import('./onto-platform.js')
    const resp = (await proxyOnto('GET', `/api/policies/${cur.on_policy_id}/regions`)) as {
      regions?: Array<{ region_id?: string; display_name?: string; rule_count?: number }>
    } | null
    const regions: OntoRegionSummary[] = (resp?.regions ?? []).map((r) => ({
      region_id: String(r.region_id ?? ''),
      display_name: String(r.display_name ?? ''),
      rule_count: Number(r.rule_count ?? 0),
    }))
    const latest = listVersionMetas(projectKey).find((v) => v.id === versionId || v.version === versionId)
    if (!latest) return
    persistVersionMeta(projectKey, {
      ...latest,
      onto_rule_count: regions.reduce((s, r) => s + r.rule_count, 0),
      onto_region_count: regions.length,
      onto_regions: regions,
      onto_built_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error(`[recordVersionOntoModeling] ${projectKey}/${versionId}:`, (e as Error).message)
  }
}

/** 回写版本的克隆来源记录（pending/done/failed 三态，fallback 重放依据） */
export function setVersionOntoClone(projectKey: string, versionId: string, clone: OntoCloneRecord): void {
  const cur = listVersionMetas(projectKey).find((v) => v.id === versionId || v.version === versionId)
  if (!cur) return
  persistVersionMeta(projectKey, { ...cur, onto_clone: clone })
}

/** 克隆源解析结果 */
export interface CloneSourceRef {
  sourceProjectKey: string
  sourceVersionId: string
  source_policy_id: string
  source_canonical: string
}

/** 解析克隆源版本的 onto policy 引用；源未建模（无 policy）返回 null */
export function resolveCloneSource(projectKey: string, versionId: string): CloneSourceRef | null {
  const v = listVersionMetas(projectKey).find((x) => x.id === sanitizeId(versionId) || x.version === versionId)
  if (!v?.on_policy_id) return null
  return {
    sourceProjectKey: projectKey,
    sourceVersionId: v.id,
    source_policy_id: v.on_policy_id,
    source_canonical: v.on_policy_canonical ?? '',
  }
}

/**
 * 执行克隆创建：GET 源 hash → POST policy_snapshot（失败重拉 hash 重试一次）。
 * 三态写 onto_clone；成功同时回写 on_policy_id。
 * intent 由调用方提供（createVersion 直接传入；fallback 重放从 meta 读取）。
 */
export async function runCloneOntoPolicy(
  projectKey: string,
  versionId: string,
  canonicalName: string,
  description: string,
  intent: OntoCloneRecord,
): Promise<void> {
  const base: OntoCloneRecord = { ...intent, source_version: null }
  try {
    const attempt = async () => {
      const { hash } = await getInitializationSource(intent.source_policy_id)
      return ensureOntoPolicy(canonicalName, description, {
        type: 'policy_snapshot',
        source_policy_id: intent.source_policy_id,
        source_version: null,
        source_hash: hash,
        rule_selection: { mode: 'all', include_dependencies: true },
      })
    }
    let ref: OntoPolicyRef
    try {
      ref = await attempt()
    } catch (e) {
      // 仅平台 4xx（如 source_hash 并发校验失败）值得重拉 hash 重试一次；
      // 超时/连接失败等平台不可用场景重试只会让用户的等待翻倍
      const retriable = e instanceof OntoRequestError && e.status >= 400 && e.status < 500
      if (!retriable) throw e
      ref = await attempt()
    }
    setVersionOntoPolicy(projectKey, versionId, ref)
    setVersionOntoClone(projectKey, versionId, {
      ...base,
      status: 'done',
      cloned_at: new Date().toISOString(),
      seeded: ref.seeded,
    })
    // 克隆成功的版本模型已就绪：写入 review 进度（仅当从未建模），
    // 前端 watch 到 phase=review 会自动展开本体预览——克隆版本进流水线直达预览
    seedStep2ReviewForClonedVersion(projectKey, versionId)
    // 拉平台地域统计入库（clone-sources 展示）；失败仅记日志
    void recordVersionOntoModeling(projectKey, versionId).catch(() => {})
  } catch (e) {
    setVersionOntoClone(projectKey, versionId, {
      ...base,
      status: 'failed',
      error: (e as Error).message,
    })
    throw e
  }
}

/** 克隆成功后的进度播种：从未跑过自动建模（phase 缺失/idle）时写入 review */
function seedStep2ReviewForClonedVersion(projectKey: string, versionId: string): void {
  const existing = readStep2Progress(projectKey, versionId)
  if (existing && existing.phase !== 'idle') return
  const now = new Date().toISOString()
  writeStep2Progress(projectKey, versionId, {
    phase: 'review',
    total_files: 0,
    processed: 0,
    started_at: now,
    finished_at: now,
    data_source_root: 'data',
  })
}

/**
 * 存量回填：老版本的建模产出只在 ontology.json 文件里，启动时扫一遍灌进 DB 新列。
 * 仅处理 on_policy_id 存在且 onto_rule_count 未回填的版本；老 ontology.json 的
 * regions 是字符串数组（无 region_id/单地域规则数），摘要以展示名兜底。
 */
export function backfillOntoModelingMeta(): void {
  let filled = 0
  for (const p of listAllProjects()) {
    for (const v of listVersionMetas(p.key)) {
      if (!v.on_policy_id || v.onto_rule_count != null) continue
      const ontologyPath = join(versionDir(p.key, v.id), 'ontology.json')
      if (!existsSync(ontologyPath)) continue
      try {
        const meta = JSON.parse(readFileSync(ontologyPath, 'utf-8')) as {
          rule_count?: number
          regions?: string[]
          finished_at?: string
        }
        const names = Array.isArray(meta.regions) ? meta.regions : []
        persistVersionMeta(p.key, {
          ...v,
          onto_rule_count: Number(meta.rule_count ?? 0),
          onto_region_count: names.length,
          onto_regions: names.map((n) => ({ region_id: '', display_name: String(n), rule_count: 0 })),
          onto_built_at: meta.finished_at || v.updatedAt,
        })
        filled++
      } catch { /* 单版本失败跳过 */ }
    }
  }
  if (filled > 0) console.log(`[project-store] backfilled onto modeling meta for ${filled} versions`)
}

function loadManifest(): WorkspaceManifest {
  ensureWorkspacesRoot()
  ensureDataspacesRoot()
  const path = manifestPath()
  if (existsSync(path)) {
    const raw = readJson<WorkspaceManifest>(path, emptyManifest())
    if (Array.isArray(raw.projects)) {
      // 兜底 dataspaces 段（旧 manifest 没有此字段）
      if (!Array.isArray(raw.dataspaces)) raw.dataspaces = []
      // 兜底 dataspaces 段中项目绑定 / 已发布版本字段
      for (const d of raw.dataspaces) {
        if (!Array.isArray(d.publishedVersions)) d.publishedVersions = []
      }
      // 兜底 projects 段中 dataSpaceIds
      for (const p of raw.projects) {
        if (!Array.isArray(p.dataSpaceIds)) p.dataSpaceIds = []
      }
      return raw
    }
  }
  // 兼容旧 registry.json（仅 key 列表）→ 迁移为 manifest
  const legacy = readJson<string[]>(legacyRegistryPath(), [])
  if (legacy.length) {
    const projects: ManifestEntry[] = legacy.map((id) => {
      const meta = readJson<ProjectMeta | null>(projectMetaPath(id), null)
      return { name: meta?.name || id, id }
    })
    const manifest = { projects, dataspaces: [] }
    saveManifest(manifest)
    try {
      rmSync(legacyRegistryPath(), { force: true })
    } catch {
      /* ignore */
    }
    return manifest
  }
  return emptyManifest()
}

function saveManifest(manifest: WorkspaceManifest) {
  ensureWorkspacesRoot()
  writeJson(manifestPath(), manifest)
}

function appendManifestEntry(name: string, id: string) {
  const manifest = loadManifest()
  manifest.projects.push({ name, id })
  saveManifest(manifest)
}

function initVersionWorkspace(key: string, versionId: string) {
  const root = versionDir(key, versionId)
  mkdirSync(join(root, 'data'), { recursive: true })
  mkdirSync(join(root, 'skills'), { recursive: true })
  // 不再自动生成 cleaned.md；Step1 清洗产物由流水线写入 data/
  // 若 config.json 配置了 step2.default_data_root 且目录存在，
  // 把数据源目录拷贝到版本工作区的 data/ 下，作为 Step 2 自动建模的输入
  seedVersionDataFromConfig(root)
}

/**
 * 从 config.step2.default_data_root 把数据源拷贝到版本工作区的 data/ 目录。
 * 完整拷贝数据源目录（主动扫描建模时仍由 scanDataDir 忽略 INDEX.md / index.md）。
 * 拷贝失败（源不存在/无权限）仅记日志，不影响版本创建。
 */
function seedVersionDataFromConfig(versionRoot: string) {
  let cfg: Step2Config | null = null
  try {
    cfg = loadStep2Config()
  } catch {
    return
  }
  const root = cfg?.default_data_root
  if (!root || !existsSync(root)) {
    console.log(`[seedData] default_data_root 未配置或不存在: ${root}`)
    return
  }
  const target = join(versionRoot, 'data')
  // 清空旧的 data/（防止残留上个版本的产物）；保留 data/ 已存在的 skill 输出
  try {
    const entries = readdirSync(target, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.isDirectory()) {
        rmSync(join(target, ent.name), { recursive: true, force: true })
      } else {
        rmSync(join(target, ent.name), { force: true })
      }
    }
  } catch (e) {
    console.warn(`[seedData] 清空 ${target} 失败:`, (e as Error).message)
  }
  console.log(`[seedData] 拷贝数据源 ${root} -> ${target}`)
  let copied = 0
  try {
    walkCopy(root, target, () => true, (copiedCount) => { copied = copiedCount })
    console.log(`[seedData] 拷贝完成: ${copied} 个文件`)
  } catch (e) {
    console.error(`[seedData] 拷贝失败:`, (e as Error).message)
  }
}

function walkCopy(
  src: string,
  dst: string,
  filter: (name: string) => boolean,
  onFile: (n: number) => void,
) {
  let n = 0
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, ent.name)
    const dstPath = join(dst, ent.name)
    if (ent.isDirectory()) {
      mkdirSync(dstPath, { recursive: true })
      walkCopy(srcPath, dstPath, filter, () => {})
    } else if (ent.isFile()) {
      if (!filter(ent.name)) continue
      mkdirSync(dirname(dstPath), { recursive: true })
      copyFileSync(srcPath, dstPath)
      n++
    }
  }
  onFile(n)
}

export function resolveVersionCwd(projectId: string, versionId?: string): string {
  const key = sanitizeId(projectId)
  const meta = loadProjectMeta(key)
  const ver = sanitizeId(versionId || meta?.currentVersion || 'v1.0.0')
  const cwd = versionDir(key, ver)
  if (existsSync(cwd)) return cwd
  // legacy flat workspace
  const legacy = projectCwd(key)
  if (existsSync(join(legacy, 'data')) || existsSync(join(legacy, 'skills'))) return legacy
  return cwd
}

export function clearAllProjects(): void {
  ensureWorkspacesRoot()
  for (const ent of readdirSync(WORKSPACES_DIR, { withFileTypes: true })) {
    if (ent.name === 'manifest.json') continue
    rmSync(join(WORKSPACES_DIR, ent.name), { recursive: true, force: true })
  }
  // 清掉旧 registry（若仍存在）
  try {
    rmSync(legacyRegistryPath(), { force: true })
  } catch {
    /* ignore */
  }
  saveManifest(emptyManifest())
}

/**
 * 永久删除单个项目：
 * 1. 校验项目存在（不存在则抛错，任何删除动作前中止）
 * 2. 通过 deleteProjectMeta 清理 SQLite 的 projects/versions/reviews 记录
 * 3. 递归删除项目工作目录
 * 4. 从 manifest.json 移除对应条目
 *
 * 存在运行中的版本时不阻止删除（Bridge-only 语义）。
 */
export function deleteProject(projectKey: string): { projectId: string; deleted: true } {
  const key = sanitizeId(projectKey)
  const project = getProject(key)

  deleteProjectMeta(key)
  rmSync(projectCwd(key), { recursive: true, force: true })

  const manifest = loadManifest()
  manifest.projects = manifest.projects.filter((entry) => entry.id !== key)
  saveManifest(manifest)

  return { projectId: project.key, deleted: true }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}

function listVersionMetas(key: string): VersionMeta[] {
  const stored = listVersions(key)
  if (stored.length) return stored.map(storedToVersion)
  // 回退：SQLite 无数据时读旧 JSON 文件（兼容未迁移场景）
  const dir = versionsDir(key)
  if (!existsSync(dir)) return []
  const list: VersionMeta[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const meta = readJson<VersionMeta | null>(versionMetaPath(key, ent.name), null)
    if (meta) list.push(meta)
  }
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return list
}

function resolveProjectListItem(p: ProjectMeta) {
  const versions = listVersionMetas(p.key)
  const runningVer = versions.find((v) => v.running)
  const latestVer =
    versions.find((v) => v.latest) ||
    versions.find((v) => v.version === p.currentVersion) ||
    versions[0]

  // 当前版本：有运行中服务的版本优先，否则最新版本
  const version = runningVer?.version || latestVer?.version || p.currentVersion

  // 状态：仅当没有任何版本服务在运行时可为「未启动」；有运行中则展示运行态
  let status: string
  let statusVariant: string
  if (runningVer) {
    status = runningVer.status && runningVer.status !== '未启动' ? runningVer.status : '运行中'
    statusVariant = runningVer.statusVariant || 'info'
    if (status === '运行中') statusVariant = 'info'
  } else if (latestVer) {
    status = latestVer.status || p.status
    statusVariant = latestVer.statusVariant || p.statusVariant
  } else {
    status = '未启动'
    statusVariant = 'neutral'
  }

  const rowClass =
    runningVer || status === '构建中' || status === '运行中'
      ? 'row-running'
      : status === '已驳回' || status === '失败'
        ? 'row-rejected'
        : status === '未启动'
          ? 'row-pending'
          : ''

  return {
    key: p.key,
    name: p.name,
    version,
    status,
    statusVariant,
    owner: p.owner,
    time: relativeTime(p.updatedAt),
    rowClass,
    hasRunning: Boolean(runningVer),
  }
}

export function listProjectsForUi() {
  // 项目列表：SQLite 为主源；若无数据回退 manifest
  const dbProjects = listAllProjects()
  const projectKeys: { id: string }[] = dbProjects.length
    ? dbProjects.map((p) => ({ id: p.key }))
    : loadManifest().projects
  const list = projectKeys
    .map((entry) => {
      const p = loadProjectMeta(entry.id)
      if (!p) return null
      return resolveProjectListItem(p)
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  const total = list.length
  const building = list.filter((p) => p!.status === '构建中' || p!.status === '运行中' || p!.hasRunning).length
  return {
    kpis: [
      {
        icon: 'folder',
        color: 'blue',
        label: '项目总数',
        value: String(total),
        delta: total ? '本地工作区' : '暂无项目',
        trend: 'flat',
      },
      {
        icon: 'check',
        color: 'green',
        label: '构建中',
        value: String(building),
        delta: total ? `${Math.round((building / total) * 100)}% 占比` : '—',
        trend: 'flat',
      },
      {
        icon: 'alert',
        color: 'amber',
        label: '本月发布',
        value: String(list.filter((p) => p!.status === '已发布').length),
        delta: '—',
        trend: 'flat',
      },
      {
        icon: 'x',
        color: 'red',
        label: '本周异常',
        value: '0',
        delta: '—',
        trend: 'flat',
      },
    ],
    list: list.map(({ hasRunning: _h, ...rest }) => rest),
    total,
  }
}

export async function createProject(input: {
  name: string
  description?: string
  /** 真实登录用户名（推荐）；未传时回退到 ownerName（仅在匹配真实注册用户名时生效） */
  ownerUsername?: string
  /**
   * 兼容字段：历史上前端可能直接传中文姓名。保持接口可用，
   * 但只在能解析到注册用户时生效；否则抛错。
   */
  ownerName?: string
  key?: string
  initialVersion?: string
  /** 规则引擎的 policy_id，工具运行时从 project.json 读取 */
  policyId?: string
}): Promise<ProjectMeta> {
  ensureWorkspacesRoot()
  const name = input.name.trim()
  if (!name) throw new Error('项目名称必填')

  // 目录名用 proj-<UUID>（ASCII，避免中文 URL 编码问题），传 key 时原样使用
  let key = input.key?.trim()
  if (key) {
    key = sanitizeId(key.startsWith('proj-') ? key : `proj-${key}`)
  } else {
    key = newProjectId()
  }
  while (existsSync(projectMetaPath(key)) || loadManifest().projects.some((p) => p.id === key)) {
    key = newProjectId()
  }

  // 负责人必须指向真实注册用户；调用方应通过 ownerUsername 传入当前登录用户名。
  // 为兼容历史用法，ownerName 仅作为"恰好等于某用户名"的兜底。
  const ownerUsername = (input.ownerUsername ?? input.ownerName ?? '').trim()
  const user = ownerUsername ? findUser(ownerUsername) : undefined
  if (!user) {
    throw new Error(`owner 用户不存在: ${ownerUsername || '(空)'}`)
  }
  const owner: ProjectOwner = {
    initials: pickInitials(user.name),
    name: user.name,
    color: pickColor(user.username),
  }
  const now = new Date().toISOString()
  const version = input.initialVersion?.trim() || 'v1.0.0'
  const versionId = sanitizeId(version)

  mkdirSync(projectCwd(key), { recursive: true })
  initVersionWorkspace(key, versionId)

  const versionMeta: VersionMeta = {
    id: versionId,
    version,
    changelog: '初始版本',
    status: '构建中',
    statusVariant: 'info',
    createdAt: now,
    updatedAt: now,
    steps: ['running', 'empty', 'empty', 'empty'],
    stepTimes: [{ startedAt: now }, {}, {}, {}],
    running: true,
    latest: true,
  }

  // fire-and-forget：onto 平台挂死/慢调用不阻塞项目创建；
  // 完成后异步回写 policy_id（含 version.json 镜像），失败仅记日志
  void ensureOntoPolicy(`${name} ${version}`, `项目 ${name} 的初始版本`)
    .then((onto) => setVersionOntoPolicy(key, versionMeta.id, onto))
    .catch((e) => console.error(`[createProject] ensureOntoPolicy failed:`, (e as Error).message))

  persistVersionMeta(key, versionMeta)

  const project: ProjectMeta = {
    key,
    name,
    description: input.description?.trim() || '',
    owner,
    currentVersion: version,
    createdAt: now,
    updatedAt: now,
    status: '构建中',
    statusVariant: 'info',
    policyId: input.policyId?.trim() || undefined,
  }
  persistProjectMeta(project)
  appendManifestEntry(name, key)
  return project
}

export function getProject(key: string): ProjectMeta {
  const p = loadProjectMeta(sanitizeId(key))
  if (!p) throw new Error(`项目不存在: ${key}`)
  return p
}

const SPACE_COLORS = ['primary', 'green', 'orange', 'purple', 'gray'] as const

function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    // 只统计业务文件：.md（数据）+ .json（仅 dataspace.json 等元数据文件，但 _crawler_import.json 是导入索引、不算）
    const abs = join(dir, ent.name)
    if (ent.isDirectory()) n += countFilesRecursive(abs)
    else if (ent.isFile()) {
      // 排除下划线开头的元数据 / 索引文件
      if (ent.name.startsWith('_')) continue
      // 排除 index.md / INDEX.md / log.md（爬虫生成的目录索引，不是业务数据）
      if (ent.name.toLowerCase() === 'index.md' || ent.name === 'log.md') continue
      // 只算 .md
      if (!ent.name.endsWith('.md')) continue
      n += 1
    }
  }
  return n
}

/**
 * 统计项目版本工作区 data/ 目录的业务 MD 文件数
 */
function countVersionFiles(cwd: string): number {
  return countFilesRecursive(join(cwd, 'data'))
}

/**
 * 累加数据空间的缓存文件数（审批归档时调用）。
 * 在版本归档到数据空间后，把该版本 data/ 目录的文件数加到对应数据空间的 fileCount 缓存字段，
 * 避免 listDataSpacesForUi 每次请求都全量遍历目录树。
 */
function bumpDataSpaceFileCount(dataSpaceId: string, delta: number): void {
  const manifest = loadManifest()
  const entry = manifest.dataspaces.find((d) => d.id === dataSpaceId)
  if (!entry) return
  entry.fileCount = (entry.fileCount || 0) + delta
  const idx = manifest.dataspaces.findIndex((d) => d.id === dataSpaceId)
  if (idx >= 0) manifest.dataspaces[idx] = entry
  saveManifest(manifest)
}

/** 最新版本：latest 标记优先，否则 currentVersion，再否则按创建时间最新 */
function getLatestVersionMeta(p: ProjectMeta): VersionMeta | null {
  const versions = listVersionMetas(p.key)
  if (!versions.length) return null
  return (
    versions.find((v) => v.latest) ||
    versions.find((v) => v.version === p.currentVersion) ||
    versions[0]
  )
}

/** 数据空间列表：遍历 manifest.dataspaces 段（独立于项目） */
export function listDataSpacesForUi() {
  const manifest = loadManifest()
  const list = manifest.dataspaces.map((d, index) => {
    const cwd = dataSpaceCwd(d.id)
    // 优先读缓存（审批归档时写入），无缓存时回退实时遍历（兼容历史数据）
    const fileCount = d.fileCount ?? countFilesRecursive(join(cwd, 'data'))
    const meta = readDataSpaceMeta(cwd)
    const isProject = !!d.projectKey
    const versions = (d.publishedVersions && d.publishedVersions.length) ? d.publishedVersions : []
    const verCount = versions.length
    // 读取 publish.json 获取同步状态
    let syncedVersionCount = 0
    try {
      const pf = readPublishFileForSpace(d.id)
      for (const v of versions) {
        if (pf.versions[v]?.remoteSync?.status === 'success') syncedVersionCount++
      }
    } catch { /* ignore */ }
    // 项目型数据空间：负责人与来源项目保持一致
    let owner: { initials: string; name: string; color: string } = { initials: 'DS', name: 'data-space', color: '#1B5BD9' }
    if (isProject && d.projectKey) {
      try {
        const p = getProject(d.projectKey)
        if (p.owner) owner = p.owner
      } catch {
        /* 项目可能已删除，回退默认 owner */
      }
    }
    return {
      id: d.id,
      color: SPACE_COLORS[index % SPACE_COLORS.length],
      title: d.name,
      key: d.id,
      // status 仅供筛选统计，卡片不展示
      status: syncedVersionCount > 0 ? '已同步' : (verCount > 0 ? '未同步' : '无版本'),
      statusVariant: syncedVersionCount > 0 ? 'success' as const : (verCount > 0 ? 'warning' as const : 'neutral' as const),
      desc: isProject
        ? `项目「${d.projectName || d.name}」已发布归档 · ${verCount} 个版本`
        : (d.description || '独立数据空间 · 与项目解耦'),
      meta: isProject
        ? [
            { label: '文件', value: String(fileCount) },
            { label: '版本', value: String(verCount) },
            { label: '已同步', value: String(syncedVersionCount) },
          ]
        : [
            { label: '文件', value: String(fileCount) },
            { label: '类型', value: '独立数据空间' },
            { label: 'ID', value: d.id.slice(0, 14) + '…' },
          ],
      owner,
      updated: relativeTime(d.updatedAt),
      publishedVersions: versions,
      syncedVersionCount,
      fileCount,
    }
  })

  const total = list.length
  const totalVersions = list.reduce((s, d) => s + (d.publishedVersions?.length || 0), 0)
  const totalSynced = list.reduce((s, d) => s + (d.syncedVersionCount || 0), 0)

  // 文件总数：所有数据空间的缓存 fileCount 之和（审批归档时累加写入）
  const totalFiles = list.reduce((sum, d) => sum + (d.fileCount || 0), 0)
  const byStatus = (label: string) => list.filter((s) => s.status === label).length

  return {
    stats: [
      {
        label: '空间总数',
        value: String(total),
        color: '#1B5BD9',
        foot: total ? `${totalVersions} 个已发布版本` : '暂无数据空间',
        footColor: '#1B8F4B'
      },
      {
        label: '已发布版本',
        value: String(totalVersions),
        color: '#7E22CE',
        foot: totalVersions ? `分布在 ${total} 个空间` : '审批通过后自动归档',
      },
      {
        label: '已同步版本',
        value: String(totalSynced),
        color: '#1B8F4B',
        foot: totalVersions ? `占版本总数 ${Math.round((totalSynced / totalVersions) * 100)}%` : '—',
        footColor: '#1B8F4B'
      },
      {
        label: '文件总数',
        value: String(totalFiles),
        color: '#C77B16',
        foot: '所有空间 data/ 目录',
      }
    ],
    filters: [
      { label: '全部', count: total },
      { label: '已同步', count: byStatus('已同步') },
      { label: '未同步', count: byStatus('未同步') },
    ],
    list,
    total
  }
}

/** 数据空间详情头：ds-XXX 独立实体；版本不存在（独立于项目版本） */
export function getDataSpaceForUi(spaceKey: string) {
  const entry = getDataSpace(spaceKey)
  if (!entry) {
    // 后向兼容：旧用法可能传 proj-XXX，按老逻辑走一遍
    if (spaceKey.startsWith('proj-')) {
      const p = getProject(spaceKey)
      const latest = getLatestVersionMeta(p)
      const latestVersion = latest?.version || p.currentVersion
      const versions = listVersionMetas(p.key)
      const cwd = resolveVersionCwd(p.key, latestVersion)
      const fileCount = countVersionFiles(cwd)
      return {
        id: p.key,
        title: p.name,
        key: p.key,
        status: '',
        statusVariant: 'neutral',
        type: '项目数据集（兼容）',
        version: latestVersion,
        owner: p.owner,
        referenced: `${versions.length} 个版本`,
        created: p.createdAt.slice(0, 10),
        updated: relativeTime(latest?.updatedAt || p.updatedAt),
        description: p.description || '',
        dataDir: 'data/',
        fileCount
      }
    }
    throw new Error('数据空间不存在')
  }
  const cwd = dataSpaceCwd(entry.id)
  // 优先读缓存（审批归档时写入），无缓存时回退实时遍历（兼容历史数据）
  const fileCount = entry.fileCount ?? countFilesRecursive(join(cwd, 'data'))
  const isProject = !!entry.projectKey
  const verCount = (entry.publishedVersions && entry.publishedVersions.length) || 0
  // 项目型数据空间：负责人与来源项目保持一致
  let owner: { initials: string; name: string; color: string } = { initials: 'DS', name: 'data-space', color: '#1B5BD9' }
  if (isProject && entry.projectKey) {
    try {
      const p = getProject(entry.projectKey)
      if (p.owner) owner = p.owner
    } catch {
      /* 项目可能已删除，回退默认 owner */
    }
  }
  return {
    id: entry.id,
    title: entry.name,
    key: entry.id,
    status: '',
    statusVariant: 'neutral',
    type: isProject ? '项目已发布归档' : '独立数据空间',
    version: isProject
      ? (verCount ? `${verCount} 个已发布版本` : '—')
      : '—',
    owner,
    referenced: isProject
      ? `来源项目 ${entry.projectKey}`
      : '独立于项目',
    projectKey: entry.projectKey,
    publishedVersions: entry.publishedVersions || [],
    created: entry.createdAt.slice(0, 10),
    updated: relativeTime(entry.updatedAt),
    description: entry.description || '',
    dataDir: 'data/',
    fileCount
  }
}

export function listVersionsForUi(projectKey: string) {
  const p = getProject(projectKey)
  const versions = listVersionMetas(p.key)
  return {
    project: {
      name: p.name,
      key: p.key,
      version: p.currentVersion,
      status: p.status,
      desc: p.description || '暂无描述',
      stats: [
        { label: '版本数', value: String(versions.length), sub: '本地' },
        { label: '当前版本', value: p.currentVersion, sub: p.status },
        { label: '负责人', value: p.owner.name, sub: '产品' },
        { label: '更新', value: relativeTime(p.updatedAt), sub: '' },
      ],
    },
    summary: `共 ${versions.length} 个版本`,
    list: versions.map((v) => ({
      v: v.version,
      latest: v.latest || v.version === p.currentVersion,
      steps: (v.steps || []).map((s) => (s === 'empty' ? 'pending' : s)),
      status: v.status,
      statusVariant: v.statusVariant,
      owner: p.owner,
      date: v.createdAt.slice(0, 10),
      updatedAt: v.updatedAt || v.createdAt,
      datasets: '—',
      running: v.running,
      clone: v.onto_clone ?? null,
    })),
    total: versions.length,
  }
}

export async function createVersion(
  projectKey: string,
  input: { version: string; changelog?: string; clone_from?: { sourceProjectKey: string; sourceVersionId: string } },
): Promise<VersionMeta> {
  const p = getProject(projectKey)
  const version = input.version.trim()
  if (!version) throw new Error('版本号必填')
  const versionId = sanitizeId(version)
  if (existsSync(versionMetaPath(p.key, versionId))) {
    throw new Error('版本已存在')
  }

  // 克隆初始化：先解析源版本（未建模则拒绝），登记 pending 意图供 fallback 重放
  let cloneIntent: OntoCloneRecord | undefined
  if (input.clone_from) {
    const src = resolveCloneSource(input.clone_from.sourceProjectKey, input.clone_from.sourceVersionId)
    if (!src) throw new Error('克隆源版本未建模（无 onto policy），无法作为初始化来源')
    cloneIntent = {
      source_policy_id: src.source_policy_id,
      source_canonical: src.source_canonical,
      source_project_key: src.sourceProjectKey,
      source_version_id: src.sourceVersionId,
      source_version: null,
      status: 'pending',
    }
  }

  const now = new Date().toISOString()
  initVersionWorkspace(p.key, versionId)

  // clear latest flags
  for (const v of listVersionMetas(p.key)) {
    if (v.latest) {
      persistVersionMeta(p.key, { ...v, latest: false })
    }
  }

  const meta: VersionMeta = {
    id: versionId,
    version,
    changelog: input.changelog?.trim() || '',
    status: '构建中',
    statusVariant: 'info',
    createdAt: now,
    updatedAt: now,
    steps: ['running', 'empty', 'empty', 'empty'],
    stepTimes: [{ startedAt: now }, {}, {}, {}],
    running: true,
    latest: true,
    ...(cloneIntent ? { onto_clone: cloneIntent } : {}),
  }
  persistVersionMeta(p.key, meta)

  // fire-and-forget：onto 平台挂死/慢调用不阻塞版本创建；
  // 完成后异步回写 policy_id（含 version.json 镜像），失败仅记日志
  if (cloneIntent) {
    void runCloneOntoPolicy(p.key, meta.id, `${p.name} ${version}`, input.changelog?.trim() || '', cloneIntent)
      .catch((e) => console.error(`[createVersion] clone onto policy failed:`, (e as Error).message))
  } else {
    void ensureOntoPolicy(
      `${p.name} ${version}`,
      input.changelog?.trim() || '',
    )
      .then((onto) => setVersionOntoPolicy(p.key, meta.id, onto))
      .catch((e) => console.error(`[createVersion] ensureOntoPolicy failed:`, (e as Error).message))
  }

  p.currentVersion = version
  p.updatedAt = now
  p.status = '构建中'
  p.statusVariant = 'info'
  persistProjectMeta(p)
  return meta
}

/** 删除指定版本（删除对应版本目录，至少保留一个，不能删运行中） */
export function deleteVersion(projectKey: string, versionId: string): void {
  const p = getProject(projectKey)
  if (!existsSync(versionMetaPath(p.key, versionId))) {
    throw new Error('版本不存在')
  }
  const all = listVersionMetas(p.key)
  if (all.length <= 1) {
    throw new Error('至少保留一个版本，无法删除最后一个')
  }
  const target = all.find((v) => v.id === versionId)
  if (!target) throw new Error('版本不存在')
  if (target.running) throw new Error('运行中的版本不能删除')

  const wasLatest = target.latest
  rmSync(versionDir(p.key, versionId), { recursive: true, force: true })
  if (wasLatest) {
    const remaining = listVersionMetas(p.key)
    if (remaining.length) {
      const next = remaining[0]
      const nextMeta = loadVersionMeta(p.key, next.id)
      if (nextMeta) {
        persistVersionMeta(p.key, { ...nextMeta, latest: true })
      }
    }
  }
}

type StepState = 'done' | 'running' | 'empty'

/**
 * 跨项目同步 skills 和 data（物理复制，目标项目获得完整能力后可独立修改）。
 *
 * @param fromKey  源项目 key（proj-xxx）
 * @param toKey    目标项目 key（proj-xxx）
 * @param opts     skillIds：要同步的 skill 目录名；dataPaths：要同步的 data 子路径
 * @returns        已同步的 skill 列表和 data 路径
 */
export function syncProjectToProject(
  fromKey: string,
  toKey: string,
  opts: { skillIds?: string[]; dataPaths?: string[] },
): { syncedSkills: string[]; syncedDataPaths: string[] } {
  const fromCwd = resolveVersionCwd(fromKey)
  const toCwd = resolveVersionCwd(toKey)
  if (fromCwd === toCwd) throw new Error('源项目和目标项目不能相同')

  const syncedSkills: string[] = []
  const syncedDataPaths: string[] = []

  // 同步 skills
  const skillIds = opts.skillIds ?? []
  for (const skillId of skillIds) {
    const src = join(fromCwd, 'skills', skillId)
    if (!existsSync(src)) {
      console.warn(`[sync] 源 skill 不存在: ${skillId}，跳过`)
      continue
    }
    const dest = join(toCwd, 'skills', skillId)
    // 目标已存在则先删除再覆盖（copyDirSync 替代 cpSync，兼容中文 skillId）
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    mkdirSync(join(dest, '..'), { recursive: true })
    copyDirSync(src, dest)
    syncedSkills.push(skillId)
  }

  // 同步 data
  const dataPaths = opts.dataPaths ?? []
  for (const dataPath of dataPaths) {
    const src = join(fromCwd, 'data', dataPath)
    if (!existsSync(src)) {
      console.warn(`[sync] 源 data 路径不存在: ${dataPath}，跳过`)
      continue
    }
    const dest = join(toCwd, 'data', dataPath)
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    mkdirSync(join(dest, '..'), { recursive: true })
    copyDirSync(src, dest)
    syncedDataPaths.push(dataPath)
  }

  return { syncedSkills, syncedDataPaths }
}

interface PipelineTemplate {
  project: Record<string, unknown>
  tracker: {
    title: string
    hint: string
    stats: string
    steps: { idx: number; state: string; name: string; status: string; hint: string }[]
  }
  panels: {
    num: number
    title: string
    statusVariant: string
    status: string
    time: string
    active?: boolean
    agent?: unknown
    sections: unknown[]
  }[]
}

const STEP_RUNNING_STATUS = ['构建中', '构建中', '构建中 · 智能体', '构建中']

function loadPipelineTemplate(): PipelineTemplate {
  const raw = readJson<PipelineTemplate | null>(PIPELINE_TEMPLATE_PATH, null)
  if (!raw) throw new Error('流水线模板缺失')
  return raw
}

function getGateIds(): string[] {
  const tpl = loadPipelineTemplate()
  const step4 = tpl.panels.find((p) => p.num === 4)
  if (!step4) return []
  const gatesSec = (step4.sections as Record<string, unknown>[]).find((s) => Array.isArray(s.gates))
  if (!Array.isArray(gatesSec?.gates)) return []
  return (gatesSec!.gates as Record<string, unknown>[]).map((g) => String(g.id)).filter(Boolean)
}

function getCurrentVersionMeta(p: ProjectMeta): VersionMeta {
  const versions = listVersionMetas(p.key)
  const current =
    versions.find((v) => v.version === p.currentVersion) ||
    versions.find((v) => v.latest) ||
    versions[0]
  if (!current) throw new Error('版本不存在')
  return current
}

/** 按 versionId 精确定位版本，未传则回退到当前版本 */
function resolveVersion(p: ProjectMeta, versionId?: string): VersionMeta {
  if (versionId) {
    const found = listVersionMetas(p.key).find((v) => v.id === versionId || v.version === versionId)
    if (found) return found
  }
  return getCurrentVersionMeta(p)
}

function normalizeStepStates(raw: string[] | undefined): StepState[] {
  const steps: StepState[] = [0, 1, 2, 3].map((i): StepState => {
    const s = raw?.[i] || 'empty'
    if (s === 'done' || s === 'running') return s
    return 'empty'
  })
  if (steps.every((s) => s === 'empty')) {
    return ['running', 'empty', 'empty', 'empty']
  }
  return steps
}

function uiState(s: StepState): 'done' | 'running' | 'pending' {
  return s === 'empty' ? 'pending' : s
}

function applyPipelineStatus(project: ProjectMeta, version: VersionMeta, steps: StepState[]) {
  const now = new Date().toISOString()
  const allDone = steps.every((s) => s === 'done')
  const runningIdx = steps.findIndex((s) => s === 'running')
  const progressStep = allDone ? steps.length : runningIdx >= 0 ? runningIdx + 1 : 1

  version.steps = steps
  version.updatedAt = now
  version.running = !allDone && runningIdx >= 0
  if (allDone) {
    version.status = '已完成'
    version.statusVariant = 'success'
    version.running = false
  } else {
    version.status = '构建中'
    version.statusVariant = 'info'
  }

  project.updatedAt = now
  project.status = version.status
  project.statusVariant = version.statusVariant
  persistVersionMeta(project.key, version)
  persistProjectMeta(project)

  return progressStep
}

/**
 * 获取 Step4 审批人：仅 reviewer 角色（审核人员）的活跃用户
 * 平台超管(admin)不参与审批，故不按权限点过滤，而按角色精确匹配。
 * 返回精简身份数据，UI 展示字段（initials/color/selected）由前端自行处理
 */
function getStep4Approvers() {
  return listUsers()
    .filter((u) => u.status === 'active')
    .filter((u) => u.role === 'reviewer')
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.role,
      roleName: findRole(u.role)?.name ?? u.role,
    }))
}

/** 计算流水线统计文案：已构建时长 + 完成进度 */
function buildTrackerStats(version: VersionMeta, steps: StepState[]): string {
  const doneCount = steps.filter((s) => s === 'done').length
  const total = steps.length
  const start = new Date(version.createdAt).getTime()
  const end = version.status === '已发布' || version.status === '已驳回'
    ? new Date(version.updatedAt).getTime()
    : Date.now()
  const diffMs = end - start
  if (!diffMs || diffMs < 0) return `已完成 ${doneCount}/${total} 步`
  const hours = Math.floor(diffMs / 3600000)
  const mins = Math.floor((diffMs % 3600000) / 60000)
  const elapsed = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return `已完成 ${doneCount}/${total} 步 · 构建 ${elapsed}`
}

/** 格式化单个步骤的时间区间文案：开始 → 结束 · 耗时 */
function buildStepTime(version: VersionMeta, stepIdx: number, stepState: StepState): string {
  const st = version.stepTimes?.[stepIdx]
  const startedAt = st?.startedAt
  // 已完成步骤用 finishedAt，进行中用当前时间，未开始无结束时间
  const finishedAt = stepState === 'done' ? st?.finishedAt : stepState === 'running' ? new Date().toISOString() : undefined
  if (!startedAt && !finishedAt) return ''

  const fmt = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const startStr = fmt(startedAt)
  const endStr = fmt(finishedAt)
  if (startedAt && finishedAt) {
    const diffMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)
    const elapsed = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
    return `${startStr} → ${endStr} · 耗时 ${elapsed}`
  }
  return startStr || endStr
}

	function buildPipelineData(project: ProjectMeta, version: VersionMeta, steps: StepState[], currentUser?: string) {
  const tpl = loadPipelineTemplate()
  const progressStep = steps.every((s) => s === 'done')
    ? steps.length
    : Math.max(1, steps.findIndex((s) => s === 'running') + 1)
  const allDone = steps.every((s) => s === 'done')

  const STEP_NAMES = ['数据采集', '本体构建', '智能体构建', '审核晋级']

  const trackerSteps = steps.map((s, i) => ({
    idx: i + 1,
    state: uiState(s),
    name: STEP_NAMES[i] || `Step ${i + 1}`,
    status: s === 'done' ? '已完成' : s === 'running' ? STEP_RUNNING_STATUS[i] || '构建中' : '待开始',
    hint: '',
  }))

  const panels = tpl.panels.map((panel, i) => {
    const s = steps[i] || 'empty'
    const status = s === 'done' ? '已完成' : s === 'running' ? '构建中' : '待开始'
    const statusVariant = s === 'done' ? 'success' : s === 'running' ? 'info' : 'neutral'
    const next: Record<string, unknown> = {
      ...panel,
      status,
      statusVariant,
      active: s === 'running',
      time: buildStepTime(version, i, s),
    }
    // Step4：动态注入审批人 + 审核进度
    if (panel.num === 4 && Array.isArray(panel.sections)) {
      const progress = getReviewProgress(project.key, version.version, currentUser)
      const sections = panel.sections.map((sec) => {
        const s = sec as Record<string, unknown>
        if (Array.isArray(s.approvers)) {
          return { ...s, approvers: getStep4Approvers() }
        }
        if (Array.isArray(s.gates) && progress) {
          const validIds = new Set((s.gates as Record<string, unknown>[]).map((g) => String(g.id)).filter(Boolean))
          const sanitize = (checks: unknown) => Array.isArray(checks) ? checks.filter((c): c is string => typeof c === 'string' && validIds.has(c)) : []
          const myChecks = sanitize(progress.decisions.find((d) => d.username === currentUser)?.gateChecks)
          const reviewerChecks = progress.assignedReviewers.map((r) => ({
            username: r.username,
            name: r.name,
            gateChecks: sanitize(progress.decisions.find((d) => d.username === r.username)?.gateChecks),
          }))
          return { ...s, gateChecksByMe: myChecks, gateChecksByReviewers: reviewerChecks }
        }
        return s
      })
      // 审核进度注入到 Step4 sections 末尾
      // 已驳回 → 无论步骤状态如何都视为 none，允许开发者重新提交
      // （正常流程驳回后 step4 会重置为 empty，但存在数据不一致的情况）
      const isRejected = progress?.status === 'rejected'
      const reviewStatus = isRejected ? 'none'
        : progress
          ? (progress.status === 'pending' ? 'in_review'
            : progress.status === 'approved' ? 'approved'
            : 'none')
          : 'none'
      next.reviewStatus = reviewStatus

      // 驳回后重新提交：注入上次的审批人信息，前端据此自动选择（所有人都需重新审核）
      if (isRejected && progress) {
        const lastReviewers = progress.assignedReviewers.map((r) => {
          const user = findUser(r.username)
          return { username: r.username, name: user?.name || r.username, role: user?.role || 'reviewer', roleName: findRole(user?.role || 'reviewer')?.name ?? '审核人员' }
        })
        next.rejectedReviewers = lastReviewers
      }

      if (progress) {
        sections.push({
		          title: '审核进度',
	          reviewProgress: {
	            status: progress.status,
	            assigned: progress.assigned,
	            approved: progress.approved,
	            rejected: progress.rejected,
	            myDecision: progress.myDecision ?? null,
	            submitComment: progress.submitComment || '',
	            submittedBy: progress.submittedBy || '',
	            decisions: progress.decisions.filter((d) => d.decidedAt !== '').map((d) => {
	              const user = findUser(d.username)
	              return {
	                name: user?.name || d.username,
	                decision: d.decision === 'approved' ? '通过' : '驳回',
	                comment: d.comment || '',
	                decidedAt: d.decidedAt,
	              }
	            }),
	            assignedReviewers: progress.assignedReviewers.map((r) => {
	              const user = findUser(r.username)
	              const myDecision = progress.decisions.find((d) => d.username === r.username && d.decidedAt !== '')
	              return {
	                name: user?.name || r.username,
	                username: r.username,
	                decision: myDecision
	                  ? (myDecision.decision === 'approved' ? '通过' : '驳回')
	                  : '待审核',
	              }
	            }),
	            historyDecisions: progress.historyDecisions.map((h) => ({
	              round: h.round,
	              submittedBy: h.submittedBy,
	              submitComment: h.submitComment,
	              status: h.status,
	              decisions: h.decisions.map((d) => {
	                const user = findUser(d.username)
	                return {
	                  name: user?.name || d.username,
	                  decision: d.decision === 'approved' ? '通过' : '驳回',
	                  comment: d.comment || '',
	                  decidedAt: d.decidedAt,
	                }
	              }),
	            })),
	          },
        })
      }
      next.sections = sections
    }
    return next
  })

  return {
    project: {
      name: `${project.name} ${version.version}`,
      key: project.key,
      version: version.version,
      versionId: version.id,
      type: '智能体构建',
      typeVariant: 'primary',
      created: project.createdAt.slice(0, 10),
      owner: project.owner.name,
      progress: STEP_NAMES[progressStep - 1] || `Step ${progressStep}`,
      progressStep,
      totalSteps: steps.length,
      // 优先用 version 实际存储的状态（已发布/已驳回/待审核），回退到步骤派生状态
      status: version.status || (allDone ? '已完成' : '构建中'),
      statusVariant: version.statusVariant || (allDone ? 'success' : 'info'),
    },
    tracker: {
      title: tpl.tracker.title || '构建进度',
      hint: tpl.tracker.hint || '点击步骤切换详情',
      stats: buildTrackerStats(version, steps),
      steps: trackerSteps,
    },
    panels,
  }
}

/** GET 流水线详情（状态取自当前版本 steps） */
export function getPipeline(projectKey: string, versionId?: string, currentUser?: string) {
  const project = getProject(projectKey)
  let version: VersionMeta
  if (versionId) {
    const found = listVersionMetas(project.key).find((v) => v.id === versionId || v.version === versionId)
    if (!found) throw new Error(`版本不存在：${versionId}`)
    version = found
  } else {
    version = getCurrentVersionMeta(project)
  }
  const steps = normalizeStepStates(version.steps)
  // 持久化：全 empty 时自动从 Step1 开始构建
  if (JSON.stringify(version.steps) !== JSON.stringify(steps)) {
    applyPipelineStatus(project, version, steps)
  }
  return buildPipelineData(project, version, steps, currentUser)
}

/**
 * 推进流水线：将 fromStep（1-based）标为已完成，下一步标为构建中。
 * 返回更新后的流水线数据与应跳转的 nextStep。
 */
export async function advancePipeline(projectKey: string, fromStep: number, versionId?: string) {
  const project = getProject(projectKey)
  let version: VersionMeta
  if (versionId) {
    const found = listVersionMetas(project.key).find((v) => v.id === versionId || v.version === versionId)
    if (!found) throw new Error(`版本不存在：${versionId}`)
    version = found
  } else {
    version = getCurrentVersionMeta(project)
  }
  const steps = normalizeStepStates(version.steps)
  const i = fromStep - 1
  if (i < 0 || i >= steps.length) throw new Error('无效 Step')

  // 自动测试（golden run）已在用户侧隐藏，advance 不再校验 review.run_status

  steps[i] = 'done'
  const now = new Date().toISOString()
  // 记录步骤时间戳：当前步完成时间、下一步开始时间
  const st = version.stepTimes ? version.stepTimes.map((t) => ({ ...t })) : []
  while (st.length < steps.length) st.push({})
  st[i] = { ...st[i], finishedAt: now }
  if (i + 1 < steps.length) {
    st[i + 1] = { ...st[i + 1], startedAt: now }
  }
  version.stepTimes = st

  let nextStep = fromStep
  if (i + 1 < steps.length) {
    steps[i + 1] = 'running'
    // 保证同时最多一个 running
    for (let j = 0; j < steps.length; j++) {
      if (j !== i + 1 && steps[j] === 'running') steps[j] = j < i + 1 ? 'done' : 'empty'
    }
    nextStep = fromStep + 1
  }

  applyPipelineStatus(project, version, steps)
  return { ...buildPipelineData(project, version, steps, undefined), nextStep }
}

// ===== 跨服务：从爬虫系统导入已通过政策到数据空间 =====

import { writeFileContent, ensureProjectWorkspace } from './workspace.js'
import { buildOkfMarkdown, computeOutputPath, type OkfPolicyFields } from './okf.js'
import * as okf from './okf/index.js'

import { getCrawlerConfig } from './config.js'

/**
 * 爬虫本地 EXPORT_DIR（同机部署时直接读文件，避免走 HTTP）
 * 默认值与 gov-subsidy-tool-linux/backend/app/config.py:28 EXPORT_DIR 一致
 * 可通过 config.json crawler.exportDir 覆盖
 */
function getCrawlerBase(): string {
  return getCrawlerConfig().baseUrl
}

function getCrawlerExportDir(): string {
  return getCrawlerConfig().exportDir
}

export interface ImportFromCrawlerOptions {
  verify_status?: 'qualified' | 'all' // 默认 verified
  one_thing_name?: string // 可选, 只导某个一件事
  region?: string // 可选, 只导某个地区
  overwrite?: boolean // 默认 false
  include_unexported?: boolean // 默认 false, 爬虫没导过 MD 的也导入（用 frontmatter 占位）
  policy_ids?: number[] // 可选, 按 ID 列表过滤（与 verify_status 互斥，优先用 policy_ids）
  // ===== 多空间版本（V1+）=====
  space_ids?: string[] // 多空间列表；不传则用第一个入参 (旧路由兼容)
  overwrite_per_space?: Record<string, boolean> // 按空间粒度覆盖；缺失时取 options.overwrite
}

export interface ImportFromCrawlerResult {
  total: number // 爬虫查到的政策数
  imported: number // 实际写入文件数
  skipped: number // 已存在跳过
  failed: number // 写入失败
  files: { path: string; policy_id: number; size: number }[]
  duration_ms: number
  index_path: string
}

/** 多空间导入：单空间结果 */
export interface PerSpaceImportResult extends ImportFromCrawlerResult {
  error?: string // 整空间失败时填 (例如空间不存在)；否则 undefined
}

/** 多空间导入：聚合结果 */
export interface MultiSpaceImportFromCrawlerResult {
  per_space: Record<string, PerSpaceImportResult>
  total: { imported: number; skipped: number; failed: number; duration_ms: number }
  success: boolean // 所有 per_space 都没有 error 且 failed === 0 时为 true
}

/** bridge 内部用：检查文件是否已存在（避免覆盖） */
function readFileContentForCheck(cwd: string, relPath: string): boolean {
  const full = join(cwd, relPath.replace(/\\/g, '/').replace(/^\/+/, ''))
  return existsSync(full)
}

/**
 * 从爬虫后端导入已通过政策到数据空间
 * 支持两种入参语义（按 id 前缀路由）：
 *   - spaceId 以 'ds-' 开头：写入 ~/.gs_platform/dataspaces/ds-XXX/data/（独立数据空间）
 *   - projectKey 以 'proj-' 开头：写入 ~/.gs_platform/workspace/proj-XXX/versions/vN/data/（兼容旧用法）
 * 流程：
 *   1. 调爬虫 /api/policies/?verify_status=verified 拿政策列表
 *   2. 调爬虫 /api/export/markdown-list 拿已导出的 MD 文件清单
 *   3. 优先复用爬虫已导出的 MD（policy.md_status === 'success'）
 *   4. 爬虫没导过的，用 buildOkfMarkdown() 生成 frontmatter 占位
 *   5. 落盘到 data/<one_thing>/<region>/...md
 *   6. 写 data/_crawler_import.json 索引
 */
export async function importFromCrawler(
  spaceIdOrProjectKey: string,
  options: ImportFromCrawlerOptions = {}
): Promise<ImportFromCrawlerResult> {
  const start = Date.now()
  const verifyStatus = options.verify_status || 'qualified'
  const overwrite = options.overwrite || false
  const includeUnexported = options.include_unexported ?? false

  // 1. 按 id 前缀分流：ds- 走独立数据空间，proj- 走老路径（兼容）
  const isDataSpace = spaceIdOrProjectKey.startsWith('ds-')
  let ownerCwd: string
  if (isDataSpace) {
    // 校验数据空间存在
    const entry = getDataSpace(spaceIdOrProjectKey)
    if (!entry) throw new Error(`数据空间不存在: ${spaceIdOrProjectKey}`)
    ownerCwd = ensureDataSpaceWorkspace(spaceIdOrProjectKey)
  } else {
    // 兼容：老项目路径
    const project = getProject(spaceIdOrProjectKey)
    const version = getCurrentVersionMeta(project)
    ownerCwd = ensureProjectWorkspace(spaceIdOrProjectKey, version.version)
  }

  // 2. 调爬虫拉政策列表
  const policies = await fetchCrawlerPolicies({
    verify_status: verifyStatus === 'all' ? undefined : 'qualified',
    one_thing_name: options.one_thing_name,
    region: options.region
  })

  // 3. 调爬虫拉已导出 MD 列表（用于复用已生成的 MD 文件）
  const exportedByPolicy = new Map<number, string>() // policy_id → md 文本
  if (!includeUnexported) {
    const exportedFiles = await fetchCrawlerExportedFiles()
    for (const f of exportedFiles) {
      const md = await fetchCrawlerMarkdown(f.batch, f.subdir, f.filename)
      if (md) {
        const m = md.match(/^policy_id:\s*(\d+)/m)
        if (m) exportedByPolicy.set(Number(m[1]), md)
      }
    }
  }

  // 4. 逐条政策处理（按 policy_ids 过滤）
  let imported = 0
  let skipped = 0
  let failed = 0
  const files: ImportFromCrawlerResult['files'] = []
  const idFilter = options.policy_ids && options.policy_ids.length > 0
    ? new Set(options.policy_ids)
    : null

  for (const rawPolicy of policies) {
    if (idFilter && !idFilter.has(rawPolicy.id)) continue
    try {
      const policy: OkfPolicyFields = {
        id: rawPolicy.id,
        one_thing_name: rawPolicy.one_thing_name || '',
        subsidy_item_name: rawPolicy.subsidy_item_name || '',
        file_type: rawPolicy.file_type,
        file_name: rawPolicy.file_name,
        publish_region: rawPolicy.publish_region,
        publish_unit: rawPolicy.publish_unit,
        publish_date: rawPolicy.publish_date,
        subsidy_target: rawPolicy.subsidy_target,
        subsidy_standard: rawPolicy.subsidy_standard,
        apply_period: rawPolicy.apply_period,
        apply_condition: rawPolicy.apply_condition,
        required_materials: rawPolicy.required_materials,
        distribute_time: rawPolicy.distribute_time,
        distribute_channel: rawPolicy.distribute_channel,
        apply_procedure: rawPolicy.apply_procedure,
        handle_channel: rawPolicy.handle_channel,
        online_entry: rawPolicy.online_entry,
        policy_url: rawPolicy.policy_url,
        verify_status: rawPolicy.verify_status,
        verify_note: rawPolicy.verify_note
      }

      // 4a. 优先复用爬虫已生成的 MD
      let mdContent: string | null = null
      if (exportedByPolicy.has(policy.id)) {
        mdContent = exportedByPolicy.get(policy.id)!
      } else if (rawPolicy.md_status === 'success' && rawPolicy.md_export_path) {
        mdContent = await fetchCrawlerMarkdownByPath(rawPolicy.md_export_path)
        // 兜底: 拉取失败且允许占位 → 自己生成
        if (!mdContent && includeUnexported) {
          console.warn(`[importFromCrawler] policy ${policy.id} MD 拉取失败, 用 buildOkfMarkdown 占位`)
          mdContent = buildOkfMarkdown(policy, policy.subsidy_standard || undefined)
        }
      } else if (includeUnexported) {
        mdContent = buildOkfMarkdown(policy, policy.subsidy_standard || undefined)
      }
      if (!mdContent) continue

      // 4b. 计算路径
      const relPath = computeOutputPath(policy)
      const dataRelPath = relPath.startsWith('data/') ? relPath : `data/${relPath}`

      // 4c. 检查是否已存在
      if (!overwrite && readFileContentForCheck(ownerCwd, dataRelPath)) {
        skipped++
        continue
      }

      // 4d. 写文件（直接 fs.writeFileSync 绕过 workspace.ts 强 projectId 绑定）
      const fullPath = join(ownerCwd, dataRelPath.replace(/\\/g, '/').replace(/^\/+/, ''))
      mkdirSync(join(fullPath, '..'), { recursive: true })
      writeFileSync(fullPath, mdContent, 'utf-8')
      imported++
      files.push({
        path: dataRelPath,
        policy_id: policy.id,
        size: Buffer.byteLength(mdContent, 'utf-8')
      })
    } catch (e) {
      console.error(`[importFromCrawler] policy ${rawPolicy?.id} failed:`, e)
      failed++
    }
  }

  // 5. 写索引
  const indexPath = 'data/_crawler_import.json'
  const indexData = {
    imported_at: new Date().toISOString(),
    source: 'crawler',
    crawler_base: getCrawlerBase(),
    verify_status: verifyStatus,
    total: imported,
    policy_ids: files.map((f) => f.policy_id)
  }
  try {
    const indexFullPath = join(ownerCwd, indexPath.replace(/\\/g, '/').replace(/^\/+/, ''))
    mkdirSync(join(indexFullPath, '..'), { recursive: true })
    writeFileSync(indexFullPath, JSON.stringify(indexData, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[importFromCrawler] index write failed:', e)
  }

  return {
    total: policies.length,
    imported,
    skipped,
    failed,
    files,
    duration_ms: Date.now() - start,
    index_path: indexPath
  }
}

/**
 * 多空间导入版本
 * 流程：
 *   1. 校验 space_ids 非空
 *   2. 抓 policies / exportedByPolicy 一次（多空间共用）
 *   3. 串行处理每个 space_id（事务一致；任一失败不中断其他空间）
 *   4. 聚合 per_space + total + success
 */
export async function importFromCrawlerMulti(
  options: ImportFromCrawlerOptions = {}
): Promise<MultiSpaceImportFromCrawlerResult> {
  const overallStart = Date.now()
  const spaceIds = options.space_ids || []
  if (spaceIds.length === 0) {
    throw new Error('space_ids 不能为空')
  }

  const verifyStatus = options.verify_status || 'qualified'
  const includeUnexported = options.include_unexported ?? false

  // 1. 抓 policies (一次)
  let policies = await fetchCrawlerPolicies({
    verify_status: verifyStatus === 'all' ? undefined : 'qualified',
    one_thing_name: options.one_thing_name,
    region: options.region
  })

  // 1.5. 触发爬虫导出未导出的政策 (确保本地有 MD 可读)
  //   - 用户决策: 本次入参所有未导出项都触发
  //   - 失败: 整批任务中断 (用户决策)
  const idFilter = options.policy_ids && options.policy_ids.length > 0
    ? new Set(options.policy_ids)
    : null
  const targetPolicies = idFilter
    ? policies.filter((p) => idFilter!.has(p.id))
    : policies
  const unexportedIds = targetPolicies
    .filter((p) => !p.md_exported || p.md_status !== 'success')
    .map((p) => p.id)
  if (unexportedIds.length > 0) {
    console.log(`[importFromCrawlerMulti] 触发爬虫导出 ${unexportedIds.length} 条未导出政策...`)
    const exportResult = await triggerCrawlerExport(unexportedIds)
    if (exportResult.failed > 0) {
      // 用户决策: 导出失败则整批任务中断
      throw new Error(
        `爬虫导出失败 ${exportResult.failed} 条（成功 ${exportResult.exported} 条），任务已中断。请检查爬虫后端日志后重试。`
      )
    }
    // 重新拉取政策状态 (拿最新的 md_exported / md_export_path)
    policies = await fetchCrawlerPolicies({
      verify_status: verifyStatus === 'all' ? undefined : 'qualified',
      one_thing_name: options.one_thing_name,
      region: options.region
    })
  }

  // 2. 抓 exportedByPolicy (一次)
  const exportedByPolicy = new Map<number, string>()
  if (!includeUnexported) {
    const exportedFiles = await fetchCrawlerExportedFiles()
    for (const f of exportedFiles) {
      const md = await fetchCrawlerMarkdown(f.batch, f.subdir, f.filename)
      if (md) {
        const m = md.match(/^policy_id:\s*(\d+)/m)
        if (m) exportedByPolicy.set(Number(m[1]), md)
      }
    }
  }

  // 3. 串行处理每个空间
  const perSpace: Record<string, PerSpaceImportResult> = {}
  let totalImported = 0
  let totalSkipped = 0
  let totalFailed = 0
  let allSuccess = true

  for (const spaceId of spaceIds) {
    // 按空间粒度 overwrite；缺失时回退到 options.overwrite
    const overwrite = options.overwrite_per_space?.[spaceId] ?? options.overwrite ?? false
    try {
      const r = await importSingleSpace(spaceId, policies, exportedByPolicy, {
        ...options,
        overwrite
      })
      perSpace[spaceId] = r
      totalImported += r.imported
      totalSkipped += r.skipped
      totalFailed += r.failed
      if (r.error || r.failed > 0) allSuccess = false
    } catch (e) {
      // 整空间级失败 (例如空间不存在) → 记录 error 但不中断其他空间
      console.error(`[importFromCrawlerMulti] space ${spaceId} failed:`, e)
      const message = e instanceof Error ? e.message : String(e)
      perSpace[spaceId] = {
        total: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        files: [],
        duration_ms: 0,
        index_path: 'data/_crawler_import.json',
        error: message
      }
      allSuccess = false
    }
  }

  return {
    per_space: perSpace,
    total: {
      imported: totalImported,
      skipped: totalSkipped,
      failed: totalFailed,
      duration_ms: Date.now() - overallStart
    },
    success: allSuccess
  }
}

/**
 * 内部：单空间导入（从 importFromCrawler 抽出，接收预抓的 policies + exportedByPolicy）
 * V2：写 raw + 转换 OKF + 维护 _okf_map.json + 清理孤儿 + 重写 INDEX.md
 */
async function importSingleSpace(
  spaceId: string,
  policies: any[],
  exportedByPolicy: Map<number, string>,
  options: ImportFromCrawlerOptions
): Promise<PerSpaceImportResult> {
  const start = Date.now()
  const verifyStatus = options.verify_status || 'qualified'
  const overwrite = options.overwrite ?? false
  const includeUnexported = options.include_unexported ?? false

  // 校验空间存在并拿到 cwd
  const isDataSpace = spaceId.startsWith('ds-')
  let ownerCwd: string
  if (isDataSpace) {
    const entry = getDataSpace(spaceId)
    if (!entry) throw new Error(`数据空间不存在: ${spaceId}`)
    ownerCwd = ensureDataSpaceWorkspace(spaceId)
  } else {
    const project = getProject(spaceId)
    const version = getCurrentVersionMeta(project)
    ownerCwd = ensureProjectWorkspace(spaceId, version.version)
  }

  // 加载 _okf_map.json
  const okfMap = okf.loadOrCreateMap(ownerCwd)

  // 逐条政策处理
  let imported = 0
  let skipped = 0
  let failed = 0
  const files: ImportFromCrawlerResult['files'] = []
  /** 本次要保留的 OKF 绝对路径集合（用于清理孤儿） */
  const keptOkfAbsPaths = new Set<string>()
  const idFilter = options.policy_ids && options.policy_ids.length > 0
    ? new Set(options.policy_ids)
    : null

  for (const rawPolicy of policies) {
    if (idFilter && !idFilter.has(rawPolicy.id)) continue
    try {
      const policy: OkfPolicyFields = {
        id: rawPolicy.id,
        one_thing_name: rawPolicy.one_thing_name || '',
        subsidy_item_name: rawPolicy.subsidy_item_name || '',
        file_type: rawPolicy.file_type,
        file_name: rawPolicy.file_name,
        publish_region: rawPolicy.publish_region,
        publish_unit: rawPolicy.publish_unit,
        publish_date: rawPolicy.publish_date,
        subsidy_target: rawPolicy.subsidy_target,
        subsidy_standard: rawPolicy.subsidy_standard,
        apply_period: rawPolicy.apply_period,
        apply_condition: rawPolicy.apply_condition,
        required_materials: rawPolicy.required_materials,
        distribute_time: rawPolicy.distribute_time,
        distribute_channel: rawPolicy.distribute_channel,
        apply_procedure: rawPolicy.apply_procedure,
        handle_channel: rawPolicy.handle_channel,
        online_entry: rawPolicy.online_entry,
        policy_url: rawPolicy.policy_url,
        verify_status: rawPolicy.verify_status,
        verify_note: rawPolicy.verify_note
      }

      // 1. 拿 raw MD 内容 (优先级: 缓存 > 本地读 > 占位模板)
      let rawMdContent: string | null = null
      if (exportedByPolicy.has(policy.id)) {
        rawMdContent = exportedByPolicy.get(policy.id)!
      } else if (rawPolicy.md_status === 'success' && rawPolicy.md_export_path) {
        rawMdContent = await fetchCrawlerMarkdownByPath(rawPolicy.md_export_path)
        if (rawMdContent) exportedByPolicy.set(policy.id, rawMdContent)
      }
      if (!rawMdContent && includeUnexported) {
        rawMdContent = buildOkfMarkdown(policy, policy.subsidy_standard || undefined)
      }
      if (!rawMdContent) {
        skipped++
        continue
      }

      // 2. 用 okf 模块算出 raw/OKF 路径
      const keyword = okf.sanitizePathSegment(policy.one_thing_name)
      const region = policy.publish_region || 'unknown'
      const rawFileName = `${okf.sanitizePathSegment(region)}_${okf.sanitizePathSegment(policy.one_thing_name)}_${policy.id}.md`

      const conv = okf.convertOne({
        policy: rawPolicy,
        rawContent: rawMdContent,
        rawFileName,
        spaceCwd: ownerCwd,
        map: okfMap
      })

      // 3. overwrite 检查 (按 data/raw_path 判断"已存在")
      //    rawRelPath 格式为 raw/{keyword}/{region}/{file}.md，替换为 data/ 前缀
      const dataRelPath = conv.rawRelPath.replace(/^raw\//, 'data/')
      const rawAbsPath = join(ownerCwd, dataRelPath.replace(/^\/+/, ''))
      if (!overwrite && existsSync(rawAbsPath)) {
        skipped++
        // 仍记录 OKF 路径, 避免被清成孤儿
        keptOkfAbsPaths.add(join(ownerCwd, conv.okfRelPath.replace(/^\/+/, '')))
        continue
      }

      // 4. 写 raw 文件到 data/ 目录
      mkdirSync(join(rawAbsPath, '..'), { recursive: true })
      writeFileSync(rawAbsPath, rawMdContent, 'utf-8')

      // 5. 写 OKF 文件
      const okfAbsPath = join(ownerCwd, conv.okfRelPath.replace(/^\/+/, ''))
      mkdirSync(join(okfAbsPath, '..'), { recursive: true })
      writeFileSync(okfAbsPath, conv.okfContent, 'utf-8')
      keptOkfAbsPaths.add(okfAbsPath)

      imported++
      files.push({
        path: conv.rawRelPath,
        policy_id: policy.id,
        size: Buffer.byteLength(rawMdContent, 'utf-8')
      })
    } catch (e) {
      console.error(`[importSingleSpace] space=${spaceId} policy=${rawPolicy?.id} failed:`, e)
      failed++
    }
  }

  // 6. 清理孤儿 OKF: 扫 bundles/ 所有 .md, 不在 keptOkfAbsPaths 的删
  cleanupOrphanOkfs(ownerCwd, keptOkfAbsPaths)

  // 7. 重写所有受影响的 INDEX.md
  rewriteAllIndexMds(ownerCwd, okfMap)

  // 8. 保存 _okf_map.json
  try {
    okf.saveMap(ownerCwd, okfMap)
  } catch (e) {
    console.warn('[importSingleSpace] _okf_map.json save failed:', e)
  }

  // 9. 写 _crawler_import.json
  const indexPath = 'data/_crawler_import.json'
  const indexData = {
    imported_at: new Date().toISOString(),
    source: 'crawler',
    crawler_base: getCrawlerBase(),
    verify_status: verifyStatus,
    space_id: spaceId,
    total: imported,
    policy_ids: files.map((f) => f.policy_id)
  }
  try {
    const indexFullPath = join(ownerCwd, indexPath.replace(/\\/g, '/').replace(/^\/+/, ''))
    mkdirSync(join(indexFullPath, '..'), { recursive: true })
    writeFileSync(indexFullPath, JSON.stringify(indexData, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[importSingleSpace] index write failed:', e)
  }

  return {
    total: policies.length,
    imported,
    skipped,
    failed,
    files,
    duration_ms: Date.now() - start,
    index_path: indexPath
  }
}

/**
 * 清理孤儿 OKF: 扫 bundles/ 目录, 删除不在 keptSet 里的 .md 文件
 * INDEX.md 保留不删
 */
function cleanupOrphanOkfs(spaceCwd: string, keptSet: Set<string>): number {
  const bundlesDir = join(spaceCwd, 'bundles')
  if (!existsSync(bundlesDir)) return 0
  let removed = 0
  walkMd(bundlesDir, (filePath) => {
    if (filePath.endsWith('INDEX.md')) return
    if (!keptSet.has(filePath)) {
      try {
        rmSync(filePath)
        removed++
        console.log(`[okf] 清理孤儿: ${filePath.replace(spaceCwd, '').replace(/\\/g, '/')}`)
      } catch (e) {
        console.warn(`[okf] 清理失败: ${filePath}`, e)
      }
    }
  })
  return removed
}

/**
 * 重写所有受影响的 INDEX.md
 * 策略: 扫描 okfMap 里出现过的 bundle 和 region 路径
 */
function rewriteAllIndexMds(spaceCwd: string, map: okf.OkfMap): number {
  // 收集所有涉及的 (bundle, region_path) 组合 + 所有 bundle
  const affectedDirs = new Set<string>()
  for (const entry of Object.values(map.mappings)) {
    // bundles/{bundle_key}/INDEX.md
    affectedDirs.add(join(spaceCwd, 'bundles', entry.bundle_key).replace(/\\/g, '/'))
    // bundles/{bundle_key}/{region_path}/INDEX.md
    const regionDir = join(spaceCwd, 'bundles', entry.bundle_key, ...entry.region_path)
    affectedDirs.add(regionDir.replace(/\\/g, '/'))
  }
  // 同时也重写所有"已存在但不在本次涉及列表"的 INDEX (因为孤儿可能被清)
  // 简化: 扫 bundles/ 全部子目录
  const bundlesDir = join(spaceCwd, 'bundles')
  if (existsSync(bundlesDir)) {
    collectDirs(bundlesDir, affectedDirs)
  }

  let written = 0
  for (const dir of affectedDirs) {
    if (!existsSync(dir)) continue
    if (writeIndexMdForDir(spaceCwd, dir)) written++
  }
  return written
}

function writeIndexMdForDir(spaceCwd: string, dirAbs: string): boolean {
  const rel = dirAbs.replace(spaceCwd, '').replace(/\\/g, '/').replace(/^\/+/, '')
  // rel 形如: bundles/{bundle_key}[/{region_path}...]
  const parts = rel.split('/').filter(Boolean)
  if (parts.length < 1 || parts[0] !== 'bundles') return false
  // 显示名: 去掉 'bundles' 前缀, 取最后一段 (region leaf) 或 bundle_key
  const displayName = parts[parts.length - 1]

  // 收集子目录和文件
  const entries: { type: 'dir' | 'file'; name: string; desc?: string }[] = []
  let items: string[]
  try {
    items = readdirSync(dirAbs)
  } catch {
    return false
  }
  for (const name of items) {
    const abs = join(dirAbs, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) {
      entries.push({ type: 'dir', name })
    } else if (st.isFile() && name.endsWith('.md') && name !== 'INDEX.md') {
      // 从 frontmatter 读 description
      let desc: string | undefined
      try {
        const content = readFileSync(abs, 'utf-8')
        const m = content.match(/^---\s*\n([\s\S]*?)\n---/)
        if (m) {
          const dm = m[1].match(/^description:\s*(.+)$/m)
          if (dm) desc = dm[1].trim().replace(/^["']|["']$/g, '')
        }
      } catch { /* ignore */ }
      entries.push({ type: 'file', name, desc })
    }
  }

  // 写 INDEX.md
  const content = okf.buildIndexMd({ dirName: displayName, entries })
  writeFileSync(join(dirAbs, 'INDEX.md'), content, 'utf-8')
  return true
}

function collectDirs(rootAbs: string, into: Set<string>): void {
  let items: string[]
  try { items = readdirSync(rootAbs) } catch { return }
  for (const name of items) {
    const abs = join(rootAbs, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) {
      into.add(abs.replace(/\\/g, '/'))
      collectDirs(abs, into)
    }
  }
}

function walkMd(rootAbs: string, cb: (filePath: string) => void): void {
  let items: string[]
  try { items = readdirSync(rootAbs) } catch { return }
  for (const name of items) {
    const abs = join(rootAbs, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) walkMd(abs, cb)
    else if (st.isFile() && name.endsWith('.md')) cb(abs.replace(/\\/g, '/'))
  }
}

// 内部：调爬虫拉政策列表
async function fetchCrawlerPolicies(filter: {
  verify_status?: string
  one_thing_name?: string
  region?: string
}): Promise<any[]> {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('page_size', '500')
  if (filter.verify_status) params.set('verify_status', filter.verify_status)
  if (filter.one_thing_name) params.set('one_thing_name', filter.one_thing_name)
  if (filter.region) params.set('keyword', filter.region)

  const url = `${getCrawlerBase()}/api/policies/?${params.toString()}`
  const resp = await fetch(url, {
    headers: { 'Accept-Charset': 'utf-8' }
  })
  if (!resp.ok) {
    throw new Error(`Crawler policies API failed: ${resp.status} ${resp.statusText}`)
  }
  const json = await resp.json()
  return json.items || []
}

// 内部：调爬虫拉已导出 MD 文件清单
async function fetchCrawlerExportedFiles(): Promise<{ batch: string; subdir: string; filename: string }[]> {
  try {
    const resp = await fetch(`${getCrawlerBase()}/api/export/markdown-list`, {
      headers: { 'Accept-Charset': 'utf-8' }
    })
    if (!resp.ok) return []
    const json = await resp.json()
    return json.files || []
  } catch {
    return []
  }
}

// 内部：拉取单个已导出 MD 文本
async function fetchCrawlerMarkdown(
  batch: string,
  subdir: string,
  filename: string
): Promise<string | null> {
  try {
    const resp = await fetch(
      `${getCrawlerBase()}/api/export/markdown/${encodeURIComponent(batch)}/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`,
      { headers: { 'Accept-Charset': 'utf-8' } }
    )
    if (!resp.ok) return null
    return await resp.text()
  } catch {
    return null
  }
}

// 内部：通过相对路径拉取（备用方案）
/**
 * 触发爬虫导出指定政策 (同步等待爬虫返回结果)
 * 爬虫内部只导 "not_exported/failed" 的, 已成功的自动跳过
 * @returns { exported, failed, total, ... }
 */
async function triggerCrawlerExport(
  policyIds: number[]
): Promise<{ exported: number; failed: number; total: number; message?: string; errors?: string[] }> {
  if (policyIds.length === 0) {
    return { exported: 0, failed: 0, total: 0 }
  }
  const url = `${getCrawlerBase()}/api/export/markdown-by-ids`
  // 兜底超时: 每条 120s + 整体留 60s buffer
  // 防止爬虫抓单个 URL 卡死导致 bridge 整个请求挂掉
  const timeoutMs = Math.max(300_000, policyIds.length * 120_000 + 60_000)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let r: Response
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_ids: policyIds }),
      signal: ac.signal
    })
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') {
      throw new Error(`爬虫导出超时 (>${Math.round(timeoutMs/1000)}s), 已中止。请检查爬虫服务或网络。`)
    }
    throw new Error(`爬虫导出请求失败: ${e?.message || String(e)}`)
  }
  clearTimeout(timer)
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`爬虫导出 HTTP ${r.status} ${r.statusText}: ${txt.slice(0, 200)}`)
  }
  const j = await r.json()
  return {
    exported: j.exported || 0,
    failed: j.failed || 0,
    total: j.total || policyIds.length,
    message: j.message,
    errors: j.errors || []
  }
}

/**
 * 通过 md_export_path 获取 MD 文本
 * 优先级（临时方案：同机部署 → 本地直读优先）：
 *   1. 本地文件系统 readFileSync (getCrawlerExportDir() + relPath)
 *      - 最快, 最可靠, 不走 HTTP
 *   2. 爬虫 HTTP /api/export/markdown/{batch}/{subdir}/{file}
 *      - 兜底 (如果本地读失败, 比如文件被清理)
 *   3. 返回 null → 调用方走 buildOkfMarkdown 占位
 */
async function fetchCrawlerMarkdownByPath(exportPath: string): Promise<string | null> {
  // 1. 本地直读 (同机部署)
  try {
    // exportPath 形如 /home/wangjinwang/.../export/{keyword}/{region}/{file}.md
    // 找 '/export/' 标记, 截后面的相对路径
    const marker = '/export/'
    const idx = exportPath.lastIndexOf(marker)
    let relPath: string
    if (idx >= 0) {
      relPath = exportPath.substring(idx + marker.length)
    } else {
      // 兼容: 如果路径不含 /export/, 尝试直接用最后一截路径
      const parts = exportPath.split('/').filter(Boolean)
      if (parts.length < 3) return null
      relPath = parts.slice(-3).join('/')
    }

    // 安全校验: 防止 path traversal (../)
    if (relPath.includes('..') || relPath.startsWith('/')) return null

    const fullPath = join(getCrawlerExportDir(), relPath)
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8')
      if (content && content.length > 0) {
        return content
      }
    }
  } catch (e) {
    console.warn(`[fetchCrawlerMarkdownByPath] 本地读取失败 ${exportPath}:`, e)
  }

  // 2. 兜底: HTTP 调用 (路径可能不匹配, 但试试)
  const parts = exportPath.split('/').filter(Boolean)
  if (parts.length < 3) return null
  let batch: string, subdir: string, filename: string
  if (parts[0] === 'markdown' && parts.length >= 4) {
    ;[batch, subdir, filename] = [parts[1], parts[2], parts[3]]
  } else if (parts.length >= 3) {
    ;[batch, subdir, filename] = [parts[0], parts[1], parts[2]]
  } else {
    return null
  }
  return fetchCrawlerMarkdown(batch, subdir, filename)
}

// ===== 独立数据空间（不依赖项目） =====

/**
 * 语义版本号降序比较器。
 * 支持 "v1.0.2" / "1.0.2" / "v2.0" 等格式，按 major.minor.patch 数值比较；
 * 高版本在前（最新版本排在 [0]）。无法解析的版本按字符串降序兜底。
 */
function compareSemverDesc(a: string, b: string): number {
  const pa = (a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0))
  const pb = (b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0)
    if (diff !== 0) return diff
  }
  return b.localeCompare(a)
}

/** 数据空间 ID 生成 */
export function newDataSpaceId(): string {
  return `ds-${randomUUID()}`
}

/** 创建数据空间物理工作区（独立于项目） */
export function ensureDataSpaceWorkspace(spaceId: string): string {
  const cwd = dataSpaceCwd(spaceId)
  mkdirSync(cwd, { recursive: true })
  mkdirSync(join(cwd, 'data'), { recursive: true })
  mkdirSync(join(cwd, 'skills'), { recursive: true })
  return cwd
}

/** 写数据空间元数据 */
function writeDataSpaceMeta(cwd: string, meta: { name: string; description?: string; createdAt: string; updatedAt: string }) {
  writeFileSync(join(cwd, 'dataspace.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

/** 读数据空间元数据 */
function readDataSpaceMeta(cwd: string): { name: string; description?: string; createdAt: string; updatedAt: string } | null {
  return readJson(join(cwd, 'dataspace.json'), null)
}

/** 读单个数据空间（从 manifest 段） */
export function getDataSpace(id: string): DataSpaceEntry | null {
  const manifest = loadManifest()
  return manifest.dataspaces.find((d) => d.id === id) || null
}

/**
 * 取得（或创建）与项目绑定的数据空间条目。
 * 同一个项目（按 projectKey）复用同一个 ds-<UUID>，多个已发布版本作为其下的子目录。
 * 同时把 version 登记到 publishedVersions（去重）。
 */
export function ensureProjectDataSpaceEntry(projectKey: string, projectName: string, version: string): DataSpaceEntry {
  const manifest = loadManifest()
  let entry = manifest.dataspaces.find((d) => d.projectKey === projectKey)
  const now = new Date().toISOString()
  if (!entry) {
    // 兜底：项目可能被删除后重建同名，残留数据空间导致重名；
    // 重名时递增后缀（-v1、-v2…），使数据空间名 + 远程同步目录唯一。
    const existingNames = new Set(manifest.dataspaces.map((d) => d.name))
    let uniqueName = projectName
    let suffix = 1
    while (existingNames.has(uniqueName)) {
      uniqueName = `${projectName}-v${suffix++}`
    }
    const id = newDataSpaceId()
    // 项目型数据空间：只建目录本身，不预建 data/skills（内容按版本放在子目录下）。
    // 与独立数据空间的 ensureDataSpaceWorkspace 区分，避免根目录留下多余的空目录。
    mkdirSync(dataSpaceCwd(id), { recursive: true })
    const meta = {
      name: uniqueName,
      description: `项目「${projectName}」已发布版本归档`,
      createdAt: now,
      updatedAt: now,
    }
    writeDataSpaceMeta(dataSpaceCwd(id), meta)
    entry = { id, ...meta, projectKey, projectName: uniqueName, publishedVersions: [] }
    manifest.dataspaces.push(entry)
  }
  // 登记版本（去重），并按语义版本号降序排序，使 [0] 始终为最新版本。
  const vers = entry.publishedVersions && Array.isArray(entry.publishedVersions) ? [...entry.publishedVersions] : []
  if (!vers.includes(version)) vers.push(version)
  vers.sort(compareSemverDesc)
  entry.projectName = entry.projectName || projectName
  entry.publishedVersions = vers
  entry.updatedAt = now
  // 回写：替换 manifest 中同 id 的条目
  const idx = manifest.dataspaces.findIndex((d) => d.id === entry!.id)
  if (idx >= 0) manifest.dataspaces[idx] = entry
  saveManifest(manifest)
  return entry
}

/** 列出所有数据空间 */
export function listDataSpaceEntries(): DataSpaceEntry[] {
  return loadManifest().dataspaces
}

// ===== 审核流（Step4 提交审核 / 通过 / 驳回）=====

const REVIEWS_PATH = join(GS_DIR, 'reviews.json')

const reviewsLock = new Set<string>()

function withReviewsLock<T>(fn: () => T): T {
  if (reviewsLock.has(REVIEWS_PATH)) {
    throw new Error('Re-entrant reviews file lock')
  }
  reviewsLock.add(REVIEWS_PATH)
  try {
    return fn()
  } finally {
    reviewsLock.delete(REVIEWS_PATH)
  }
}

export interface ReviewerDecision {
  username: string
  name: string
  decision: 'approved' | 'rejected'
  comment?: string
  decidedAt: string
  gateChecks?: string[]
}

export interface ReviewRecord {
  id: string
  projectKey: string
  projectName: string
  version: string
  submittedBy: string
  submittedAt: string
  assignedReviewers: { username: string; name: string }[]
  decisions: ReviewerDecision[]
  status: 'pending' | 'approved' | 'rejected'
  submitComment?: string
  reviewedAt?: string
  /** 资格判定质量摘要（提交审核时由 version.json.step2_judge_history 计算并固化） */
  summary?: JudgeHistorySummary
}

/** 资格判定历史质量摘要（写死在 ReviewRecord.summary 上，供审批页展示） */
export interface JudgeHistorySummary {
  /** 累计判定条数（version.json.step2_judge_history.total_count） */
  total: number
  /** 历史中累计被命中过的不同规则 ID 数量 */
  matched_rules: number
  /** 累计参与编译的不同规则 ID 数量 */
  total_rules: number
  /** 命中率：matched_rules / total_rules；当 total_rules === 0 时为 0 */
  hit_rate: number
}

interface ReviewsFile {
  reviews: ReviewRecord[]
}

/** 从 SQLite 读取全部审批记录（回退 JSON 兼容） */
function readReviews(): ReviewsFile {
  const stored = listAllReviews()
  if (stored.length) {
    return { reviews: stored.map(storedToReview) }
  }
  // 回退：JSON 文件
  if (!existsSync(REVIEWS_PATH)) return { reviews: [] }
  try {
    const raw = JSON.parse(readFileSync(REVIEWS_PATH, 'utf-8')) as ReviewsFile
    return Array.isArray(raw.reviews) ? raw : { reviews: [] }
  } catch {
    return { reviews: [] }
  }
}

/** 将单条审批记录写入 SQLite */
function persistReview(r: ReviewRecord): void {
  saveReview(reviewToStored(r))
}

/** 批量保存（替换 writeReviews 语义） */
function writeReviews(data: ReviewsFile): void {
  // 逐条 upsert（保持与原 writeReviews 语义一致）
  for (const r of data.reviews) {
    persistReview(r)
  }
}

function reviewToStored(r: ReviewRecord): StoredReview {
  return {
    id: r.id,
    projectKey: r.projectKey,
    projectName: r.projectName,
    version: r.version,
    submittedBy: r.submittedBy,
    submittedAt: r.submittedAt,
    assignedReviewers: r.assignedReviewers,
    decisions: r.decisions,
    status: r.status,
    submitComment: r.submitComment,
    reviewedAt: r.reviewedAt,
  }
}

function storedToReview(s: StoredReview): ReviewRecord {
  return {
    id: s.id,
    projectKey: s.projectKey,
    projectName: s.projectName,
    version: s.version,
    submittedBy: s.submittedBy,
    submittedAt: s.submittedAt,
    assignedReviewers: s.assignedReviewers,
    decisions: s.decisions,
    status: s.status,
    submitComment: s.submitComment,
    reviewedAt: s.reviewedAt,
  }
}

/** List all review records (for taskboard) */
export function listReviews(): ReviewRecord[] {
  // 过滤掉 saveGateChecks 写入的占位决策（decidedAt 为空字符串），
  // 避免前端 TaskboardPage 误将占位当成真实审批
  return readReviews().reviews
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((r) => ({
      ...r,
      decisions: r.decisions.filter((d) => d.decidedAt !== ''),
    }))
}

/** List pending reviews (for reviewer's taskboard) */
export function listPendingReviews(): ReviewRecord[] {
  return listReviews().filter((r) => r.status === 'pending')
}

/** 从当前 version 的资格判定历史计算质量摘要。
 *  命中率语义：命中规则数（去重）/ 总规则数（去重），不随判定次数稀释。 */
export function computeJudgeHistorySummary(projectKey: string, versionId: string): JudgeHistorySummary {
  const history = readJudgeHistory(projectKey, versionId)
  const total = history.total_count
  // 累计去重集合由 step2-judge-history 持久化（旧数据从现存 entries 推导）
  const matched_rules = history.hit_rule_ids.length
  const total_rules = history.total_rule_ids.length
  const hit_rate = total_rules > 0 ? matched_rules / total_rules : 0
  return { total, matched_rules, total_rules, hit_rate }
}

/** 开发提交审核：选定审批人（至少2人） */
export function submitForReview(
  projectKey: string,
  submittedBy: string,
  reviewers: { username: string; name: string }[],
  submitComment?: string,
  versionId?: string,
): { review: ReviewRecord; pipeline: unknown } {
  if (!Array.isArray(reviewers) || reviewers.length < 2) {
    throw new Error('至少选择 2 名审批人')
  }
  return withReviewsLock(() => {
    const project = getProject(projectKey)
    const version = resolveVersion(project, versionId)

    const steps = normalizeStepStates(version.steps)
    if (steps[2] !== 'done') {
      throw new Error('Step3 未完成，无法提交审核')
    }
    const existing = readReviews().reviews.find(
      (r) => r.projectKey === project.key && r.version === version.version && r.status === 'pending',
    )
    if (existing) throw new Error('当前版本已在审核中，请勿重复提交')

    // 在 applyPipelineStatus 之前先快照资格判定摘要：
    // applyPipelineStatus → persistVersionMeta 会用 SQLite 行覆盖 version.json，
    // 把 step2_judge_history 一并清掉，因此必须先读后写。
    const summary = computeJudgeHistorySummary(project.key, version.id)

    steps[3] = 'running' as StepState
    // 记录 Step4 开始时间
    const st4 = version.stepTimes ? version.stepTimes.map((t) => ({ ...t })) : []
    while (st4.length < 4) st4.push({})
    st4[3] = { ...st4[3], startedAt: new Date().toISOString() }
    version.stepTimes = st4
    applyPipelineStatus(project, version, steps)
    // 覆写为「待审核」状态（applyPipelineStatus 会设为「构建中」，需修正）
    version.status = '待审核'
    version.statusVariant = 'warning'
    persistVersionMeta(project.key, version)
    persistProjectMeta({ ...project, status: '待审核', statusVariant: 'warning' })

    const review: ReviewRecord = {
      id: `rev-${randomUUID()}`,
      projectKey: project.key,
      projectName: project.name,
      version: version.version,
      submittedBy,
      submittedAt: new Date().toISOString(),
      assignedReviewers: reviewers
        .filter((r) => r.username !== submittedBy)
        .map((r) => {
          const user = findUser(r.username)
          return { username: r.username, name: user?.name || r.username }
        }),
      decisions: [],
      status: 'pending',
      submitComment: submitComment || '',
      summary,
    }

    const reviews = readReviews()
    reviews.reviews.push(review)
    writeReviews(reviews)

    const pipeline = buildPipelineData(project, version, steps, submittedBy)
    return { review, pipeline }
  })
}

/** 查找当前版本的 pending 审核记录 */
function findPendingReview(projectKey: string, version: string): ReviewRecord | undefined {
  return readReviews().reviews.find(
    (r) => r.projectKey === projectKey && r.version === version && r.status === 'pending',
  )
}

/** 校验审批人资格：必须被分派且未投过票（忽略 saveGateChecks 的预勾选占位） */
function assertCanDecide(review: ReviewRecord, reviewer: string): { username: string; name: string } {
  // 禁止提交人审核自己提交的审核
  if (review.submittedBy === reviewer) {
    throw new Error('不能审核自己提交的审核')
  }
  const assigned = review.assignedReviewers.find((r) => r.username === reviewer)
  if (!assigned) throw new Error('您不是该审核的分派审批人')
  if (review.decisions.some((d) => d.username === reviewer && d.decidedAt !== '')) {
    throw new Error('您已审核过，请勿重复操作')
  }
  return assigned
}

export function saveGateChecks(projectKey: string, version: string, username: string, gateChecks: string[]): void {
  return withReviewsLock(() => {
    const reviews = readReviews()
    const review = reviews.reviews.find(
      (r) => r.projectKey === projectKey && r.version === version && r.status === 'pending',
    )
    if (!review) throw new Error('未找到待审核记录')
    const assigned = review.assignedReviewers.some((r) => r.username === username)
    if (!assigned) throw new Error('您不是该版本的指定审批人')
    const validIds = new Set(getGateIds())
    const sanitized = gateChecks.filter((g): g is string => typeof g === 'string' && validIds.has(g))
    let decision = review.decisions.find((d) => d.username === username)
    if (!decision) {
      decision = { username, name: findUser(username)?.name || username, decision: 'approved', comment: '', decidedAt: '', gateChecks: sanitized }
      review.decisions.push(decision)
    } else {
      decision.gateChecks = sanitized
    }
    writeReviews(reviews)
  })
}

/** 判定审核结果：所有人投完票后再判定 */
function resolveReviewStatus(review: ReviewRecord): 'approved' | 'rejected' | 'pending' {
  // 只统计真实决策（忽略 saveGateChecks 写入的占位：decidedAt 为空字符串）
  const realDecisions = review.decisions.filter((d) => d.decidedAt !== '')
  const decidedUsernames = new Set(realDecisions.map((d) => d.username))
  const allDecided = review.assignedReviewers.every((r) => decidedUsernames.has(r.username))
  if (!allDecided) return 'pending'
  // 所有人投完 → 有任何驳回则整体驳回，否则通过
  const hasRejected = realDecisions.some((d) => d.decision === 'rejected')
  return hasRejected ? 'rejected' : 'approved'
}

/** 审核通过 */
export function approvePipeline(
  projectKey: string,
  reviewer: string,
  comment?: string,
  versionId?: string,
  gateChecksFallback?: string[],
): { review: ReviewRecord; pipeline: unknown } {
  return withReviewsLock(() => {
    const project = getProject(projectKey)
    const version = resolveVersion(project, versionId)
    const steps = normalizeStepStates(version.steps)

    const reviews = readReviews()
    const review = reviews.reviews.find(
      (r) => r.projectKey === project.key && r.version === version.version && r.status === 'pending',
    )
    if (!review) throw new Error('未找到待审核记录')

    // 提取预勾选 gateChecks 并清除占位 decision（saveGateChecks 可能写入），避免 assertCanDecide 误判
    const preDecision = review.decisions.find((d) => d.username === reviewer && d.decidedAt === '')
    const gateChecks = preDecision?.gateChecks ?? gateChecksFallback
    if (preDecision) {
      review.decisions = review.decisions.filter((d) => d.username !== reviewer)
    }

    const assigned = assertCanDecide(review, reviewer)
    const reviewerUser = findUser(reviewer)

    // 审批人须已全勾检查项
    const allGateIds = getGateIds()
    if (allGateIds.length > 0) {
      const checked = gateChecks ?? []
      const missing = allGateIds.filter((id) => !checked.includes(id))
      if (missing.length > 0) {
        throw new Error('请先勾选全部审核检查项')
      }
    }

    review.decisions.push({
      username: assigned.username,
      name: reviewerUser?.name || assigned.username,
      decision: 'approved',
      comment: comment || '',
      decidedAt: new Date().toISOString(),
      gateChecks,
    })

    // 所有人投完票后再判定
    const result = resolveReviewStatus(review)
    if (result === 'approved') {
      review.status = 'approved'
      review.reviewedAt = new Date().toISOString()
      steps[3] = 'done'
      applyPipelineStatus(project, version, steps)
      version.status = '已发布'
      version.statusVariant = 'success'
      persistVersionMeta(project.key, version)
      persistProjectMeta({ ...project, status: '已发布', statusVariant: 'success' })
      // 全票通过 → 自动把版本归档到与项目绑定的数据空间（本地中转，供后续 rsync 发布）。
      // 失败仅记录日志，不影响审批状态（审批正确性优先）。
      try {
        const dsEntry = ensureProjectDataSpaceEntry(project.key, project.name, version.version)
        copyVersionToDataSpace({
          projectKey: project.key,
          projectName: project.name,
          version: version.version,
          dataSpaceId: dsEntry.id,
        })
        // 归档成功后，计算该版本 data/ 目录的业务文件数，累加到数据空间缓存
        const versionFileCount = countVersionFiles(resolveVersionCwd(project.key, version.version))
        bumpDataSpaceFileCount(dsEntry.id, versionFileCount)
      } catch (e) {
        console.error(`[approvePipeline] 自动归档到数据空间失败 (project=${project.key}, version=${version.version}):`, e)
      }
    } else if (result === 'rejected') {
      // 有人驳回 → 整体驳回
      review.status = 'rejected'
      review.reviewedAt = new Date().toISOString()
      steps[3] = 'empty'
      steps[2] = 'done'
      applyPipelineStatus(project, version, steps)
      version.status = '已驳回'
      version.statusVariant = 'danger'
      persistVersionMeta(project.key, version)
      persistProjectMeta({ ...project, status: '已驳回', statusVariant: 'danger' })
    }
    // result === 'pending' → 还有人没投，保持 pending

    writeReviews(reviews)
    const pipeline = buildPipelineData(project, version, steps, reviewer)
    return { review, pipeline }
  })
}

/** 驳回（所有人投完票后再判定，不立即生效） */
export function rejectPipeline(
  projectKey: string,
  reviewer: string,
  comment?: string,
  versionId?: string,
  gateChecksFallback?: string[],
): { review: ReviewRecord; pipeline: unknown } {
  return withReviewsLock(() => {
    const project = getProject(projectKey)
    const version = resolveVersion(project, versionId)
    const steps = normalizeStepStates(version.steps)

    const reviews = readReviews()
    const review = reviews.reviews.find(
      (r) => r.projectKey === project.key && r.version === version.version && r.status === 'pending',
    )
    if (!review) throw new Error('未找到待审核记录')

    const assigned = assertCanDecide(review, reviewer)
    const reviewerUser = findUser(reviewer)

    // 清除 saveGateChecks 的预勾选占位 decision，避免展示冲突
    const preDecision = review.decisions.find((d) => d.username === reviewer && d.decidedAt === '')
    const gateChecks = preDecision?.gateChecks ?? gateChecksFallback
    if (preDecision) {
      review.decisions = review.decisions.filter((d) => d.username !== reviewer)
    }

    review.decisions.push({
      username: assigned.username,
      name: reviewerUser?.name || assigned.username,
      decision: 'rejected',
      comment: comment || '',
      decidedAt: new Date().toISOString(),
      gateChecks,
    })

    // 所有人投完票后再判定
    const result = resolveReviewStatus(review)
    if (result === 'rejected') {
      review.status = 'rejected'
      review.reviewedAt = new Date().toISOString()
      steps[3] = 'empty'
      steps[2] = 'done'
      applyPipelineStatus(project, version, steps)
      version.status = '已驳回'
      version.statusVariant = 'danger'
      persistVersionMeta(project.key, version)
      persistProjectMeta({ ...project, status: '已驳回', statusVariant: 'danger' })
    } else if (result === 'approved') {
      // 虽然有人点了驳回，但最终判定为通过（理论上不会走到这，因为有一票驳回）
      review.status = 'approved'
      review.reviewedAt = new Date().toISOString()
      steps[3] = 'done'
      applyPipelineStatus(project, version, steps)
      version.status = '已发布'
      version.statusVariant = 'success'
      persistVersionMeta(project.key, version)
      persistProjectMeta({ ...project, status: '已发布', statusVariant: 'success' })
    }
    // result === 'pending' → 还有人没投，驳回暂不生效，其他人仍可操作

    writeReviews(reviews)
    const pipeline = buildPipelineData(project, version, steps, reviewer)
    return { review, pipeline }
  })
}

/** 获取当前版本的审核进度（供前端展示已批 X/N） */
export interface ReviewProgress {
  assigned: number
  approved: number
  rejected: number
  status: string
  myDecision?: string
  submitComment: string
  submittedBy: string
  decisions: ReviewerDecision[]
  assignedReviewers: { username: string; name: string }[]
  /** 历史审核轮次的决策记录（驳回后重新提交时，保留之前的审核日志） */
  historyDecisions: { round: number; decisions: ReviewerDecision[]; submittedBy: string; submitComment: string; status: string }[]
}
export function getReviewProgress(projectKey: string, version: string, currentUser?: string): ReviewProgress | null {
  const allReviews = readReviews().reviews.filter(
    (r) => r.projectKey === projectKey && r.version === version,
  )
  if (!allReviews.length) return null

  // 当前记录：优先 pending，其次最新的（listAllReviews 按 submittedAt DESC，所以 [0] 最新）
  const review = allReviews.find((r) => r.status === 'pending') ?? allReviews[0]

  const realDecisions = review.decisions.filter((d) => d.decidedAt !== '')
  const approved = realDecisions.filter((d) => d.decision === 'approved').length
  const rejected = realDecisions.filter((d) => d.decision === 'rejected').length
  const mine = realDecisions.find((d) => d.username === currentUser)

  // 构建历史轮次（排除当前这条）
  const historyDecisions = allReviews
    .filter((r) => r.id !== review.id)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    .map((r, i) => ({
      round: i + 1,
      decisions: r.decisions,
      submittedBy: r.submittedBy,
      submitComment: r.submitComment || '',
      status: r.status,
    }))

  return {
    assigned: review.assignedReviewers.length,
    approved,
    rejected,
    status: review.status,
    myDecision: mine?.decision,
    submitComment: review.submitComment || '',
    submittedBy: review.submittedBy || '',
    decisions: realDecisions,
    assignedReviewers: review.assignedReviewers,
    historyDecisions,
  }
}

```
