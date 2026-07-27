import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACES_DIR } from "./config.js";

export function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/gu, "_");
}

export function ensureProjectWorkspace(projectKey: string, versionId: string): string {
  const dir = join(WORKSPACES_DIR, safeSegment(projectKey), "versions", safeSegment(versionId));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function versionDir(projectKey: string, versionId: string): string {
  return join(WORKSPACES_DIR, safeSegment(projectKey), "versions", safeSegment(versionId));
}

