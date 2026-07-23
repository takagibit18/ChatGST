import { z } from "zod";

export const regionSchema = z.enum(["北京市", "河北省", "全国", "对比"]);
export type PolicyRegion = z.infer<typeof regionSchema>;

export const policyStatusSchema = z.enum(["effective", "expired", "draft", "unknown"]);

export const policyMetadataSchema = z.object({
  document_id: z.string().min(1),
  title: z.string().min(1),
  region: z.string().min(1),
  authority: z.string().min(1),
  publish_date: z.string().min(1),
  effective_from: z.string().min(1),
  effective_to: z.string().nullable(),
  status: policyStatusSchema,
  source_url: z.union([z.url(), z.literal("unknown")]),
  policy_type: z.string().default("childcare-subsidy"),
  version_group: z.string().default("unknown"),
  version_priority: z.number().int().default(0),
});
export type PolicyMetadata = z.infer<typeof policyMetadataSchema>;

export const evidenceItemSchema = z.object({
  document_id: z.string(),
  chunk_id: z.string(),
  title: z.string(),
  region: z.string(),
  section_path: z.array(z.string()),
  content: z.string(),
  source_url: z.union([z.url(), z.literal("unknown")]),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  status: policyStatusSchema,
  retrieval_score: z.number(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const evidencePackSchema = z.object({
  query_context: z.object({
    region: regionSchema.nullable(),
    intent: z.string(),
    effective_date: z.string(),
    confirmed_slots: z.record(z.string(), z.unknown()),
    missing_slots: z.array(z.string()),
  }),
  policy_versions: z.array(policyMetadataSchema),
  evidence: z.array(evidenceItemSchema),
  knowledge_gaps: z.array(z.string()),
});
export type EvidencePack = z.infer<typeof evidencePackSchema>;

