# 用户管理 — 用户 CRUD

> 源文件：`bridge/src/users-store.ts`

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { hashPassword, verifyPassword, isPasswordHashed, validatePasswordStrength } from './crypto.js'
import { getUserRow, listUserRows, saveUserRow, deleteUserRow } from './project-store.js'

const GS_DIR = process.env.GS_PLATFORM_HOME || join(homedir(), '.gs_platform')
const USERS_PATH = join(GS_DIR, 'users.json')

export interface UserRecord {
  username: string
  password: string
  name: string
  role: string
  email: string
  status: 'active' | 'disabled'
}

interface UsersFile {
  users: UserRecord[]
}

function emptyFile(): UsersFile {
  return { users: [] }
}

const lockHeld = new Set<string>()

function withLock<T>(key: string, fn: () => T): T {
  if (lockHeld.has(key)) {
    throw new Error(`Re-entrant file lock on ${key}`)
  }
  lockHeld.add(key)
  try {
    return fn()
  } finally {
    lockHeld.delete(key)
  }
}

// ===== 读取层：SQLite 优先，JSON fallback =====

/** 从 SQLite 读全量用户（含 password hash），空时 fallback JSON */
function readAllUsers(): UserRecord[] {
  const rows = listUserRows()
  if (rows.length) {
    return rows.map((r) => ({
      username: r.username,
      password: r.password,
      name: r.name,
      role: r.role,
      email: r.email,
      status: (r.status === 'disabled' ? 'disabled' : 'active') as UserRecord['status'],
    }))
  }
  // fallback：SQLite 为空时读 JSON（首次启动或迁移前）
  return readUsersJson().users
}

/** 从 JSON 文件读（仅作为 fallback 和镜像写入用） */
function readUsersJson(): UsersFile {
  if (!existsSync(USERS_PATH)) return emptyFile()
  try {
    const raw = JSON.parse(readFileSync(USERS_PATH, 'utf-8')) as UsersFile
    if (!Array.isArray(raw.users)) return emptyFile()
    return raw
  } catch {
    return emptyFile()
  }
}

// ===== 镜像写入层：写 JSON 文件，与 SQLite 保持一致 =====

