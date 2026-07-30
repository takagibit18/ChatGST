# 工作空间 — 文件树 CRUD

> 源文件：`bridge/src/workspace.ts`

```typescript
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { resolveVersionCwd } from './projects.js'
import { dataSpaceCwd } from './paths.js'
import { copyDirSync } from './fs-safe.js'

const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * 按 id 前缀路由到正确的物理 cwd
 * - ds-<UUID>: 走独立数据空间 dataspaces/<id>/
 * - proj-<UUID> (或任何其他): 走老项目路径 workspace/<id>/versions/<v>/
 */
function resolveOwnerCwd(id: string, versionId?: string): string {
  if (id.startsWith('ds-')) return dataSpaceCwd(id)
  return resolveVersionCwd(id, versionId)
}

const TEXT_EXTS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.py',
  '.go',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.rs',
  '.sh',
  '.sql',
  '.html',
  '.css',
  '.scss',
  '.mjs',
  '.cjs',
])

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

/**
 * 编辑模式文件栏隐藏名单（相对版本工作区根路径，正斜杠）。
 * 名单中的文件/目录不会出现在 GET files/tree 结果里，避免向用户暴露项目元数据。
 * 后续可继续追加，例如：project.json 相关路径、内部索引等。
 */
export const FILE_TREE_HIDDEN_PATHS: ReadonlySet<string> = new Set([
  'version.json',
  'session-prefs.json',
])

function normTreePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/** 是否应在文件树中隐藏（精确相对路径匹配） */
export function isHiddenFromFileTree(relPath: string): boolean {
  const p = normTreePath(relPath)
  if (!p) return false
  if (FILE_TREE_HIDDEN_PATHS.has(p)) return true
  // 隐藏目录本身及其所有子路径：若名单含 `meta/`，则 `meta/a.json` 也隐藏
  for (const hidden of FILE_TREE_HIDDEN_PATHS) {
    if (hidden.endsWith('/') && p.startsWith(hidden)) return true
    if (!hidden.endsWith('/') && p.startsWith(hidden + '/')) return true
  }
  return false
}

function resolveSafe(cwd: string, relPath: string): string {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const full = resolve(cwd, cleaned)
  const root = resolve(cwd)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error('Path escapes workspace')
  }
  return full
}

export function ensureProjectWorkspace(projectId: string, versionId?: string): string {
  const cwd = resolveOwnerCwd(projectId, versionId)
  mkdirSync(cwd, { recursive: true })
  // 项目型数据空间根目录（无版本）不预建 data/skills，避免出现空目录；
  // 版本子目录与普通项目工作区才确保 data/skills 存在。
  const isDataspaceRoot = projectId.startsWith('ds-') && cwd === dataSpaceCwd(projectId)
  if (!isDataspaceRoot) {
    mkdirSync(join(cwd, 'data'), { recursive: true })
    mkdirSync(join(cwd, 'skills'), { recursive: true })
  }
  return cwd
}

function walkDir(cwd: string, absDir: string): FileNode[] {
  const entries = readdirSync(absDir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name.startsWith('.')) continue
    const abs = join(absDir, ent.name)
    const rel = relative(cwd, abs).split(sep).join('/')
    if (isHiddenFromFileTree(rel)) continue
    if (ent.isDirectory()) {
      nodes.push({ name: ent.name, path: rel, type: 'dir', children: walkDir(cwd, abs) })
    } else {
      nodes.push({ name: ent.name, path: rel, type: 'file' })
    }
  }
  return nodes
}

export function getFileTree(projectId: string, versionId: string): FileNode[] {
  const cwd = ensureProjectWorkspace(projectId, versionId)
  return walkDir(cwd, cwd)
}

export function readFileContent(projectId: string, versionId: string, relPath: string): { path: string; content: string } {
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const full = resolveSafe(cwd, relPath)
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw new Error('File not found')
  }
  const st = statSync(full)
  if (st.size > MAX_FILE_BYTES) {
    throw new Error('File too large')
  }
  const ext = extname(full).toLowerCase()
  if (ext && !TEXT_EXTS.has(ext)) {
    // allow no-ext and known text; reject obvious binaries by extension only
    const binary = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.wasm', '.exe']
    if (binary.includes(ext)) throw new Error('Binary files are not supported')
  }
  return { path: relPath.replace(/\\/g, '/'), content: readFileSync(full, 'utf-8') }
}

export function writeFileContent(projectId: string, versionId: string, relPath: string, content: string): { path: string } {
  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) {
    throw new Error('Content too large')
  }
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const full = resolveSafe(cwd, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return { path: relPath.replace(/\\/g, '/') }
}

export function createSkillTemplate(
  projectId: string,
  versionId: string,
  name: string,
  description = '项目技能',
): { path: string } {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) throw new Error('Invalid skill name')
  const rel = `skills/${id}/SKILL.md`
  const body = `---
