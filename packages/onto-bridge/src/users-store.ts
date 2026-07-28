/**
 * users-store.ts — 用户存储 (stub)
 */
export interface User {
  username: string;
  role: string;
  displayName: string;
}

const DEFAULT_USERS: User[] = [
  { username: "admin", role: "admin", displayName: "系统管理员" },
];

export function listUsers(): User[] { return [...DEFAULT_USERS]; }
