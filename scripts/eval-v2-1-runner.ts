import { evaluateEvidenceSufficiency, normalizePolicyQuery } from "@policy/runtime/index";
import { resolveAdministrativeRegion, type PiLocalRagRetrievalProvider, type RetrievalEvalHit } from "@policy/rag/index";
import { basename } from "node:path";

export function assertTrainOnlyCalibrationPath(path: string): void {
  if (basename(path) !== "retrieval.train.jsonl" || /(?:dev|test)/iu.test(path)) throw new Error("Calibration may read retrieval.train.jsonl only");
}

export type EvalV21Input = { id: string; question: string; user_region: string | null; effective_date: string };
export type EvalHitV21 = RetrievalEvalHit & { authority: string; source_priority: number; version_group: string; version_priority: number };
export type EvalV21Prediction = {
  case_id: string; predicted_behavior: "answer" | "clarify_region" | "no_answer"; top_k: EvalHitV21[];
  retrieval_ms: number[]; total_ms: number[]; repeat_stable: boolean; evidence_sufficient: boolean; answer_text: string; citations: string[];
};

export async function runEvalV21Input(
  provider: Pick<PiLocalRagRetrievalProvider, "search">,
  rawInput: EvalV21Input & Record<string, unknown>,
  minimumAnswerScore: number,
  options: { warmups: number; measured: number } = { warmups: 0, measured: 1 },
): Promise<EvalV21Prediction> {
  const { id, question, user_region: userRegion, effective_date: effectiveDate } = rawInput;
  const normalized = normalizePolicyQuery(question, null);
  const region = userRegion ?? (normalized.region === "对比" ? null : normalized.region);
  if (!region) return { case_id: id, predicted_behavior: "clarify_region", top_k: [], retrieval_ms: [], total_ms: [], repeat_stable: true, evidence_sufficient: false, answer_text: "", citations: [] };
  const timings: number[] = [];
  const totals: number[] = [];
  const sequences: string[][] = [];
  let finalHits: EvalHitV21[] = [];
  let evidenceSufficient = false;
  const resolvedTarget = resolveAdministrativeRegion(region);
  const targetRegionCode = resolvedTarget.status === "resolved" ? resolvedTarget.region.code : normalized.regionCode;
  const iterations = options.warmups + options.measured;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const totalStart = performance.now();
    const retrievalStart = performance.now();
    const hits = await provider.search({ query: normalized.retrievalQuery, region, effective_date: effectiveDate, top_k: 10 });
    evidenceSufficient = evaluateEvidenceSufficiency(question, normalized.intent, hits, targetRegionCode).sufficient;
    const elapsed = performance.now() - retrievalStart;
    finalHits = hits.map((hit) => ({ document_id: hit.document_id, chunk_id: hit.chunk_id, region_code: hit.metadata.region_code ?? "100000",
      effective_from: hit.effective_from, effective_to: hit.effective_to, duplicate_group_id: hit.metadata.duplicate_group_id ?? null, score: hit.retrieval_score,
      authority: hit.metadata.authority, source_priority: hit.metadata.source_priority ?? 0, version_group: hit.metadata.version_group ?? "unknown", version_priority: hit.metadata.version_priority ?? 0 }));
    if (iteration >= options.warmups) {
      timings.push(Number(elapsed.toFixed(6)));
      totals.push(Number((performance.now() - totalStart).toFixed(6)));
      sequences.push(finalHits.map((hit) => hit.chunk_id));
    }
  }
  const predicted = evidenceSufficient && finalHits.length > 0 && finalHits[0]!.score >= minimumAnswerScore ? "answer" : "no_answer";
  return { case_id: id, predicted_behavior: predicted, top_k: finalHits, retrieval_ms: timings, total_ms: totals,
    repeat_stable: sequences.every((sequence) => JSON.stringify(sequence) === JSON.stringify(sequences[0])), evidence_sufficient: evidenceSufficient, answer_text: "", citations: [] };
}
