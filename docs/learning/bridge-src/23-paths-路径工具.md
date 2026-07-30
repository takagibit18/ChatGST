# 路径工具 — 目录初始化

> 源文件：`bridge/src/paths.ts`

```typescript
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 配置文件路径：与 src/ 同级的 config.json（可被环境变量覆盖） */
const CONFIG_PATH = process.env.POLICY_BRIDGE_CONFIG ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json')

interface PathsConfig {
  /** 工作区根目录（项目用）。可相对路径，相对 bridge 根目录解析。 */
  workspaceDir?: string
  /** 数据空间根目录（独立于项目）。可相对路径，相对 bridge 根目录解析。 */
  dataspaceDir?: string
}

/** 读取 config.json 中的路径配置（仅取路径相关字段） */
function loadPathsConfig(): PathsConfig {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as PathsConfig
    return {
      workspaceDir: raw.workspaceDir,
      dataspaceDir: raw.dataspaceDir,
    }
  } catch {
    return {}
  }
}

/** bridge 根目录（src/ 的上一级），用于解析相对配置路径 */
const BRIDGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 将可能的相对路径解析为绝对路径（相对 bridge 根目录） */
function resolveDir(dir: string): string {
  return resolve(BRIDGE_ROOT, dir)
}

const cfg = loadPathsConfig()

/**
 * 平台工作区根目录。
 * 优先级：环境变量 GS_PLATFORM_WORKSPACE > config.json.workspaceDir > ~/.gs_platform/workspace
 */
export const WORKSPACES_DIR =
  process.env.GS_PLATFORM_WORKSPACE ||
  (cfg.workspaceDir ? resolveDir(cfg.workspaceDir) : join(homedir(), '.gs_platform', 'workspace'))

/**
 * 数据空间根目录（独立于项目）。
 * 优先级：环境变量 GS_PLATFORM_DATASPACE > config.json.dataspaceDir > ~/.gs_platform/dataspaces
 */
export const DATASPACES_DIR =
  process.env.GS_PLATFORM_DATASPACE ||
  (cfg.dataspaceDir ? resolveDir(cfg.dataspaceDir) : join(homedir(), '.gs_platform', 'dataspaces'))

export function projectCwd(projectId: string): string {
  // 允许中文字符、字母、数字、._-，其余替换为 _
  const safe = projectId.replace(/[^\w\u4e00-\u9fa5.-]/g, '_')
  return join(WORKSPACES_DIR, safe)
}

/** 数据空间物理目录：与项目隔离，不被 versions/ 包裹 */
export function dataSpaceCwd(spaceId: string): string {
  // 允许中文字符、字母、数字、._-，其余替换为 _
  const safe = spaceId.replace(/[^\w\u4e00-\u9fa5.-]/g, '_')
  return join(DATASPACES_DIR, safe)
}

export function ensureWorkspacesRoot(): void {
  mkdirSync(WORKSPACES_DIR, { recursive: true })
}

export function ensureDataspacesRoot(): void {
  mkdirSync(DATASPACES_DIR, { recursive: true })
}

```
