/**
 * 11-step2-finalize.ts — Step2 收尾
 *
 * 对应原架构文档 step2-finalize.ts (完整实现)
 * 写入 ontology.json 元数据
 */
import { join } from "node:path";
import { versionDir } from "./paths.js";
import { readStep2Progress, writeStep2Progress } from "./step2-progress.js";
import type { OntologyMeta } from "./types.js";
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

function readVersionMeta(pk: string, vid: string): { on_policy_id?: string; on_policy_canonical?: string } {
  const p = join(versionDir(pk, vid), "version.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf-8")) as any; } catch { return {}; }
}

export function finalizeStep2(
  projectKey: string, versionId: string, regions: string[], ruleCount: number,
): OntologyMeta {
  const progress = readStep2Progress(projectKey, versionId);
  if (!progress) throw new Error("step2 progress 不存在");
  const meta = readVersionMeta(projectKey, versionId);
  if (!meta.on_policy_id) throw new Error("缺少 on_policy_id");

  const startedAt = progress.started_at ?? new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const reviewStart = progress.review?.run_started_at ?? finishedAt;
  const reviewEnd = progress.review?.run_finished_at ?? finishedAt;

  const ontologyMeta: OntologyMeta = {
    policy_id: meta.on_policy_id,
    canonical_name: meta.on_policy_canonical ?? "",
    regions,
    started_at: startedAt,
    finished_at: finishedAt,
    step_durations: {
      extract_ms: 0,
      derive_ms: 0,
      merge_ms: 0,
      review_ms: new Date(reviewEnd).getTime() - new Date(reviewStart).getTime(),
      golden_run_ms: new Date(reviewEnd).getTime() - new Date(reviewStart).getTime(),
    },
    file_count: progress.total_files,
    rule_count: ruleCount,
    ...(progress.review?.run_pass_rate !== undefined ? { golden_pass_rate: progress.review.run_pass_rate } : {}),
  };

  atomicWriteJson(join(versionDir(projectKey, versionId), "ontology.json"), ontologyMeta);
  writeStep2Progress(projectKey, versionId, { phase: "done", finished_at: finishedAt });
  return ontologyMeta;
}
