/**
 * project-store.ts — 项目持久化 (stub)
 *
 * 管理多项目/多版本的本地文件存储
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { WORKSPACES_DIR } from "./paths.js";

interface ProjectEntry {
  key: string;
  name: string;
  createdAt: string;
  versions: string[];
}

export async function initProjectStore(): Promise<void> {
  if (!existsSync(WORKSPACES_DIR)) {
    mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
  console.log(`[onto-bridge] project store initialized at ${WORKSPACES_DIR}`);
}

export function flushProjectStore(): void {
  console.log("[onto-bridge] project store flushed");
}

export function clearAllProjects(): void {
  if (!existsSync(WORKSPACES_DIR)) return;
  for (const entry of readdirSync(WORKSPACES_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      rmSync(`${WORKSPACES_DIR}/${entry.name}`, { recursive: true, force: true });
    }
  }
}

export function listProjects(): ProjectEntry[] {
  if (!existsSync(WORKSPACES_DIR)) return [];
  return readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      key: e.name,
      name: e.name,
      createdAt: new Date().toISOString(),
      versions: [],
    }));
}
