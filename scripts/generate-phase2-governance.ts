import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  finalizeKnowledgeSnapshot,
  findDuplicateCandidates,
  getAdministrativeRegion,
  hashJson,
  loadPolicyDocuments,
  nationwideKnowledgeLocations,
  resolveAdministrativeRegion,
  validatePhase2Governance,
  verifyKnowledgeSnapshot,
  type DuplicateCandidate,
  type DuplicateGroup,
  type IntakeAuditRecord,
  type KnowledgeSnapshot,
  type NationwideMetadataOverride,
  type PolicyDocument,
} from "@policy/rag/index";
import type { PolicyMetadata } from "@policy/schemas/index";

const root = resolve("knowledge");
const auditPath = resolve(root, "metadata/nationwide-childcare-source-audit.jsonl");
const phase1Path = resolve(root, "metadata/nationwide-childcare-overrides.json");
const phase2Path = resolve(root, "metadata/nationwide-childcare-phase2-overrides.json");
const candidatesPath = resolve(root, "metadata/duplicate-candidates.json");
const groupsPath = resolve(root, "metadata/duplicate-groups.json");
const snapshotsDir = resolve(root, "snapshots");
const generatedAt = "2026-08-02T00:00:00.000Z";

type Phase2Override = NationwideMetadataOverride & Required<Pick<PolicyMetadata,
  "document_kind" | "source_domain" | "publisher_region_code" | "policy_number" | "canonical_document_id"
  | "duplicate_group_id" | "source_priority">>;

const nationalMembers = [
  "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_21",
  "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_29",
  "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_58",
];
const nationalCanonical = nationalMembers[1]!;

function documentKind(type: string | null): Phase2Override["document_kind"] {
  if (type === "政策规章") return "policy_rule";
  if (type === "官方解读") return "official_interpretation";
  if (type === "办事指南") return "service_guide";
  return "unknown";
}

function extractPolicyNumber(document: PolicyDocument): string | null {
  return `${document.metadata.title}\n${document.body.slice(0, 1200)}`.match(/[\u4e00-\u9fff]{1,12}〔\d{4}〕\d+号/u)?.[0] ?? null;
}

function sourcePriority(kind: Phase2Override["document_kind"], domain: string): number {
  const department = /wjw|wsjkw|wst|swt|czt/u.test(domain) ? 40 : 30;
  const kindPriority = kind === "policy_rule" ? 20 : kind === "official_interpretation" ? 10 : 5;
  return department + kindPriority;
}

function publisherRegion(record: IntakeAuditRecord, applicableCode: string): string | null {
  const explicit: Record<string, string> = {
    "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_21.md": "340000",
    "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_29.md": "410000",
    "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_58.md": "650000",
    "省级或地市_官方解读_育儿补贴申请“一件事”_17.md": "150000",
    "贴申领专区_官方解读_育儿补贴申请“一件事”_32.md": "420000",
  };
  if (explicit[record.relative_path]) return explicit[record.relative_path]!;
  const resolved = resolveAdministrativeRegion(record.region);
  return resolved.status === "resolved" ? resolved.region.code : getAdministrativeRegion(applicableCode)?.code ?? null;
}

function metadataHash(value: object, stage: "K2" | "K3" | "K4"): string {
  if (stage === "K4") return hashJson(value);
  const item = value as Record<string, unknown>;
  const selected = stage === "K2"
    ? Object.fromEntries(Object.entries(item).filter(([key]) => !["canonical_document_id", "duplicate_group_id", "source_priority", "version_priority"].includes(key)))
    : Object.fromEntries(Object.entries(item).filter(([key]) => !["source_priority", "version_priority", "effective_to"].includes(key)));
  return hashJson(selected);
}

function snapshot(
  id: KnowledgeSnapshot["snapshot_id"],
  description: string,
  auditHash: string,
  documents: Array<{ document_id: string; source_sha256: string; metadata_sha256: string | null }>,
  excluded: Array<{ document_id: string; reason: string }>,
  configuration: KnowledgeSnapshot["configuration"],
  reproducibility: KnowledgeSnapshot["reproducibility"] = "manifest",
  legacyChunks?: number,
): KnowledgeSnapshot {
  return finalizeKnowledgeSnapshot({
    schema_version: 1, snapshot_id: id, description, created_at: generatedAt, source_audit_hash: auditHash,
    configuration, documents, excluded,
    counts: { documents: documents.length, excluded: excluded.length, ...(legacyChunks === undefined ? {} : { legacy_chunks: legacyChunks }) },
    reproducibility,
  });
}

