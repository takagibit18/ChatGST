/**
 * roles-store.ts — 角色存储 (stub)
 */
export interface Role {
  code: string;
  name: string;
  permissions: string[];
}

const DEFAULT_ROLES: Role[] = [
  { code: "admin", name: "管理员", permissions: ["*"] },
  { code: "editor", name: "编辑者", permissions: ["project:read", "project:write", "step2:run"] },
  { code: "viewer", name: "查看者", permissions: ["project:read"] },
];

export function listRoles(): Role[] { return [...DEFAULT_ROLES]; }