name: ${id}
description: ${description}
---

# ${name}

在此编写技能说明与操作步骤。
`
  writeFileContent(projectId, versionId, rel, body)
  return { path: rel }
}

/** Create a skill with custom content (e.g. LLM-generated). */
export function createSkillWithContent(
  projectId: string,
  versionId: string,
  name: string,
  description: string,
  content: string,
): { path: string } {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) throw new Error('Invalid skill name')
  const rel = `skills/${id}/SKILL.md`
  writeFileContent(projectId, versionId, rel, content)
  return { path: rel }
}

/** Read up to `maxFiles` text files from the data/ directory for LLM context. */
export function readDataContext(
  projectId: string,
  versionId: string,
  maxFiles = 5,
  maxChars = 2000,
): string[] {
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const dataDir = join(cwd, 'data')
  if (!existsSync(dataDir)) return []
  const results: string[] = []
  try {
    const entries = readdirSync(dataDir, { withFileTypes: true })
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (results.length >= maxFiles) break
      if (!ent.isFile()) continue
      const ext = extname(ent.name).toLowerCase()
      if (!TEXT_EXTS.has(ext) && ext !== '.md') continue
      const full = join(dataDir, ent.name)
      try {
        const raw = readFileSync(full, 'utf-8')
        results.push(`--- ${ent.name} ---\n${raw.slice(0, maxChars)}${raw.length > maxChars ? '\n...(truncated)' : ''}`)
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* data dir not readable */
  }
  return results
}

function normRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function assertNotRoot(relPath: string) {
  if (!normRel(relPath)) throw new Error('Cannot operate on workspace root')
}

export function mkdirPath(projectId: string, versionId: string, relPath: string): { path: string } {
  const path = normRel(relPath)
  assertNotRoot(path)
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const full = resolveSafe(cwd, path)
  if (existsSync(full)) throw new Error('Path already exists')
  mkdirSync(full, { recursive: true })
  return { path }
}

export function createEmptyFile(
  projectId: string,
  versionId: string,
  relPath: string,
  content = '',
): { path: string } {
  const path = normRel(relPath)
  assertNotRoot(path)
  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) {
    throw new Error('Content too large')
  }
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const full = resolveSafe(cwd, path)
  if (existsSync(full)) throw new Error('File already exists')
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return { path }
}

export function renamePath(projectId: string, versionId: string, from: string, to: string): { path: string } {
  const src = normRel(from)
  const dest = normRel(to)
  assertNotRoot(src)
  assertNotRoot(dest)
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const srcFull = resolveSafe(cwd, src)
  const destFull = resolveSafe(cwd, dest)
  if (!existsSync(srcFull)) throw new Error('Source not found')
  if (existsSync(destFull)) throw new Error('Destination already exists')
  mkdirSync(dirname(destFull), { recursive: true })
  renameSync(srcFull, destFull)
  return { path: dest }
}

export function deletePath(projectId: string, versionId: string, relPath: string): { path: string } {
  const path = normRel(relPath)
  assertNotRoot(path)
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const full = resolveSafe(cwd, path)
  if (!existsSync(full)) throw new Error('Path not found')
  rmSync(full, { recursive: true, force: true })
  return { path }
}

export function copyPath(projectId: string, versionId: string, from: string, to: string): { path: string } {
  const src = normRel(from)
  const dest = normRel(to)
  assertNotRoot(src)
  assertNotRoot(dest)
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const srcFull = resolveSafe(cwd, src)
  const destFull = resolveSafe(cwd, dest)
  if (!existsSync(srcFull)) throw new Error('Source not found')
  if (existsSync(destFull)) throw new Error('Destination already exists')
  mkdirSync(dirname(destFull), { recursive: true })
  const st = statSync(srcFull)
  if (st.isDirectory()) {
    copyDirSync(srcFull, destFull)
  } else {
    copyFileSync(srcFull, destFull)
  }
  return { path: dest }
}

export function movePath(projectId: string, versionId: string, from: string, to: string): { path: string } {
  return renamePath(projectId, versionId, from, to)
}

export function getDownloadFile(
  projectId: string,
  versionId: string,
  relPath: string,
): { absPath: string; filename: string } {
  const path = normRel(relPath)
  assertNotRoot(path)
  const cwd = ensureProjectWorkspace(projectId, versionId)
  const full = resolveSafe(cwd, path)
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw new Error('File not found')
  }
  return { absPath: full, filename: basename(full) }
}

```
