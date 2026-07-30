# 角色权限 — RBAC 权限点管理

> 源文件：`bridge/src/roles-store.ts`

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getRoleRow, listRoleRows, saveRoleRow, deleteRoleRow } from './project-store.js'

const GS_DIR = process.env.GS_PLATFORM_HOME || join(homedir(), '.gs_platform')
const ROLES_PATH = join(GS_DIR, 'roles.json')

export interface Role {
  code: string
  name: string
  description: string
  permissions: string[]
}

interface RolesFile {
  roles: Role[]
}

/**
 * 所有可选权限点（极简版，功能层级）。
 * 与前端 src/types/auth.ts 的 Permission 类型保持一致。
 *
 * 说明：`user:change-password` 不在此列 —— 任何已登录用户都能改自己密码，
 * 不需要通过角色分配。
 */
export const ALL_PERMISSION_POINTS: { code: string; name: string; description: string }[] = [
  { code: 'project', name: '项目空间', description: '项目流水线、数据空间、本体建模、智能体（查看+编辑一体）' },
  { code: 'task', name: '待办事项', description: '审批/驳回流水线、查看待办审核任务' },
  { code: 'user:manage', name: '用户管理', description: '管理平台用户与角色（含重置密码、禁用/启用）' },
]

/**
 * 系统内置角色定义（首次启动时写入作为默认值）。
 * 修改角色权限直接改此处，首次部署会据此生成；
 * 已存在数据时以 SQLite/JSON 为准（支持运行时定制）。
 */
const DEFAULT_ROLES: RolesFile = {
  roles: [
    {
      code: 'admin',
      name: '平台超管',
      description: '全部功能 + 用户管理',
      permissions: ['*'],
    },
    {
      code: 'developer',
      name: '开发人员',
      description: '项目空间、待办事项',
      permissions: ['project', 'task'],
    },
    {
      code: 'reviewer',
      name: '审核人员',
      description: '项目空间、待办事项',
      permissions: ['project', 'task'],
    },
  ],
}

/**
 * 旧权限点 → 新权限点的映射（用于自动迁移）。
 */
const LEGACY_PERMISSION_MAP: Record<string, string> = {
  'pipeline:view': 'project',
  'pipeline:edit': 'project',
  'step1:edit': 'project',
  'step2:view': 'project',
  'step2:edit': 'project',
  'step3:edit': 'project',
  'skill:generate': 'project',
  'skill:edit': 'project',
  'file:edit': 'project',
  'agent:chat': 'project',
  'agent:chat-readonly': 'project',
  'step4:submit': 'project',
  'step4:review': 'task',
  'step4:approve': 'task',
  'step4:reject': 'task',
  'dataspace:view': 'project',
  'dataspace:edit': 'project',
  'dataspace': 'project',
  'task:view': 'task',
  'review': 'task',
  'user:reset-password': 'user:manage',
  'project:view': 'project',
  'project:edit': 'project',
}

let cached: RolesFile | null = null

/** 所有当前有效的权限点（含通配符） */
const VALID_PERMISSIONS = new Set([...ALL_PERMISSION_POINTS.map((p) => p.code), '*'])

function migratePermissionList(perms: string[]): { result: string[]; changed: boolean } {
  let changed = false
  const migrated = new Set<string>()
  for (const p of perms) {
    if (p === '*') {
      migrated.add('*')
      continue
    }
    const mapped = LEGACY_PERMISSION_MAP[p]
    if (mapped) {
      migrated.add(mapped)
      changed = true
    } else if (VALID_PERMISSIONS.has(p) || p === 'user:change-password') {
      migrated.add(p)
    } else {
      migrated.add(p)
    }
  }
  return { result: [...migrated], changed }
}

// ===== 镜像写入层：写 JSON 文件 =====

function writeRolesFile(data: RolesFile): void {
  if (!existsSync(GS_DIR)) mkdirSync(GS_DIR, { recursive: true })
  writeFileSync(ROLES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/** 双写：SQLite 主存储 + JSON 镜像 + 失效缓存 */
function persistRole(role: Role): void {
  saveRoleRow(role)
  // 同步 JSON 镜像
  const all = loadRolesRaw()
  const idx = all.roles.findIndex((r) => r.code === role.code)
  if (idx >= 0) all.roles[idx] = role
  else all.roles.push(role)
  writeRolesFile(all)
  invalidateCache()
}

/** 双写删除 */
function removeRole(code: string): void {
  deleteRoleRow(code)
  const all = loadRolesRaw().roles.filter((r) => r.code !== code)
  writeRolesFile({ roles: all })
  invalidateCache()
}

/** Invalidate cache so next read picks up changes */
function invalidateCache(): void {
  cached = null
}

// ===== 读取层：SQLite 优先，JSON fallback =====

/** 从 SQLite 读全量角色，空时 fallback JSON（含默认种子） */
function loadRolesRaw(): RolesFile {
  const rows = listRoleRows()
  if (rows.length) {
    return {
      roles: rows.map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
      })),
    }
  }
  // fallback：SQLite 为空时读 JSON（含首次种子逻辑）
  return loadRolesJson()
}

