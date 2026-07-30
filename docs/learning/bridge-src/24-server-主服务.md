# 主服务 — Express + WebSocket 全部 API

> 源文件：`bridge/src/server.ts`

```typescript
import cors from 'cors'

import express from 'express'

import { createServer } from 'node:http'

import { WebSocketServer } from 'ws'

import {

  abortSession,

  createSession,

  deleteSession,

  getSessionMessages,

  listSessions,

  promptSession,

  renameSession,

  setSessionPinned,

} from './agent-runtime.js'

import {

  verifyCredentials,

  createToken,

  verifyToken,

  getPublicKey,

  getUserFromPayload,

  changeOwnPassword,

  resetUserPasswordByAdmin,

  listUsersStore,

  listUsersBrief,

  createUser,

  updateUser,

  disableUser,

  enableUser,

  deleteUser,

  listRoles,

  type AuthUser,

} from './auth.js'

import { permissionsInclude, updateRole, createRole, deleteRole, ALL_PERMISSION_POINTS } from './roles-store.js'

import { ensureWorkspacesRoot, WORKSPACES_DIR } from './paths.js'

import { getServerConfig, getCrawlerConfig, getOntoPlatformConfig } from './config.js'

import { logEvent, queryEvents } from './event-log.js'

import { saveCrawlTask, getCrawlTask, listCrawlTasks, deleteCrawlTask, type StoredCrawlTask } from './project-store.js'

import { getAnnouncementConfig, getActiveAnnouncement, saveAnnouncementConfig } from './announcement-store.js'

import { proxyOnto, OntoRequestError } from './onto-platform.js'

import { listProjectSkills, generateSkillWithLlm, generateAgentDescription } from './skills.js'

import { createAgentFromTemplate } from './agent-template.js'

import { runStep2AutoModeling } from './step2-build.js'

import { resolveDataRoot } from './step2-data-source.js'

import { readStep2Progress, writeStep2Progress } from './step2-progress.js'

import { finalizeStep2 } from './step2-finalize.js'

import { appendJudgeHistory, readJudgeHistory } from './step2-judge-history.js'

import {

  copyPath,

  createEmptyFile,

  createSkillTemplate,

  createSkillWithContent,

  deletePath,

  ensureProjectWorkspace,

  getDownloadFile,

  getFileTree,

  mkdirPath,

  movePath,

  readFileContent,

  renamePath,

  writeFileContent,

} from './workspace.js'

import { existsSync, readFileSync, readdirSync } from 'node:fs'

import { join } from 'node:path'

import { importFromCrawler, importFromCrawlerMulti } from './projects.js'

import {

  advancePipeline,

  clearAllProjects,

  createProject,

  createVersion,

  deleteVersion,

  getDataSpace,

  getDataSpaceForUi,

  getPipeline,

  getProject,

  listDataSpacesForUi,

  listProjectsForUi,

  listVersionsForUi,

  resolveVersionCwd,

  syncProjectToProject,

  submitForReview,

  approvePipeline,

  rejectPipeline,

  getReviewProgress,

  listReviews,

  listPendingReviews,

  setVersionOntoPolicy,

  saveGateChecks,

  runCloneOntoPolicy,

} from './projects.js'

import { ensureOntoPolicy } from './step2-policy.js'

import { listModeledVersions } from './project-store.js'

import type { OntoCloneRecord } from './types.js'

import { syncVersionToRemote, getPublishStatus } from './publish.js'



ensureWorkspacesRoot()



const COOKIE_NAME = 'auth_token'

const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

/** 是否启用 Secure Cookie：显式配置优先，否则仅在生产环境 + HTTPS 时启用 */

const COOKIE_SECURE = false

const CORS_ORIGIN_ENV = process.env.CORS_ORIGIN || ''

const CORS_ORIGINS = CORS_ORIGIN_ENV.split(',').map((s) => s.trim()).filter(Boolean)



const loginFailures = new Map<string, { count: number; expiresAt: number }>()

const LOGIN_RATE_LIMIT_WINDOW = 5 * 60 * 1000

const LOGIN_RATE_LIMIT_MAX = 10



function isLoginRateLimited(key: string): boolean {

  const entry = loginFailures.get(key)

  if (!entry) return false

  if (Date.now() > entry.expiresAt) {

    loginFailures.delete(key)

    return false

  }

  return entry.count >= LOGIN_RATE_LIMIT_MAX

}



function recordLoginFailure(key: string): void {

  const entry = loginFailures.get(key)

  if (!entry || Date.now() > entry.expiresAt) {

    loginFailures.set(key, { count: 1, expiresAt: Date.now() + LOGIN_RATE_LIMIT_WINDOW })

  } else {

    entry.count++

  }

}



function clearLoginFailure(key: string): void {

  loginFailures.delete(key)

}



function ok<T>(res: express.Response, data: T) {

  res.json({ code: 0, data, message: 'ok' })

}



/**

 * 从 query 的 projectId/versionId 读取 version.json.on_policy_id，

 * 注入到 body 的指定字段下（rule: item/patch；concept/operator: 直接顶层）。

 * 若 body 已含 policy_id 或没匹配版本，不覆盖。

 */

async function injectPolicyId(

  body: unknown,

  query: express.Request['query'],

  wrapKey: 'item' | 'patch' | 'top',

): Promise<Record<string, unknown>> {

  const root = (body ?? {}) as Record<string, unknown>

  let obj: Record<string, unknown>

  if (wrapKey === 'item' || wrapKey === 'patch') {

    obj = (root[wrapKey] ?? {}) as Record<string, unknown>

  } else {

    obj = root

  }

  if (obj.policy_id) return root

  const projectId = typeof query.projectId === 'string' ? query.projectId : ''

  const versionId = typeof query.versionId === 'string' ? query.versionId : ''

  if (!projectId || !versionId) return root

  try {

    const cwd = resolveVersionCwd(projectId, versionId)

    const version = JSON.parse(

      readFileSync(join(cwd, 'version.json'), 'utf-8')

    ) as { on_policy_id?: string }

    if (!version.on_policy_id) return root

    const patched: Record<string, unknown> = { ...obj, policy_id: version.on_policy_id }

    if (wrapKey === 'item' || wrapKey === 'patch') {

      return { ...root, [wrapKey]: patched }

    }

    return patched

  } catch {

    return root

  }

}



function fail(res: express.Response, e: unknown, status = 400) {

  res.status(status).json({ code: status, error: String((e as Error).message), message: String((e as Error).message) })

}



/**

 * onto 代理专用错误响应：平台返回的结构化错误（error_type / candidates / unbound_variable 等）

 * 原样透传给前端（如 region_ambiguous 的候选列表需要前端渲染），非结构化错误走 fail。

 */

function failOnto(res: express.Response, e: unknown) {

  if (e instanceof OntoRequestError && e.payload && typeof e.payload === 'object') {

    res.status(e.status).json(e.payload)

    return

  }

  fail(res, e, 502)

}



// Extend Express Request to carry user info

declare module 'express' {

  interface Request {

    user?: AuthUser

  }

}



/** Auth middleware: parse JWT from cookie, attach req.user */

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {

  const token = req.cookies?.[COOKIE_NAME]

  if (!token) {

    return res.status(401).json({ code: 401, message: '未登录' })

  }

  const payload = verifyToken(token)

  if (!payload) {

    res.clearCookie(COOKIE_NAME)

    return res.status(401).json({ code: 401, message: '登录已过期' })

  }

  const user = getUserFromPayload(payload)

  if (!user) {

    res.clearCookie(COOKIE_NAME)

    return res.status(401).json({ code: 401, message: '用户不存在或已禁用' })

  }

  req.user = user

  next()

}



/** Permission guard middleware: requires authMiddleware to have run */

function requirePermission(point: string) {

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {

    if (!req.user) {

      return res.status(401).json({ code: 401, message: '未登录' })

    }

    if (!permissionsInclude(req.user.permissions, point)) {

      return res.status(403).json({ code: 403, message: '无权限执行此操作' })

    }

    next()

  }

}



/** 权限守卫（任一满足即可）：用于多个权限点等价的场景 */

function requireAnyPermission(...points: string[]) {

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {

    if (!req.user) {

      return res.status(401).json({ code: 401, message: '未登录' })

    }

    const allowed = points.some((p) => permissionsInclude(req.user!.permissions, p))

    if (!allowed) {

      return res.status(403).json({ code: 403, message: '无权限执行此操作' })

    }

    next()

  }

}



/** Parse cookies from request header (lightweight, no cookie-parser dep) */

function parseCookies(req: express.Request): Record<string, string> {

  const header = req.headers.cookie

  if (!header) return {}

  const cookies: Record<string, string> = {}

  for (const part of header.split(';')) {

    const [k, ...v] = part.trim().split('=')

    if (k) cookies[k] = v.join('=')

  }

  return cookies

}



// Middleware to populate req.cookies

const cookieParser = (req: express.Request, _res: express.Response, next: express.NextFunction) => {

  req.cookies = parseCookies(req)

  next()

}



export function createApp() {

  const app = express()

  const corsOrigins = CORS_ORIGINS.length > 0 ? CORS_ORIGINS : true

  app.use(cors({ origin: corsOrigins, credentials: true }))

  app.use(express.json({ limit: '3mb' }))

  app.use(cookieParser)



  app.get('/health', (_req, res) => {

    res.json({ ok: true })

  })



  // —— 事件管理 ——

  // 查询事件列表（developer 只能看自己的，admin/reviewer 可看全部）

  app.get('/api/v1/events', authMiddleware, async (req, res) => {

    try {

      const role = (req as any).user?.role || ''

      const actorFilter = role === 'developer' ? (req as any).user!.username : (req.query.actor ? String(req.query.actor) : undefined)

      const result = await queryEvents({

        action: req.query.action ? String(req.query.action) : undefined,

        actor: actorFilter,

        page: req.query.page ? Number(req.query.page) : 1,

        page_size: req.query.page_size ? Number(req.query.page_size) : 20,

      })

      ok(res, result)

    } catch (e) {

      fail(res, e)

    }

  })



  // 前端上报事件（B 类：爬虫操作）

  app.post('/api/v1/events', authMiddleware, async (req, res) => {

    try {

      await logEvent({

        actor: req.user!.username,

        action: String(req.body?.action || ''),

        target: req.body?.target ? String(req.body.target) : undefined,

        detail: req.body?.detail,

        ip: req.ip,

      })

      ok(res, { logged: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // —— 公告管理 ——

  // 获取当前生效的公告（所有登录用户可查）

  app.get('/api/v1/announcement', authMiddleware, (_req, res) => {

    try {

      ok(res, getActiveAnnouncement())

    } catch (e) {

      fail(res, e)

    }

  })



  // 获取公告完整配置（仅 admin）

  app.get('/api/v1/announcement/config', authMiddleware, requirePermission('user:manage'), (_req, res) => {

    try {

      ok(res, getAnnouncementConfig())

    } catch (e) {

      fail(res, e)

    }

  })



  // 更新公告配置（仅 admin）

  app.put('/api/v1/announcement/config', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      const cfg = saveAnnouncementConfig(

        {

          content: String(req.body?.content ?? ''),

          enabled: Boolean(req.body?.enabled),

          expireAt: req.body?.expireAt ? String(req.body.expireAt) : null,

        },

        req.user!.username,

      )

      logEvent({ actor: req.user!.username, action: 'announcement.update', target: '公告', detail: { enabled: cfg.enabled, hasExpire: !!cfg.expireAt }, ip: req.ip })

      ok(res, cfg)

    } catch (e) {

      fail(res, e)

    }

  })



  // —— 认证相关（公开路由）——



  // RSA 公钥（前端加密密码用）

  app.get('/api/v1/auth/public-key', (_req, res) => {

    ok(res, { publicKey: getPublicKey() })

  })



  // 登录（密码经 RSA 加密）

  app.post('/api/v1/auth/login', (req, res) => {

    const username = String(req.body?.username ?? '').trim()

    const passwordEnc = String(req.body?.passwordEnc ?? '')

    if (!username || !passwordEnc) {

      return res.status(400).json({ code: 400, message: '用户名和密码必填' })

    }

    const rateLimitKey = `${req.ip}:${username}`

    if (isLoginRateLimited(rateLimitKey)) {

      return res.status(429).json({ code: 429, message: '登录尝试过于频繁，请稍后再试' })

    }

    const user = verifyCredentials(username, passwordEnc)

    if (!user) {

      recordLoginFailure(rateLimitKey)

      return res.status(401).json({ code: 401, message: '用户名或密码错误' })

    }

    clearLoginFailure(rateLimitKey)

    const token = createToken(user)

    res.cookie(COOKIE_NAME, token, {

      httpOnly: true,

      sameSite: 'lax',

      maxAge: COOKIE_MAX_AGE,

      path: '/',

      secure: COOKIE_SECURE,

    })

    logEvent({ actor: username, action: 'user.login', target: username, ip: req.ip })

    ok(res, { user, token })

  })



  // 登出

  app.post('/api/v1/auth/logout', (_req, res) => {

    res.clearCookie(COOKIE_NAME, { path: '/' })

    ok(res, { loggedOut: true })

  })



  // 获取当前登录用户信息

  app.get('/api/v1/auth/me', authMiddleware, (req, res) => {

    ok(res, req.user)

  })



  // 修改密码（自己改自己）

  app.post('/api/v1/auth/change-password', authMiddleware, (req, res) => {

    try {

      const oldPwdEnc = String(req.body?.oldPasswordEnc ?? '')

      const newPwdEnc = String(req.body?.newPasswordEnc ?? '')

      if (!oldPwdEnc || !newPwdEnc) {

        return res.status(400).json({ code: 400, message: '旧密码和新密码必填' })

      }

      changeOwnPassword(req.user!.username, oldPwdEnc, newPwdEnc)

      ok(res, { changed: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // —— 角色管理（admin 可见，支持运行时配置）——

  app.get('/api/v1/roles', authMiddleware, requirePermission('user:manage'), (_req, res) => {

    ok(res, listRoles())

  })



  // 获取所有可选权限点（供前端角色编辑 UI 渲染 checkbox）

  app.get('/api/v1/permissions', authMiddleware, requirePermission('user:manage'), (_req, res) => {

    ok(res, ALL_PERMISSION_POINTS)

  })



  // 更新角色（name/description/permissions）

  app.put('/api/v1/roles/:code', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      const code = req.params.code

      const patch: { name?: string; description?: string; permissions?: string[] } = {}

      if (typeof req.body?.name === 'string') patch.name = String(req.body.name).trim()

      if (typeof req.body?.description === 'string') patch.description = String(req.body.description).trim()

      if (Array.isArray(req.body?.permissions)) {

        patch.permissions = (req.body.permissions as unknown[])

          .filter((p): p is string => typeof p === 'string')

          .map((p) => p.trim())

          .filter(Boolean)

      }

      if (Object.keys(patch).length === 0) return fail(res, new Error('没有需要更新的字段'))

      ok(res, updateRole(code, patch))

    } catch (e) {

      fail(res, e)

    }

  })



  // 新建角色

  app.post('/api/v1/roles', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      const code = String(req.body?.code || '').trim()

      const name = String(req.body?.name || '').trim()

      const description = String(req.body?.description || '').trim()

      const permissions = Array.isArray(req.body?.permissions)

        ? (req.body.permissions as unknown[]).filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean)

        : []

      if (!code) return fail(res, new Error('角色代码必填'))

      if (!name) return fail(res, new Error('角色名称必填'))

      ok(res, createRole({ code, name, description, permissions }))

    } catch (e) {

      fail(res, e)

    }

  })



  // 删除角色（内置角色不允许删除）

  app.delete('/api/v1/roles/:code', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      deleteRole(req.params.code)

      ok(res, { deleted: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // —— 用户管理（仅 admin）——

  // 用户简要信息（仅 username/name/role，所有已登录用户可访问，供 Dashboard 团队统计）

  app.get('/api/v1/users/brief', authMiddleware, (_req, res) => {

    ok(res, listUsersBrief())

  })



  app.get('/api/v1/users', authMiddleware, requirePermission('user:manage'), (_req, res) => {

    ok(res, listUsersStore())

  })



  app.post('/api/v1/users', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      const username = String(req.body?.username ?? '').trim()

      const password = String(req.body?.password ?? '')

      const name = String(req.body?.name ?? '').trim()

      const role = String(req.body?.role ?? '').trim()

      const email = String(req.body?.email ?? '').trim()

      if (!username || !password || !role) {

        return res.status(400).json({ code: 400, message: '用户名、密码、角色必填' })

      }

      const user = createUser({ username, password, name, role, email })

      logEvent({ actor: req.user!.username, action: 'user.create', target: username, detail: { role, name }, ip: req.ip })

      ok(res, user)

    } catch (e) {

      fail(res, e)

    }

  })



  app.patch('/api/v1/users/:username', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      const patch: { name?: string; role?: string; email?: string; status?: 'active' | 'disabled' } = {}

      if (req.body?.name !== undefined) patch.name = String(req.body.name)

      if (req.body?.role !== undefined) patch.role = String(req.body.role)

      if (req.body?.email !== undefined) patch.email = String(req.body.email)

      if (req.body?.status !== undefined) patch.status = req.body.status

      ok(res, updateUser(req.params.username, patch))

    } catch (e) {

      fail(res, e)

    }

  })



  app.post('/api/v1/users/:username/reset-password', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      const newPwd = resetUserPasswordByAdmin(req.params.username)

      logEvent({ actor: req.user!.username, action: 'user.reset_password', target: req.params.username, ip: req.ip })

      ok(res, { password: newPwd })

    } catch (e) {

      fail(res, e)

    }

  })



  // 禁用用户（不允许禁用自己）

  app.post('/api/v1/users/:username/disable', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      disableUser(req.params.username, req.user!.username)

      logEvent({ actor: req.user!.username, action: 'user.disable', target: req.params.username, ip: req.ip })

      ok(res, { disabled: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // 启用用户

  app.post('/api/v1/users/:username/enable', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      enableUser(req.params.username)

      logEvent({ actor: req.user!.username, action: 'user.enable', target: req.params.username, ip: req.ip })

      ok(res, { enabled: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // 删除用户（不允许删除自己）

  app.delete('/api/v1/users/:username', authMiddleware, requirePermission('user:manage'), (req, res) => {

    try {

      deleteUser(req.params.username, req.user!.username)

      ok(res, { deleted: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // —— 审核任务列表（待办事项用）——

  app.get('/api/v1/reviews', authMiddleware, requirePermission('task'), (req, res) => {

    const status = String(req.query?.status || '')

    const currentUser = req.user!.username

    const all = listReviews()

    if (status === 'pending') {

      ok(res, listPendingReviews())

    } else if (status === 'assigned_me') {

      // 待我审核：pending 且我是被分派的审批人 且我还没决策

      ok(res, all.filter((r) =>

        r.status === 'pending' &&

        r.assignedReviewers.some((a) => a.username === currentUser) &&

        !r.decisions.some((d) => d.username === currentUser),

      ))

    } else if (status === 'decided_me') {

      // 我已审核（已投票）

      ok(res, all.filter((r) =>

        r.decisions.some((d) => d.username === currentUser),

      ))

    } else if (status === 'approved') {

      ok(res, all.filter((r) => r.status === 'approved'))

    } else if (status === 'rejected') {

      ok(res, all.filter((r) => r.status === 'rejected'))

    } else {

      ok(res, all)

    }

  })



  // 审核任务统计（待办事项用）

  app.get('/api/v1/reviews/stats', authMiddleware, requirePermission('task'), (req, res) => {

    const currentUser = req.user!.username

    const all = listReviews()

    const pending = all.filter((r) => r.status === 'pending')

    ok(res, {

      total: all.length,

      pending: pending.length,

      assignedMe: pending.filter((r) =>

        r.assignedReviewers.some((a) => a.username === currentUser) &&

        !r.decisions.some((d) => d.username === currentUser),

      ).length,

      decidedMe: all.filter((r) =>

        r.decisions.some((d) => d.username === currentUser),

      ).length,

      submittedMe: all.filter((r) => r.submittedBy === currentUser).length,

      approved: all.filter((r) => r.status === 'approved').length,

      rejected: all.filter((r) => r.status === 'rejected').length,

    })

  })



  // —— 政务本体构建平台代理（Step 2 本体建模）——

  // 按当前 version 的 on_policy_id 拉本体（仅规则数有意义）

  app.get('/api/v1/projects/:id/versions/:vid/onto/ontology', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const { id, vid } = req.params

      const cwd = resolveVersionCwd(id, vid)

      const version = JSON.parse(

        readFileSync(join(cwd, 'version.json'), 'utf-8')

      ) as { on_policy_id?: string }

      if (!version.on_policy_id) return fail(res, new Error('缺少 on_policy_id'))

      const data = await proxyOnto('GET', `/api/ontology?policy_id=${encodeURIComponent(version.on_policy_id)}`)

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // 结构化地域列表（级联下拉数据源）：透传平台 GET /api/policies/{pid}/regions，

  // 支持按层级 query 通配筛选（province_level / prefecture_level / county_level / township_level / national）

  app.get('/api/v1/projects/:id/versions/:vid/onto/regions', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const { id, vid } = req.params

      const cwd = resolveVersionCwd(id, vid)

      const version = JSON.parse(

        readFileSync(join(cwd, 'version.json'), 'utf-8')

      ) as { on_policy_id?: string }

      if (!version.on_policy_id) return fail(res, new Error('缺少 on_policy_id'))

      const qs = ['national', 'province_level', 'prefecture_level', 'county_level', 'township_level']

        .filter((k) => typeof req.query[k] === 'string' && req.query[k])

        .map((k) => `${k}=${encodeURIComponent(String(req.query[k]))}`)

        .join('&')

      const data = await proxyOnto(

        'GET',

        `/api/policies/${version.on_policy_id}/regions${qs ? `?${qs}` : ''}`,

      )

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // meta：地域 + 算子下拉数据源（用于资格判定面板）

  app.get('/api/v1/onto/meta', authMiddleware, requirePermission('project'), async (_req, res) => {

    try {

      const data = await proxyOnto('GET', '/api/meta')

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // GET 接口仅需 project（查看），POST 编辑接口也只需 project（查看+编辑一体）

  app.get('/api/v1/onto/ontology', authMiddleware, requirePermission('project'), async (_req, res) => {

    try {

      const data = await proxyOnto('GET', '/api/ontology')

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  app.get('/api/v1/onto/extractions', authMiddleware, requirePermission('project'), async (_req, res) => {

    try {

      const data = await proxyOnto('GET', '/api/onto/extractions')

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  app.get('/api/v1/onto/derivations', authMiddleware, requirePermission('project'), async (_req, res) => {

    try {

      const data = await proxyOnto('GET', '/api/onto/derivations')

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // 资格判定是只读推理操作，有 project 权限即可使用

  app.post('/api/v1/onto/infer', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      // 若 query 传 projectId + versionId，自动注入对应 policy_id 到 body

      let body: Record<string, unknown> = (req.body ?? {}) as Record<string, unknown>

      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : ''

      const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : ''

      if (projectId && versionId && !body.policy_id) {

        const cwd = resolveVersionCwd(projectId, versionId)

        try {

          const version = JSON.parse(

            readFileSync(join(cwd, 'version.json'), 'utf-8')

          ) as { on_policy_id?: string }

          if (version.on_policy_id) body = { ...body, policy_id: version.on_policy_id }

        } catch {

          // 没有 version.json 时不阻断，按缺省 policy 跑

        }

      }

      const data = await proxyOnto('POST', '/api/infer', body)

      ok(res, data)

    } catch (e) {

      failOnto(res, e)

    }

  })



// 自然语言 query（走 LLM）—— 也支持 projectId/versionId query 注入 policy_id

  app.post('/api/v1/onto/query', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      let body: Record<string, unknown> = (req.body ?? {}) as Record<string, unknown>

      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : ''

      const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : ''

      if (projectId && versionId && !body.policy_id) {

        const cwd = resolveVersionCwd(projectId, versionId)

        try {

          const version = JSON.parse(

            readFileSync(join(cwd, 'version.json'), 'utf-8')

          ) as { on_policy_id?: string }

          if (version.on_policy_id) body = { ...body, policy_id: version.on_policy_id }

        } catch {

          // 没 version.json 时不阻断

        }

      }

      const data = await proxyOnto('POST', '/api/query', body)

      ok(res, data)

    } catch (e) {

      failOnto(res, e)

    }

  })



  // 本体编辑：concept / operator 统一形态（query 携带 projectId/versionId 时自动注入 policy_id）

  for (const kind of ['concept', 'operator']) {

    app.post(`/api/v1/onto/${kind}`, authMiddleware, requirePermission('project'), async (req, res) => {

      try {

        const body = await injectPolicyId(req.body, req.query, 'top')

        const data = await proxyOnto('POST', `/api/ontology/save/${kind}`, body)

        ok(res, data)

      } catch (e) {

        fail(res, e, 502)

      }

    })



    app.post(`/api/v1/onto/${kind}/create`, authMiddleware, requirePermission('project'), async (req, res) => {

      try {

        const body = await injectPolicyId(req.body, req.query, 'top')

        const data = await proxyOnto('POST', `/api/ontology/create/${kind}`, body)

        ok(res, data)

      } catch (e) {

        fail(res, e, 502)

      }

    })



    app.post(`/api/v1/onto/${kind}/:id/delete`, authMiddleware, requirePermission('project'), async (req, res) => {

      try {

        const data = await proxyOnto('POST', `/api/ontology/delete/${encodeURIComponent(req.params.id)}`, req.body ?? {})

        ok(res, data)

      } catch (e) {

        fail(res, e, 502)

      }

    })

  }



  // rule 编辑：query 携带 projectId/versionId，自动注入 policy_id 到 body 顶层

  // 注意：本体平台 /api/ontology/save/rule 的 schema 是 {name, patch, policy_id}，

  // policy_id 必须在顶层，不能塞进 patch 内部，否则本体平台返回 404 not_found。

  app.post('/api/v1/onto/rule', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const body = await injectPolicyId(req.body, req.query, 'top')

      const data = await proxyOnto('POST', '/api/ontology/save/rule', body)

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })

  app.post('/api/v1/onto/rule/create', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const body = await injectPolicyId(req.body, req.query, 'item')

      const data = await proxyOnto('POST', '/api/ontology/create/rule', body)

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // —— Step 2 本体建模（bridge 编排）——



  /** 建模中的版本集合：防止并发构建对同一批未完成文件重复 extract */

  const buildingVersions = new Set<string>()



  // 启动自动建模（异步，返回当前 progress）

  app.post('/api/v1/projects/:id/versions/:vid/onto/build', authMiddleware, requirePermission('project'), async (req, res) => {

    const buildKey = `${req.params.id}@${req.params.vid}`

    try {

      const { id, vid } = req.params

      getProject(id) // 校验存在

      const cwd = resolveVersionCwd(id, vid)

      if (!existsSync(cwd)) return fail(res, new Error('版本不存在'))



      // 已有构建 runner 在跑：不重复启动（否则两个 runner 会对同一批未完成文件重复提取），

      // 直接返回当前进度，前端继续轮询即可

      if (buildingVersions.has(buildKey)) {

        return ok(res, readStep2Progress(id, vid) ?? { phase: 'idle', total_files: 0, processed: 0, errors: [] })

      }

      // 立即占位：覆盖 policy 兜底创建的等待窗口（重放克隆可能耗时数十秒），

      // 后续提前返回的错误路径与 runner 结束都要释放

      buildingVersions.add(buildKey)



      const version = JSON.parse(

        readFileSync(join(cwd, 'version.json'), 'utf-8')

      ) as { on_policy_id?: string; onto_clone?: OntoCloneRecord }



      // createVersion 的 policy 创建是 fire-and-forget，可能尚未完成或失败；

      // 建模启动时兜底即时创建一次（失败则明确报错，不让流程走到无 policy 的建模）。

      // 有克隆意图时按原意图重放（重拉 source_hash），避免静默建成空模型丢失克隆内容。

      let policyId = version.on_policy_id

      if (!policyId) {

        try {

          if (version.onto_clone) {

            await runCloneOntoPolicy(id, vid, `${getProject(id).name} ${vid}`, '', version.onto_clone)

            const refreshed = JSON.parse(

              readFileSync(join(cwd, 'version.json'), 'utf-8')

            ) as { on_policy_id?: string }

            policyId = refreshed.on_policy_id

            if (!policyId) throw new Error('克隆重放后仍未获得 policy_id')

          } else {

            const onto = await ensureOntoPolicy(`${getProject(id).name} ${vid}`, '')

            setVersionOntoPolicy(id, vid, onto)

            policyId = onto.policy_id

          }

        } catch (e) {

          buildingVersions.delete(buildKey)

          return fail(res, new Error(`onto policy 创建失败：${(e as Error).message}`))

        }

      }



      // 新版本创建时已将 default_data_root 的数据复制到当前版本 data/，

      // Step 2 应扫描版本自己的输入目录，避免依赖全局配置路径。

      const dataRoot = join(cwd, 'data')

      // fire-and-forget：不阻塞响应；runner 结束后释放互斥锁

      void runStep2AutoModeling(id, vid, policyId, dataRoot)

        .catch((e) => {

          console.error(`[step2 build] failed for ${buildKey}:`, e)

        })

        .finally(() => buildingVersions.delete(buildKey))



      logEvent({ actor: req.user!.username, action: 'step2.build', target: buildKey, ip: req.ip })

      ok(res, readStep2Progress(id, vid) ?? { phase: 'idle', total_files: 0, processed: 0, errors: [] })

    } catch (e) {

      buildingVersions.delete(buildKey)

      fail(res, e)

    }

  })



  // 拉取进度（前端轮询）

  app.get('/api/v1/projects/:id/versions/:vid/onto/progress', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const { id, vid } = req.params

      const progress = readStep2Progress(id, vid)

      ok(res, progress ?? { phase: 'idle', total_files: 0, processed: 0, errors: [] })

    } catch (e) {

      fail(res, e)

    }

  })



// 审核状态（透传 onto 平台，重组为前端期望的 regions 结构）

  app.get('/api/v1/projects/:id/versions/:vid/onto/review-status', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const { id, vid } = req.params

      const cwd = resolveVersionCwd(id, vid)

      const version = JSON.parse(

        readFileSync(join(cwd, 'version.json'), 'utf-8')

      ) as { on_policy_id?: string }

      if (!version.on_policy_id) return fail(res, new Error('缺少 on_policy_id'))

      // onto-platform 返回扁平规则列表 {counts, rules: [{name, region, status, ...}]}

      const raw = (await proxyOnto('GET', `/api/policies/${version.on_policy_id}/rules/review-status`)) as {

        counts?: Record<string, number>

        rules?: Array<{ name: string; region: string; status: string; reviewed_at?: string; reviewed_by?: string; [k: string]: unknown }>

      } | null

      const rules = raw?.rules ?? []

      // 按 region 分组；status 映射：unreviewed→pending, reviewed/confirmed→保留

      const map = new Map<string, Array<{ name: string; status: 'pending' | 'reviewed' | 'confirmed'; golden: boolean }>>()

      for (const r of rules) {

        const arr = map.get(r.region) ?? []

        const status: 'pending' | 'reviewed' | 'confirmed' =

          r.status === 'confirmed' ? 'confirmed' : r.status === 'reviewed' ? 'reviewed' : 'pending'

        arr.push({ name: r.name, status, golden: false })

        map.set(r.region, arr)

      }

      ok(res, {

        counts: raw?.counts ?? {},

        regions: Array.from(map.entries()).map(([region, items]) => ({ region, rules: items })),

      })

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // 规则详情（to_nl）— 审核面板右侧详情

  app.get('/api/v1/projects/:id/versions/:vid/onto/rule/to_nl', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const { id, vid } = req.params

      const cwd = resolveVersionCwd(id, vid)

      const version = JSON.parse(

        readFileSync(join(cwd, 'version.json'), 'utf-8')

      ) as { on_policy_id?: string }

      if (!version.on_policy_id) return fail(res, new Error('缺少 on_policy_id'))

      const name = String(req.query.name ?? '')

      if (!name) return fail(res, new Error('缺少 name 参数'))

      const data = await proxyOnto(

        'GET',

        `/api/policies/${version.on_policy_id}/rule/to_nl?name=${encodeURIComponent(name)}`,

      )

      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // 确认规则（透传，同步 golden_selected 计数）

  app.post('/api/v1/projects/:id/versions/:vid/onto/rule/confirm', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const { id, vid } = req.params

      const cwd = resolveVersionCwd(id, vid)

      const version = JSON.parse(

        readFileSync(join(cwd, 'version.json'), 'utf-8')

      ) as { on_policy_id?: string }

      if (!version.on_policy_id) return fail(res, new Error('缺少 on_policy_id'))

      const body = req.body ?? {}

      const data = await proxyOnto('POST', `/api/policies/${version.on_policy_id}/rule/confirm`, {

        name: String(body.name ?? ''),

        seed_golden: Boolean(body.seed_golden ?? true),

      })



      // 同步更新 review 计数（仅在 review 阶段）

      const progress = readStep2Progress(id, vid)

      if (progress?.phase === 'review' && progress.review) {

        const delta = body.seed_golden ? 1 : -1

        writeStep2Progress(id, vid, {

          review: {

            ...progress.review,

            golden_selected: Math.max(0, (progress.review.golden_selected ?? 0) + delta),

          },

        })

      }



      ok(res, data)

    } catch (e) {

      fail(res, e, 502)

    }

  })



  // 运行 golden 集（透传，同步 run_status）

  app.post('/api/v1/projects/:id/versions/:vid/onto/golden/run', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const { id, vid } = req.params

      const cwd = resolveVersionCwd(id, vid)

      const version = JSON.parse(

        readFileSync(join(cwd, 'version.json'), 'utf-8')

      ) as { on_policy_id?: string }

      if (!version.on_policy_id) return fail(res, new Error('缺少 on_policy_id'))

      const body = req.body ?? {}



      // 先把 review.run_status 置 running（review 字段不存在时初始化）

      const progress = readStep2Progress(id, vid)

      const prevReview = progress?.review ?? { golden_selected: 0, golden_total: 0 }

      writeStep2Progress(id, vid, {

        review: {

          ...prevReview,

          run_status: 'running',

          run_started_at: new Date().toISOString(),

        },

      })



      try {

        const data = await proxyOnto('POST', `/api/policies/${version.on_policy_id}/golden/run`, {

          ...(body.region ? { region: String(body.region) } : {}),

        })

        // 标记 passed（外部平台返回的 ok=true 即认为 passed）

        const cur = readStep2Progress(id, vid)

        const curReview = cur?.review ?? prevReview

        writeStep2Progress(id, vid, {

          review: {

            ...curReview,

            run_status: 'passed',

            run_finished_at: new Date().toISOString(),

          },

        })

        ok(res, data)

      } catch (e) {

        const cur = readStep2Progress(id, vid)

        const curReview = cur?.review ?? prevReview

        writeStep2Progress(id, vid, {

          review: {

            ...curReview,

            run_status: 'failed',

            run_finished_at: new Date().toISOString(),

          },

        })

        fail(res, e, 502)

      }

    } catch (e) {

      fail(res, e)

    }

  })



  // —— 资格判定历史（rule-match 历史：质量可追溯）——



  // 追加一条资格判定记录

  app.post('/api/v1/projects/:id/versions/:vid/onto/rule/judge-history', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const { id, vid } = req.params

      const body = req.body ?? {}

      const text = typeof body.text === 'string' ? body.text : ''

      const question = typeof body.question === 'string' ? body.question : undefined

      const region = typeof body.region === 'string' ? body.region : ''

      const region_id = typeof body.region_id === 'string' && body.region_id ? body.region_id : undefined

      const display_name = typeof body.display_name === 'string' && body.display_name ? body.display_name : undefined

      const matched_rule_ids = Array.isArray(body.matched_rule_ids)

        ? (body.matched_rule_ids as unknown[]).filter((s): s is string => typeof s === 'string')

        : []

      const total_rule_ids = Array.isArray(body.total_rule_ids)

        ? (body.total_rule_ids as unknown[]).filter((s): s is string => typeof s === 'string')

        : []

      if (!text) return fail(res, new Error('缺少 text'))

      if (!region) return fail(res, new Error('缺少 region'))

      const snapshot = appendJudgeHistory(id, vid, {

        text,

        question,

        region,

        region_id,

        display_name,

        matched_rule_ids,

        total_rule_ids,

      })

      ok(res, snapshot)

    } catch (e) {

      fail(res, e)

    }

  })



  // 读取当前版本的资格判定历史

  app.get('/api/v1/projects/:id/versions/:vid/onto/rule/judge-history', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const { id, vid } = req.params

      ok(res, readJudgeHistory(id, vid))

    } catch (e) {

      fail(res, e)

    }

  })



  // 收尾：写 ontology.json + phase=done

  app.post('/api/v1/projects/:id/versions/:vid/onto/finalize', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const { id, vid } = req.params

      const regions = Array.isArray(req.body?.regions) ? req.body.regions.map(String) : []

      const ruleCount = Number(req.body?.rule_count ?? 0)

      const meta = finalizeStep2(id, vid, regions, ruleCount)

      logEvent({ actor: req.user!.username, action: 'step2.finalize', target: `${id}@${vid}`, detail: { regions, ruleCount }, ip: req.ip })

      ok(res, meta)

    } catch (e) {

      fail(res, e, 400)

    }

  })



  // —— 项目空间（对齐前端 /api/v1）——

  app.get('/api/v1/projects', authMiddleware, requirePermission('project'), (_req, res) => {

    try {

      ok(res, listProjectsForUi())

    } catch (e) {

      fail(res, e)

    }

  })



  app.post('/api/v1/projects', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      // 负责人默认取当前登录用户；仅当请求体显式传入 ownerUsername 时才覆盖。

      const ownerUsername = req.body?.ownerUsername

        ? String(req.body.ownerUsername)

        : req.user!.username

      const project = await createProject({

        name: String(req.body?.name || ''),

        description: String(req.body?.description || ''),

        ownerUsername,

        ownerName: String(req.body?.ownerName || ''),

        key: req.body?.key ? String(req.body.key) : undefined,

        policyId: req.body?.policyId ? String(req.body.policyId) : undefined,

      })

      logEvent({ actor: req.user!.username, action: 'project.create', target: project.name, detail: { key: project.key, owner: ownerUsername }, ip: req.ip })

      ok(res, project)

    } catch (e) {

      fail(res, e)

    }

  })



  app.post('/api/v1/projects/:fromId/sync-to/:toId', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const result = syncProjectToProject(req.params.fromId, req.params.toId, {

        skillIds: Array.isArray(req.body?.skillIds) ? req.body.skillIds : [],

        dataPaths: Array.isArray(req.body?.dataPaths) ? req.body.dataPaths : [],

      })

      ok(res, result)

    } catch (e) {

      fail(res, e)

    }

  })



  app.get('/api/v1/projects/versions', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const projectKey = String(req.query.project || req.query.key || '')

      if (!projectKey) return fail(res, new Error('project query required'))

      ok(res, listVersionsForUi(projectKey))

    } catch (e) {

      fail(res, e)

    }

  })



  app.post('/api/v1/projects/:id/versions', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const cloneFrom = req.body?.clone_from

      const meta = await createVersion(req.params.id, {

        version: String(req.body?.version || ''),

        changelog: String(req.body?.changelog || ''),

        ...(cloneFrom?.sourceProjectKey && cloneFrom?.sourceVersionId

          ? {

              clone_from: {

                sourceProjectKey: String(cloneFrom.sourceProjectKey),

                sourceVersionId: String(cloneFrom.sourceVersionId),

              },

            }

          : {}),

      })

      logEvent({ actor: req.user!.username, action: 'project.version.create', target: String(req.body?.version || ''), detail: { project: req.params.id, ...(cloneFrom ? { clone_from: cloneFrom } : {}) }, ip: req.ip })

      ok(res, meta)

    } catch (e) {

      fail(res, e)

    }

  })



  /** clone-sources：全工作区已建模版本（跨项目，SQL 聚合），供创建版本时选择克隆源 */

  app.get('/api/v1/onto/clone-sources', authMiddleware, requirePermission('project'), (_req, res) => {

    try {

      ok(res, { sources: listModeledVersions() })

    } catch (e) {

      fail(res, e)

    }

  })



  app.post('/api/v1/projects/:id/versions/:vid/delete', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      deleteVersion(req.params.id, req.params.vid)

      logEvent({ actor: req.user!.username, action: 'project.version.delete', target: req.params.vid, detail: { project: req.params.id }, ip: req.ip })

      ok(res, { deleted: true })

    } catch (e) {

      fail(res, e)

    }

  })



  app.get('/api/v1/projects/:id/pipeline', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const version = String(req.query.version || '').trim() || undefined

      ok(res, getPipeline(req.params.id, version, req.user!.username))

    } catch (e) {

      fail(res, e)

    }

  })



  app.post('/api/v1/projects/:id/pipeline/advance', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const fromStep = Number(req.body?.fromStep)

      if (!Number.isFinite(fromStep) || fromStep < 1) {

        return fail(res, new Error('fromStep required'))

      }

      const version = String(req.body?.version || '').trim() || undefined

      const result = await advancePipeline(req.params.id, fromStep, version)

      logEvent({ actor: req.user!.username, action: 'pipeline.advance', target: req.params.id, detail: { fromStep, version }, ip: req.ip })

      ok(res, result)

    } catch (e) {

      fail(res, e)

    }

  })



  // 审核流：提交审核（developer）—— 携带选定的审批人

  app.post('/api/v1/projects/:id/pipeline/submit-review', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const comment = req.body?.comment ? String(req.body.comment) : undefined

      const version = String(req.body?.version || '').trim() || undefined

      const reviewers = Array.isArray(req.body?.reviewers) ? req.body.reviewers : []

      const cleaned = reviewers

        .filter((r: { username?: string; name?: string }) => r && r.username && r.name)

        .map((r: { username: string; name: string }) => ({ username: String(r.username), name: String(r.name) }))

      ok(res, submitForReview(req.params.id, req.user!.username, cleaned, comment, version))

      logEvent({ actor: req.user!.username, action: 'pipeline.submit_review', target: req.params.id, detail: { reviewers: cleaned.map((r: { username: string; name: string }) => r.name) }, ip: req.ip })

    } catch (e) {

      fail(res, e)

    }

  })



  // 审核流：通过（reviewer）—— 共识：全票通过才发布归档

  app.post('/api/v1/projects/:id/pipeline/approve', authMiddleware, requirePermission('task'), (req, res) => {

    try {

      const comment = req.body?.comment ? String(req.body.comment) : undefined

      const version = String(req.body?.version || '').trim() || undefined

      const gateChecks = Array.isArray(req.body?.gateChecks) ? req.body.gateChecks as string[] : undefined

      ok(res, approvePipeline(req.params.id, req.user!.username, comment, version, gateChecks))

      logEvent({ actor: req.user!.username, action: 'pipeline.approve', target: req.params.id, detail: { comment: comment || '' }, ip: req.ip })

    } catch (e) {

      fail(res, e)

    }

  })



  // 审核流：驳回（reviewer）—— 任一驳回即整体驳回，退回 Step3

  app.post('/api/v1/projects/:id/pipeline/reject', authMiddleware, requirePermission('task'), (req, res) => {

    try {

      const comment = req.body?.comment ? String(req.body.comment) : undefined

      const version = String(req.body?.version || '').trim() || undefined

      const gateChecks = Array.isArray(req.body?.gateChecks) ? req.body.gateChecks as string[] : undefined

      ok(res, rejectPipeline(req.params.id, req.user!.username, comment, version, gateChecks))

      logEvent({ actor: req.user!.username, action: 'pipeline.reject', target: req.params.id, detail: { comment: comment || '' }, ip: req.ip })

    } catch (e) {

      fail(res, e)

    }

  })



  // 审核流：保存检查项勾选状态（审批人实时勾选时调用）

  app.post('/api/v1/projects/:id/versions/:vid/gate-checks', authMiddleware, requirePermission('task'), (req, res) => {

    try {

      const gateChecks: string[] = Array.isArray(req.body?.gateChecks) ? req.body.gateChecks : []

      saveGateChecks(req.params.id, req.params.vid, req.user!.username, gateChecks)

      ok(res, { saved: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // 审核流：查询当前版本审核进度（已批 X/N、各审批人决策、我的决策）

  app.get('/api/v1/projects/:id/review-progress', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const version = req.query?.version ? String(req.query.version) : undefined

      const ver = version || getPipeline(req.params.id).project.version

      ok(res, getReviewProgress(req.params.id, ver, req.user!.username))

    } catch (e) {

      fail(res, e)

    }

  })



  app.post('/api/v1/admin/clear-projects', authMiddleware, requirePermission('user:manage'), (_req, res) => {

    try {

      clearAllProjects()

      ok(res, { cleared: true })

    } catch (e) {

      fail(res, e)

    }

  })



  // —— 数据空间（制品晋级库：审批通过后自动归档，只读 + 可同步）——

  app.get('/api/v1/data/spaces', authMiddleware, requirePermission('project'), (_req, res) => {

    try {

      ok(res, listDataSpacesForUi())

    } catch (e) {

      fail(res, e)

    }

  })



  // 数据空间为制品晋级库，由审批流程自动生成，不支持手动新建/删除。



  app.get('/api/v1/data/spaces/:id', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      ok(res, getDataSpaceForUi(req.params.id))

    } catch (e) {

      fail(res, e)

    }

  })



  // 查询某版本的发布/同步状态（仅依赖数据空间本地副本，不回项目空间）

  app.get('/api/v1/data/spaces/:dsId/versions/:vid/publish-status', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      ok(res, getPublishStatus({ dataSpaceId: req.params.dsId, version: req.params.vid }))

    } catch (e) {

      fail(res, e)

    }

  })



  // 手动同步到远程：直接用数据空间本地副本，不回项目空间

  app.post('/api/v1/data/spaces/:dsId/versions/:vid/sync-to-remote', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const entry = getDataSpace(req.params.dsId)

      if (!entry) throw new Error(`数据空间不存在: ${req.params.dsId}`)

      const spaceName = entry.projectName || entry.name

      const result = syncVersionToRemote(req.params.dsId, req.params.vid, spaceName, req.user?.name)

      ok(res, result)

    } catch (e) {

      const msg = e instanceof Error ? e.message : String(e)

      if (/未配置|not found|不存在|not configured|No such|缺失/i.test(msg)) {

        return res.status(400).json({ error: 'publish_config_error', message: msg })

      }

      fail(res, e, 500)

    }

  })





  // 多空间导入（V1+）：body 必须含 space_ids: string[]

  // 必须先注册此路由，匹配优先级高于 /:id/import-from-crawler

  app.post('/api/v1/data/spaces/import-from-crawler', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const opts = req.body || {}

      if (!Array.isArray(opts.space_ids) || opts.space_ids.length === 0) {

        return res.status(400).json({

          error: 'space_ids_required',

          message: '请至少选择 1 个目标数据空间（space_ids 非空数组）'

        })

      }

      const result = await importFromCrawlerMulti(opts)

      logEvent({ actor: req.user!.username, action: 'dataspace.import_crawler', target: (opts.space_ids || []).join(','), detail: { imported: result.total.imported, skipped: result.total.skipped }, ip: req.ip })

      ok(res, result)

    } catch (e) {

      console.error('[import-from-crawler-multi] failed:', e)

      res.status(502).json({ error: 'crawler_import_failed', message: String((e as Error).message) })

    }

  })



  // OKF 固化导出：bridge 构造绝对路径，代理调爬虫 /api/export/okf

  app.post('/api/v1/projects/:id/versions/:vid/export-okf', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const projectId = req.params.id

      const versionId = req.params.vid

      const workspace = String(req.body?.workspace || '')

      const policyIds: number[] = Array.isArray(req.body?.policy_ids) ? req.body.policy_ids : []



      // 构造绝对路径：~/.gs_platform/workspace/{projectId}/versions/{version}/data

      const cwd = resolveVersionCwd(projectId, versionId)

      const targetDir = join(cwd, 'data')



      // 调爬虫 okf 接口（policy_ids 始终传：空数组=不过滤全量导出，非空=按ID过滤）

      const crawlerBase = getCrawlerConfig().baseUrl

      const params = new URLSearchParams({ target_dir: targetDir })

      if (workspace) params.set('workspace', workspace)

      const resp = await fetch(`${crawlerBase}/api/export/okf?${params}`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ policy_ids: policyIds }),

      })

      const data = await resp.json()

      if (!resp.ok) {

        return res.status(resp.status).json({ code: resp.status, message: data.detail || data.message || 'crawler error' })

      }

      logEvent({ actor: req.user!.username, action: 'dataspace.import_crawler', target: `${projectId}@${versionId}`, detail: { exported: data.exported, failed: data.failed }, ip: req.ip })

      ok(res, data)

    } catch (e) {

      console.error('[export-okf] failed:', e)

      res.status(502).json({ error: 'export_okf_failed', message: String((e as Error).message) })

    }

  })



  // 项目版本数据目录文件统计：读取 workspace/{projectId}/versions/{vid}/data 下的文件数

  app.get('/api/v1/projects/:id/versions/:vid/data-stats', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const cwd = resolveVersionCwd(req.params.id, req.params.vid)

      const dataDir = join(cwd, 'data')

      let fileCount = 0

      if (existsSync(dataDir)) {

        const countFiles = (dir: string): number => {

          let n = 0

          for (const ent of readdirSync(dir, { withFileTypes: true })) {

            if (ent.isDirectory()) n += countFiles(join(dir, ent.name))

            else if (ent.name.endsWith('.md') || ent.name.endsWith('.json')) {

              if (ent.name.toLowerCase() !== 'index.md') n++

            }

          }

          return n

        }

        fileCount = countFiles(dataDir)

      }

      ok(res, { fileCount, dataDir: 'data/' })

    } catch (e) {

      ok(res, { fileCount: 0, dataDir: 'data/' })

    }

  })



  // 单空间导入（兼容旧路由 / 老调用方）：内部转换为 space_ids=[id]

  app.post('/api/v1/data/spaces/:id/import-from-crawler', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const opts = req.body || {}

      // 强制单空间语义：传过去的 options 里 overwrite 走单空间粒度

      const result = await importFromCrawlerMulti({

        ...opts,

        space_ids: [req.params.id],

        overwrite_per_space: { [req.params.id]: opts.overwrite ?? false }

      })

      // 旧调用方期望单空间扁平结构 → 从 per_space 取出第一个

      const single = result.per_space[req.params.id]

      if (!single) {

        return res.status(500).json({ error: 'no_result', message: '无返回结果' })

      }

      // 若整空间失败 (有 error), 走 502 分支保留旧行为

      if (single.error) {

        return res.status(502).json({ error: 'crawler_import_failed', message: single.error })

      }

      ok(res, single)

    } catch (e) {

      console.error('[import-from-crawler] failed:', e)

      res.status(502).json({ error: 'crawler_import_failed', message: String((e as Error).message) })

    }

  })



  // ============ 采集任务管理（持久化到 DB，不丢失 task_id）============



  // 提交自动采集任务：代理调爬虫 auto-collect，将 task_id 存入 DB

  app.post('/api/v1/crawl-tasks', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const crawlerBase = getCrawlerConfig().baseUrl

      const params = new URLSearchParams()

      const body = req.body || {}

      const fields: Record<string, string | number | boolean | undefined> = {

        workspace: body.workspace || req.query.workspace,

        subsidy_type: body.subsidy_type,

        region: body.region,

        keyword: body.keyword,

        keyword_relation: body.keyword_relation || 'and',

        max_results: body.max_results,

        pages: body.pages,

        use_gov_search_scraper: body.use_gov_search_scraper,

        api_key: body.api_key,

        model: body.model,

      }

      for (const [k, v] of Object.entries(fields)) {

        if (v !== undefined && v !== null && v !== '') params.set(k, String(v))

      }

      const resp = await fetch(`${crawlerBase}/api/policies/auto-collect?${params}`, { method: 'POST' })

      const data = await resp.json() as { task_id?: string; message?: string; workspace?: string }

      if (!resp.ok || !data.task_id) {

        return res.status(resp.status || 502).json({ error: 'crawler_error', message: data.detail || data.message || 'crawler error' })

      }

      const now = new Date().toISOString()

      saveCrawlTask({

        task_id: data.task_id,

        workspace: String(fields.workspace || data.workspace || ''),

        subsidy_type: String(fields.subsidy_type || ''),

        region: String(fields.region || ''),

        keyword: String(fields.keyword || ''),

        keyword_relation: String(fields.keyword_relation || 'and'),

        pages: Number(fields.pages || 5),

        use_gov_search: fields.use_gov_search_scraper !== false,

        status: 'running',

        stage: '',

        progress_percent: 0,

        total_found: 0, total_evaluated: 0, total_accepted: 0, total_saved: 0, total_skipped: 0,

        current_url: '',

        started_at: now,

        finished_at: null,

        created_at: now,

      })

      logEvent({ actor: req.user!.username, action: 'crawl_task.create', target: data.task_id, detail: { workspace: fields.workspace, subsidy_type: fields.subsidy_type, region: fields.region }, ip: req.ip })

      ok(res, data)

    } catch (e) {

      console.error('[crawl-tasks create] failed:', e)

      res.status(502).json({ error: 'crawler_error', message: String((e as Error).message) })

    }

  })



  // 查询采集任务进度：从爬虫拉最新进度，同步到 DB，返回给前端

  app.get('/api/v1/crawl-tasks/:taskId', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const { taskId } = req.params

      const stored = getCrawlTask(taskId)

      if (!stored) return res.status(404).json({ error: 'not_found', message: '任务不存在' })

      // 已结束的任务直接返 DB 缓存

      if (stored.status !== 'running') return ok(res, stored)

      // running 的任务去爬虫拉最新进度

      const crawlerBase = getCrawlerConfig().baseUrl

      const resp = await fetch(`${crawlerBase}/api/policies/auto-collect/${encodeURIComponent(taskId)}`)

      if (!resp.ok) return ok(res, stored) // 爬虫不可达时降级返旧值

      const p = await resp.json() as Record<string, unknown>

      const updated: StoredCrawlTask = {

        ...stored,

        status: (p.status as StoredCrawlTask['status']) || stored.status,

        stage: String(p.stage || stored.stage),

        progress_percent: Number(p.progress_percent ?? stored.progress_percent),

        total_found: Number(p.total_found ?? stored.total_found),

        total_evaluated: Number(p.total_evaluated ?? stored.total_evaluated),

        total_accepted: Number(p.total_accepted ?? stored.total_accepted),

        total_saved: Number(p.total_saved ?? stored.total_saved),

        total_skipped: Number(p.total_skipped ?? stored.total_skipped),

        current_url: String(p.current_url || stored.current_url),

        finished_at: p.status === 'completed' || p.status === 'failed' ? new Date().toISOString() : stored.finished_at,

      }

      saveCrawlTask(updated)

      ok(res, updated)

    } catch (e) {

      console.error('[crawl-tasks progress] failed:', e)

      res.status(500).json({ error: String((e as Error).message) })

    }

  })



  // 列出工作空间下的采集任务

  app.get('/api/v1/crawl-tasks', authMiddleware, requirePermission('project'), (req, res) => {

    const workspace = String(req.query.workspace || '')

    const tasks = listCrawlTasks(workspace || undefined)

    ok(res, { items: tasks, total: tasks.length })

  })



  // 删除采集任务记录

  app.delete('/api/v1/crawl-tasks/:taskId', authMiddleware, requirePermission('project'), (req, res) => {

    deleteCrawlTask(req.params.taskId)

    ok(res, { message: '已删除' })

  })



  app.get('/api/projects/:id/files/tree', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      ensureProjectWorkspace(req.params.id, versionId)

      res.json({ data: getFileTree(req.params.id, versionId) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.get('/api/projects/:id/files', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      const path = String(req.query.path || '')

      if (!path) return res.status(400).json({ error: 'path required' })

      res.json({ data: readFileContent(req.params.id, versionId, path) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.put('/api/projects/:id/files', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      const path = String(req.body?.path || '')

      const content = String(req.body?.content ?? '')

      if (!path) return res.status(400).json({ error: 'path required' })

      res.json({ data: writeFileContent(req.params.id, versionId, path, content) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/files/mkdir', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({ data: mkdirPath(req.params.id, versionId, String(req.body?.path || '')) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/files/create', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({

        data: createEmptyFile(

          req.params.id,

          versionId,

          String(req.body?.path || ''),

          String(req.body?.content ?? ''),

        ),

      })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/files/rename', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({

        data: renamePath(req.params.id, versionId, String(req.body?.from || ''), String(req.body?.to || '')),

      })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/files/delete', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({ data: deletePath(req.params.id, versionId, String(req.body?.path || '')) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/files/copy', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({

        data: copyPath(req.params.id, versionId, String(req.body?.from || ''), String(req.body?.to || '')),

      })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/files/move', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({

        data: movePath(req.params.id, versionId, String(req.body?.from || ''), String(req.body?.to || '')),

      })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.get('/api/projects/:id/files/download', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      const path = String(req.query.path || '')

      if (!path) return res.status(400).json({ error: 'path required' })

      const { absPath, filename } = getDownloadFile(req.params.id, versionId, path)

      res.download(absPath, filename)

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/skills', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      const name = String(req.body?.name || '')

      const description = String(req.body?.description || '项目技能')

      const content = req.body?.content ? String(req.body.content) : undefined

      if (content) {

        res.json({ data: createSkillWithContent(req.params.id, versionId, name, description, content) })

      } else {

        res.json({ data: createSkillTemplate(req.params.id, versionId, name, description) })

      }

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  // LLM-powered skill generation (returns generated content without saving)

  app.post('/api/projects/:id/skills/generate', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const name = String(req.body?.name || '').trim()

      const description = String(req.body?.description || '').trim()

      if (!name) return res.status(400).json({ error: 'name required' })

      if (!description) return res.status(400).json({ error: 'description required' })

      const versionId = String(req.query.versionId || '')

      const content = await generateSkillWithLlm(req.params.id, versionId, name, description)

      ok(res, { content })

    } catch (e) {

      console.error('[skill-generate] failed:', e)

      res.status(502).json({ error: String((e as Error).message) })

    }

  })



  // —— AI 生成智能体（基于 example 模板复制完整智能体）——



  // 获取智能体默认值：名称=项目名，描述=LLM生成，规则引擎凭证=config.json.ontoPlatform（不含password），policyId=当前版本 version.json.on_policy_id

  app.get('/api/projects/:id/agent/defaults', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const projectId = req.params.id

      const versionId = String(req.query.versionId || '')

      const project = getProject(projectId)



      // 规则引擎凭证：从 bridge config.json.ontoPlatform 取 url+username（不回显 password）

      let ruleEngine: { url: string; username: string } | {} = {}

      try {

        const cfg = getOntoPlatformConfig()

        ruleEngine = { url: cfg.url, username: cfg.username }

      } catch (e) {

        // ontoPlatform 未配置，返回空对象（同时记录原因便于排查）

        console.warn('[agent-defaults] getOntoPlatformConfig failed:', (e as Error).message)

      }



      // 描述：LLM 根据 data/ 文件生成（可能耗时 10-30 秒）

      let description = ''

      try {

        description = await generateAgentDescription(projectId, versionId)

      } catch (e) {

        console.warn('[agent-defaults] description generation failed:', (e as Error).message)

      }



      // policyId 默认从当前版本的 version.json.on_policy_id 读取（Step2 建模后写入），

      // 未建模（无 on_policy_id）时回退到 project.policyId

      let policyId = project.policyId ?? ''

      try {

        const verCwd = resolveVersionCwd(projectId, versionId)

        const versionMeta = JSON.parse(

          readFileSync(join(verCwd, 'version.json'), 'utf-8'),

        ) as { on_policy_id?: string }

        if (versionMeta.on_policy_id) policyId = versionMeta.on_policy_id

      } catch {

        // version.json 不存在或解析失败，保留 project.policyId

      }



      ok(res, {

        name: project.name,

        description,

        ruleEngine,

        policyId,

        policyDocsDir: 'data',

      })

    } catch (e) {

      fail(res, e)

    }

  })



  // 从模板创建智能体：复制 example/育儿补贴/ → skills/<id>/，替换名称，写 config.json

  app.post('/api/projects/:id/agent/generate', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const name = String(req.body?.name || '').trim()

      const description = String(req.body?.description || '').trim()

      if (!name) return res.status(400).json({ error: 'name required' })

      if (!description) return res.status(400).json({ error: 'description required' })



      const versionId = String(req.query.versionId || '')

      const result = createAgentFromTemplate(req.params.id, versionId, {

        name,

        description,

        policyId: req.body?.policyId ? String(req.body.policyId) : undefined,

        policyDocsDir: req.body?.policyDocsDir ? String(req.body.policyDocsDir) : undefined,

        ruleEngine: req.body?.ruleEngine ?? undefined,

      })

      ok(res, result)

    } catch (e) {

      console.error('[agent-generate] failed:', e)

      res.status(502).json({ error: String((e as Error).message) })

    }

  })



  // 保存智能体（generate 已落盘，save 仅返回成功，前端刷新技能列表）

  app.post('/api/projects/:id/agent/save', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const skillId = String(req.body?.skillId || '').trim()

      if (!skillId) return res.status(400).json({ error: 'skillId required' })

      ok(res, { ok: true, skillId })

    } catch (e) {

      fail(res, e)

    }

  })



  app.get('/api/projects/:id/skills', authMiddleware, requirePermission('project'), (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({ data: listProjectSkills(req.params.id, versionId) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.get('/api/projects/:id/sessions', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({ data: await listSessions(req.params.id, versionId) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/sessions', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({ data: await createSession(req.params.id, versionId) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.get('/api/projects/:id/sessions/:sid/messages', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({ data: await getSessionMessages(req.params.id, versionId, req.params.sid) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.patch('/api/projects/:id/sessions/:sid', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      const title = String(req.body?.title || '')

      res.json({ data: await renameSession(req.params.id, versionId, req.params.sid, title) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.post('/api/projects/:id/sessions/:sid/pin', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      const pinned = Boolean(req.body?.pinned)

      res.json({ data: await setSessionPinned(req.params.id, versionId, req.params.sid, pinned) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  app.delete('/api/projects/:id/sessions/:sid', authMiddleware, requirePermission('project'), async (req, res) => {

    try {

      const versionId = String(req.query.versionId || '')

      res.json({ data: await deleteSession(req.params.id, versionId, req.params.sid) })

    } catch (e) {

      res.status(400).json({ error: String((e as Error).message) })

    }

  })



  return app

}



export async function startServer(port = getServerConfig().port) {

  const app = createApp()

  const server = createServer(app)

  const wss = new WebSocketServer({ server, path: '/ws' })



  wss.on('connection', (socket, req) => {

    // —— WebSocket 鉴权：握手时校验 cookie 中的 JWT ——

    const cookieHeader = req.headers.cookie || ''

    const cookies: Record<string, string> = {}

    for (const part of cookieHeader.split(';')) {

      const [k, ...v] = part.trim().split('=')

      if (k) cookies[k] = v.join('=')

    }

    const token = cookies[COOKIE_NAME]

    const payload = verifyToken(token)

    if (!payload) {

      socket.close(4001, '未登录或登录已过期')

      return

    }

    const wsUser = {

      username: payload.username,

      role: payload.role,

      permissions: payload.permissions || [],

    }



    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    const projectId = url.searchParams.get('projectId') || 'tax-skills'



    const send = (data: unknown) => {

      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data))

    }



    send({ type: 'connected', projectId })



    socket.on('message', async (raw) => {

      let msg: {

        type?: string

        sessionId?: string

        text?: string

        skillIds?: string[]

        versionId?: string

      }

      try {

        msg = JSON.parse(String(raw))

      } catch {

        send({ type: 'error', message: 'Invalid JSON' })

        return

      }



      try {

        if (msg.type === 'prompt') {

          if (!msg.sessionId || !msg.text) {

            send({ type: 'error', message: 'sessionId and text required' })

            return

          }

          // Re-verify token expiry on each prompt

          const currentPayload = verifyToken(token)

          if (!currentPayload) {

            send({ type: 'error', message: '登录已过期，请重新登录' })

            socket.close(4001, '登录已过期')

            return

          }

          // 发送对话需要 project 权限

          if (!permissionsInclude(wsUser.permissions, 'project')) {

            send({ type: 'error', message: '无 project 权限' })

            return

          }

          await promptSession({

            projectId,

            versionId: msg.versionId || '',

            sessionId: msg.sessionId,

            text: msg.text,

            skillIds: msg.skillIds || [],

            send,

          })

          return

        }

        if (msg.type === 'abort') {

          if (msg.sessionId) await abortSession(projectId, msg.versionId || '', msg.sessionId)

          send({ type: 'aborted', sessionId: msg.sessionId })

          return

        }

        if (msg.type === 'subscribe_session') {

          send({ type: 'subscribed', sessionId: msg.sessionId })

          return

        }

        send({ type: 'error', message: `Unknown type: ${msg.type}` })

      } catch (e) {

        send({ type: 'error', message: String((e as Error).message) })

      }

    })

  })



  server.listen(port, getServerConfig().host, () => {

    console.log(`[policy-agent-bridge] http://localhost:${port}`)

    console.log(`[policy-agent-bridge] workspace: ${WORKSPACES_DIR}`)

  })



  return server

}


```
