import { getOntoPlatformConfig } from "./config.js";
export type { OntoPlatformConfig } from "./types.js";

export class OntoRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly bodyText: string,
    public readonly payload?: { error_type?: string; error?: string; candidates?: unknown[]; [key: string]: unknown },
  ) {
    super(`onto-platform ${method} ${path} -> HTTP ${status}: ${payload?.error ?? bodyText.slice(0, 200)}`);
    this.name = "OntoRequestError";
  }

  get errorType(): string | undefined {
    return this.payload?.error_type;
  }
}

type Session = { cookie: string; loggedAt: number };

let session: Session | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 300_000;
const LOGIN_TIMEOUT_MS = 10_000;

function parseCookie(header: string): string {
  return header
    .split(/,(?=\s*[\w-]+=)/u)
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

async function ensureLogin(): Promise<string> {
  if (session && Date.now() - session.loggedAt < SESSION_TTL_MS) return session.cookie;
  const cfg = getOntoPlatformConfig();
  const response = await fetch(`${cfg.url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`onto-platform login failed: HTTP ${response.status}`);
  const cookie = parseCookie(response.headers.get("set-cookie") ?? "");
  if (!cookie) throw new Error("onto-platform login returned no Set-Cookie header.");
  session = { cookie, loggedAt: Date.now() };
  return cookie;
}

export function clearOntoSession(): void {
  session = null;
}

export async function proxyOnto<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number },
): Promise<T | null> {
  const cfg = getOntoPlatformConfig();
  const url = `${cfg.url}${path.startsWith("/") ? path : `/${path}`}`;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function doFetch(cookie: string): Promise<Response> {
    const headers: Record<string, string> = {
      Cookie: cookie,
      Accept: "application/json",
      "Accept-Charset": "utf-8",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init);
  }

  let cookie = await ensureLogin();
  let response = await doFetch(cookie);
  if (response.status === 401) {
    clearOntoSession();
    cookie = await ensureLogin();
    response = await doFetch(cookie);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let payload: OntoRequestError["payload"];
    try {
      payload = JSON.parse(text) as OntoRequestError["payload"];
    } catch {
      payload = undefined;
    }
    throw new OntoRequestError(method, path, response.status, text, payload);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return (await response.json()) as T;
  return null;
}
