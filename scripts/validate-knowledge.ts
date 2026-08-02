import {
  defaultKnowledgeLocations,
  getAdministrativeRegion,
  isRegionAncestor,
  loadPolicyDocuments,
  SemanticPolicyChunker,
} from "@policy/rag/index";

const documents = await loadPolicyDocuments(defaultKnowledgeLocations(), { includeQuarantined: true });
const chunker = new SemanticPolicyChunker();
const errors: string[] = [];
const warnings: string[] = [];
if (documents.length === 0) {
  errors.push("No local policy Markdown found. See knowledge/README.md before building the index.");
}
for (const document of documents) {
  if (document.raw.includes("\uFFFD") || /锟斤拷|Ã\w|å\w/u.test(document.raw)) {
    errors.push(`${document.fileName}: possible mojibake`);
  }
  if (document.metadata.source_url === "unknown") errors.push(`${document.fileName}: missing valid source URL`);
  const registeredRegion = getAdministrativeRegion(document.metadata.region_code ?? "");
  if (!registeredRegion || registeredRegion.name !== document.metadata.region) errors.push(`${document.fileName}: unregistered or inconsistent region`);
  if (registeredRegion?.parent_code !== document.metadata.parent_region_code) errors.push(`${document.fileName}: inconsistent parent region`);
  const applicableRegionCodes = document.metadata.applicable_region_codes ?? [];
  if (applicableRegionCodes.some((code) => !getAdministrativeRegion(code))) errors.push(`${document.fileName}: unknown applicable region`);
  if (applicableRegionCodes.some((code) => !isRegionAncestor(document.metadata.region_code ?? "", code))) {
    errors.push(`${document.fileName}: applicable region is outside the declared region hierarchy`);
  }
  if (document.metadata.review_status === "quarantined" && (document.metadata.quarantine_reasons?.length ?? 0) === 0) {
    errors.push(`${document.fileName}: quarantined document needs a reason`);
  }
  if (document.metadata.review_status === "approved" && document.metadata.status === "unknown") errors.push(`${document.fileName}: approved document has unknown status`);
  if (document.metadata.publish_date === "unknown") warnings.push(`${document.fileName}: publish_date unknown`);
  if (document.metadata.effective_from === "unknown") warnings.push(`${document.fileName}: effective_from unknown`);
  const chunks = chunker.chunk(document);
  if (chunks.length === 0) errors.push(`${document.fileName}: no semantic chunks`);
  if (chunks.some((chunk) => chunk.content.length > 2200)) errors.push(`${document.fileName}: oversized chunk`);
}
const result = { valid: errors.length === 0, documents: documents.length, errors, warnings };
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