const auditText = await readFile(auditPath, "utf8");
const audit = auditText.trim().split(/\r?\n/gu).map((line) => JSON.parse(line) as IntakeAuditRecord);
const phase1 = JSON.parse(await readFile(phase1Path, "utf8")) as Record<string, NationwideMetadataOverride>;
const documents = await loadPolicyDocuments(nationwideKnowledgeLocations(), { includeQuarantined: true });
const byId = new Map(documents.map((document) => [document.metadata.document_id, document]));
const candidates = findDuplicateCandidates(documents.map((document) => ({
  document_id: document.metadata.document_id,
  region_code: document.metadata.region_code ?? "000000",
  title: document.metadata.title,
  body: document.body,
  policy_number: extractPolicyNumber(document),
})), 0.42);

const nationalEvidence = candidates.filter((candidate) => nationalMembers.includes(candidate.left_document_id)
  && nationalMembers.includes(candidate.right_document_id));
const groups: DuplicateGroup[] = [{
  group_id: "dup-national-childcare-management-standard-2025",
  match_kind: "near",
  canonical_document_id: nationalCanonical,
  member_document_ids: nationalMembers,
  evidence: nationalEvidence.map((item) => ({
    left_document_id: item.left_document_id, right_document_id: item.right_document_id, similarity: item.similarity,
  })),
  review_status: "confirmed",
  rationale: "三份材料适用范围均为全国，正文五字 shingles 相似度均高于 0.97；选择标题完整且明确标注联合发布机构的官方转载作为 canonical。",
}];

const groupByMember = new Map(groups.flatMap((group) => group.member_document_ids.map((id) => [id, group] as const)));
const auditByPath = new Map(audit.map((record) => [record.relative_path, record]));
const phase2 = Object.fromEntries(Object.entries(phase1).map(([path, item]) => {
  const document = byId.get(item.document_id)!;
  const record = auditByPath.get(path)!;
  const kind = documentKind(record.type);
  const duplicateGroup = groupByMember.get(item.document_id);
  const domain = new URL(item.source_url).hostname;
  return [path, {
    ...item,
    document_kind: kind,
    source_domain: domain,
    publisher_region_code: publisherRegion(record, item.region_code),
    policy_number: extractPolicyNumber(document),
    version_group: `${item.policy_type}:${item.region_code}:${kind}`,
    version_priority: 0,
    canonical_document_id: duplicateGroup?.canonical_document_id ?? item.document_id,
    duplicate_group_id: duplicateGroup?.group_id ?? null,
    source_priority: sourcePriority(kind, domain) + (item.document_id === nationalCanonical ? 100 : 0),
  } satisfies Phase2Override];
})) as Record<string, Phase2Override>;

const versionGroups = new Map<string, Phase2Override[]>();
for (const item of Object.values(phase2).filter((value) => value.review_status === "approved" && value.canonical_document_id === value.document_id)) {
  const members = versionGroups.get(item.version_group) ?? [];
  members.push(item);
  versionGroups.set(item.version_group, members);
}
for (const members of versionGroups.values()) {
  members.sort((left, right) => left.effective_from.localeCompare(right.effective_from)
    || (left.source_priority ?? 0) - (right.source_priority ?? 0) || left.document_id.localeCompare(right.document_id, "zh-CN"));
  members.forEach((item, index) => { item.version_priority = index + 1; });
}

const validation = validatePhase2Governance(phase2, groups);
if (!validation.valid) throw new Error(validation.errors.join("\n"));

const candidateArtifact = {
  schema_version: 1,
  algorithm: { normalization: "NFKC+URL/Markdown/punctuation/whitespace removal", fingerprint: "5-character-shingle-jaccard", near_threshold: 0.42 },
  generated_at: generatedAt,
  counts: {
    documents: documents.length,
    exact: candidates.filter((item) => item.kind === "exact").length,
    near: candidates.filter((item) => item.kind === "near").length,
    policy_number: candidates.filter((item) => item.kind === "policy_number").length,
  },
  candidates,
};
const auditHash = createHash("sha256").update(auditText).digest("hex");
const auditById = new Map(audit.map((record) => [phase1[record.relative_path]!.document_id, record]));
const descriptor = (items: Array<[string, Phase2Override | NationwideMetadataOverride]>, stage: "K2" | "K3" | "K4") => items
  .map(([, item]) => ({ document_id: item.document_id, source_sha256: item.source_sha256, metadata_sha256: metadataHash(item, stage) }))
  .sort((left, right) => left.document_id.localeCompare(right.document_id, "zh-CN"));
