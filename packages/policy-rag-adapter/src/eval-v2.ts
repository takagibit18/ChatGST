import { z } from "zod";
import { isRegionAncestor } from "./region-registry.js";

export const retrievalCategorySchema = z.enum([
  "single_region_fact", "cross_level_policy", "cross_region_interference", "temporal_version",
  "multi_evidence", "colloquial_typo", "paraphrase_consistency", "false_premise", "no_answer", "missing_region",
]);

export const retrievalEvalCaseSchema = z.object({
  id: z.string().min(1),
  dataset_version: z.literal("retrieval-v2.0"),
  split: z.enum(["train", "dev", "test", "regression"]),
  case_group_id: z.string().min(1),
  question: z.string().min(1),
  category: retrievalCategorySchema,
  difficulty: z.enum(["easy", "medium", "hard"]),
  user_region: z.string().nullable(),
  user_region_code: z.string().regex(/^\d{6}$/u).nullable(),
  effective_date: z.iso.date(),
  answerable: z.boolean(),
  expected_behavior: z.enum(["answer", "clarify_region", "no_answer"]),
  relevant_documents: z.array(z.string().min(1)),
  relevant_chunks: z.array(z.string().min(1)),
  graded_chunks: z.record(z.string(), z.number().int().min(0).max(3)),
  required_facts: z.array(z.string()),
  forbidden_facts: z.array(z.string()),
  expected_citations: z.array(z.string().min(1)),
  source_review_status: z.enum(["approved", "generated"]),
  reviewer: z.string().min(1),
  notes: z.string(),
  legacy_case_id: z.string().min(1).optional(),
});
export type RetrievalEvalCase = z.infer<typeof retrievalEvalCaseSchema>;

export const conversationScenarioSchema = z.object({
  scenario_id: z.string().min(1),
  dataset_version: z.literal("conversations-v1.0"),
  split: z.enum(["dev", "test"]),
  initial_context: z.record(z.string(), z.unknown()),
  turns: z.array(z.object({
    user: z.string().min(1),
    expected_behavior: z.enum(["clarify_region", "answer", "update_region_and_retrieve", "reject_false_premise", "recover"]),
    expected_region_code: z.string().regex(/^\d{6}$/u).nullable(),
  })).min(2),
  success_conditions: z.array(z.string().min(1)).min(1),
});
export type ConversationScenario = z.infer<typeof conversationScenarioSchema>;

export const safetyEvalCaseSchema = z.object({
  id: z.string().min(1), dataset_version: z.literal("safety-v1.0"), split: z.enum(["dev", "test"]),
  prompt: z.string().min(1), category: z.enum(["prompt_injection", "privacy", "authority_overreach", "false_premise", "out_of_scope"]),
  expected_behavior: z.enum(["refuse", "correct", "clarify", "safe_answer"]),
  forbidden_behavior: z.array(z.string().min(1)), reviewer: z.string().min(1),
});
export type SafetyEvalCase = z.infer<typeof safetyEvalCaseSchema>;

export const extractionManifestSchema = z.object({
  document_id: z.string().min(1), source_sha256: z.string().regex(/^[a-f0-9]{64}$/u), source_format: z.string().min(1),
  metadata_review_status: z.enum(["approved", "quarantined"]), region_code: z.string().regex(/^\d{6}$/u).nullable(),
  canonical_document_id: z.string().min(1), expected_indexed: z.boolean(),
});

export type RetrievalEvalHit = {
  document_id: string;
  chunk_id: string;
  region_code: string;
  effective_from: string;
  effective_to: string | null;
  duplicate_group_id: string | null;
  score: number;
};

export type RetrievalEvalResult = {
  case_id: string;
  hits: RetrievalEvalHit[];
  predicted_behavior: "answer" | "clarify_region" | "no_answer";
};

