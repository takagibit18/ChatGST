# 持久化存储 — SQLite 操作层

> 源文件：`bridge/src/project-store.ts`

```typescript
/**

 * 项目/版本元数据存储层（基于 sql.js / SQLite Wasm）

 * 数据库文件：~/.gs_platform/projects.db

 *

 * 替代原 manifest.json + project.json + version.json 文件存储。

 * 启动时若 DB 为空且存在旧 JSON 文件，自动一次性迁移。

 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'

import { homedir } from 'node:os'

import { join, dirname } from 'node:path'

import initSqlJs, { type Database } from 'sql.js'

import type { OntoCloneRecord, OntoRegionSummary } from './types.js'



const GS_DIR = process.env.GS_PLATFORM_HOME || join(homedir(), '.gs_platform')

const DB_PATH = join(GS_DIR, 'projects.db')

const WORKSPACES_DIR = join(GS_DIR, 'workspace')



// ===== 类型（与 projects.ts 保持一致，避免循环依赖在此重复定义） =====



export interface StoredProject {

  key: string

  name: string

  description: string

  owner: { name: string; color?: string; initials?: string }

  currentVersion: string

  createdAt: string

  updatedAt: string

  status: string

  statusVariant?: string

}



export interface StoredVersion {

  projectKey: string

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

  stepTimes?: Array<{ startedAt?: string; finishedAt?: string }>

  on_policy_id?: string

  on_policy_canonical?: string

  /** 建模产出元数据（入库，支持聚合查询；version.json 仅存镜像） */

  onto_rule_count?: number

  onto_region_count?: number

  onto_regions?: OntoRegionSummary[]

  onto_built_at?: string

  /** 克隆来源记录（含 pending/failed 意图，fallback 重放用） */

  onto_clone?: OntoCloneRecord

}



/** clone-sources 聚合行：已建模版本 + 项目名 */

export interface ModeledVersionRow {

  projectKey: string

  projectName: string

  versionId: string

  version: string

  policy_id: string

  canonical_name: string

  rule_count: number

  region_count: number

  regions: OntoRegionSummary[]

  built_at: string

}



let db: Database | null = null

let dirty = false



/** 启动时调用一次：初始化 DB + 迁移旧 JSON 数据 */

export async function initProjectStore(): Promise<void> {

  if (db) return

  const SQL = await initSqlJs()

  if (existsSync(DB_PATH)) {

    db = new SQL.Database(readFileSync(DB_PATH))

  } else {

    mkdirSync(dirname(DB_PATH), { recursive: true })

    db = new SQL.Database()

  }

  db.run(`

    CREATE TABLE IF NOT EXISTS projects (

      key            TEXT PRIMARY KEY,

      name           TEXT NOT NULL,

      description    TEXT DEFAULT '',

      owner          TEXT NOT NULL,

      currentVersion TEXT DEFAULT '',

      status         TEXT DEFAULT '',

      statusVariant  TEXT DEFAULT '',

      createdAt      TEXT NOT NULL,

      updatedAt      TEXT NOT NULL

    );

    CREATE TABLE IF NOT EXISTS versions (

      projectKey     TEXT NOT NULL,

      id             TEXT NOT NULL,

      version        TEXT NOT NULL,

      changelog      TEXT DEFAULT '',

      status         TEXT DEFAULT '',

      statusVariant  TEXT DEFAULT '',

      steps          TEXT DEFAULT '[]',

      stepTimes      TEXT,

      running        INTEGER DEFAULT 0,

      latest         INTEGER DEFAULT 0,

      on_policy_id   TEXT,

      on_policy_canonical TEXT,

      onto_rule_count INTEGER,

      onto_region_count INTEGER,

      onto_regions   TEXT,

      onto_built_at  TEXT,

      onto_clone     TEXT,

      createdAt      TEXT NOT NULL,

      updatedAt      TEXT NOT NULL,

      PRIMARY KEY (projectKey, id)

    );

    CREATE INDEX IF NOT EXISTS idx_versions_updated ON versions(updatedAt DESC);

    CREATE INDEX IF NOT EXISTS idx_versions_policy ON versions(on_policy_id);

    CREATE TABLE IF NOT EXISTS reviews (

      id              TEXT PRIMARY KEY,

      projectKey      TEXT NOT NULL,

      projectName     TEXT DEFAULT '',

      version         TEXT NOT NULL,

      submittedBy     TEXT DEFAULT '',

      submittedAt     TEXT NOT NULL,

      assignedReviewers TEXT DEFAULT '[]',

      decisions       TEXT DEFAULT '[]',

      status          TEXT DEFAULT 'pending',

      submitComment   TEXT DEFAULT '',

      reviewedAt      TEXT

    );

    CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(projectKey, version);

    CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

    CREATE INDEX IF NOT EXISTS idx_reviews_submitted ON reviews(submittedAt DESC);

    CREATE TABLE IF NOT EXISTS users (

      username   TEXT PRIMARY KEY,

      password   TEXT NOT NULL,

      name       TEXT DEFAULT '',

      role       TEXT DEFAULT '',

      email      TEXT DEFAULT '',

      status     TEXT DEFAULT 'active'

    );

    CREATE TABLE IF NOT EXISTS roles (

      code         TEXT PRIMARY KEY,

      name         TEXT DEFAULT '',

      description  TEXT DEFAULT '',

      permissions  TEXT DEFAULT '[]'

    );

    CREATE TABLE IF NOT EXISTS crawl_tasks (

      task_id          TEXT PRIMARY KEY,

      workspace        TEXT NOT NULL,

      subsidy_type     TEXT DEFAULT '',

      region           TEXT DEFAULT '',

      keyword          TEXT DEFAULT '',

      keyword_relation TEXT DEFAULT 'and',

      pages            INTEGER DEFAULT 5,

      use_gov_search   INTEGER DEFAULT 1,

      status           TEXT DEFAULT 'running',

      stage            TEXT DEFAULT '',

      progress_percent INTEGER DEFAULT 0,

      total_found      INTEGER DEFAULT 0,

      total_evaluated  INTEGER DEFAULT 0,

      total_accepted   INTEGER DEFAULT 0,

      total_saved      INTEGER DEFAULT 0,

      total_skipped    INTEGER DEFAULT 0,

      current_url      TEXT DEFAULT '',

      started_at       TEXT NOT NULL,

      finished_at      TEXT,

      created_at       TEXT NOT NULL

    );

    CREATE INDEX IF NOT EXISTS idx_crawl_tasks_workspace ON crawl_tasks(workspace);

    CREATE INDEX IF NOT EXISTS idx_crawl_tasks_status ON crawl_tasks(status);

  `)

  // 迁移：旧库缺列时补上（stepTimes 及建模元数据列）

  const cols = db.exec(`PRAGMA table_info(versions)`)

  const existing = new Set(cols.length ? cols[0].values.map((r) => String(r[1])) : [])

  for (const col of ['stepTimes', 'onto_rule_count', 'onto_region_count', 'onto_regions', 'onto_built_at', 'onto_clone']) {

    if (!existing.has(col)) {

      db.run(`ALTER TABLE versions ADD COLUMN ${col} ${col === 'onto_rule_count' || col === 'onto_region_count' ? 'INTEGER' : 'TEXT'}`)

    }

  }

  migrateFromJson()

  migrateUsersFromJson()

  migrateRolesFromJson()

  // 定时落盘

  setInterval(flush, 3000).unref?.()

}



function flush() {

  if (!db || !dirty) return

  try {

    writeFileSync(DB_PATH, Buffer.from(db.export()))

    dirty = false

  } catch (e) {

    console.error('[project-store] flush failed:', e)

  }

}



/** 进程退出前强制落盘 */

export function flushProjectStore(): void {

  flush()

}



// ===== JSON → SQLite 一次性迁移 =====



function migrateFromJson() {

  if (!db) return

  const count = db.exec('SELECT COUNT(*) FROM projects')

  const n = count.length ? Number(count[0].values[0][0]) : 0

  if (n > 0) return // 已有数据，不迁移



  const manifestPath = join(WORKSPACES_DIR, 'manifest.json')

  if (!existsSync(manifestPath)) return

  try {

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    const entries: { id: string }[] = manifest.projects || []

    let migrated = 0

    for (const entry of entries) {

      const projectJsonPath = join(WORKSPACES_DIR, entry.id, 'project.json')

      if (!existsSync(projectJsonPath)) continue

      try {

        const p = JSON.parse(readFileSync(projectJsonPath, 'utf-8'))

        saveProjectMeta({

          key: p.key || entry.id,

          name: p.name || entry.id,

          description: p.description || '',

          owner: p.owner || { name: '未知' },

          currentVersion: p.currentVersion || '',

          createdAt: p.createdAt || new Date().toISOString(),

          updatedAt: p.updatedAt || new Date().toISOString(),

          status: p.status || '',

          statusVariant: p.statusVariant || '',

        })

        // versions 目录

        const versionsDir = join(WORKSPACES_DIR, entry.id, 'versions')

        if (existsSync(versionsDir)) {

          for (const vent of readdirSync(versionsDir, { withFileTypes: true })) {

            if (!vent.isDirectory()) continue

            const vPath = join(versionsDir, vent.name, 'version.json')

            if (!existsSync(vPath)) continue

            try {

              const v = JSON.parse(readFileSync(vPath, 'utf-8'))

              saveVersionMeta({

                projectKey: p.key || entry.id,

                id: v.id || vent.name,

                version: v.version || vent.name,

                changelog: v.changelog || '',

                status: v.status || '',

                statusVariant: v.statusVariant || '',

                createdAt: v.createdAt || new Date().toISOString(),

                updatedAt: v.updatedAt || v.createdAt || new Date().toISOString(),

                steps: Array.isArray(v.steps) ? v.steps : [],

                running: !!v.running,

                latest: !!v.latest,

                stepTimes: v.stepTimes,

                on_policy_id: v.on_policy_id,

                on_policy_canonical: v.on_policy_canonical,

              })

            } catch { /* 单版本失败跳过 */ }

          }

        }

        migrated++

      } catch { /* 单项目失败跳过 */ }

    }

    if (migrated > 0) {

      console.log(`[project-store] migrated ${migrated} projects from JSON to SQLite`)

      dirty = true

      flush()

    }



    // 迁移 reviews.json

    const reviewsPath = join(GS_DIR, 'reviews.json')

    const reviewCount = db.exec('SELECT COUNT(*) FROM reviews')

    const rn = reviewCount.length ? Number(reviewCount[0].values[0][0]) : 0

    if (rn === 0 && existsSync(reviewsPath)) {

      try {

        const raw = JSON.parse(readFileSync(reviewsPath, 'utf-8'))

        const reviews = Array.isArray(raw.reviews) ? raw.reviews : []

        for (const r of reviews) {

          saveReview({

            id: r.id,

            projectKey: r.projectKey || '',

            projectName: r.projectName || '',

            version: r.version || '',

            submittedBy: r.submittedBy || '',

            submittedAt: r.submittedAt || new Date().toISOString(),

            assignedReviewers: Array.isArray(r.assignedReviewers) ? r.assignedReviewers : [],

            decisions: Array.isArray(r.decisions) ? r.decisions : [],

            status: r.status || 'pending',

            submitComment: r.submitComment || '',

            reviewedAt: r.reviewedAt,

          })

        }

        if (reviews.length) {

          console.log(`[project-store] migrated ${reviews.length} reviews from JSON to SQLite`)

          dirty = true

          flush()

        }

      } catch { /* reviews 迁移失败跳过 */ }

    }

  } catch (e) {

    console.error('[project-store] migration failed:', e)

  }

}



// ===== Projects CRUD =====



export function getProjectMeta(key: string): StoredProject | null {

  if (!db) return null

  const stmt = db.prepare('SELECT * FROM projects WHERE key = ?')

  stmt.bind([key])

  if (!stmt.step()) { stmt.free(); return null }

  const row = stmt.getAsObject()

  stmt.free()

  return {

    key: String(row.key),

    name: String(row.name),

    description: String(row.description || ''),

    owner: JSON.parse(String(row.owner || '{}')),

    currentVersion: String(row.currentVersion || ''),

    createdAt: String(row.createdAt),

    updatedAt: String(row.updatedAt),

    status: String(row.status || ''),

    statusVariant: String(row.statusVariant || ''),

  }

}



export function saveProjectMeta(p: StoredProject): void {

  if (!db) return

  db.run(

    `INSERT INTO projects (key,name,description,owner,currentVersion,status,statusVariant,createdAt,updatedAt)

     VALUES (?,?,?,?,?,?,?,?,?)

     ON CONFLICT(key) DO UPDATE SET

       name=excluded.name, description=excluded.description, owner=excluded.owner,

       currentVersion=excluded.currentVersion, status=excluded.status,

       statusVariant=excluded.statusVariant, updatedAt=excluded.updatedAt`,

    [p.key, p.name, p.description, JSON.stringify(p.owner), p.currentVersion, p.status, p.statusVariant || '', p.createdAt, p.updatedAt],

  )

  dirty = true

}



export function deleteProjectMeta(key: string): void {

  if (!db) return

  db.run('DELETE FROM projects WHERE key = ?', [key])

  db.run('DELETE FROM versions WHERE projectKey = ?', [key])

  db.run('DELETE FROM reviews WHERE projectKey = ?', [key])

  dirty = true

}



export function listProjectKeys(): string[] {

  if (!db) return []

  const res = db.exec('SELECT key FROM projects ORDER BY createdAt')

  return res.length ? res[0].values.map((r) => String(r[0])) : []

}



export function listAllProjects(): StoredProject[] {

  if (!db) return []

  const res = db.exec('SELECT * FROM projects ORDER BY createdAt')

  if (!res.length) return []

  return res[0].values.map((row) => ({

    key: String(row[0]),

    name: String(row[1]),

    description: String(row[2] || ''),

    owner: JSON.parse(String(row[3] || '{}')),

    currentVersion: String(row[4] || ''),

    status: String(row[5] || ''),

    statusVariant: String(row[6] || ''),

    createdAt: String(row[7]),

    updatedAt: String(row[8]),

  }))

}



// ===== Versions CRUD =====



function rowToVersion(row: unknown[]): StoredVersion {

  return {

    projectKey: String(row[0]),

    id: String(row[1]),

    version: String(row[2]),

    changelog: String(row[3] || ''),

    status: String(row[4] || ''),

    statusVariant: String(row[5] || ''),

    steps: JSON.parse(String(row[6] || '[]')),

    stepTimes: row[7] ? JSON.parse(String(row[7])) : undefined,

    running: Number(row[8]) === 1,

    latest: Number(row[9]) === 1,

    on_policy_id: row[10] ? String(row[10]) : undefined,

    on_policy_canonical: row[11] ? String(row[11]) : undefined,

    onto_rule_count: row[12] != null ? Number(row[12]) : undefined,

    onto_region_count: row[13] != null ? Number(row[13]) : undefined,

    onto_regions: row[14] ? JSON.parse(String(row[14])) : undefined,

    onto_built_at: row[15] ? String(row[15]) : undefined,

    onto_clone: row[16] ? JSON.parse(String(row[16])) : undefined,

    createdAt: String(row[17]),

    updatedAt: String(row[18]),

  }

}



const VERSION_COLS = 'projectKey,id,version,changelog,status,statusVariant,steps,stepTimes,running,latest,on_policy_id,on_policy_canonical,onto_rule_count,onto_region_count,onto_regions,onto_built_at,onto_clone,createdAt,updatedAt'



export function getVersionMeta(projectKey: string, versionId: string): StoredVersion | null {

  if (!db) return null

  const stmt = db.prepare(`SELECT ${VERSION_COLS} FROM versions WHERE projectKey = ? AND id = ?`)

  stmt.bind([projectKey, versionId])

  if (!stmt.step()) { stmt.free(); return null }

  const row = stmt.get()

  stmt.free()

  return rowToVersion(row)

}



export function saveVersionMeta(v: StoredVersion): void {

  if (!db) return

  db.run(

    `INSERT INTO versions (${VERSION_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)

     ON CONFLICT(projectKey,id) DO UPDATE SET

       version=excluded.version, changelog=excluded.changelog, status=excluded.status,

       statusVariant=excluded.statusVariant, steps=excluded.steps, stepTimes=excluded.stepTimes,

       running=excluded.running,

       latest=excluded.latest, on_policy_id=excluded.on_policy_id,

       on_policy_canonical=excluded.on_policy_canonical,

       onto_rule_count=excluded.onto_rule_count, onto_region_count=excluded.onto_region_count,

       onto_regions=excluded.onto_regions, onto_built_at=excluded.onto_built_at,

       onto_clone=excluded.onto_clone, updatedAt=excluded.updatedAt`,

    [v.projectKey, v.id, v.version, v.changelog, v.status, v.statusVariant,

     JSON.stringify(v.steps), v.stepTimes ? JSON.stringify(v.stepTimes) : null, v.running ? 1 : 0, v.latest ? 1 : 0,

     v.on_policy_id ?? null, v.on_policy_canonical ?? null,

     v.onto_rule_count ?? null, v.onto_region_count ?? null,

     v.onto_regions ? JSON.stringify(v.onto_regions) : null,

     v.onto_built_at ?? null,

     v.onto_clone ? JSON.stringify(v.onto_clone) : null,

     v.createdAt, v.updatedAt],

  )

  dirty = true

}



export function deleteVersionMeta(projectKey: string, versionId: string): void {

  if (!db) return

  db.run('DELETE FROM versions WHERE projectKey = ? AND id = ?', [projectKey, versionId])

  dirty = true

}



export function listVersions(projectKey: string): StoredVersion[] {

  if (!db) return []

  const stmt = db.prepare(`SELECT ${VERSION_COLS} FROM versions WHERE projectKey = ? ORDER BY createdAt DESC`)

  stmt.bind([projectKey])

  const out: StoredVersion[] = []

  while (stmt.step()) out.push(rowToVersion(stmt.get()))

  stmt.free()

  return out

}



/**

 * clone-sources 聚合：全工作区已建模版本（跨项目），一条 SQL 取齐。

 * 条件：已关联 onto policy 且建模规则数 > 0；按最近建模时间倒序。

 */

export function listModeledVersions(): ModeledVersionRow[] {

  if (!db) return []

  const res = db.exec(

    `SELECT v.projectKey, p.name, v.id, v.version, v.on_policy_id, v.on_policy_canonical,

            v.onto_rule_count, v.onto_region_count, v.onto_regions, v.onto_built_at

     FROM versions v JOIN projects p ON p.key = v.projectKey

     WHERE v.on_policy_id IS NOT NULL AND v.on_policy_id != ''

       AND v.onto_rule_count IS NOT NULL AND v.onto_rule_count > 0

     ORDER BY v.onto_built_at DESC`,

  )

  if (!res.length) return []

  return res[0].values.map((row) => ({

    projectKey: String(row[0]),

    projectName: String(row[1] || ''),

    versionId: String(row[2]),

    version: String(row[3]),

    policy_id: String(row[4]),

    canonical_name: String(row[5] || ''),

    rule_count: Number(row[6] ?? 0),

    region_count: Number(row[7] ?? 0),

    regions: row[8] ? JSON.parse(String(row[8])) : [],

    built_at: String(row[9] || ''),

  }))

}



// ===== Reviews CRUD =====



export interface StoredReview {

  id: string

  projectKey: string

  projectName: string

  version: string

  submittedBy: string

  submittedAt: string

  assignedReviewers: { username: string; name: string }[]

  decisions: { username: string; name: string; decision: 'approved' | 'rejected'; comment?: string; decidedAt: string }[]

  status: 'pending' | 'approved' | 'rejected'

  submitComment?: string

  reviewedAt?: string

}



const REVIEW_COLS = 'id,projectKey,projectName,version,submittedBy,submittedAt,assignedReviewers,decisions,status,submitComment,reviewedAt'



function rowToReview(row: unknown[]): StoredReview {

  return {

    id: String(row[0]),

    projectKey: String(row[1]),

    projectName: String(row[2] || ''),

    version: String(row[3]),

    submittedBy: String(row[4] || ''),

    submittedAt: String(row[5]),

    assignedReviewers: JSON.parse(String(row[6] || '[]')),

    decisions: JSON.parse(String(row[7] || '[]')),

    status: String(row[8] || 'pending') as StoredReview['status'],

    submitComment: row[9] ? String(row[9]) : undefined,

    reviewedAt: row[10] ? String(row[10]) : undefined,

  }

}



export function listAllReviews(): StoredReview[] {

  if (!db) return []

  const res = db.exec(`SELECT ${REVIEW_COLS} FROM reviews ORDER BY submittedAt DESC`)

  if (!res.length) return []

  return res[0].values.map(rowToReview)

}



export function getReview(id: string): StoredReview | null {

  if (!db) return null

  const stmt = db.prepare(`SELECT ${REVIEW_COLS} FROM reviews WHERE id = ?`)

  stmt.bind([id])

  if (!stmt.step()) { stmt.free(); return null }

  const row = stmt.get()

  stmt.free()

  return rowToReview(row)

}



export function saveReview(r: StoredReview): void {

  if (!db) return

  db.run(

    `INSERT INTO reviews (${REVIEW_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)

     ON CONFLICT(id) DO UPDATE SET

       projectKey=excluded.projectKey, projectName=excluded.projectName, version=excluded.version,

       submittedBy=excluded.submittedBy, submittedAt=excluded.submittedAt,

       assignedReviewers=excluded.assignedReviewers, decisions=excluded.decisions,

       status=excluded.status, submitComment=excluded.submitComment, reviewedAt=excluded.reviewedAt`,

    [r.id, r.projectKey, r.projectName, r.version, r.submittedBy, r.submittedAt,

     JSON.stringify(r.assignedReviewers), JSON.stringify(r.decisions),

     r.status, r.submitComment ?? null, r.reviewedAt ?? null],

  )

  dirty = true

}



export function deleteReview(id: string): void {

  if (!db) return

  db.run('DELETE FROM reviews WHERE id = ?', [id])

  dirty = true

}



// ===== Users 表 CRUD（SQLite 主存储，users.json 作为镜像由 users-store.ts 维护）=====



export interface StoredUser {

  username: string

  password: string

  name: string

  role: string

  email: string

  status: string

}



const USER_COLS = 'username,password,name,role,email,status'



function rowToUser(row: unknown[]): StoredUser {

  return {

    username: String(row[0]),

    password: String(row[1]),

    name: String(row[2] || ''),

    role: String(row[3] || ''),

    email: String(row[4] || ''),

    status: String(row[5] || 'active'),

  }

}



export function listUserRows(): StoredUser[] {

  if (!db) return []

  const res = db.exec(`SELECT ${USER_COLS} FROM users ORDER BY username`)

  if (!res.length) return []

  return res[0].values.map(rowToUser)

}



export function getUserRow(username: string): StoredUser | null {

  if (!db) return null

  const stmt = db.prepare(`SELECT ${USER_COLS} FROM users WHERE username = ?`)

  stmt.bind([username])

  if (!stmt.step()) { stmt.free(); return null }

  const row = stmt.get()

  stmt.free()

  return rowToUser(row)

}



export function saveUserRow(u: StoredUser): void {

  if (!db) return

  db.run(

    `INSERT INTO users (${USER_COLS}) VALUES (?,?,?,?,?,?)

     ON CONFLICT(username) DO UPDATE SET

       password=excluded.password, name=excluded.name, role=excluded.role,

       email=excluded.email, status=excluded.status`,

    [u.username, u.password, u.name, u.role, u.email, u.status],

  )

  dirty = true

}



export function deleteUserRow(username: string): void {

  if (!db) return

  db.run('DELETE FROM users WHERE username = ?', [username])

  dirty = true

}



// ===== Roles 表 CRUD（SQLite 主存储，roles.json 作为镜像由 roles-store.ts 维护）=====



export interface StoredRole {

  code: string

  name: string

  description: string

  permissions: string[]

}



const ROLE_COLS = 'code,name,description,permissions'



function rowToRole(row: unknown[]): StoredRole {

  return {

    code: String(row[0]),

    name: String(row[1] || ''),

    description: String(row[2] || ''),

    permissions: JSON.parse(String(row[3] || '[]')),

  }

}



export function listRoleRows(): StoredRole[] {

  if (!db) return []

  const res = db.exec(`SELECT ${ROLE_COLS} FROM roles ORDER BY code`)

  if (!res.length) return []

  return res[0].values.map(rowToRole)

}



export function getRoleRow(code: string): StoredRole | null {

  if (!db) return null

  const stmt = db.prepare(`SELECT ${ROLE_COLS} FROM roles WHERE code = ?`)

  stmt.bind([code])

  if (!stmt.step()) { stmt.free(); return null }

  const row = stmt.get()

  stmt.free()

  return rowToRole(row)

}



export function saveRoleRow(r: StoredRole): void {

  if (!db) return

  db.run(

    `INSERT INTO roles (${ROLE_COLS}) VALUES (?,?,?,?)

     ON CONFLICT(code) DO UPDATE SET

       name=excluded.name, description=excluded.description, permissions=excluded.permissions`,

    [r.code, r.name, r.description, JSON.stringify(r.permissions)],

  )

  dirty = true

}



export function deleteRoleRow(code: string): void {

  if (!db) return

  db.run('DELETE FROM roles WHERE code = ?', [code])

  dirty = true

}



// ===== Users/Roles JSON → SQLite 迁移（启动时执行）=====



export function migrateUsersFromJson(): void {

  if (!db) return

  const count = db.exec('SELECT COUNT(*) FROM users')

  const n = count.length ? Number(count[0].values[0][0]) : 0

  if (n > 0) return



  const usersPath = join(GS_DIR, 'users.json')

  if (!existsSync(usersPath)) return

  try {

    const raw = JSON.parse(readFileSync(usersPath, 'utf-8'))

    const users = Array.isArray(raw?.users) ? raw.users : []

    for (const u of users) {

      saveUserRow({

        username: String(u.username || ''),

        password: String(u.password || ''),

        name: String(u.name || ''),

        role: String(u.role || ''),

        email: String(u.email || ''),

        status: String(u.status || 'active'),

      })

    }

    flush()

    console.log(`[project-store] migrated ${users.length} users from JSON`)

  } catch (e) {

    console.error('[project-store] users migration failed:', e)

  }

}



export function migrateRolesFromJson(): void {

  if (!db) return

  const count = db.exec('SELECT COUNT(*) FROM roles')

  const n = count.length ? Number(count[0].values[0][0]) : 0

  if (n > 0) return



  const rolesPath = join(GS_DIR, 'roles.json')

  if (!existsSync(rolesPath)) return

  try {

    const raw = JSON.parse(readFileSync(rolesPath, 'utf-8'))

    const roles = Array.isArray(raw?.roles) ? raw.roles : []

    for (const r of roles) {

      saveRoleRow({

        code: String(r.code || ''),

        name: String(r.name || ''),

        description: String(r.description || ''),

        permissions: Array.isArray(r.permissions) ? r.permissions : [],

      })

    }

    flush()

    console.log(`[project-store] migrated ${roles.length} roles from JSON`)

  } catch (e) {

    console.error('[project-store] roles migration failed:', e)

  }

}



// ===== Crawl Tasks CRUD =====



export interface StoredCrawlTask {

  task_id: string

  workspace: string

  subsidy_type: string

  region: string

  keyword: string

  keyword_relation: string

  pages: number

  use_gov_search: boolean

  status: 'running' | 'completed' | 'failed'

  stage: string

  progress_percent: number

  total_found: number

  total_evaluated: number

  total_accepted: number

  total_saved: number

  total_skipped: number

  current_url: string

  started_at: string

  finished_at: string | null

  created_at: string

}



const CRAWL_TASK_COLS = 'task_id,workspace,subsidy_type,region,keyword,keyword_relation,pages,use_gov_search,status,stage,progress_percent,total_found,total_evaluated,total_accepted,total_saved,total_skipped,current_url,started_at,finished_at,created_at'



function rowToCrawlTask(row: unknown[]): StoredCrawlTask {

  return {

    task_id: String(row[0]),

    workspace: String(row[1]),

    subsidy_type: String(row[2] || ''),

    region: String(row[3] || ''),

    keyword: String(row[4] || ''),

    keyword_relation: String(row[5] || 'and'),

    pages: Number(row[6] || 5),

    use_gov_search: Number(row[7]) === 1,

    status: String(row[8] || 'running') as StoredCrawlTask['status'],

    stage: String(row[9] || ''),

    progress_percent: Number(row[10] || 0),

    total_found: Number(row[11] || 0),

    total_evaluated: Number(row[12] || 0),

    total_accepted: Number(row[13] || 0),

    total_saved: Number(row[14] || 0),

    total_skipped: Number(row[15] || 0),

    current_url: String(row[16] || ''),

    started_at: String(row[17]),

    finished_at: row[18] ? String(row[18]) : null,

    created_at: String(row[19]),

  }

}



export function saveCrawlTask(t: StoredCrawlTask): void {

  if (!db) return

  db.run(

    `INSERT INTO crawl_tasks (${CRAWL_TASK_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)

     ON CONFLICT(task_id) DO UPDATE SET

       status=excluded.status, stage=excluded.stage, progress_percent=excluded.progress_percent,

       total_found=excluded.total_found, total_evaluated=excluded.total_evaluated,

       total_accepted=excluded.total_accepted, total_saved=excluded.total_saved,

       total_skipped=excluded.total_skipped, current_url=excluded.current_url,

       finished_at=excluded.finished_at`,

    [t.task_id, t.workspace, t.subsidy_type, t.region, t.keyword, t.keyword_relation,

     t.pages, t.use_gov_search ? 1 : 0, t.status, t.stage, t.progress_percent,

     t.total_found, t.total_evaluated, t.total_accepted, t.total_saved, t.total_skipped,

     t.current_url, t.started_at, t.finished_at ?? null, t.created_at],

  )

  dirty = true

}



export function getCrawlTask(taskId: string): StoredCrawlTask | null {

  if (!db) return null

  const stmt = db.prepare(`SELECT ${CRAWL_TASK_COLS} FROM crawl_tasks WHERE task_id = ?`)

  stmt.bind([taskId])

  if (!stmt.step()) { stmt.free(); return null }

  const row = stmt.get()

  stmt.free()

  return rowToCrawlTask(row)

}



export function listCrawlTasks(workspace?: string): StoredCrawlTask[] {

  if (!db) return []

  if (workspace) {

    const stmt = db.prepare(`SELECT ${CRAWL_TASK_COLS} FROM crawl_tasks WHERE workspace = ? ORDER BY created_at DESC`)

    stmt.bind([workspace])

    const out: StoredCrawlTask[] = []

    while (stmt.step()) out.push(rowToCrawlTask(stmt.get()))

    stmt.free()

    return out

  }

  const res = db.exec(`SELECT ${CRAWL_TASK_COLS} FROM crawl_tasks ORDER BY created_at DESC`)

  if (!res.length) return []

  return res[0].values.map(rowToCrawlTask)

}



export function listRunningCrawlTasks(workspace?: string): StoredCrawlTask[] {

  if (!db) return []

  const sql = workspace

    ? `SELECT ${CRAWL_TASK_COLS} FROM crawl_tasks WHERE workspace = ? AND status = 'running' ORDER BY created_at DESC`

    : `SELECT ${CRAWL_TASK_COLS} FROM crawl_tasks WHERE status = 'running' ORDER BY created_at DESC`

  if (workspace) {

    const stmt = db.prepare(sql)

    stmt.bind([workspace])

    const out: StoredCrawlTask[] = []

    while (stmt.step()) out.push(rowToCrawlTask(stmt.get()))

    stmt.free()

    return out

  }

  const res = db.exec(sql)

  if (!res.length) return []

  return res[0].values.map(rowToCrawlTask)

}



export function deleteCrawlTask(taskId: string): void {

  if (!db) return

  db.run('DELETE FROM crawl_tasks WHERE task_id = ?', [taskId])

  dirty = true

}


```
