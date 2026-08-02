import { z } from "zod";

export const regionSchema = z.string().min(1);
export type PolicyRegion = z.infer<typeof regionSchema>;

export const policyStatusSchema = z.enum(["effective", "expired", "draft", "unknown"]);
export const policyReviewStatusSchema = z.enum(["approved", "quarantined"]);
export const administrativeRegionLevelSchema = z.enum(["national", "province", "prefecture", "county", "unknown"]);

export const policyMetadataSchema = z.object({
  document_id: z.string().min(1),
  title: z.string().min(1),
  region: z.string().min(1),
  region_code: z.string().regex(/^\d{6}$/u).default("100000"),
  region_level: administrativeRegionLevelSchema.default("national"),
  parent_region_code: z.string().regex(/^\d{6}$/u).nullable().default(null),
  applicable_region_codes: z.array(z.string().regex(/^\d{6}$/u)).min(1).default(["100000"]),
  authority: z.string().min(1),
  publish_date: z.string().min(1),
  effective_from: z.string().min(1),
  effective_to: z.string().nullable(),
  status: policyStatusSchema,
  source_url: z.union([z.url(), z.literal("unknown")]),
  policy_type: z.string().default("childcare-subsidy"),
  document_kind: z.enum(["policy_rule", "official_interpretation", "service_guide", "official_repost", "unknown"]).default("unknown"),
  source_domain: z.string().min(1).default("unknown"),
  publisher_region_code: z.string().regex(/^\d{6}$/u).nullable().default(null),
  policy_number: z.string().nullable().default(null),
  version_group: z.string().default("unknown"),
  version_priority: z.number().int().default(0),
  canonical_document_id: z.string().min(1).optional(),
  duplicate_group_id: z.string().min(1).nullable().default(null),
  source_priority: z.number().int().min(0).default(0),
  review_status: policyReviewStatusSchema.default("approved"),
  quarantine_reasons: z.array(z.string().min(1)).default([]),
});
// Input type keeps the Phase 0 shape source-compatible; parsing materializes all
// Phase 1 defaults before metadata reaches storage or retrieval.
export type PolicyMetadata = z.input<typeof policyMetadataSchema>;

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
export type EvidencePack = z.input<typeof evidencePackSchema>;
