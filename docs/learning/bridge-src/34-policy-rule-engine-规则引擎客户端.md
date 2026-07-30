# 规则引擎客户端 — HTTP 调用 /api/query

> 源文件：`bridge/src/example/policy-template/tools/policy-rule-engine.ts`

```typescript
/**

 * 政策规则引擎代理（资格判定服务）

 *

 * 对接规则引擎 POST /api/query 接口。

 * 认证：POST /api/login 获取 session cookie。

 *

 * 配置自包含：policyId + 规则引擎 URL/凭证均从 skill 级 config.json 读取

 * （skills/<skill-id>/config.json），随 skill 目录一起分发/同步，不依赖 bridge 根 config.json。

 */

import { existsSync, readFileSync } from 'node:fs'

import { dirname, join } from 'node:path'



/** skill 级配置文件 schema */

interface SkillConfig {

  policyId?: string

  /** 政策文件目录路径（相对 CWD 或绝对路径），默认 "data" */

  policyDocsDir?: string

  ruleEngine?: {

    url: string

    username: string

    password: string

  }

}



/** 规则引擎服务配置（解析后） */

interface ServiceConfig {

  url: string

  username: string

  password: string

}



/** 从 skill 级 config.json 读取完整配置 */

function loadSkillConfig(configPath: string): SkillConfig {

  if (!existsSync(configPath)) {

    throw new Error(`skill config.json not found: ${configPath}`)

  }

  return JSON.parse(readFileSync(configPath, 'utf8')) as SkillConfig

}



/** 从 skill 级 config.json 读取规则引擎服务配置 */

export function loadServiceConfig(configPath: string): ServiceConfig {

  const cfg = loadSkillConfig(configPath)

  const re = cfg.ruleEngine

  if (!re || !re.url || !re.username || !re.password) {

    throw new Error(`config.json: ruleEngine.{url,username,password} 必填 (path: ${configPath})`)

  }

  return { url: re.url.replace(/\/+$/, ''), username: re.username, password: re.password }

}



/** 从 skill 级 config.json 读取 policyId */

export function getPolicyId(configPath: string): string | undefined {

  try {

    return loadSkillConfig(configPath).policyId

  } catch {

    return undefined

  }

}



/** 从 skill 级 config.json 读取政策文件目录路径，默认 "data" */

export function getPolicyDocsDir(configPath: string): string {

  try {

    return loadSkillConfig(configPath).policyDocsDir?.trim() || 'data'

  } catch {

    return 'data'

  }

}



export function getRuleEngineSummary(configPath: string): string {

  try {

    const c = loadServiceConfig(configPath)

    return `${c.url} (user: ${c.username})`

  } catch (e) {

    return `(未配置: ${(e as Error).message})`

  }

}



/** 会话状态：内存 cookie jar + 上次登录时间 */

interface Session {

  cookie: string

  loggedAt: number

}

let session: Session | null = null

const SESSION_TTL_MS = 30 * 60 * 1000



async function ensureLogin(configPath: string): Promise<string> {

  if (session && Date.now() - session.loggedAt < SESSION_TTL_MS) {

    return session.cookie

  }

  const cfg = loadServiceConfig(configPath)

  const r = await fetch(`${cfg.url}/api/login`, {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({ username: cfg.username, password: cfg.password }),

  })

  if (!r.ok) {

    const text = await r.text().catch(() => '')

    throw new Error(`规则引擎登录失败: HTTP ${r.status} ${text.slice(0, 100)}`)

  }

  const setCookie = r.headers.get('set-cookie') ?? ''

  const cookie = setCookie

    .split(/,(?=\s*[\w-]+=)/)

    .map((s) => s.split(';')[0].trim())

    .filter(Boolean)

    .join('; ')

  if (!cookie) {

    throw new Error('规则引擎登录: 响应无 Set-Cookie，请检查账号')

  }

  session = { cookie, loggedAt: Date.now() }

  return session.cookie

}



async function clearSession(): Promise<void> {

  session = null

}



/** /api/query 请求体 */

export interface PolicyQueryRequest {

  region: string

  text: string

  question?: string

  policy_id?: string

  version?: string

}



/** missing_info 时返回的待补字段项 */

export interface MissingField {

  op: string

  zh?: string

  hint?: string

}



/** /api/query 响应体（关键字段） */

export interface PolicyQueryResponse {

  ok?: boolean

  error?: string

  error_type?: string

  region: string

  eligible: boolean

  verdict: 'eligible' | 'missing_info' | 'ineligible'

  missing?: MissingField[]

  conclusions?: unknown[]

  procedure?: unknown

  diagnosis?: unknown

  trace?: string[]

}



/**

 * 调用政策规则引擎的自然语言查询接口。

 * configPath 指向 skill 级 config.json（含规则引擎 URL/凭证 + policyId）。

 */

export async function queryPolicy(

  configPath: string,

  req: PolicyQueryRequest,

): Promise<PolicyQueryResponse> {

  const cfg = loadServiceConfig(configPath)

  const url = `${cfg.url}/api/query`



  async function doFetch(cookie: string): Promise<Response> {

    return fetch(url, {

      method: 'POST',

      headers: { 'Content-Type': 'application/json', Cookie: cookie },

      body: JSON.stringify(req),

    })

  }



  let cookie = await ensureLogin(configPath)

  let r = await doFetch(cookie)

  if (r.status === 401) {

    await clearSession()

    cookie = await ensureLogin(configPath)

    r = await doFetch(cookie)

  }



  if (!r.ok) {

    const text = await r.text().catch(() => '')

    throw new Error(`规则引擎 /api/query -> HTTP ${r.status}: ${text.slice(0, 200)}`)

  }



  const data = (await r.json()) as PolicyQueryResponse

  if (data.ok === false) {

    throw new Error(`规则引擎业务错误: ${data.error ?? '未知错误'} (${data.error_type ?? ''})`)

  }

  return data

}


```