const allIds = Object.values(phase2).map((item) => item.document_id);
const approved1 = Object.entries(phase1).filter(([, item]) => item.review_status === "approved");
const canonical2 = Object.entries(phase2).filter(([, item]) => item.review_status === "approved" && item.canonical_document_id === item.document_id);
const legacy = Array.from({ length: 6 }, (_, index) => ({ document_id: `legacy-local-document-${index + 1}`, source_sha256: "unavailable-local-only", metadata_sha256: null }));
const snapshots: KnowledgeSnapshot[] = [
  snapshot("K0", "历史本地 6 文档/54 chunks 基线；原文按仓库策略不提交。", auditHash, legacy, [],
    { metadata_governance: false, canonical_deduplication: false, version_authority_policy: false }, "legacy-local-baseline", 54),
  snapshot("K1", "47 份 intake 候选直接扩入的实验清单，不允许作为默认索引。", auditHash,
    allIds.map((id) => ({ document_id: id, source_sha256: auditById.get(id)!.sha256, metadata_sha256: null })).sort((a, b) => a.document_id.localeCompare(b.document_id, "zh-CN")), [],
    { metadata_governance: false, canonical_deduplication: false, version_authority_policy: false }),
  snapshot("K2", "Phase 1 元数据与地区治理后的 approved 集合。", auditHash, descriptor(approved1, "K2"),
    Object.values(phase1).filter((item) => item.review_status !== "approved").map((item) => ({ document_id: item.document_id, reason: "quarantined" })),
    { metadata_governance: true, canonical_deduplication: false, version_authority_policy: false }),
  snapshot("K3", "K2 加入人工确认的 canonical 去重。", auditHash, descriptor(canonical2, "K3"),
    Object.values(phase2).filter((item) => item.review_status !== "approved" || item.canonical_document_id !== item.document_id)
      .map((item) => ({ document_id: item.document_id, reason: item.review_status !== "approved" ? "quarantined" : "non_canonical_duplicate" })),
    { metadata_governance: true, canonical_deduplication: true, version_authority_policy: false }),
  snapshot("K4", "K3 加入版本组、有效区间与来源权威性优先级。", auditHash, descriptor(canonical2, "K4"),
    Object.values(phase2).filter((item) => item.review_status !== "approved" || item.canonical_document_id !== item.document_id)
      .map((item) => ({ document_id: item.document_id, reason: item.review_status !== "approved" ? "quarantined" : "non_canonical_duplicate" })),
    { metadata_governance: true, canonical_deduplication: true, version_authority_policy: true }),
];
if (snapshots.some((item) => !verifyKnowledgeSnapshot(item))) throw new Error("Generated snapshot failed self-verification");

const outputs = new Map<string, string>([
  [phase2Path, `${JSON.stringify(phase2, null, 2)}\n`],
  [candidatesPath, `${JSON.stringify(candidateArtifact, null, 2)}\n`],
  [groupsPath, `${JSON.stringify({ schema_version: 1, generated_at: generatedAt, groups }, null, 2)}\n`],
  ...snapshots.map((item) => [resolve(snapshotsDir, `${item.snapshot_id}.json`), `${JSON.stringify(item, null, 2)}\n`] as [string, string]),
]);

if (process.argv.includes("--write")) {
  await mkdir(dirname(phase2Path), { recursive: true });
  await mkdir(snapshotsDir, { recursive: true });
  await Promise.all([...outputs].map(([path, content]) => writeFile(path, content, "utf8")));
} else {
  for (const [path, expected] of outputs) {
    if (await readFile(path, "utf8").catch(() => "") !== expected) throw new Error(`Stale Phase 2 artifact: ${path}`);
  }
}

console.log(JSON.stringify({
  ...validation,
  duplicate_candidates: candidateArtifact.counts,
  snapshots: Object.fromEntries(snapshots.map((item) => [item.snapshot_id, { documents: item.counts.documents, hash: item.snapshot_hash }])),
}, null, 2));
