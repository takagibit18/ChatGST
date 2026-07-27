import { join } from "node:path";
import { atomicWriteJson } from "./json-store.js";
import { readStep2Progress, readVersionJson, writeStep2Progress } from "./step2-progress.js";
import type { OntologyMeta } from "./types.js";
import { versionDir } from "./workspace.js";

export function finalizeStep2(projectKey: string, versionId: string, regions: string[], ruleCount: number): OntologyMeta {
  const progress = readStep2Progress(projectKey, versionId);
  if (!progress) throw new Error("step2 progress does not exist.");
  const version = readVersionJson(projectKey, versionId);
  const policyId = typeof version.on_policy_id === "string" ? version.on_policy_id : undefined;
  if (!policyId) throw new Error("Missing on_policy_id in version.json.");

  const startedAt = progress.started_at ?? new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const reviewStart = progress.review?.run_started_at ?? finishedAt;
  const reviewEnd = progress.review?.run_finished_at ?? finishedAt;
  const reviewMs = Math.max(0, new Date(reviewEnd).getTime() - new Date(reviewStart).getTime());

  const meta: OntologyMeta = {
    policy_id: policyId,
    canonical_name: typeof version.on_policy_canonical === "string" ? version.on_policy_canonical : "",
    regions,
    started_at: startedAt,
    finished_at: finishedAt,
    step_durations: {
      extract_ms: 0,
      derive_ms: 0,
      merge_ms: 0,
      review_ms: reviewMs,
      golden_run_ms: reviewMs,
    },
    file_count: progress.total_files,
    rule_count: ruleCount,
    ...(progress.review?.run_pass_rate !== undefined ? { golden_pass_rate: progress.review.run_pass_rate } : {}),
  };

  atomicWriteJson(join(versionDir(projectKey, versionId), "ontology.json"), meta);
  writeStep2Progress(projectKey, versionId, { phase: "done", finished_at: finishedAt });
  return meta;
}
