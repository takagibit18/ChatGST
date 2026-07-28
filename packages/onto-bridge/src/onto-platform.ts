/**
 * 05-onto-platform.ts — 本体平台 HTTP 代理层
 *
 * 对应原架构文档 onto-platform.ts (完整实现)
 * 核心职责: session 管理 + 所有 /api/* 调用的统一代理
 *
 * 对比 ChatGST:
 *   ChatGST 有自己的 DeepSeekModelProvider.chatCompletion()
 *   这里是 OntoRequestError + proxyOnto() 作为统一入口
 */
import { getOntoPlatformConfig, type OntoPlatformConfig } from "./config.js";

const MOCK_MODE = process.env.MOCK_ONTO === "1" || process.env.MOCK_ONTO === "true";
let mockOntoResponse: ((method: string, path: string, body: unknown) => unknown) | null = null;

async function ensureMock() {
  if (!mockOntoResponse) {
    mockOntoResponse = (await import("./mock-onto.js")).mockOntoResponse;
  }
}

export class OntoRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly bodyText: string,
    public readonly payload?: { error_type?: string; error?: string; candidates?: unknown[]; [k: string]: unknown },
  ) {
    super(`onto-platform ${method} ${path} -> HTTP ${status}: ${payload?.error ?? bodyText.slice(0, 200)}`);
    this.name = "OntoRequestError";
  }
  get errorType(): string | undefined { return this.payload?.error_type; }
}

interface Session { cookie: string; loggedAt: number }
let session: Session | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000;  // 30 分钟
const LOGIN_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

/** 登录本体平台，获取 session cookie (幂等：复用未过期 session) */
async function ensureLogin(): Promise<string> {
  if (session && Date.now() - session.loggedAt < SESSION_TTL_MS) return session.cookie;
  const cfg = getOntoPlatformConfig();
  const r = await fetch(`${cfg.url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`onto-platform login failed: HTTP ${r.status}`);
  const setCookie = r.headers.get("set-cookie") ?? "";
  const cookie = setCookie
    .split(/,(?=\s*[\w-]+=)/)
    .map((s) => s.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("onto-platform login: 响应无 Set-Cookie");
  session = { cookie, loggedAt: Date.now() };
  return cookie;
}

async function clearSession(): Promise<void> { session = null; }

/**
 * 核心代理函数 — 带重试机制 (对齐 ChatGST chatCompletion 的 retry 设计)
 *
 * @param method   HTTP 方法
 * @param path     API 路径 (如 /api/onto/extract)
 * @param body     请求体 (可选)
 * @param opts     超时等选项
 * @returns        响应 JSON (或 null)
 */
export async function proxyOnto<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number; retries?: number },
): Promise<T | null> {
  // Mock mode: 本地模拟，不读 config，不发起网络
  if (MOCK_MODE) {
    await ensureMock();
    const result = mockOntoResponse!(method, path, body);
    return result as T;
  }

  const cfg = getOntoPlatformConfig();
  const url = `${cfg.url}${path.startsWith("/") ? path : "/" + path}`;
  const timeoutMs = opts?.timeoutMs ?? 300_000;
  const maxRetries = opts?.retries ?? MAX_RETRIES;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let cookie = await ensureLogin();
      const headers: Record<string, string> = {
        Cookie: cookie, Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

      let r = await fetch(url, {
        method, headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (r.status === 401 && attempt < maxRetries) {
        await clearSession();
        cookie = await ensureLogin();
        headers.Cookie = cookie;
        r = await fetch(url, {
          method, headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      }

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        let payload: OntoRequestError["payload"] | undefined;
        try { payload = JSON.parse(text); } catch { payload = undefined; }
        throw new OntoRequestError(method, path, r.status, text, payload);
      }

      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) return (await r.json()) as T;
      return null;
    } catch (error) {
      if (error instanceof OntoRequestError) throw error;
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        process.stderr.write(`[onto-platform] ${method} ${path} attempt ${attempt} failed, retry in ${delay}ms: ${String(error).slice(0, 150)}\n`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  return null;
}

/** 供启动日志用的摘要信息 */
export function getOntoSummary(): string {
  if (MOCK_MODE) return "mock (local)";
  try {
    const cfg = getOntoPlatformConfig();
    return `${cfg.url} (user: ${cfg.username})`;
  } catch {
    return "(未配置)";
  }
}
