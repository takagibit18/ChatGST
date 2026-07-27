import { proxyOnto } from "./onto-platform.js";
import { loadStep2Config } from "./step2-data-source.js";
import { writeStep2Progress } from "./step2-progress.js";
import type { MergeSummary } from "./types.js";

type MergeAllResponse = {
  ok?: boolean;
  dry_run?: boolean;
  plan_id?: string;
  merged?: number;
  failed?: number;
  conflict_items?: Array<{ key?: string }>;
  blocked_rules?: unknown[];
  warnings?: string[];
  results?: Array<{ region?: string; ok?: boolean; reason?: string }>;
  error?: string;
};

const MAX_ERR_TEXT = 300;

export async function runMergeAllWithResolutions(projectKey: string, versionId: string, policyId: string): Promise<MergeSummary> {
  const action = loadStep2Config().merge_conflict_action ?? "use_candidate";
  writeStep2Progress(projectKey, versionId, { phase: "merge", merge_stage: "preview" });
  const preview = await proxyOnto<MergeAllResponse>("POST", `/api/policies/${policyId}/merge-all`, {
    dry_run: true,
    max_workers: 4,
  });
  if (!preview || preview.ok === false) {
    throw new Error(`merge-all preview failed: ${(preview?.error ?? "empty response").slice(0, MAX_ERR_TEXT)}`);
  }

  const conflictKeys = (preview.conflict_items ?? [])
    .map((item) => item.key)
    .filter((key): key is string => typeof key === "string" && key.length > 0);
  if (conflictKeys.length > 0) {
    writeStep2Progress(projectKey, versionId, { merge_stage: "resolving", conflict_count: conflictKeys.length });
  }
  const resolutions = conflictKeys.length > 0 ? Object.fromEntries(conflictKeys.map((key) => [key, { action }])) : undefined;

  writeStep2Progress(projectKey, versionId, { merge_stage: "committing" });
  const commit = await proxyOnto<MergeAllResponse>("POST", `/api/policies/${policyId}/merge-all`, {
    dry_run: false,
    plan_id: preview.plan_id,
    resolutions,
    max_workers: 4,
  });
  if (!commit || commit.ok === false) {
    throw new Error(`merge-all commit failed: ${(commit?.error ?? "empty response").slice(0, MAX_ERR_TEXT)}`);
  }

  const failedRegions = (commit.results ?? [])
    .filter((result) => result.ok === false)
    .map((result) => ({ region: result.region ?? "(unknown)", reason: result.reason ?? "(no reason)" }));

  return {
    merged: commit.merged ?? 0,
    failed: commit.failed ?? failedRegions.length,
    conflict_count: conflictKeys.length,
    conflict_action: action,
    overwritten_keys: conflictKeys,
    blocked_count: (commit.blocked_rules ?? []).length,
    warnings: commit.warnings ?? [],
    failed_regions: failedRegions,
    finished_at: new Date().toISOString(),
  };
}
