import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditIntakeDirectory,
  buildPolicyIndex,
  ChinesePolicySearchTextProcessor,
  getRegionPath,
  isRegionAncestor,
  loadPolicyDocuments,
  PiLocalRagRetrievalProvider,
  resolveAdministrativeRegion,
  validateGovernanceSnapshot,
  type IntakeAuditRecord,
  type NationwideMetadataOverride,
  type PolicyDocument,
} from "@policy/rag/index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Phase 1 region governance", () => {
  it("resolves canonical names, aliases and parent-child paths from the registry", () => {
    expect(resolveAdministrativeRegion("北京")).toMatchObject({ status: "resolved", region: { code: "110000", name: "北京市" } });
    expect(resolveAdministrativeRegion("黑龙江省_大庆市")).toMatchObject({ status: "resolved", region: { code: "230600" } });
    expect(resolveAdministrativeRegion("不存在地区")).toEqual({ status: "unknown", input: "不存在地区" });
    expect(getRegionPath("230600").map((region) => region.code)).toEqual(["100000", "230000", "230600"]);
    expect(isRegionAncestor("230000", "230600")).toBe(true);
    expect(isRegionAncestor("110000", "230600")).toBe(false);
  });

  it("requires one hash-bound override per source and validates review states", async () => {
    const audit = (await readFile(resolve("knowledge/metadata/nationwide-childcare-source-audit.jsonl"), "utf8"))
      .trim().split(/\r?\n/gu).map((line) => JSON.parse(line) as IntakeAuditRecord);
    const overrides = JSON.parse(await readFile(resolve("knowledge/metadata/nationwide-childcare-overrides.json"), "utf8")) as Record<string, NationwideMetadataOverride>;
    const result = validateGovernanceSnapshot(audit, overrides);

    expect(result).toMatchObject({ valid: true, files: 47, approved: 41, quarantined: 6, metadata_complete: 47, region_resolved: 47 });
  });

  it("quarantines missing regions and unknown policy states before default loading", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgst-governance-"));
    temporaryDirectories.push(root);
    const rawDir = join(root, "raw");
    const curatedDir = join(root, "curated");
    await import("node:fs/promises").then(({ mkdir }) => Promise.all([
      mkdir(rawDir, { recursive: true }), mkdir(curatedDir, { recursive: true }),
    ]));
    await writeFile(join(rawDir, "unknown.md"), [
      "---", "title: 待核验育儿补贴材料", "status: issue", "resource: https://example.gov.cn/policy", "timestamp: 2026-01-02", "---", "正文",
    ].join("\n"), "utf8");
    const locations = { rawDir, curatedDir, overridesPath: join(root, "overrides.json") };

    expect(await loadPolicyDocuments(locations)).toHaveLength(0);
    const all = await loadPolicyDocuments(locations, { includeQuarantined: true });
    expect(all).toHaveLength(1);
    expect(all[0]?.metadata).toMatchObject({ region_code: "000000", region_level: "unknown", status: "unknown", review_status: "quarantined" });
    expect(all[0]?.metadata.quarantine_reasons).toEqual(expect.arrayContaining(["unknown_region", "unknown_policy_status"]));
  });

  it("reports an unregistered region in the intake audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "chatgst-region-audit-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "unknown.md"), [
      "---", "title: 测试育儿补贴政策材料", "status: effective", "resource: https://example.gov.cn/policy",
      "region: 火星市", "timestamp: 2026-01-02", "---", "正文",
    ].join("\n"), "utf8");
    const [record] = await auditIntakeDirectory(root);
    expect(record).toMatchObject({ region_code: null, region_resolution: "unknown" });
    expect(record?.flags).toContain("unknown_region");
  });

  it("persists governance fields and never indexes quarantined documents", async () => {
    const indexDir = await mkdtemp(join(tmpdir(), "chatgst-index-governance-"));
    temporaryDirectories.push(indexDir);
    const base: PolicyDocument = {
      metadata: {
        document_id: "approved", title: "北京市育儿补贴细则", region: "北京市", region_code: "110000",
        region_level: "province", parent_region_code: "100000", applicable_region_codes: ["110000"],
        authority: "北京市卫生健康委员会", publish_date: "2026-01-01", effective_from: "2026-01-01",
        effective_to: null, status: "effective", source_url: "https://example.gov.cn/approved",
        policy_type: "childcare-subsidy", version_group: "beijing", version_priority: 1,
        review_status: "approved", quarantine_reasons: [],
      },
      fileName: "approved.md", sourcePath: join(indexDir, "approved.md"), body: "每孩每年补贴。", raw: "每孩每年补贴。",
      bodyStartLine: 1, fileHash: "approved-hash", sourceFormat: "markdown", extractionWarnings: [],
    };
    const quarantined: PolicyDocument = {
      ...base,
      metadata: { ...base.metadata, document_id: "quarantined", review_status: "quarantined", quarantine_reasons: ["unknown_region"] },
      fileName: "quarantined.md", fileHash: "quarantined-hash",
    };
    const report = await buildPolicyIndex({
      indexDir,
      documents: [base, quarantined],
      chunker: { chunk: (document) => [{
        document_id: document.metadata.document_id, chunk_id: `${document.metadata.document_id}:1`, title: document.metadata.title,
        content: document.body, section_path: ["正文"], line_start: 1, line_end: 1, ordinal: 0,
      }] },
      textProcessor: new ChinesePolicySearchTextProcessor(),
      rebuild: true,
    });
    expect(report.documents_total).toBe(1);
    const provider = new PiLocalRagRetrievalProvider(indexDir);
    expect(await provider.getMetadata("quarantined")).toBeNull();
    expect(await provider.getMetadata("approved")).toMatchObject({
      region_code: "110000", parent_region_code: "100000", applicable_region_codes: ["110000"], review_status: "approved",
    });
  });
});
