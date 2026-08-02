import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EvidencePack } from "@policy/schemas/index";
import { PiLocalRagRetrievalProvider, type PolicySearchResult, type PolicyVersionResolution } from "@policy/rag/index";
import { buildEvidencePack, normalizePolicyQuery, type NormalizedPolicyQuery } from "@policy/runtime/index";

export type EvalCase = {
  id: string;
  question: string;
  expected_region: "北京市" | "河北省" | "对比" | null;
  expected_intent: string;
  relevant_documents: string[];
  expected_terms: string[];
};

export async function loadEvalCases(): Promise<EvalCase[]> {
  return JSON.parse(await readFile(resolve("domains/childcare-subsidy/evals/cases.json"), "utf8")) as EvalCase[];
}

export async function retrieveForEval(
  provider: PiLocalRagRetrievalProvider,
  query: NormalizedPolicyQuery,
  effectiveDate = "2026-07-23",
): Promise<{ pack: EvidencePack; hits: PolicySearchResult[] }> {
  if (!query.region || query.unsupportedRegion || query.unsafe) {
    return {
      hits: [],
      pack: {
        query_context: {
          region: query.region,
          intent: query.intent,
          effective_date: effectiveDate,
          confirmed_slots: query.confirmedSlots,
          missing_slots: query.missingSlots,
        },
        policy_versions: [],
        evidence: [],
        knowledge_gaps: ["未执行检索"],
      },
    };
  }
  const regions: string[] = query.region === "对比"
    ? query.comparisonRegions.map((item) => item.name)
    : [query.region];
  const combinedHits: PolicySearchResult[] = [];
  for (const region of regions) {
    combinedHits.push(...await provider.search({
      query: query.retrievalQuery,
      region,
      effective_date: effectiveDate,
      top_k: query.region === "对比" ? 4 : 5,
    }));
  }
  const hits = combinedHits
    .filter((hit, index, all) => all.findIndex((candidate) => candidate.chunk_id === hit.chunk_id) === index)
    .slice(0, 8);
  const resolutions: PolicyVersionResolution[] = [];
  for (const region of regions) {
    resolutions.push(await provider.resolvePolicyVersion({ region, policy_type: "childcare-subsidy", reference_date: effectiveDate }));
  }
  return { hits, pack: buildEvidencePack({ query, effectiveDate, hits, resolutions }) };
}

export function normalizedEvalQuery(item: EvalCase): NormalizedPolicyQuery {
  return normalizePolicyQuery(item.question, null);
}
