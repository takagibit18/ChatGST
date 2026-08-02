import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IntakeAuditRecord, NationwideMetadataOverride } from "@policy/rag/index";
import { getAdministrativeRegion, loadPolicyDocuments, nationwideKnowledgeLocations, resolveAdministrativeRegion, validateGovernanceSnapshot } from "@policy/rag/index";

const auditPath = resolve("knowledge/metadata/nationwide-childcare-source-audit.jsonl");
const outputPath = resolve("knowledge/metadata/nationwide-childcare-overrides.json");

const regionCorrections: Record<string, string> = {
  "广东": "广东省",
  "国家卫健委": "全国",
  "国家卫健委 财政部": "全国",
  "贴申领专区": "湖北省",
  "": "江苏省",
};

const fileCorrections: Record<string, string> = {
  "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_21.md": "全国",
  "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_29.md": "全国",
  "新疆维吾尔自治区_政策规章_育儿补贴申请“一件事”_58.md": "全国",
};

function authorityFor(record: IntakeAuditRecord, region: string): string {
  const host = new URL(record.source_url!).hostname;
  if (region === "全国") return /财政部/u.test(record.title ?? "") ? "国家卫生健康委员会、财政部" : "国家卫生健康委员会";
  if (/czt\./u.test(host)) return `${region}财政部门`;
  if (/wjw|wsjkw|wst|swt/u.test(host)) return `${region}卫生健康委员会`;
  if (/gov\.cn$/u.test(host)) return `${region}人民政府`;
  return `${region}政务服务机构`;
}

function resolveRecordRegion(record: IntakeAuditRecord): string {
  return fileCorrections[record.relative_path] ?? regionCorrections[record.region ?? ""] ?? record.region ?? "";
}

function createOverride(record: IntakeAuditRecord): NationwideMetadataOverride {
  const corrected = resolveRecordRegion(record);
  const resolution = resolveAdministrativeRegion(corrected);
  if (resolution.status !== "resolved") throw new Error(`${record.relative_path}: cannot resolve ${JSON.stringify(corrected)}`);
  const region = getAdministrativeRegion(resolution.region.code)!;
  const quarantined = record.raw_status !== "verified";
  const expired = /废止/u.test(record.title ?? "");
  return {
    document_id: record.relative_path.replace(/\.md$/u, ""),
    title: record.title!,
    region: region.name,
    region_code: region.code,
    region_level: region.level,
    parent_region_code: region.parent_code,
    applicable_region_codes: [region.code],
    authority: authorityFor(record, region.name),
    publish_date: record.timestamp!,
    effective_from: record.timestamp!,
    effective_to: null,
    status: expired ? "expired" : quarantined ? "unknown" : "effective",
    source_url: record.source_url!,
    policy_type: "childcare-subsidy",
    version_group: `childcare-subsidy:${region.code}`,
    version_priority: 0,
    review_status: quarantined ? "quarantined" : "approved",
    quarantine_reasons: quarantined ? ["phase0_source_audit_issue"] : [],
    source_sha256: record.sha256,
  };
}

const audit = (await readFile(auditPath, "utf8")).trim().split(/\r?\n/gu).map((line) => JSON.parse(line) as IntakeAuditRecord);
const generated = Object.fromEntries(audit.map((record) => [record.relative_path, createOverride(record)]));
const validation = validateGovernanceSnapshot(audit, generated);
if (!validation.valid) throw new Error(validation.errors.join("\n"));
const serialized = `${JSON.stringify(generated, null, 2)}\n`;

if (process.argv.includes("--write")) await writeFile(outputPath, serialized, "utf8");
else if (await readFile(outputPath, "utf8").catch(() => "") !== serialized) {
  console.error("Phase 1 overrides are stale. Run pnpm knowledge:governance:write.");
  process.exitCode = 1;
}
const indexable = await loadPolicyDocuments(nationwideKnowledgeLocations());
if (indexable.length !== validation.approved) throw new Error(`Approved/indexable mismatch: ${validation.approved}/${indexable.length}`);
console.log(JSON.stringify({ ...validation, indexable: indexable.length, output: outputPath }, null, 2));
