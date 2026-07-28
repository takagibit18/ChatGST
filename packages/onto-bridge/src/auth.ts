/**
 * auth.ts — 认证模块 (stub)
 *
 * 原架构文档中引用了 initAuth()，但未给出完整源码。
 * 此处提供最小实现，后续可扩展为 JWT/OAuth。
 */
export interface AuthUser {
  username: string;
  password: string;   // hashed
  displayName: string;
  role: string;
  email: string;
}

let initialized = false;

export function initAuth(): void {
  if (initialized) return;
  initialized = true;
  console.log("[onto-bridge] auth initialized (stub)");
}

export function authenticate(username: string, password: string): AuthUser | null {
  // Stub: accept any non-empty credentials
  if (!username || !password) return null;
  return {
    username,
    password: "",
    displayName: username,
    role: "admin",
    email: `${username}@local`,
  };
}
