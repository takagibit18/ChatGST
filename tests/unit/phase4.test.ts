import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyKnowledgeSnapshot, type KnowledgeSnapshot } from "@policy/rag/index";

const root = resolve("domains/childcare-subsidy/evals/phase4");
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(resolve(root, path), "utf8")) as T;

function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { [prefix]: value };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    Object.entries(flatten(item, prefix ? `${prefix}.${key}` : key))));
}

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (key === "extends") continue;
    const current = output[key];
    output[key] = value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)
      ? merge(current as Record<string, unknown>, value as Record<string, unknown>) : structuredClone(value);
  }
  return output;
}

describe("Phase 4 controlled experiment invariants", () => {
  it("binds the exact annotated Phase 3.3 baseline", async () => {
    const matrix = await json<{ base_tag: string; base_commit: string; repeat_count: number }>("experiment-matrix.json");
    expect(matrix).toMatchObject({ base_tag: "phase3.3-frozen-baseline", base_commit: "f6f033baac1231937de377a9383fdb3117743ff7", repeat_count: 3 });
  });

  it("changes exactly one primary variable in every K/R treatment", async () => {
    const matrix = await json<{ experiments: Array<{ id: string; changed_variable: string; config: string }> }>("experiment-matrix.json");
    const baseline = await json<Record<string, unknown>>("configs/baseline.json");
    for (const experiment of matrix.experiments) {
      const patch = await json<Record<string, unknown>>(experiment.config);
      const config = merge(baseline, patch);
      const left = flatten(baseline), right = flatten(config);
      const differences = [...new Set([...Object.keys(left), ...Object.keys(right)])]
        .filter((key) => key !== "experiment_id" && JSON.stringify(left[key]) !== JSON.stringify(right[key]));
      expect(differences, experiment.id).toEqual(experiment.id === "K4" ? [] : [experiment.changed_variable]);
    }
  });

  it("defines all twelve agent components and permanently labels high-risk removals", async () => {
    const config = await json<{ ablations: Array<{ component: string; high_risk: boolean }> }>("configs/agent-ablation.json");
    expect(config.ablations).toHaveLength(12);
    expect(new Set(config.ablations.map((item) => item.component)).size).toBe(12);
    expect(config.ablations.filter((item) => item.high_risk).map((item) => item.component).sort()).toEqual([
      "region_hierarchy", "safety_precheck", "stale_context_guard", "version_filtering",
    ]);
  });

  it("keeps K0-K4 as distinct verified snapshot artifacts", async () => {
    const snapshots = await Promise.all(["K0", "K1", "K2", "K3", "K4"].map(async (id) =>
      JSON.parse(await readFile(resolve(`knowledge/snapshots/${id}.json`), "utf8")) as KnowledgeSnapshot));
    expect(snapshots.every(verifyKnowledgeSnapshot)).toBe(true);
    expect(new Set(snapshots.map((item) => item.snapshot_hash)).size).toBe(5);
    expect(snapshots.map((item) => item.counts.documents)).toEqual([6, 47, 41, 39, 39]);
    expect(snapshots[0]?.reproducibility).toBe("legacy-local-baseline");
    expect(snapshots.slice(1).every((item) => item.reproducibility === "manifest")).toBe(true);
  });
});
