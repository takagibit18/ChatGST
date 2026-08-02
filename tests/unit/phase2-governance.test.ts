import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPolicyIndex,
  ChinesePolicySearchTextProcessor,
  loadPolicyDocuments,
  phase2NationwideKnowledgeLocations,
  PiLocalRagRetrievalProvider,
  validatePhase2Governance,
  verifyKnowledgeSnapshot,
  type DuplicateGroup,
  type KnowledgeSnapshot,
  type PolicyDocument,
} from "@policy/rag/index";
import type { PolicyMetadata } from "@policy/schemas/index";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function policyDocument(id: string, overrides: Partial<PolicyMetadata> = {}, body = `${id}正文`): PolicyDocument {
  return {
    metadata: {
      document_id: id, title: `${id}育儿补贴政策`, region: "北京市", region_code: "110000", region_level: "province",
      parent_region_code: "100000", applicable_region_codes: ["110000"], authority: "北京市卫生健康委员会",
      publish_date: "2026-01-01", effective_from: "2026-01-01", effective_to: null, status: "effective",
      source_url: `https://example.gov.cn/${id}`, policy_type: "childcare-subsidy", document_kind: "policy_rule",
      source_domain: "example.gov.cn", publisher_region_code: "110000", policy_number: null,
      version_group: "beijing-policy", version_priority: 1, canonical_document_id: id, duplicate_group_id: null,
      source_priority: 10, review_status: "approved", quarantine_reasons: [], ...overrides,
    },
    fileName: `${id}.md`, sourcePath: `${id}.md`, body, raw: body, bodyStartLine: 1,
    fileHash: `${id}:${body}:${JSON.stringify(overrides)}`, sourceFormat: "markdown", extractionWarnings: [],
  };
}

const chunker = { chunk: (document: PolicyDocument) => [{
  document_id: document.metadata.document_id, chunk_id: `${document.metadata.document_id}:1`, title: document.metadata.title,
  content: document.body, section_path: ["正文"], line_start: 1, line_end: 1, ordinal: 0,
}] };

describe("Phase 2 duplicate, version and snapshot governance", () => {
  it("validates confirmed groups and immutable K0-K4 manifests", async () => {
    const metadata = JSON.parse(await readFile(resolve("knowledge/metadata/nationwide-childcare-phase2-overrides.json"), "utf8")) as Record<string, PolicyMetadata>;
    const groupArtifact = JSON.parse(await readFile(resolve("knowledge/metadata/duplicate-groups.json"), "utf8")) as { groups: DuplicateGroup[] };
    expect(validatePhase2Governance(metadata, groupArtifact.groups)).toMatchObject({
      valid: true, files: 47, canonical_documents: 39, duplicate_groups: 1,
    });
    const expectedCounts = { K0: 6, K1: 47, K2: 41, K3: 39, K4: 39 } as const;
    for (const [id, count] of Object.entries(expectedCounts)) {
      const manifest = JSON.parse(await readFile(resolve(`knowledge/snapshots/${id}.json`), "utf8")) as KnowledgeSnapshot;
      expect(verifyKnowledgeSnapshot(manifest)).toBe(true);
      expect(manifest.counts.documents).toBe(count);
    }
  });

  it("keeps high-similarity cross-region policies as candidates instead of confirmed duplicates", async () => {
    const candidates = JSON.parse(await readFile(resolve("knowledge/metadata/duplicate-candidates.json"), "utf8")) as {
      candidates: Array<{ left_document_id: string; right_document_id: string; similarity: number; same_region: boolean }>;
    };
    const groups = JSON.parse(await readFile(resolve("knowledge/metadata/duplicate-groups.json"), "utf8")) as { groups: DuplicateGroup[] };
    expect(candidates.candidates.some((item) => item.similarity > 0.97 && item.same_region)).toBe(true);
    const confirmed = new Set(groups.groups.flatMap((group) => group.member_document_ids));
    const crossRegion = candidates.candidates.find((item) => !item.same_region && item.similarity > 0.6);
    expect(crossRegion).toBeDefined();
    expect(confirmed.has(crossRegion!.left_document_id) && confirmed.has(crossRegion!.right_document_id)).toBe(false);
  });

  it("materializes K4 with only approved canonical documents", async () => {
    const indexDir = await mkdtemp(join(tmpdir(), "chatgst-k4-"));
    temporaryDirectories.push(indexDir);
    const documents = await loadPolicyDocuments(phase2NationwideKnowledgeLocations(), { includeQuarantined: true });
    const report = await buildPolicyIndex({
      indexDir, documents, chunker, textProcessor: new ChinesePolicySearchTextProcessor(), rebuild: true,
    });
    expect(report.documents_total).toBe(39);
    const provider = new PiLocalRagRetrievalProvider(indexDir);
    expect(provider.getStats().documents).toBe(39);
    expect(await provider.getMetadata("新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_21")).toBeNull();
    expect(await provider.getMetadata("新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_29")).toMatchObject({
      canonical_document_id: "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_29",
      duplicate_group_id: "dup-national-childcare-management-standard-2025",
      document_kind: "policy_rule",
    });
  });

  it("handles add, content update, metadata-only update and delete incrementally", async () => {
    const indexDir = await mkdtemp(join(tmpdir(), "chatgst-incremental-"));
    temporaryDirectories.push(indexDir);
    const first = policyDocument("first");
    const second = policyDocument("second", { version_group: "second-policy" });
    const base = { indexDir, chunker, textProcessor: new ChinesePolicySearchTextProcessor() };

    expect(await buildPolicyIndex({ ...base, documents: [first], rebuild: true })).toMatchObject({ documents_indexed: 1 });
    expect(await buildPolicyIndex({ ...base, documents: [first] })).toMatchObject({ documents_indexed: 0, documents_unchanged: 1 });
    expect(await buildPolicyIndex({ ...base, documents: [first, second] })).toMatchObject({ documents_indexed: 1, documents_unchanged: 1 });
    const contentUpdate = { ...first, body: "更新后的正文", raw: "更新后的正文", fileHash: "content-update" };
    expect(await buildPolicyIndex({ ...base, documents: [contentUpdate, second] })).toMatchObject({ documents_indexed: 1, documents_unchanged: 1 });
    const metadataUpdate = { ...contentUpdate, metadata: { ...contentUpdate.metadata, title: "仅元数据更新" }, fileHash: "metadata-update" };
    expect(await buildPolicyIndex({ ...base, documents: [metadataUpdate, second] })).toMatchObject({ documents_indexed: 1, documents_unchanged: 1 });
    expect(await buildPolicyIndex({ ...base, documents: [metadataUpdate] })).toMatchObject({ documents_removed: 1, documents_unchanged: 1 });
  });

  it("resolves same-date versions deterministically by authority priority", async () => {
    const indexDir = await mkdtemp(join(tmpdir(), "chatgst-version-order-"));
    temporaryDirectories.push(indexDir);
    const lower = policyDocument("lower", { source_priority: 10 });
    const higher = policyDocument("higher", { source_priority: 90 });
    await buildPolicyIndex({
      indexDir, documents: [lower, higher], chunker, textProcessor: new ChinesePolicySearchTextProcessor(), rebuild: true,
    });
    const resolved = await new PiLocalRagRetrievalProvider(indexDir).resolvePolicyVersion({
      region: "北京市", policy_type: "childcare-subsidy", reference_date: "2026-08-02",
    });
    expect(resolved).toMatchObject({ status: "resolved", policies: [{ document_id: "higher" }] });
  });
});
