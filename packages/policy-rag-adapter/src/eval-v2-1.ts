import { z } from "zod";
import { retrievalCategorySchema } from "./eval-v2.js";

export const evalReviewStatusSchema = z.enum(["pending_review", "human_approved", "rejected"]);

export const goldEvidenceSchema = z.object({
  document_id: z.string().min(1),
  chunk_id: z.string().min(1),
  supporting_text: z.string().min(8),
  relevance_grade: z.number().int().min(1).max(3),
});

const challengeSchema = z.object({
  required_levels: z.array(z.string()).optional(),
  interference_regions: z.array(z.string()).optional(),
  temporal_assertion: z.string().optional(),
  canonical_query: z.string().optional(),
  paraphrase_key: z.string().optional(),
  false_premise: z.string().optional(),
  correction_fact: z.string().optional(),
  no_answer_reason: z.string().optional(),
  missing_slot: z.string().optional(),
}).strict();

export const retrievalAnnotationV21Schema = z.object({
  id: z.string().min(1),
  dataset_version: z.literal("retrieval-v2.1"),
  split: z.enum(["train", "dev", "regression"]),
  case_group_id: z.string().min(1),
  question: z.string().min(2),
  category: retrievalCategorySchema,
  difficulty: z.enum(["easy", "medium", "hard"]),
  difficulty_rationale: z.string().min(8),
  user_region: z.string().nullable(),
  user_region_code: z.string().regex(/^\d{6}$/u).nullable(),
  effective_date: z.iso.date(),
  answerable: z.boolean(),
  expected_behavior: z.enum(["answer", "clarify_region", "no_answer"]),
  gold_evidence: z.array(goldEvidenceSchema),
  required_facts: z.array(z.string().min(1)),
  forbidden_facts: z.array(z.string().min(1)),
  expected_citations: z.array(z.string().min(1)),
  challenge: challengeSchema,
  annotation_method: z.literal("source_first"),
  retriever_used_for_labeling: z.literal(false),
  source_review_status: evalReviewStatusSchema,
  annotator_type: z.enum(["assistant", "human"]),
  annotator: z.string().min(1),
  reviewer: z.string().nullable(),
  migration_note: z.string().optional(),
  legacy_case_id: z.string().optional(),
  notes: z.string(),
}).superRefine((item, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message, path: ["challenge"] });
  if (item.answerable !== (item.gold_evidence.length > 0)) fail("answerable must match Gold evidence presence");
  if (item.answerable && item.expected_behavior !== "answer") fail("answerable cases must expect answer");
  if (!item.answerable && item.expected_behavior === "answer") fail("unanswerable cases cannot expect answer");
  if (item.category === "multi_evidence" && new Set(item.gold_evidence.map((evidence) => evidence.chunk_id)).size < 2) fail("multi_evidence needs at least two chunks");
  if (item.category === "cross_level_policy" && (item.challenge.required_levels?.length ?? 0) < 2) fail("cross_level_policy needs two levels");
  if (item.category === "cross_region_interference" && (item.challenge.interference_regions?.length ?? 0) < 1) fail("cross_region_interference needs an interference region");
  if (item.category === "temporal_version" && !item.challenge.temporal_assertion) fail("temporal_version needs a temporal assertion");
  if (item.category === "colloquial_typo" && (!item.challenge.canonical_query || item.challenge.canonical_query === item.question)) fail("colloquial_typo needs a distinct canonical query");
  if (item.category === "paraphrase_consistency" && !item.challenge.paraphrase_key) fail("paraphrase case needs a key");
  if (item.category === "false_premise" && (!item.challenge.false_premise || !item.challenge.correction_fact)) fail("false_premise needs premise and correction");
  if (item.category === "no_answer" && (!item.challenge.no_answer_reason || item.gold_evidence.length > 0)) fail("no_answer needs a reason and no Gold evidence");
  if (item.category === "missing_region" && (item.user_region !== null || item.challenge.missing_slot !== "region")) fail("missing_region must omit region");
});
export type RetrievalAnnotationV21 = z.infer<typeof retrievalAnnotationV21Schema>;

export const retrievalEvalCaseV21Schema = retrievalAnnotationV21Schema.and(z.object({
  relevant_documents: z.array(z.string().min(1)),
  relevant_chunks: z.array(z.string().min(1)),
  graded_chunks: z.record(z.string(), z.number().int().min(1).max(3)),
}));
export type RetrievalEvalCaseV21 = z.infer<typeof retrievalEvalCaseV21Schema>;

const reviewFields = {
  source_review_status: evalReviewStatusSchema,
  annotator_type: z.enum(["assistant", "human"]),
  annotator: z.string().min(1),
  reviewer: z.string().nullable(),
  annotation_method: z.literal("source_first"),
  retriever_used_for_labeling: z.literal(false),
};

export const conversationScenarioV21Schema = z.object({
  scenario_id: z.string().min(1), dataset_version: z.literal("conversations-v1.1"), split: z.literal("dev"),
  initial_context: z.record(z.string(), z.unknown()),
  category: z.enum(["region_clarification", "region_switch", "correction", "stale_context", "recovery"]),
  turns: z.array(z.object({
    user: z.string().min(1), expected_behavior: z.enum(["clarify_region", "answer", "update_region_and_retrieve", "reject_false_premise", "recover"]),
    expected_region_code: z.string().regex(/^\d{6}$/u).nullable(), forbidden_region_codes: z.array(z.string().regex(/^\d{6}$/u)),
  })).min(2),
  success_conditions: z.array(z.string().min(1)).min(1), ...reviewFields,
});
export type ConversationScenarioV21 = z.infer<typeof conversationScenarioV21Schema>;

export const safetyEvalCaseV21Schema = z.object({
  id: z.string().min(1), dataset_version: z.literal("safety-v1.1"), split: z.literal("dev"),
  prompt: z.string().min(1), category: z.enum(["prompt_injection", "privacy", "authority_overreach", "false_premise", "out_of_scope"]),
  expected_behavior: z.enum(["refuse", "correct", "clarify", "safe_answer"]),
  forbidden_behavior: z.array(z.string().min(1)), ...reviewFields,
});
export type SafetyEvalCaseV21 = z.infer<typeof safetyEvalCaseV21Schema>;

export function materializeRetrievalAnnotation(item: RetrievalAnnotationV21): RetrievalEvalCaseV21 {
  const relevantDocuments = [...new Set(item.gold_evidence.map((evidence) => evidence.document_id))];
  const relevantChunks = [...new Set(item.gold_evidence.map((evidence) => evidence.chunk_id))];
  const gradedChunks = Object.fromEntries(item.gold_evidence.map((evidence) => [evidence.chunk_id, evidence.relevance_grade]));
  return retrievalEvalCaseV21Schema.parse({
    ...item,
    relevant_documents: relevantDocuments,
    relevant_chunks: relevantChunks,
    graded_chunks: gradedChunks,
    expected_citations: relevantDocuments,
  });
}
