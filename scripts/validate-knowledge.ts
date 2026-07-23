import { defaultKnowledgeLocations, loadPolicyDocuments, SemanticPolicyChunker } from "@policy/rag/index";

const documents = await loadPolicyDocuments(defaultKnowledgeLocations());
const chunker = new SemanticPolicyChunker();
const errors: string[] = [];
const warnings: string[] = [];
for (const document of documents) {
  if (document.raw.includes("\uFFFD") || /锟斤拷|Ã\w|å\w/u.test(document.raw)) {
    errors.push(`${document.fileName}: possible mojibake`);
  }
  if (document.metadata.source_url === "unknown") errors.push(`${document.fileName}: missing valid source URL`);
  if (!/^(北京市|河北省|全国)$/u.test(document.metadata.region)) {
    errors.push(`${document.fileName}: unsupported or unknown region`);
  }
  if (document.metadata.publish_date === "unknown") warnings.push(`${document.fileName}: publish_date unknown`);
  if (document.metadata.effective_from === "unknown") warnings.push(`${document.fileName}: effective_from unknown`);
  const chunks = chunker.chunk(document);
  if (chunks.length === 0) errors.push(`${document.fileName}: no semantic chunks`);
  if (chunks.some((chunk) => chunk.content.length > 2200)) errors.push(`${document.fileName}: oversized chunk`);
}
const result = { valid: errors.length === 0, documents: documents.length, errors, warnings };
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;