export type RetrievalV2Metrics = {
  cases: number;
  document_recall_at_5: number;
  chunk_recall_at_5: number;
  mrr_at_10: number;
  ndcg_at_10: number;
  region_leakage_rate: number;
  temporal_leakage_rate: number;
  duplicate_occupancy_at_5: number;
  no_answer_precision: number;
  no_answer_recall: number;
  no_answer_f1: number;
  missing_region_clarification_accuracy: number;
  paraphrase_top5_jaccard: number;
};

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function dcg(grades: number[]): number {
  return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

export function calculateRetrievalV2Metrics(cases: RetrievalEvalCase[], results: RetrievalEvalResult[]): RetrievalV2Metrics {
  const byId = new Map(results.map((result) => [result.case_id, result]));
  const answerable = cases.filter((item) => item.answerable);
  const documentRecall: number[] = [];
  const chunkRecall: number[] = [];
  const reciprocalRanks: number[] = [];
  const ndcgs: number[] = [];
  let regionLeaks = 0;
  let regionHits = 0;
  let temporalLeaks = 0;
  let temporalHits = 0;
  let duplicateSlots = 0;
  let topSlots = 0;
  for (const item of answerable) {
    const hits = byId.get(item.id)?.hits ?? [];
    const top5 = hits.slice(0, 5);
    const top10 = hits.slice(0, 10);
    documentRecall.push(divide(new Set(top5.filter((hit) => item.relevant_documents.includes(hit.document_id)).map((hit) => hit.document_id)).size,
      new Set(item.relevant_documents).size));
    chunkRecall.push(divide(new Set(top5.filter((hit) => item.relevant_chunks.includes(hit.chunk_id)).map((hit) => hit.chunk_id)).size,
      new Set(item.relevant_chunks).size));
    const rank = top10.findIndex((hit) => item.relevant_documents.includes(hit.document_id));
    reciprocalRanks.push(rank < 0 ? 0 : 1 / (rank + 1));
    const grades = top10.map((hit) => item.graded_chunks[hit.chunk_id] ?? 0);
    const ideal = Object.values(item.graded_chunks).sort((left, right) => right - left).slice(0, 10);
    ndcgs.push(divide(dcg(grades), dcg(ideal)));
    for (const hit of top5) {
      if (item.user_region_code) {
        regionHits += 1;
        if (!isRegionAncestor(hit.region_code, item.user_region_code)) regionLeaks += 1;
      }
      temporalHits += 1;
      if (hit.effective_from > item.effective_date || (hit.effective_to !== null && hit.effective_to < item.effective_date)) temporalLeaks += 1;
    }
    const uniqueDocuments = [...new Map(top5.map((hit) => [hit.document_id, hit])).values()];
    const seenDuplicateGroups = new Set<string>();
    for (const hit of uniqueDocuments) {
      if (hit.duplicate_group_id && seenDuplicateGroups.has(hit.duplicate_group_id)) duplicateSlots += 1;
      if (hit.duplicate_group_id) seenDuplicateGroups.add(hit.duplicate_group_id);
      topSlots += 1;
    }
  }
  const noAnswer = cases.filter((item) => item.expected_behavior === "no_answer");
  const predictedNoAnswer = cases.filter((item) => byId.get(item.id)?.predicted_behavior === "no_answer");
  const trueNoAnswer = noAnswer.filter((item) => byId.get(item.id)?.predicted_behavior === "no_answer").length;
  const noAnswerPrecision = divide(trueNoAnswer, predictedNoAnswer.length);
  const noAnswerRecall = divide(trueNoAnswer, noAnswer.length);
  const missingRegion = cases.filter((item) => item.expected_behavior === "clarify_region");
  const paraphraseGroups = new Map<string, RetrievalEvalCase[]>();
  for (const item of cases.filter((value) => value.category === "paraphrase_consistency")) {
    paraphraseGroups.set(item.case_group_id, [...(paraphraseGroups.get(item.case_group_id) ?? []), item]);
  }
  const paraphraseScores = [...paraphraseGroups.values()].flatMap((group) => group.length < 2 ? [] : [
    jaccard((byId.get(group[0]!.id)?.hits ?? []).slice(0, 5).map((hit) => hit.chunk_id),
      (byId.get(group[1]!.id)?.hits ?? []).slice(0, 5).map((hit) => hit.chunk_id)),
  ]);
  return {
    cases: cases.length,
    document_recall_at_5: mean(documentRecall), chunk_recall_at_5: mean(chunkRecall), mrr_at_10: mean(reciprocalRanks),
    ndcg_at_10: mean(ndcgs), region_leakage_rate: divide(regionLeaks, regionHits), temporal_leakage_rate: divide(temporalLeaks, temporalHits),
    duplicate_occupancy_at_5: divide(duplicateSlots, topSlots), no_answer_precision: noAnswerPrecision, no_answer_recall: noAnswerRecall,
    no_answer_f1: noAnswerPrecision + noAnswerRecall === 0 ? 0 : 2 * noAnswerPrecision * noAnswerRecall / (noAnswerPrecision + noAnswerRecall),
    missing_region_clarification_accuracy: mean(missingRegion.map((item) => Number(byId.get(item.id)?.predicted_behavior === "clarify_region"))),
    paraphrase_top5_jaccard: mean(paraphraseScores),
  };
}
