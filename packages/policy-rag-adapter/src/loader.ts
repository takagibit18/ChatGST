import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { policyMetadataSchema, type PolicyMetadata } from "@policy/schemas/index";
import { PolicyAssistantError } from "@policy/shared/index";
import { EXTRACTION_PIPELINE_VERSION, extractDocument, isSupportedDocument } from "./document-extractor.js";
import type { PolicyDocument } from "./types.js";
import { getAdministrativeRegion, isRegionAncestor, resolveAdministrativeRegion } from "./region-registry.js";

type MetadataOverride = Partial<PolicyMetadata>;

export type KnowledgeLocations = {
  rawDir: string;
  curatedDir: string;
  overridesPath: string;
};

export type LoadPolicyDocumentsOptions = {
  includeQuarantined?: boolean;
};

async function knowledgeFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && isSupportedDocument(entry.name)) results.push(path);
    }
  }
  await walk(root);
  return results.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function dateOrUnknown(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return "unknown";
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : "unknown";
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "null") return null;
  return dateOrUnknown(value);
}

function sourceOrUnknown(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "unknown";
  } catch {
    return "unknown";
  }
}

function normalizeStatus(value: unknown): PolicyMetadata["status"] {
  if (value === "verified") return "effective";
  return value === "effective" || value === "expired" || value === "draft" ? value : "unknown";
}

