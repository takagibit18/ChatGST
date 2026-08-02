import { createHash } from "node:crypto";

export type DeduplicationDocument = {
  document_id: string;
  region_code: string;
  title: string;
  body: string;
  policy_number?: string | null;
};

export type DuplicateCandidate = {
  left_document_id: string;
  right_document_id: string;
  kind: "exact" | "near" | "policy_number";
  similarity: number;
  same_region: boolean;
  evidence: string[];
};

export function normalizeForDeduplication(input: string): string {
  return input.normalize("NFKC")
    .replace(/^---\s*[\s\S]*?\s*---\s*/u, "")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLowerCase();
}

export function normalizedContentHash(input: string): string {
  return createHash("sha256").update(normalizeForDeduplication(input)).digest("hex");
}

function shingles(input: string, width = 5): Set<string> {
  const normalized = normalizeForDeduplication(input);
  if (normalized.length <= width) return new Set(normalized ? [normalized] : []);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - width; index += 1) result.add(normalized.slice(index, index + width));
  return result;
}

export function shingleJaccard(left: string, right: string): number {
  const a = shingles(left);
  const b = shingles(right);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function findDuplicateCandidates(
  documents: DeduplicationDocument[],
  nearThreshold = 0.42,
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  const hashes = new Map(documents.map((document) => [document.document_id, normalizedContentHash(document.body)]));
  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    const left = documents[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < documents.length; rightIndex += 1) {
      const right = documents[rightIndex]!;
      const sameRegion = left.region_code === right.region_code;
      const exact = hashes.get(left.document_id) === hashes.get(right.document_id);
      const samePolicyNumber = Boolean(left.policy_number && left.policy_number === right.policy_number);
      const similarity = exact ? 1 : shingleJaccard(left.body, right.body);
      if (!exact && similarity < nearThreshold && !samePolicyNumber) continue;
      const kind = exact ? "exact" : similarity >= nearThreshold ? "near" : "policy_number";
      candidates.push({
        left_document_id: left.document_id,
        right_document_id: right.document_id,
        kind,
        similarity: Number(similarity.toFixed(6)),
        same_region: sameRegion,
        evidence: [
          ...(exact ? [`normalized-body-sha256:${hashes.get(left.document_id)}`] : []),
          ...(samePolicyNumber ? [`policy-number:${left.policy_number}`] : []),
        ],
      });
    }
  }
  return candidates.sort((left, right) => right.similarity - left.similarity
    || left.left_document_id.localeCompare(right.left_document_id, "zh-CN")
    || left.right_document_id.localeCompare(right.right_document_id, "zh-CN"));
}
