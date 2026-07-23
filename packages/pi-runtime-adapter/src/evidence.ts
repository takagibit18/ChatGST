import type { EvidencePack, PolicyMetadata } from "@policy/schemas/index";
import type { PolicySearchResult, PolicyVersionResolution } from "@policy/rag/index";
import type { NormalizedPolicyQuery } from "./query-normalizer.js";

export function buildEvidencePack(input: {
  query: NormalizedPolicyQuery;
  effectiveDate: string;
  hits: PolicySearchResult[];
  resolutions: PolicyVersionResolution[];
}): EvidencePack {
  const versionMap = new Map<string, PolicyMetadata>();
  for (const hit of input.hits) versionMap.set(hit.metadata.document_id, hit.metadata);
  for (const resolution of input.resolutions) {
    for (const policy of resolution.policies) versionMap.set(policy.document_id, policy);
  }
  const knowledgeGaps: string[] = [];
  if (input.hits.length === 0) knowledgeGaps.push("未检索到符合地区和有效日期的政策依据");
  for (const resolution of input.resolutions) {
    if (resolution.status === "not_found") knowledgeGaps.push("未解析到有效地方政策版本");
    if (resolution.status === "conflict") {
      knowledgeGaps.push(`政策版本冲突：${resolution.conflict_groups.join("、")}`);
    }
  }
  return {
    query_context: {
      region: input.query.region,
      intent: input.query.intent,
      effective_date: input.effectiveDate,
      confirmed_slots: input.query.confirmedSlots,
      missing_slots: input.query.missingSlots,
    },
    policy_versions: [...versionMap.values()],
    evidence: input.hits.map((hit) => ({
      document_id: hit.document_id,
      chunk_id: hit.chunk_id,
      title: hit.title,
      region: hit.region,
      section_path: hit.section_path,
      content: hit.content,
      source_url: hit.source_url,
      effective_from: hit.effective_from,
      effective_to: hit.effective_to,
      status: hit.status,
      retrieval_score: hit.retrieval_score,
    })),
    knowledge_gaps: [...new Set(knowledgeGaps)],
  };
}

