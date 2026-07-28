/**
 * 02-paths.ts — 工作区路径管理
 *
 * 所有持久化数据存放在 WORKSPACES_DIR 下
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const WORKSPACES_DIR = process.env.ONTO_WORKSPACES_DIR ||
  join(homedir(), ".onto-platform", "workspaces");

export function ensureWorkspacesRoot(): void {
  if (!existsSync(WORKSPACES_DIR)) {
    mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
}

export function projectDir(projectKey: string): string {
  return join(WORKSPACES_DIR, sanitize(projectKey));
}

export function versionDir(projectKey: string, versionId: string): string {
  const safe = sanitize(versionId);
  return join(WORKSPACES_DIR, sanitize(projectKey), "versions", safe);
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}