function writeUsersMirror(data: UsersFile): void {
  if (!existsSync(GS_DIR)) mkdirSync(GS_DIR, { recursive: true })
  writeFileSync(USERS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/** 双写：SQLite 主存储 + JSON 镜像 */
function persistUser(user: UserRecord): void {
  saveUserRow(user)
  // 同步 JSON 镜像（读全量后替换/追加当前用户）
  const all = readAllUsers()
  const idx = all.findIndex((u) => u.username === user.username)
  if (idx >= 0) all[idx] = user
  else all.push(user)
  writeUsersMirror({ users: all })
}

/** 双写删除 */
function removeUser(username: string): void {
  deleteUserRow(username)
  const all = readAllUsers().filter((u) => u.username !== username)
  writeUsersMirror({ users: all })
}

// ===== 对外 API（签名不变）=====

/** List all users (passwords included — internal use only) */
export function listUsersRaw(): UserRecord[] {
  return readAllUsers()
}

/** List all users for API response (strip passwords) */
export function listUsers(): Omit<UserRecord, 'password'>[] {
  return readAllUsers().map(({ password: _pwd, ...rest }) => rest)
}

/** List users brief info for Dashboard (no sensitive fields, no admin permission needed) */
export function listUsersBrief(): { username: string; name: string; role: string }[] {
  return readAllUsers().map(({ username, name, role }) => ({ username, name, role }))
}

/** Find a user by username (includes password hash for verification) */
export function findUser(username: string): UserRecord | undefined {
  // 优先从 SQLite 单行查询（更快）
  const row = getUserRow(username)
  if (row) {
    return {
      username: row.username,
      password: row.password,
      name: row.name,
      role: row.role,
      email: row.email,
      status: (row.status === 'disabled' ? 'disabled' : 'active') as UserRecord['status'],
    }
  }
  // fallback JSON
  return readUsersJson().users.find((u) => u.username === username)
}

/** Verify a plaintext password against stored hash */
export function verifyUserPassword(username: string, plainPassword: string): boolean {
  const user = findUser(username)
  if (!user) return false
  return verifyPassword(plainPassword, user.password)
}

/** Create a new user */
export function createUser(input: {
  username: string
  password: string
  name: string
  role: string
  email?: string
}): Omit<UserRecord, 'password'> {
  return withLock(USERS_PATH, () => {
    validatePasswordStrength(input.password)
    const all = readAllUsers()
    if (all.some((u) => u.username === input.username)) {
      throw new Error('用户名已存在')
    }
    const user: UserRecord = {
      username: input.username.trim(),
      password: hashPassword(input.password),
      name: input.name.trim() || input.username,
      role: input.role,
      email: input.email || '',
      status: 'active',
    }
    persistUser(user)
    const { password: _pwd, ...rest } = user
    return rest
  })
}

/** Update a user (partial update, not password) */
export function updateUser(
  username: string,
  patch: Partial<Pick<UserRecord, 'name' | 'role' | 'email' | 'status'>>,
): Omit<UserRecord, 'password'> {
  return withLock(USERS_PATH, () => {
    const all = readAllUsers()
    const idx = all.findIndex((u) => u.username === username)
    if (idx < 0) throw new Error('用户不存在')
    all[idx] = { ...all[idx], ...patch }
    persistUser(all[idx])
    const { password: _pwd, ...rest } = all[idx]
    return rest
  })
}

/** Change password (verifies old password first, validates new password strength) */
export function changePassword(username: string, oldPassword: string, newPassword: string): void {
  withLock(USERS_PATH, () => {
    const all = readAllUsers()
    const idx = all.findIndex((u) => u.username === username)
    if (idx < 0) throw new Error('用户不存在')
    if (!verifyPassword(oldPassword, all[idx].password)) {
      throw new Error('旧密码不正确')
    }
    validatePasswordStrength(newPassword)
    all[idx].password = hashPassword(newPassword)
    persistUser(all[idx])
  })
}

/** Reset password (admin operation, sets new password directly) */
export function resetPassword(username: string, newPassword: string): void {
  withLock(USERS_PATH, () => {
    const all = readAllUsers()
    const idx = all.findIndex((u) => u.username === username)
    if (idx < 0) throw new Error('用户不存在')
    all[idx].password = hashPassword(newPassword)
    persistUser(all[idx])
  })
}

/** Disable a user (cannot disable self) */
export function disableUser(username: string, operator: string): void {
  withLock(USERS_PATH, () => {
    if (username === operator) throw new Error('不允许禁用自己的账号')
    const all = readAllUsers()
    const idx = all.findIndex((u) => u.username === username)
    if (idx < 0) throw new Error('用户不存在')
    if (all[idx].status === 'disabled') throw new Error('用户已是禁用状态')
    all[idx].status = 'disabled'
    persistUser(all[idx])
  })
}

/** Enable a previously disabled user */
export function enableUser(username: string): void {
  withLock(USERS_PATH, () => {
    const all = readAllUsers()
    const idx = all.findIndex((u) => u.username === username)
    if (idx < 0) throw new Error('用户不存在')
    if (all[idx].status === 'active') throw new Error('用户已是正常状态')
    all[idx].status = 'active'
    persistUser(all[idx])
  })
}

/** Delete a user (cannot delete self) */
export function deleteUser(username: string, operator: string): void {
  withLock(USERS_PATH, () => {
    if (username === operator) throw new Error('不允许删除自己的账号')
    const all = readAllUsers()
    const idx = all.findIndex((u) => u.username === username)
    if (idx < 0) throw new Error('用户不存在')
    removeUser(username)
  })
}

/** Migrate from config.json auth section on first start */
export function migrateFromConfig(configAuth: {
  username: string
  password: string
  displayName?: string
  role?: string
  email?: string
}): void {
  if (existsSync(USERS_PATH)) {
    migratePlaintextPasswords()
    return
  }
  if (!existsSync(GS_DIR)) mkdirSync(GS_DIR, { recursive: true })
  const user: UserRecord = {
    username: configAuth.username,
    password: hashPassword(configAuth.password),
    name: configAuth.displayName || '系统管理员',
    role: 'admin',
    email: configAuth.email || '',
    status: 'active',
  }
  // 双写：SQLite + JSON
  persistUser(user)
}

/** Auto-migrate any plaintext passwords to scrypt hashes */
export function migratePlaintextPasswords(): void {
  withLock(USERS_PATH, () => {
    const all = readAllUsers()
    let changed = false
    for (let i = 0; i < all.length; i++) {
      if (!isPasswordHashed(all[i].password)) {
        all[i].password = hashPassword(all[i].password)
        changed = true
      }
    }
    if (changed) {
      // 逐个双写回
      for (const u of all) persistUser(u)
    }
  })
}

```
