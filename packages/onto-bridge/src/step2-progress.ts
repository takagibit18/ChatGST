/**
 * 08-step2-progress.ts — Step2 进度管理
 *
 * 对应原架构文档 step2-progress.ts (完整实现)
 * 持久化版本进度到 version.json 和 _step2_done.json
 */
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { versionDir } from "./paths.js";
import type { Step2Progress } from "./types.js";

function versionJsonPath(projectKey: string, versionId: string): string {
  return join(versionDir(projectKey, versionId), "version.json");
}
function doneCachePath(projectKey: string, versionId: string): string {
  return join(versionDir(projectKey, versionId), "_step2_done.json");
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf-8")) as T; } catch { return fallback; }
}

export function readStep2Progress(projectKey: string, versionId: string): Step2Progress | null {
  const v = readJson<Record<string, unknown>>(versionJsonPath(projectKey, versionId), {});
  return (v.step2_progress as Step2Progress | undefined) ?? null;
}

export function writeStep2Progress(
  projectKey: string, versionId: string, patch: Partial<Step2Progress>,
): Step2Progress {
  const v = readJson<Record<string, unknown>>(versionJsonPath(projectKey, versionId), {});
  const cur = (v.step2_progress as Step2Progress | undefined) ?? {
    phase: "idle", total_files: 0, processed: 0, errors: [],
  };
  const merged: Step2Progress = { ...cur, ...patch, errors: patch.errors ?? cur.errors };
  v.step2_progress = merged;
  atomicWrite(versionJsonPath(projectKey, versionId), JSON.stringify(v, null, 2) + "\n");
  return merged;
}

export function markStep2FileDone(projectKey: string, versionId: string, relPath: string): void {
  const p = doneCachePath(projectKey, versionId);
  const set = readJson<string[]>(p, []);
  if (!set.includes(relPath)) {
    set.push(relPath);
    atomicWrite(p, JSON.stringify(set, null, 2) + "\n");
  }
}

export function isStep2FileDone(projectKey: string, versionId: string, relPath: string): boolean {
  return readJson<string[]>(doneCachePath(projectKey, versionId), []).includes(relPath);
}