/** 从 JSON 读（含首次种子、迁移、默认值回退） */
function loadRolesJson(): RolesFile {
  if (!existsSync(ROLES_PATH)) {
    if (!existsSync(GS_DIR)) mkdirSync(GS_DIR, { recursive: true })
    writeRolesFile(DEFAULT_ROLES)
    // 首次启动：默认角色同时写入 SQLite
    for (const r of DEFAULT_ROLES.roles) saveRoleRow(r)
    return DEFAULT_ROLES
  }
  try {
    const parsed = JSON.parse(readFileSync(ROLES_PATH, 'utf-8')) as RolesFile
    if (!Array.isArray(parsed.roles)) throw new Error('invalid roles.json')
    // 迁移旧权限点
    let changed = false
    const newRoles = parsed.roles.map((role) => {
      const { result, changed: permChanged } = migratePermissionList(role.permissions)
      if (permChanged) changed = true
      return { ...role, permissions: result }
    })
    const result = { roles: newRoles }
    if (changed) {
      writeRolesFile(result)
      for (const r of result.roles) saveRoleRow(r)
      console.log('[roles-store] 自动迁移旧权限点到新格式')
    }
    return result
  } catch {
    return DEFAULT_ROLES
  }
}

/** 带缓存的读取入口 */
function loadRoles(): RolesFile {
  if (cached) return cached
  cached = loadRolesRaw()
  return cached
}

// ===== 对外 API（签名不变）=====

/** List all roles */
export function listRoles(): Role[] {
  return loadRoles().roles
}

/** Find a role by code */
export function findRole(code: string): Role | undefined {
  // 优先从 SQLite 单行查询
  const row = getRoleRow(code)
  if (row) {
    return { code: row.code, name: row.name, description: row.description, permissions: row.permissions }
  }
  return loadRoles().roles.find((r) => r.code === code)
}

/** Get permissions array for a role code; empty if role not found */
export function getPermissions(roleCode: string): string[] {
  const role = findRole(roleCode)
  return role?.permissions || []
}

/** Check if a role has a specific permission point. '*' grants all. */
export function hasPermission(roleCode: string, point: string): boolean {
  const perms = getPermissions(roleCode)
  if (perms.includes('*')) return true
  return perms.includes(point)
}

/** Check if a permissions array (already resolved) includes a point. '*' grants all. */
export function permissionsInclude(permissions: string[], point: string): boolean {
  if (permissions.includes('*')) return true
  return permissions.includes(point)
}

// ===== 角色管理 CRUD（admin 运行时定制） =====

/** 内置角色代码：不可删除，不可改名称/描述，只可编辑权限 */
export const BUILTIN_ROLE_CODES = ['admin', 'developer', 'reviewer']

/** 是否为内置角色 */
export function isBuiltinRole(code: string): boolean {
  return BUILTIN_ROLE_CODES.includes(code)
}

/** Update an existing role's name/description/permissions */
export function updateRole(
  code: string,
  patch: Partial<Pick<Role, 'name' | 'description' | 'permissions'>>,
): Role {
  const data = loadRoles()
  const idx = data.roles.findIndex((r) => r.code === code)
  if (idx < 0) throw new Error('角色不存在')
  if (isBuiltinRole(code)) {
    if (patch.name !== undefined) {
      throw new Error('内置角色不允许修改名称')
    }
  }
  if (code === 'admin' && patch.permissions && !patch.permissions.includes('*')) {
    throw new Error('平台超管必须拥有全部权限（*）')
  }
  data.roles[idx] = { ...data.roles[idx], ...patch }
  persistRole(data.roles[idx])
  return data.roles[idx]
}

/** Create a new role */
export function createRole(input: {
  code: string
  name: string
  description?: string
  permissions?: string[]
}): Role {
  const code = input.code.trim()
  if (!code) throw new Error('角色代码不能为空')
  const data = loadRoles()
  if (data.roles.some((r) => r.code === code)) throw new Error('角色代码已存在')
  const role: Role = {
    code,
    name: input.name.trim() || code,
    description: input.description?.trim() || '',
    permissions: input.permissions || [],
  }
  persistRole(role)
  return role
}

/** Delete a role (built-in roles cannot be deleted) */
export function deleteRole(code: string): void {
  if (isBuiltinRole(code)) {
    throw new Error('内置角色不允许删除')
  }
  const data = loadRoles()
  const idx = data.roles.findIndex((r) => r.code === code)
  if (idx < 0) throw new Error('角色不存在')
  removeRole(code)
}

```
