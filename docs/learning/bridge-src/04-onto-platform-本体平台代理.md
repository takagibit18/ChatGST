# 本体平台 HTTP 代理 — Cookie 会话 + 请求转发

> 源文件：`bridge/src/onto-platform.ts`

```typescript
import { getOntoPlatformConfig, type OntoPlatformConfig } from './config.js'



export type { OntoPlatformConfig }



/** onto-platform 请求错误：携带 HTTP 状态与平台错误体（error_type / candidates 等） */

export class OntoRequestError extends Error {

  constructor(

    public readonly method: string,

    public readonly path: string,

    public readonly status: number,

    public readonly bodyText: string,

    public readonly payload?: { error_type?: string; error?: string; candidates?: unknown[]; [k: string]: unknown },

  ) {

    super(

      `onto-platform ${method} ${path} -> HTTP ${status}: ${

        payload?.error ?? bodyText.slice(0, 200)

      }`,

    )

    this.name = 'OntoRequestError'

  }



  /** 平台 error_type（如 region_ambiguous / ontology_invalid） */

  get errorType(): string | undefined {

    return this.payload?.error_type

  }

}



export function getOntoSummary(): string {

  try {

    const c = getOntoPlatformConfig()

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

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 分钟过期



/** onto-platform 登录请求超时 10s（业务请求超时由 proxyOnto opts.timeoutMs 控制） */

const ONTO_LOGIN_TIMEOUT_MS = 10_000



async function ensureLogin(): Promise<string> {

  if (session && Date.now() - session.loggedAt < SESSION_TTL_MS) {

    return session.cookie

  }

  const cfg = getOntoPlatformConfig()

  const r = await fetch(`${cfg.url}/api/login`, {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({ username: cfg.username, password: cfg.password }),

    signal: AbortSignal.timeout(ONTO_LOGIN_TIMEOUT_MS),

  })

  if (!r.ok) {

    throw new Error(`onto-platform login failed: HTTP ${r.status}`)

  }

  const setCookie = r.headers.get('set-cookie') ?? ''

  const cookie = setCookie

    .split(/,(?=\s*[\w-]+=)/)

    .map((s) => s.split(';')[0].trim())

    .filter(Boolean)

    .join('; ')

  if (!cookie) {

    throw new Error('onto-platform login: 响应无 Set-Cookie，请检查账号')

  }

  session = { cookie, loggedAt: Date.now() }

  return cookie

}



async function clearSession(): Promise<void> {

  session = null

}



/**

 * 转发请求到外部本体平台，自动维护 cookie；遇 401 自动重登一次。

 * @param method  HTTP 方法

 * @param path    平台路径（不带 host，如 /api/ontology）

 * @param body    可选 JSON body

 * @param opts.timeoutMs  单次请求超时（默认 300s，覆盖 LLM 类慢调用；

 *                        平台挂死时避免无限挂起；policy 创建等快调用应传更小值）

 * @returns       解析后的 JSON（若是 JSON），否则 null

 */

export async function proxyOnto<T = unknown>(

  method: string,

  path: string,

  body?: unknown,

  opts?: { timeoutMs?: number },

): Promise<T | null> {

  const cfg = getOntoPlatformConfig()

  const url = `${cfg.url}${path.startsWith('/') ? path : '/' + path}`

  const timeoutMs = opts?.timeoutMs ?? 300_000



  async function doFetch(cookie: string): Promise<Response> {

    const headers: Record<string, string> = {

      Cookie: cookie,

      Accept: 'application/json',

      'Accept-Charset': 'utf-8',

    }

    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'

    return fetch(url, {

      method,

      headers,

      body: body !== undefined ? JSON.stringify(body) : undefined,

      signal: AbortSignal.timeout(timeoutMs),

    })

  }



  let cookie = await ensureLogin()

  let r = await doFetch(cookie)

  if (r.status === 401) {

    await clearSession()

    cookie = await ensureLogin()

    r = await doFetch(cookie)

  }



  if (!r.ok) {

    const text = await r.text().catch(() => '')

    let payload: OntoRequestError['payload']

    try {

      payload = JSON.parse(text) as OntoRequestError['payload']

    } catch {

      payload = undefined

    }

    throw new OntoRequestError(method, path, r.status, text, payload)

  }



  const ct = r.headers.get('content-type') ?? ''

  if (ct.includes('application/json')) {

    return (await r.json()) as T

  }

  return null

}


```
