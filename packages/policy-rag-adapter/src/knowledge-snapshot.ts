import { createHash } from "node:crypto";

export type KnowledgeSnapshotId = "K0" | "K1" | "K2" | "K3" | "K4";

export type KnowledgeSnapshot = {
  schema_version: 1;
  snapshot_id: KnowledgeSnapshotId;
  description: string;
  created_at: string;
  source_audit_hash: string;
  configuration: {
    metadata_governance: boolean;
    canonical_deduplication: boolean;
    version_authority_policy: boolean;
  };
  documents: Array<{ document_id: string; source_sha256: string; metadata_sha256: string | null }>;
  excluded: Array<{ document_id: string; reason: string }>;
  counts: { documents: number; excluded: number; legacy_chunks?: number };
  reproducibility: "manifest" | "legacy-local-baseline";
  snapshot_hash: string;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function finalizeKnowledgeSnapshot(input: Omit<KnowledgeSnapshot, "snapshot_hash">): KnowledgeSnapshot {
  return { ...input, snapshot_hash: hashJson(input) };
}

export function verifyKnowledgeSnapshot(snapshot: KnowledgeSnapshot): boolean {
  const { snapshot_hash: expected, ...input } = snapshot;
  return expected === hashJson(input)
    && snapshot.counts.documents === snapshot.documents.length
    && snapshot.counts.excluded === snapshot.excluded.length
    && new Set(snapshot.documents.map((item) => item.document_id)).size === snapshot.documents.length;
}
