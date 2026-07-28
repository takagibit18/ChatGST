/**
 * 01-index.ts — 本体平台 Bridge 入口
 *
 * 对应原架构文档 index.ts
 * 启动顺序: crypto → project-store → auth → server
 */
import { startServer } from "./server.js";
import { ensureWorkspacesRoot, WORKSPACES_DIR } from "./paths.js";
import { initProjectStore, flushProjectStore, clearAllProjects } from "./project-store.js";
import { initAuth } from "./auth.js";
import { getOntoSummary } from "./onto-platform.js";
import { listRoles } from "./roles-store.js";
import { listUsers } from "./users-store.js";

export async function bootstrapOntoPlatform() {
  // crypto 初始化（如有需要）
  // initCrypto()
  await initProjectStore();
  initAuth();
  ensureWorkspacesRoot();

  if (process.env.CLEAR_PROJECTS_ON_START === "1") {
    clearAllProjects();
    console.log("[onto-bridge] cleared all local projects");
  }

  const roles = listRoles();
  const users = listUsers();
  console.log(`[onto-bridge] roles: ${roles.map((r) => r.code).join(", ")}`);
  console.log(`[onto-bridge] users: ${users.length} (${users.map((u) => `${u.username}/${u.role}`).join(", ")})`);
  console.log(`[onto-bridge] onto-platform: ${getOntoSummary()}`);

  return { startServer, WORKSPACES_DIR };
}
