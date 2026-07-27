import { OntoRequestError, proxyOnto } from "./onto-platform.js";
import { scanDataDir } from "./step2-data-source.js";
import { runMergeAllWithResolutions } from "./step2-merge.js";
import { isStep2FileDone, markStep2FileDone, readStep2Progress, writeStep2Progress } from "./step2-progress.js";
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

function extractAmbiguousCandidates(error: unknown): NonNullable<Step2Error["candidates"]> {
  if (!(error instanceof OntoRequestError) || error.errorType !== "region_ambiguous") return [];
  return ((error.payload?.candidates ?? []) as Array<Record<string, unknown>>)
    .filter((candidate) => candidate.region_id || candidate.id)
    .map((candidate) => ({
      region_id: String(candidate.region_id ?? candidate.id),
      display_name: String(candidate.display_name ?? candidate.region_id ?? candidate.id),
      ...(typeof candidate.rule_count === "number" ? { rule_count: candidate.rule_count } : {}),
    }));
}

export async function runStep2AutoModeling(
  projectKey: string,
  versionId: string,
  policyId: string,
  dataRoot: string,
): Promise<void> {
  const scanned = scanDataDir(dataRoot);
  const doneFlags = scanned.map((file) => isStep2FileDone(projectKey, versionId, file.relPath));
  const files = scanned.filter((_, index) => !doneFlags[index]);
  const doneCount = doneFlags.filter(Boolean).length;

  const regionCounts = new Map<string, { count: number; display: string }>();
  for (const file of scanned) {
    const key = levelsKey(file.levels);
    const current = regionCounts.get(key);
    regionCounts.set(key, { count: (current?.count ?? 0) + 1, display: file.display });
  }
  const duplicateRegions = [...regionCounts.values()].filter((item) => item.count > 1);
  if (duplicateRegions.length > 0) {
    const at = new Date().toISOString();
    writeStep2Progress(projectKey, versionId, {
      phase: "failed",
      finished_at: at,
      errors: [
        {
          file: duplicateRegions.map((item) => item.display).join(", "),
          stage: "extract",
          message: `Multiple files map to the same region: ${duplicateRegions.map((item) => `${item.display} (${item.count})`).join(", ")}`,
          at,
        },
      ],
    });
    return;
  }

  if (files.length === 0) {
    const existing = readStep2Progress(projectKey, versionId);
    const now = new Date().toISOString();
    try {
      const summary = await runMergeAllWithResolutions(projectKey, versionId, policyId);
      const errors = summary.failed_regions.map((item) => ({ file: item.region, stage: "merge-all" as const, message: item.reason, at: now }));
      writeStep2Progress(projectKey, versionId, {
        phase: summary.merged === 0 && summary.failed > 0 ? "failed" : "review",
        total_files: existing?.total_files ?? scanned.length,
        processed: existing?.processed ?? scanned.length,
        started_at: existing?.started_at ?? now,
        finished_at: summary.finished_at,
        data_source_root: existing?.data_source_root ?? dataRoot,
        merge_summary: summary,
        errors,
      });
    } catch (error) {
      writeStep2Progress(projectKey, versionId, {
        phase: "failed",
        finished_at: now,
        errors: [{ file: "*", stage: "merge-all", message: String((error as Error).message), at: now }],
      });
    }
    return;
  }

  const started = new Date().toISOString();
  writeStep2Progress(projectKey, versionId, {
    phase: "extract",
    total_files: scanned.length,
    processed: doneCount,
    started_at: started,
    data_source_root: dataRoot,
  });

  let processed = doneCount;
  const errors: Step2Error[] = [];

  for (const file of files) {
    writeStep2Progress(projectKey, versionId, { current_file: file.relPath, current_region: file.display });
    try {
      const extract = await proxyOnto<{ id?: string; items?: unknown[] }>("POST", "/api/onto/extract", {
        region_selector: { levels: file.levels },
        title: file.title,
        text: file.text,
        doc_ref: file.relPath,
        policy_id: policyId,
      });
      if (!extract?.id) throw new Error("extract returned no id");
      writeStep2Progress(projectKey, versionId, { phase: "derive" });
      const derive = await proxyOnto<{ id?: string }>("POST", "/api/onto/derive", {
        region_selector: { levels: file.levels },
        qa_items: extract.items ?? [],
        extraction_id: extract.id,
        doc_ref: file.relPath,
        policy_id: policyId,
      });
      if (!derive?.id) throw new Error("derive returned no id");
      markStep2FileDone(projectKey, versionId, file.relPath);
    } catch (error) {
      const candidates = extractAmbiguousCandidates(error);
      errors.push({
        file: file.relPath,
        stage: "extract",
        message: candidates.length > 0 ? `Region ambiguous: ${candidates.map((candidate) => candidate.display_name).join(", ")}` : String((error as Error).message),
        at: new Date().toISOString(),
        ...(candidates.length > 0 ? { candidates } : {}),
      });
    }
    processed += 1;
    writeStep2Progress(projectKey, versionId, { processed });
  }

  try {
    const summary = await runMergeAllWithResolutions(projectKey, versionId, policyId);
    const mergeErrors = summary.failed_regions.map((item) => ({
      file: item.region,
      stage: "merge-all" as const,
      message: item.reason,
      at: summary.finished_at,
    }));
    writeStep2Progress(projectKey, versionId, {
      phase: summary.merged === 0 && summary.failed > 0 ? "failed" : "review",
      finished_at: summary.finished_at,
      merge_summary: summary,
      errors: [...errors, ...mergeErrors],
    });
  } catch (error) {
    writeStep2Progress(projectKey, versionId, {
      phase: "failed",
      finished_at: new Date().toISOString(),
      errors: [...errors, { file: "*", stage: "merge-all", message: String((error as Error).message), at: new Date().toISOString() }],
    });
  }
}
