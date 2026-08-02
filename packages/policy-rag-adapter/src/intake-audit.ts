import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import matter from "gray-matter";

export const INTAKE_AUDIT_SCHEMA_VERSION = 1;

export type IntakeAuditRecord = {
  schema_version: number;
  relative_path: string;
  bytes: number;
  sha256: string;
  utf8_valid: boolean;
  type: string | null;
  title: string | null;
  raw_status: string | null;
  region: string | null;
  source_url: string | null;
  timestamp: string | null;
  body_chars: number;
  line_count: number;
  source_url_valid: boolean;
  date_valid: boolean;
  flags: string[];
  duplicate_group_keys: string[];
};

export type IntakeAuditSummary = {
  files: number;
  bytes: number;
  utf8_invalid: number;
  source_url_invalid: number;
  date_invalid: number;
  flagged_files: number;
  suspected_duplicates: number;
  types: Record<string, number>;
  raw_statuses: Record<string, number>;
};

type PreliminaryRecord = IntakeAuditRecord & { duplicate_candidates: string[] };

const decoder = new TextDecoder("utf-8", { fatal: true });
const acceptedIndexStatuses = new Set(["effective", "expired", "draft"]);
const genericTitles = new Set(["政府信息公开", "新闻发布会", "实施方案》的通知"]);

function sha256(input: Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function validHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizedBody(body: string): string {
  return body
    .normalize("NFKC")
    .replace(/\[([^\]]+)\]\(<[^>]+>\)/gu, "$1")
    .replace(/[\s*_`#>]+/gu, "")
    .trim();
}

function duplicateCandidates(title: string | null, body: string): string[] {
  const keys: string[] = [];
  const normalized = normalizedBody(body);
  if (normalized.length > 0) keys.push(`body-sha256:${sha256(normalized)}`);

  const searchable = `${title ?? ""}\n${body}`;
  const policyNumbers = searchable.match(/[\u4e00-\u9fff]{0,12}〔\d{4}〕\d+号/gu) ?? [];
  for (const number of new Set(policyNumbers.map((item) => item.replace(/\s+/gu, "")))) {
    keys.push(`policy-number:${number}`);
  }
  return keys.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function suspiciousTitle(title: string | null): boolean {
  if (!title) return false;
  return genericTitles.has(title) || title.length < 6 || title.startsWith("申请育儿补贴以家庭为单位");
}

function suspiciousRegion(region: string | null): boolean {
  if (!region) return false;
  return region.includes("_") || /国家卫健委|财政部|申领专区/u.test(region) || region === "广东";
}

async function markdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
    }
  }
  await walk(root);
  return files.sort((a, b) => relative(root, a).localeCompare(relative(root, b), "zh-CN"));
}

async function inspectFile(root: string, path: string): Promise<PreliminaryRecord> {
  const buffer = await readFile(path);
  const relativePath = relative(root, path).replace(/\\/gu, "/");
  let decoded = "";
  let utf8Valid = true;
  try {
    decoded = decoder.decode(buffer);
  } catch {
    utf8Valid = false;
  }

  const parsed = utf8Valid ? matter(decoded) : { data: {}, content: "" };
  const attributes = parsed.data as Record<string, unknown>;
  const type = stringValue(attributes.type);
  const title = stringValue(attributes.title);
  const rawStatus = stringValue(attributes.status);
  const region = stringValue(attributes.region);
  const sourceUrl = stringValue(attributes.resource ?? attributes.source_url);
  const timestamp = stringValue(attributes.timestamp ?? attributes.publish_date);
  const body = parsed.content.trim();
  const flags: string[] = [];

  if (!utf8Valid) flags.push("invalid_utf8");
  if (!title) flags.push("missing_title");
  else if (suspiciousTitle(title)) flags.push("suspicious_title");
  if (!region) flags.push("missing_region");
  else if (suspiciousRegion(region)) flags.push("suspicious_region");
  if (!validHttpUrl(sourceUrl)) flags.push(sourceUrl ? "invalid_source_url" : "missing_source_url");
  if (!validDate(timestamp)) flags.push(timestamp ? "invalid_date" : "missing_date");
  if (!rawStatus) flags.push("missing_status");
  else if (!acceptedIndexStatuses.has(rawStatus)) flags.push("non_index_status");
  if (body.length === 0) flags.push("empty_body");

  return {
    schema_version: INTAKE_AUDIT_SCHEMA_VERSION,
    relative_path: relativePath,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
    utf8_valid: utf8Valid,
    type,
    title,
    raw_status: rawStatus,
    region,
    source_url: sourceUrl,
    timestamp,
    body_chars: body.length,
    line_count: decoded.length === 0 ? 0 : decoded.split(/\r?\n/gu).length,
    source_url_valid: validHttpUrl(sourceUrl),
    date_valid: validDate(timestamp),
    flags,
    duplicate_group_keys: [],
    duplicate_candidates: utf8Valid ? duplicateCandidates(title, body) : [],
  };
}

export async function auditIntakeDirectory(root: string): Promise<IntakeAuditRecord[]> {
  const preliminary = await Promise.all((await markdownFiles(root)).map((path) => inspectFile(root, path)));
  const candidateCounts = new Map<string, number>();
  for (const record of preliminary) {
    for (const key of record.duplicate_candidates) candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1);
  }

  return preliminary.map(({ duplicate_candidates: candidates, ...record }) => {
    const duplicateGroupKeys = candidates.filter((key) => (candidateCounts.get(key) ?? 0) > 1);
    const flags = duplicateGroupKeys.length > 0
      ? [...new Set([...record.flags, "suspected_duplicate"])].sort()
      : [...record.flags].sort();
    return { ...record, flags, duplicate_group_keys: duplicateGroupKeys };
  });
}

export function serializeIntakeAudit(records: IntakeAuditRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}

export function summarizeIntakeAudit(records: IntakeAuditRecord[]): IntakeAuditSummary {
  const types: Record<string, number> = {};
  const rawStatuses: Record<string, number> = {};
  for (const record of records) {
    const type = record.type ?? "<missing>";
    const status = record.raw_status ?? "<missing>";
    types[type] = (types[type] ?? 0) + 1;
    rawStatuses[status] = (rawStatuses[status] ?? 0) + 1;
  }
  return {
    files: records.length,
    bytes: records.reduce((total, record) => total + record.bytes, 0),
    utf8_invalid: records.filter((record) => !record.utf8_valid).length,
    source_url_invalid: records.filter((record) => !record.source_url_valid).length,
    date_invalid: records.filter((record) => !record.date_valid).length,
    flagged_files: records.filter((record) => record.flags.length > 0).length,
    suspected_duplicates: records.filter((record) => record.flags.includes("suspected_duplicate")).length,
    types,
    raw_statuses: rawStatuses,
  };
}
