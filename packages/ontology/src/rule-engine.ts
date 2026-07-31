import { getRuleEngineConfig } from "./config.js";
import { hasPublishedLocalOntology, queryLocalPolicy } from "./local-store.js";
import type { PolicyQueryRequest, PolicyQueryResponse, RuleEngineConfig } from "./types.js";

type Session = { cookie: string; loggedAt: number; key: string };

let session: Session | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000;

function cookieFrom(header: string): string {
  return header
    .split(/,(?=\s*[\w-]+=)/u)
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

async function ensureLogin(cfg: RuleEngineConfig): Promise<string> {
  const key = `${cfg.url}:${cfg.username}`;
  if (session && session.key === key && Date.now() - session.loggedAt < SESSION_TTL_MS) return session.cookie;
  const response = await fetch(`${cfg.url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
  });
  if (!response.ok) throw new Error(`rule engine login failed: HTTP ${response.status}`);
  const cookie = cookieFrom(response.headers.get("set-cookie") ?? "");
  if (!cookie) throw new Error("rule engine login returned no Set-Cookie header.");
  session = { cookie, loggedAt: Date.now(), key };
  return cookie;
}

export async function queryPolicy(req: PolicyQueryRequest): Promise<PolicyQueryResponse> {
  const localPolicyId = req.policy_id ?? process.env.RULE_ENGINE_POLICY_ID;
  if (localPolicyId && hasPublishedLocalOntology(localPolicyId)) {
    return queryLocalPolicy({
      policy_id: localPolicyId,
      region: req.region,
      text: req.text,
      ...(req.question ? { question: req.question } : {}),
      ...(req.version ? { version: req.version } : {}),
      ...(req.facts ? { facts: req.facts } : {}),
    });
  }
  const cfg = getRuleEngineConfig();
  const payload = { ...req, policy_id: req.policy_id ?? cfg.policyId };
  async function doFetch(cookie: string): Promise<Response> {
    return fetch(`${cfg.url}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(payload),
    });
  }
  let cookie = await ensureLogin(cfg);
  let response = await doFetch(cookie);
  if (response.status === 401) {
    session = null;
    cookie = await ensureLogin(cfg);
    response = await doFetch(cookie);
  }
  if (!response.ok) throw new Error(`rule engine /api/query -> HTTP ${response.status}`);
  const data = (await response.json()) as PolicyQueryResponse;
  if (data.ok === false) throw new Error(`rule engine business error: ${data.error ?? "unknown"}`);
  return data;
}

