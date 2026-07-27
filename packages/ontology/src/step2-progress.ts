import { join } from "node:path";
import { atomicWriteJson, readJsonFile } from "./json-store.js";
import type { Step2Progress } from "./types.js";
import { ensureProjectWorkspace, versionDir } from "./workspace.js";

function versionJsonPath(projectKey: string, versionId: string): string {
  return join(versionDir(projectKey, versionId), "version.json");
}

function doneCachePath(projectKey: string, versionId: string): string {
  return join(versionDir(projectKey, versionId), "_step2_done.json");
}

function idleProgress(): Step2Progress {
  return { phase: "idle", total_files: 0, processed: 0, errors: [] };
}

export function readVersionJson(projectKey: string, versionId: string): Record<string, unknown> {
  return readJsonFile<Record<string, unknown>>(versionJsonPath(projectKey, versionId), {});
}

export function writeVersionJson(projectKey: string, versionId: string, data: Record<string, unknown>): void {
  ensureProjectWorkspace(projectKey, versionId);
  atomicWriteJson(versionJsonPath(projectKey, versionId), data);
}

export function readStep2Progress(projectKey: string, versionId: string): Step2Progress | null {
  const value = readVersionJson(projectKey, versionId).step2_progress;
  return value && typeof value === "object" ? (value as Step2Progress) : null;
}

export function writeStep2Progress(projectKey: string, versionId: string, patch: Partial<Step2Progress>): Step2Progress {
  const version = readVersionJson(projectKey, versionId);
  const current = (version.step2_progress as Step2Progress | undefined) ?? idleProgress();
  const merged: Step2Progress = { ...current, ...patch, errors: patch.errors ?? current.errors };
  version.step2_progress = merged;
  writeVersionJson(projectKey, versionId, version);
  return merged;
}

export function markStep2FileDone(projectKey: string, versionId: string, relPath: string): void {
  const path = doneCachePath(projectKey, versionId);
  const done = readJsonFile<string[]>(path, []);
  if (done.includes(relPath)) return;
  atomicWriteJson(path, [...done, relPath]);
}

export function isStep2FileDone(projectKey: string, versionId: string, relPath: string): boolean {
  return readJsonFile<string[]>(doneCachePath(projectKey, versionId), []).includes(relPath);
}

