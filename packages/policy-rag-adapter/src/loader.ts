import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { policyMetadataSchema, type PolicyMetadata } from "@policy/schemas/index";
import { PolicyAssistantError } from "@policy/shared/index";
import { EXTRACTION_PIPELINE_VERSION, extractDocument, isSupportedDocument } from "./document-extractor.js";
import type { PolicyDocument } from "./types.js";

type MetadataOverride = Partial<PolicyMetadata>;

export type KnowledgeLocations = {
  rawDir: string;
  curatedDir: string;
  overridesPath: string;
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
  return value === "effective" || value === "expired" || value === "draft" ? value : "unknown";
}

function metadataFrom(
  fileName: string,
  attributes: Record<string, unknown>,
  override: MetadataOverride | undefined,
): PolicyMetadata {
  const documentId = String(override?.document_id ?? attributes.document_id ?? fileName.slice(0, -extname(fileName).length));
  const candidate = {
    document_id: documentId,
    title: String(override?.title ?? attributes.title ?? "unknown"),
    region: String(override?.region ?? attributes.region ?? "unknown"),
    authority: String(override?.authority ?? attributes.authority ?? "unknown"),
    publish_date: dateOrUnknown(override?.publish_date ?? attributes.publish_date ?? attributes.timestamp),
    effective_from: dateOrUnknown(override?.effective_from ?? attributes.effective_from),
    effective_to: nullableDate(override?.effective_to ?? attributes.effective_to),
    status: normalizeStatus(override?.status ?? attributes.status),
    source_url: sourceOrUnknown(override?.source_url ?? attributes.source_url ?? attributes.resource),
    policy_type: String(override?.policy_type ?? attributes.policy_type ?? "childcare-subsidy"),
    version_group: String(override?.version_group ?? attributes.version_group ?? documentId),
    version_priority: Number(override?.version_priority ?? attributes.version_priority ?? 0),
  };
  const parsed = policyMetadataSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new PolicyAssistantError("INVALID_INPUT", `Invalid policy metadata: ${fileName}`, {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return parsed.data;
}

export async function loadPolicyDocuments(locations: KnowledgeLocations): Promise<PolicyDocument[]> {
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
    const parsed = extracted.format === "markdown"
      ? matter(extracted.text)
      : { content: extracted.text, data: {} as Record<string, unknown> };
    const relativeKey = `${collection}/${relative(root, path).replace(/\\/gu, "/")}`;
    const metadataOverride = overrides[relativeKey] ?? overrides[fileName];
    const metadata = metadataFrom(fileName, parsed.data as Record<string, unknown>, metadataOverride);
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
