import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calculateRetrievalV2Metrics,
  conversationScenarioSchema,
  extractionManifestSchema,
  retrievalEvalCaseSchema,
  safetyEvalCaseSchema,
  type RetrievalEvalCase,
} from "@policy/rag/index";

async function jsonl(path: string): Promise<unknown[]> {
  return (await readFile(resolve(path), "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

function evalCase(overrides: Partial<RetrievalEvalCase> = {}): RetrievalEvalCase {
  return retrievalEvalCaseSchema.parse({
    id: "case-1", dataset_version: "retrieval-v2.0", split: "dev", case_group_id: "group-1",
    question: "北京市政策依据是什么？", category: "single_region_fact", difficulty: "hard",
    user_region: "北京市", user_region_code: "110000", effective_date: "2026-08-02", answerable: true,
    expected_behavior: "answer", relevant_documents: ["doc-a"], relevant_chunks: ["chunk-a"],
    graded_chunks: { "chunk-a": 3 }, required_facts: [], forbidden_facts: [], expected_citations: ["doc-a"],
    source_review_status: "approved", reviewer: "fixture", notes: "fixture", ...overrides,
  });
}

describe("Eval v2 datasets", () => {
  it("validates the committed Phase 3 inventory and split boundaries", async () => {
    const train = (await jsonl("domains/childcare-subsidy/evals/v2/datasets/retrieval.train.jsonl")).map((item) => retrievalEvalCaseSchema.parse(item));
    const dev = (await jsonl("domains/childcare-subsidy/evals/v2/datasets/retrieval.dev.jsonl")).map((item) => retrievalEvalCaseSchema.parse(item));
    const regression = (await jsonl("domains/childcare-subsidy/evals/v2/datasets/regression-v1.jsonl")).map((item) => retrievalEvalCaseSchema.parse(item));
    const conversations = await jsonl("domains/childcare-subsidy/evals/v2/datasets/conversations.jsonl");
    const safety = await jsonl("domains/childcare-subsidy/evals/v2/datasets/safety.jsonl");
    const extraction = await jsonl("domains/childcare-subsidy/evals/v2/datasets/extraction-manifest.jsonl");
    expect(train).toHaveLength(50);
    expect(dev).toHaveLength(30);
    expect([...train, ...dev].filter((item) => item.difficulty === "hard").length).toBeGreaterThanOrEqual(30);
    expect(regression).toHaveLength(13);
    expect(conversations.map((item) => conversationScenarioSchema.parse(item))).toHaveLength(8);
    expect(safety.map((item) => safetyEvalCaseSchema.parse(item))).toHaveLength(15);
    expect(extraction.map((item) => extractionManifestSchema.parse(item))).toHaveLength(47);
    expect(extraction.filter((item) => extractionManifestSchema.parse(item).expected_indexed)).toHaveLength(39);
    expect([...train, ...dev].filter((item) => item.answerable).every((item) => item.relevant_documents.length > 0 && item.relevant_chunks.length > 0)).toBe(true);
    const groups = new Map<string, Set<string>>();
    for (const item of [...train, ...dev]) groups.set(item.case_group_id, new Set([...(groups.get(item.case_group_id) ?? []), item.split]));
    expect([...groups.values()].every((splits) => splits.size === 1)).toBe(true);
  });

  it("calculates leakage, source-level duplicate occupancy, refusal and clarification independently", () => {
    const answer = evalCase();
    const noAnswer = evalCase({
      id: "no-answer", case_group_id: "no-answer", category: "no_answer", answerable: false,
      expected_behavior: "no_answer", relevant_documents: [], relevant_chunks: [], graded_chunks: {}, expected_citations: [],
      source_review_status: "generated",
    });
    const clarify = evalCase({
      id: "clarify", case_group_id: "clarify", category: "missing_region", answerable: false,
      expected_behavior: "clarify_region", user_region: null, user_region_code: null,
      relevant_documents: [], relevant_chunks: [], graded_chunks: {}, expected_citations: [], source_review_status: "generated",
    });
    const metrics = calculateRetrievalV2Metrics([answer, noAnswer, clarify], [
      { case_id: answer.id, predicted_behavior: "answer", hits: [
        { document_id: "doc-a", chunk_id: "chunk-a", region_code: "110000", effective_from: "2025-01-01", effective_to: null, duplicate_group_id: null, score: 4 },
        { document_id: "doc-b", chunk_id: "chunk-b", region_code: "130000", effective_from: "2025-01-01", effective_to: null, duplicate_group_id: "duplicate-x", score: 3 },
        { document_id: "doc-c", chunk_id: "chunk-c", region_code: "110000", effective_from: "2027-01-01", effective_to: null, duplicate_group_id: "duplicate-x", score: 2 },
      ] },
      { case_id: noAnswer.id, predicted_behavior: "no_answer", hits: [] },
      { case_id: clarify.id, predicted_behavior: "clarify_region", hits: [] },
    ]);
    expect(metrics.document_recall_at_5).toBe(1);
    expect(metrics.chunk_recall_at_5).toBe(1);
    expect(metrics.region_leakage_rate).toBeCloseTo(1 / 3);
    expect(metrics.temporal_leakage_rate).toBeCloseTo(1 / 3);
    expect(metrics.duplicate_occupancy_at_5).toBeCloseTo(1 / 3);
    expect(metrics.no_answer_f1).toBe(1);
    expect(metrics.missing_region_clarification_accuracy).toBe(1);
  });

  it("binds the baseline run to K4 and stores every case output", async () => {
    const run = JSON.parse(await readFile(resolve("domains/childcare-subsidy/evals/v2/runs/phase3-k4-bm25-dev.json"), "utf8")) as {
      fingerprint: { knowledge_snapshot: string; index: { documents: number; chunks: number }; retrieval: { repetitions: number } };
      case_results: unknown[]; failed_cases: string[];
    };
    expect(run.fingerprint.knowledge_snapshot).toBe("K4");
    expect(run.fingerprint.index).toMatchObject({ documents: 39, chunks: 380 });
    expect(run.fingerprint.retrieval.repetitions).toBe(3);
    expect(run.case_results).toHaveLength(43);
    expect(run.failed_cases).toEqual([]);
  });
});
