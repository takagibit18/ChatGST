import { createHash } from "node:crypto";

export const EXPECTED_REVIEW_INVENTORY = {
  retrieval: 80,
  regression: 13,
  conversations: 20,
  safety: 30,
} as const;

export const EXPECTED_REVIEW_TOTAL = Object.values(EXPECTED_REVIEW_INVENTORY)
  .reduce((sum, count) => sum + count, 0);

export type ReviewCounts = {
  pending_review: number;
  human_approved: number;
  rejected: number;
};

export type ReviewInventory = {
  retrieval: number;
  regression: number;
  conversations: number;
  safety: number;
};

export type DatasetReviewGate =
  | "blocked_pending_human_review"
  | "blocked_rejected_gold"
  | "human_review_passed";

export type InputFingerprint = {
  dev_sha256: string;
  regression_sha256: string;
  calibration_sha256: string;
  knowledge_snapshot_hash: string;
  dataset_manifest_sha256?: string;
};

export type DatasetManifest = {
  knowledge_snapshot_hash?: string;
  files?: Record<string, { sha256?: string; rows?: number }>;
  counts?: Partial<ReviewInventory> & { train?: number; dev?: number };
  review?: Partial<ReviewCounts> & { reviewer?: string };
  dataset_review_gate?: string;
  test_split?: { status?: string };
};

export type ReviewedRecord = {
  id: string;
  source_review_status: keyof ReviewCounts;
  reviewer?: string | null;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value.replace(/\r\n/gu, "\n")).digest("hex");
}

export function evaluateHumanReview(input: {
  review: ReviewCounts;
  inventory: ReviewInventory;
  reviewer: string;
}): { complete: boolean; gate: DatasetReviewGate; errors: string[] } {
  const errors: string[] = [];
  for (const [category, expected] of Object.entries(EXPECTED_REVIEW_INVENTORY)) {
    const actual = input.inventory[category as keyof ReviewInventory];
    if (actual !== expected) errors.push(`review_inventory_mismatch: ${category} expected ${expected}, got ${actual}`);
  }
  const inventoryTotal = Object.values(input.inventory).reduce((sum, count) => sum + count, 0);
  const reviewTotal = input.review.human_approved + input.review.pending_review + input.review.rejected;
  if (inventoryTotal !== EXPECTED_REVIEW_TOTAL) {
    errors.push(`review_inventory_mismatch: expected total ${EXPECTED_REVIEW_TOTAL}, got ${inventoryTotal}`);
  }
  if (reviewTotal !== EXPECTED_REVIEW_TOTAL) {
    errors.push(`review_count_mismatch: expected total ${EXPECTED_REVIEW_TOTAL}, got ${reviewTotal}`);
  }
  if (!input.reviewer.trim()) errors.push("reviewer_missing");
  if (input.review.rejected > 0) {
    return { complete: false, gate: "blocked_rejected_gold", errors };
  }
  const complete = errors.length === 0
    && input.review.human_approved === EXPECTED_REVIEW_TOTAL
    && input.review.pending_review === 0
    && input.review.rejected === 0;
  if (!complete && input.review.pending_review === 0 && input.review.human_approved !== EXPECTED_REVIEW_TOTAL) {
    errors.push(`human_review_incomplete: expected ${EXPECTED_REVIEW_TOTAL} approved, got ${input.review.human_approved}`);
  }
  return { complete, gate: complete ? "human_review_passed" : "blocked_pending_human_review", errors };
}

export function summarizeReview(records: ReviewedRecord[]): { review: ReviewCounts; reviewer: string } {
  const review: ReviewCounts = { pending_review: 0, human_approved: 0, rejected: 0 };
  const reviewers = new Set<string>();
  for (const record of records) {
    review[record.source_review_status]++;
    if (record.reviewer?.trim()) reviewers.add(record.reviewer.trim());
  }
  return { review, reviewer: reviewers.size === 1 ? [...reviewers][0]! : "" };
}

export function assertReviewSourceConsistency(annotations: ReviewedRecord[], datasets: ReviewedRecord[]): void {
  const materialized = new Map(datasets.map((record) => [record.id, record]));
  if (annotations.length !== datasets.length) {
    throw new Error(`review_state_mismatch: annotations contain ${annotations.length} records but datasets contain ${datasets.length}`);
  }
  for (const annotation of annotations) {
    const dataset = materialized.get(annotation.id);
    if (!dataset || dataset.source_review_status !== annotation.source_review_status || dataset.reviewer !== annotation.reviewer) {
      throw new Error(`review_state_mismatch: annotation and materialized dataset differ for ${annotation.id}`);
    }
  }
}

export function assertManifestReview(manifest: DatasetManifest, actual: ReviewCounts, reviewer: string): void {
  for (const key of ["human_approved", "pending_review", "rejected"] as const) {
    if (manifest.review?.[key] !== actual[key]) {
      throw new Error(`manifest_review_mismatch: ${key} does not match materialized datasets`);
    }
  }
  if (manifest.review?.reviewer !== reviewer) {
    throw new Error("manifest_review_mismatch: reviewer does not match materialized datasets");
  }
}

export function assertArtifactConsistency(input: {
  raw: InputFingerprint;
  actual: InputFingerprint;
  manifest: DatasetManifest;
  actualDatasetHashes: Record<string, string>;
}): void {
  const comparisons: Array<[keyof InputFingerprint, string]> = [
    ["dev_sha256", "retrieval.dev dataset hash"],
    ["regression_sha256", "regression dataset hash"],
    ["calibration_sha256", "calibration hash"],
    ["knowledge_snapshot_hash", "knowledge snapshot hash"],
  ];
  for (const [key, label] of comparisons) {
    if (input.raw[key] !== input.actual[key]) {
      throw new Error(`stale_raw_predictions: ${label} does not match raw input fingerprint`);
    }
  }
  if (input.raw.dataset_manifest_sha256 !== input.actual.dataset_manifest_sha256) {
    throw new Error("stale_raw_predictions: dataset manifest hash does not match raw input fingerprint");
  }
  if (input.manifest.knowledge_snapshot_hash !== input.actual.knowledge_snapshot_hash) {
    throw new Error("manifest_mismatch: knowledge snapshot hash does not match current K4 snapshot");
  }
  for (const [name, actualHash] of Object.entries(input.actualDatasetHashes)) {
    const manifestHash = input.manifest.files?.[name]?.sha256;
    if (manifestHash !== actualHash) {
      throw new Error(`manifest_mismatch: ${name} hash does not match actual dataset`);
    }
  }
}
