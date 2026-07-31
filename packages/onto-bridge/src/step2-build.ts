/**
 * 10-step2-build.ts — Step2 自动建模编排器
 *
 * 对应原架构文档 step2-build.ts (完整实现)
 * 核心编排: scan → extract → derive → merge → finalize
 *
 * 这是本体平台与 ChatGST 最大的差异点:
 *   ChatGST:  文档 → 切片 → BM25 索引 (无语义理解)
 *   本体平台:  文档 → extract(LLM提取规则) → derive(补全推导) → merge(冲突合并)
 */
import { proxyOnto, OntoRequestError } from "./onto-platform.js";
import { scanDataDir } from "./step2-data-source.js";
import { runMergeAllWithResolutions } from "./step2-merge.js";
import { writeStep2Progress, markStep2FileDone, isStep2FileDone, readStep2Progress } from "./step2-progress.js";
import type { RegionLevels, Step2Error } from "./types.js";

function levelsKey(levels: RegionLevels): string {
  return JSON.stringify([
    levels.province_level ?? null,
    levels.prefecture_level ?? null,
    levels.county_level ?? null,
    levels.township_level ?? null,
    levels.national ?? null,
  ]);
}

function extractAmbiguousCandidates(e: unknown): Array<{ region_id: string; display_name: string; rule_count?: number }> {
  if (!(e instanceof OntoRequestError) || e.errorType !== "region_ambiguous") return [];
  return ((e.payload?.candidates ?? []) as any[])
    .filter((c) => c?.region_id || c?.id)
    .map((c) => ({
      region_id: c.region_id ?? c.id,
      display_name: c.display_name ?? (c.region_id ?? c.id),
      rule_count: c.rule_count,
    }));
}

/**
 * 执行 Step2 完整管道
 *
 * @param projectKey  项目标识
 * @param versionId   版本标识
 * @param policyId    本体策略 ID
 * @param dataRoot    政策数据根目录 (默认 "data")
 */
export async function runStep2AutoModeling(
  projectKey: string,
  versionId: string,
  policyId: string,
  dataRoot: string,
): Promise<void> {
  const scanned = scanDataDir(dataRoot);
  const doneFlags = scanned.map((f) => isStep2FileDone(projectKey, versionId, f.relPath));
  const files = scanned.filter((_, i) => !doneFlags[i]);
  const doneCount = doneFlags.filter(Boolean).length;

  // 多文件地域 guard: 同一地域目录下不能有多个文件
  const rc = new Map<string, { count: number; display: string }>();
  for (const f of scanned) {
    const k = levelsKey(f.levels);
    const cur = rc.get(k);
    rc.set(k, { count: (cur?.count ?? 0) + 1, display: f.display });
  }
  const multi = [...rc.values()].filter((r) => r.count > 1);
  if (multi.length > 0) {
    writeStep2Progress(projectKey, versionId, {
      phase: "failed",
      finished_at: new Date().toISOString(),
      errors: [{
        file: multi.map((r) => r.display).join("、"),
        stage: "extract",
        message: `同一地域含多个文件：${multi.map((r) => `${r.display}（${r.count}个）`).join("、")}。暂不支持。`,
        at: new Date().toISOString(),
      }],
    });
    return;
  }

  // 全部已完成 → 仅重跑 merge-all（幂等）
  if (files.length === 0) {
    const existing = readStep2Progress(projectKey, versionId);
    const now = new Date().toISOString();
    try {
      const summary = await runMergeAllWithResolutions(projectKey, versionId, policyId);
      if (summary.merged === 0 && summary.failed > 0) {
        writeStep2Progress(projectKey, versionId, {
          phase: "failed", finished_at: now, merge_summary: summary,
          errors: summary.failed_regions.map((r) => ({ file: r.region, stage: "merge-all", message: r.reason, at: now })),
        });
        return;
      }
      writeStep2Progress(projectKey, versionId, {
        phase: "review", total_files: existing?.total_files ?? 0, processed: existing?.processed ?? 0,
        started_at: existing?.started_at ?? now, finished_at: existing?.finished_at ?? now,
        data_source_root: existing?.data_source_root ?? dataRoot, merge_summary: summary,
      });
    } catch (e) {
      writeStep2Progress(projectKey, versionId, {
        phase: "failed", finished_at: now,
        errors: [{ file: "*", stage: "merge-all", message: String((e as Error).message), at: now }],
      });
    }
    return;
  }

  const now = new Date().toISOString();
  writeStep2Progress(projectKey, versionId, {
    phase: "extract", total_files: scanned.length, processed: doneCount, started_at: now,
    data_source_root: dataRoot,
  });

  let processed = doneCount;
  const newErrors: Step2Error[] = [];

  // 阶段①: 逐文件 extract → derive
  for (const f of files) {
    writeStep2Progress(projectKey, versionId, { current_file: f.relPath, current_region: f.display });
    try {
      const ext = await proxyOnto<any>("POST", "/api/onto/extract", {
        region_selector: { levels: f.levels },
        title: f.title,
        text: f.text,
        doc_ref: f.relPath,
        policy_id: policyId,
      });
      if (!ext?.id) throw new Error("extract 返回无 id");
      const der = await proxyOnto<any>("POST", "/api/onto/derive", {
        region_selector: { levels: f.levels },
        qa_items: ext.items ?? [],
        extraction_id: ext.id,
        doc_ref: f.relPath,
        policy_id: policyId,
      });
      if (!der?.id) throw new Error("derive 返回无 id");
      markStep2FileDone(projectKey, versionId, f.relPath);
      console.log(`[step2] extract+derive OK: ${f.relPath}`);
    } catch (e) {
      const candidates = extractAmbiguousCandidates(e);
      newErrors.push({
        file: f.relPath, stage: "extract",
        message: candidates.length
          ? `地域歧义：候选${candidates.map((c) => c.display_name).join("、")}`
          : String((e as Error).message),
        at: new Date().toISOString(),
        ...(candidates.length ? { candidates } : {}),
      });
      console.error(`[step2] extract failed: ${f.relPath}: ${String((e as Error).message).slice(0, 200)}`);
    }
    processed += 1;
    writeStep2Progress(projectKey, versionId, { processed });
  }

  // 阶段②: merge-all 两阶段合并
  try {
    const summary = await runMergeAllWithResolutions(projectKey, versionId, policyId);
    const mergeErrors = summary.failed_regions.map((r) => ({
      file: r.region, stage: "merge-all" as const, message: r.reason, at: summary.finished_at,
    }));
    if (summary.merged === 0 && summary.failed > 0) {
      writeStep2Progress(projectKey, versionId, {
        phase: "failed", finished_at: summary.finished_at, merge_summary: summary,
        errors: [...newErrors, ...mergeErrors],
      });
      return;
    }
    writeStep2Progress(projectKey, versionId, {
      phase: "review", finished_at: summary.finished_at, merge_summary: summary,
      errors: [...newErrors, ...mergeErrors],
    });
  } catch (e) {
    writeStep2Progress(projectKey, versionId, {
      phase: "failed", finished_at: new Date().toISOString(),
      errors: [...newErrors, { file: "*", stage: "merge-all", message: String((e as Error).message), at: new Date().toISOString() }],
    });
  }
}
