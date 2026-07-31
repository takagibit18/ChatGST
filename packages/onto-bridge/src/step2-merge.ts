/**
 * 09-step2-merge.ts — 两阶段规则合并
 *
 * 对应原架构文档 step2-merge.ts (完整实现)
 * 阶段1: dry_run 预览冲突
 * 阶段2: 自动生成 conflict → resolution 决策 + commit
 *
 * 对比 ChatGST:
 *   ChatGST 没有"多来源规则冲突"的概念
 *   这里是本体平台的核心创新: 多地域/多文件规则合并
 */
import { proxyOnto } from "./onto-platform.js";
import { loadStep2Config } from "./step2-data-source.js";
import { writeStep2Progress } from "./step2-progress.js";
import type { MergeSummary, Step2Config } from "./types.js";

interface MergeAllResponse {
  ok?: boolean; dry_run?: boolean; plan_id?: string;
  merged?: number; failed?: number;
  conflict_items?: { key?: string }[];
  blocked_rules?: unknown[]; warnings?: string[];
  results?: { region?: string; ok?: boolean; reason?: string }[];
  error?: string;
}

const MAX_ERR_TEXT = 300;

function resolveConflictAction(): NonNullable<Step2Config["merge_conflict_action"]> {
  const action = loadStep2Config().merge_conflict_action ?? "use_candidate";
  if (action === "use_candidate" || action === "keep_existing" || action === "skip") return action;
  throw new Error(`merge_conflict_action 无效: ${action}`);
}

export async function runMergeAllWithResolutions(
  projectKey: string, versionId: string, policyId: string,
): Promise<MergeSummary> {
  const action = resolveConflictAction();
  const finished = () => new Date().toISOString();

  // 阶段1: preview
  writeStep2Progress(projectKey, versionId, { phase: "merge", merge_stage: "preview" });
  const preview = await proxyOnto<MergeAllResponse>("POST", `/api/policies/${policyId}/merge-all`, {
    dry_run: true, max_workers: 4,
  });
  if (!preview || preview.ok === false) {
    throw new Error(`merge-all 预览失败: ${(preview?.error ?? "无响应").slice(0, MAX_ERR_TEXT)}`);
  }

  // 阶段2: 自动生成 conflict resolutions
  const conflictKeys = (preview.conflict_items ?? [])
    .map((c) => c.key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  if (conflictKeys.length > 0) {
    writeStep2Progress(projectKey, versionId, { merge_stage: "resolving", conflict_count: conflictKeys.length });
  }
  const resolutions = conflictKeys.length > 0
    ? Object.fromEntries(conflictKeys.map((k) => [k, { action }]))
    : undefined;

  // 阶段3: commit (复用 plan_id)
  writeStep2Progress(projectKey, versionId, { merge_stage: "committing" });
  const commit = await proxyOnto<MergeAllResponse>("POST", `/api/policies/${policyId}/merge-all`, {
    dry_run: false, plan_id: preview.plan_id, resolutions, max_workers: 4,
  });
  if (!commit || commit.ok === false) {
    throw new Error(`merge-all 提交失败: ${(commit?.error ?? "无响应").slice(0, MAX_ERR_TEXT)}`);
  }

  const results = commit.results ?? [];
  const failedRegions = results
    .filter((r) => r.ok === false)
    .map((r) => ({ region: r.region ?? "(未知)", reason: r.reason ?? "(无原因)" }));

  return {
    merged: commit.merged ?? 0,
    failed: commit.failed ?? failedRegions.length,
    conflict_count: conflictKeys.length,
    conflict_action: action,
    overwritten_keys: conflictKeys,
    blocked_count: (commit.blocked_rules ?? []).length,
    warnings: commit.warnings ?? [],
    failed_regions: failedRegions,
    finished_at: finished(),
  };
}
