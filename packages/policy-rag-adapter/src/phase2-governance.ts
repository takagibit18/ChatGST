import type { PolicyMetadata } from "@policy/schemas/index";

export type DuplicateGroup = {
  group_id: string;
  match_kind: "exact" | "near";
  canonical_document_id: string;
  member_document_ids: string[];
  evidence: Array<{ left_document_id: string; right_document_id: string; similarity: number }>;
  review_status: "confirmed";
  rationale: string;
};

export type Phase2Validation = {
  valid: boolean;
  files: number;
  canonical_documents: number;
  duplicate_groups: number;
  errors: string[];
};

export function validatePhase2Governance(
  metadata: Record<string, PolicyMetadata & { source_sha256?: string }>,
  groups: DuplicateGroup[],
): Phase2Validation {
  const errors: string[] = [];
  const byId = new Map(Object.values(metadata).map((item) => [item.document_id, item]));
  const grouped = new Set<string>();
  for (const group of groups) {
    if (!group.member_document_ids.includes(group.canonical_document_id)) errors.push(`${group.group_id}: canonical is not a member`);
    for (const id of group.member_document_ids) {
      if (!byId.has(id)) errors.push(`${group.group_id}: unknown member ${id}`);
      if (grouped.has(id)) errors.push(`${id}: belongs to multiple duplicate groups`);
      grouped.add(id);
      const item = byId.get(id);
      if (item?.canonical_document_id !== group.canonical_document_id || item.duplicate_group_id !== group.group_id) {
        errors.push(`${id}: duplicate metadata mismatch`);
      }
    }
  }
  const approvedCanonical = Object.values(metadata).filter((item) => item.review_status === "approved"
    && (item.canonical_document_id ?? item.document_id) === item.document_id);
  const versions = new Map<string, PolicyMetadata[]>();
  for (const item of approvedCanonical) {
    if (!item.version_group || item.version_group === "unknown") errors.push(`${item.document_id}: version group missing`);
    if (!item.document_kind || item.document_kind === "unknown") errors.push(`${item.document_id}: document kind missing`);
    if (!item.source_domain || item.source_domain === "unknown") errors.push(`${item.document_id}: source domain missing`);
    const group = versions.get(item.version_group ?? "unknown") ?? [];
    group.push(item);
    versions.set(item.version_group ?? "unknown", group);
  }
  for (const [group, items] of versions) {
    const priorities = items.map((item) => item.version_priority ?? 0);
    if (new Set(priorities).size !== priorities.length) errors.push(`${group}: version priorities are not unique`);
  }
  return {
    valid: errors.length === 0,
    files: Object.keys(metadata).length,
    canonical_documents: approvedCanonical.length,
    duplicate_groups: groups.length,
    errors,
  };
}