function metadataFrom(
  fileName: string,
  attributes: Record<string, unknown>,
  override: MetadataOverride | undefined,
): PolicyMetadata {
  const documentId = String(override?.document_id ?? attributes.document_id ?? fileName.slice(0, -extname(fileName).length));
  const legacyRegion = String(override?.region ?? attributes.region ?? "unknown");
  const resolution = resolveAdministrativeRegion(legacyRegion);
  const resolvedRegion = resolution.status === "resolved" ? resolution.region : null;
  const explicitRegion = typeof override?.region_code === "string" ? getAdministrativeRegion(override.region_code) : null;
  const region = explicitRegion ?? resolvedRegion;
  const status = normalizeStatus(override?.status ?? attributes.status);
  const inferredReasons = [
    ...(!region ? ["unknown_region"] : []),
    ...(status === "unknown" ? ["unknown_policy_status"] : []),
  ];
  const reviewStatus = override?.review_status
    ?? (attributes.review_status === "approved" || attributes.review_status === "quarantined" ? attributes.review_status : undefined)
    ?? (inferredReasons.length > 0 ? "quarantined" : "approved");
  const candidate = {
    document_id: documentId,
    title: String(override?.title ?? attributes.title ?? "unknown"),
    region: String(override?.region ?? region?.name ?? attributes.region ?? "unknown"),
    region_code: String(override?.region_code ?? region?.code ?? "000000"),
    region_level: override?.region_level ?? region?.level ?? "unknown",
    parent_region_code: override?.parent_region_code ?? region?.parent_code ?? null,
    applicable_region_codes: override?.applicable_region_codes ?? (region ? [region.code] : ["000000"]),
    authority: String(override?.authority ?? attributes.authority ?? "unknown"),
    publish_date: dateOrUnknown(override?.publish_date ?? attributes.publish_date ?? attributes.timestamp),
    effective_from: dateOrUnknown(override?.effective_from ?? attributes.effective_from),
    effective_to: nullableDate(override?.effective_to ?? attributes.effective_to),
    status,
    source_url: sourceOrUnknown(override?.source_url ?? attributes.source_url ?? attributes.resource),
    policy_type: String(override?.policy_type ?? attributes.policy_type ?? "childcare-subsidy"),
    version_group: String(override?.version_group ?? attributes.version_group ?? documentId),
    version_priority: Number(override?.version_priority ?? attributes.version_priority ?? 0),
    review_status: reviewStatus,
    quarantine_reasons: override?.quarantine_reasons ?? inferredReasons,
  };
  const parsed = policyMetadataSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new PolicyAssistantError("INVALID_INPUT", `Invalid policy metadata: ${fileName}`, {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  const registered = getAdministrativeRegion(parsed.data.region_code);
  const hierarchyValid = parsed.data.applicable_region_codes.every(
    (code) => getAdministrativeRegion(code) && isRegionAncestor(parsed.data.region_code, code),
  );
  if (parsed.data.review_status === "approved" && (!registered || registered.name !== parsed.data.region
    || registered.level !== parsed.data.region_level || registered.parent_code !== parsed.data.parent_region_code
    || !hierarchyValid)) {
    throw new PolicyAssistantError("INVALID_INPUT", `Invalid policy region metadata: ${fileName}`);
  }
  if (parsed.data.review_status === "approved" && parsed.data.status === "unknown") {
    throw new PolicyAssistantError("INVALID_INPUT", `Approved policy cannot have unknown status: ${fileName}`);
  }
  if (parsed.data.review_status === "quarantined" && parsed.data.quarantine_reasons.length === 0) {
    throw new PolicyAssistantError("INVALID_INPUT", `Quarantined policy needs a reason: ${fileName}`);
  }
  return parsed.data;
}

function parseMarkdownWithOverride(text: string, hasOverride: boolean): { content: string; data: Record<string, unknown> } {
  try {
    return matter(text) as { content: string; data: Record<string, unknown> };
  } catch (error) {
    if (!hasOverride) throw error;
    const frontMatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(text);
    return { content: frontMatter ? text.slice(frontMatter[0].length) : text, data: {} };
  }
}

export async function loadPolicyDocuments(
  locations: KnowledgeLocations,
  options: LoadPolicyDocumentsOptions = {},
): Promise<PolicyDocument[]> {
  let overrides: Record<string, MetadataOverride> = {};
  try {
    overrides = JSON.parse(await readFile(locations.overridesPath, "utf8")) as Record<string, MetadataOverride>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const discovered = [
    ...(await knowledgeFiles(locations.rawDir)).map((path) => ({ path, root: locations.rawDir, collection: "raw" })),
    ...(await knowledgeFiles(locations.curatedDir)).map((path) => ({ path, root: locations.curatedDir, collection: "curated" })),
  ];
  const documents: PolicyDocument[] = [];
  const ids = new Set<string>();
  for (const { path, root, collection } of discovered) {
    const fileName = basename(path);
    const buffer = await readFile(path);
    const extracted = await extractDocument(fileName, buffer);
    const relativeKey = `${collection}/${relative(root, path).replace(/\\/gu, "/")}`;
    const metadataOverride = overrides[relativeKey] ?? overrides[fileName];
    const parsed = extracted.format === "markdown"
      ? parseMarkdownWithOverride(extracted.text, Boolean(metadataOverride))
      : { content: extracted.text, data: {} as Record<string, unknown> };
    const metadata = metadataFrom(fileName, parsed.data as Record<string, unknown>, metadataOverride);
    if (!options.includeQuarantined && (metadata.review_status !== "approved" || metadata.status === "unknown")) continue;
    if (ids.has(metadata.document_id)) {
      throw new PolicyAssistantError("INVALID_INPUT", `Duplicate document_id: ${metadata.document_id}`);
    }
    ids.add(metadata.document_id);
    documents.push({
      metadata,
      fileName,
      sourcePath: resolve(path),
      body: parsed.content.trim(),
      raw: extracted.text,
      bodyStartLine: extracted.bodyStartLine,
      fileHash: createHash("sha256")
        .update(EXTRACTION_PIPELINE_VERSION)
        .update("\0")
        .update(buffer)
        .update("\0")
        .update(JSON.stringify(metadata))
        .digest("hex"),
      sourceFormat: extracted.format,
      extractionWarnings: extracted.warnings,
    });
  }
  return documents;
}

export function defaultKnowledgeLocations(root = process.cwd()): KnowledgeLocations {
  return {
    rawDir: resolve(root, "knowledge/raw"),
    curatedDir: resolve(root, "knowledge/curated"),
    overridesPath: resolve(root, "knowledge/metadata/overrides.json"),
  };
}

export function nationwideKnowledgeLocations(root = process.cwd()): KnowledgeLocations {
  return {
    rawDir: resolve(root, "knowledge/intake/nationwide-childcare"),
    curatedDir: resolve(root, "knowledge/intake/.none"),
    overridesPath: resolve(root, "knowledge/metadata/nationwide-childcare-overrides.json"),
  };
}
