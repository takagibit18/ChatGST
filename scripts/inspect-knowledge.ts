import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { defaultKnowledgeLocations, loadPolicyDocuments, SemanticPolicyChunker } from "@policy/rag/index";

const documents = await loadPolicyDocuments(defaultKnowledgeLocations());
const chunker = new SemanticPolicyChunker();
const output = [];
for (const document of documents) {
  const bytes = await readFile(document.sourcePath);
  const chunks = chunker.chunk(document);
  output.push({
    file: document.fileName,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    document_id: document.metadata.document_id,
    region: document.metadata.region,
    publish_date: document.metadata.publish_date,
    source_url: document.metadata.source_url,
    source_format: document.sourceFormat,
    extraction_warnings: document.extractionWarnings,
    headings_or_articles: chunks.filter((chunk) => chunk.section_path.length > 0).length,
    chunks: chunks.length,
    tables: (document.body.match(/^\|.+\|$/gmu) ?? []).length,
    lists: (document.body.match(/^\s*(?:[-*]|\d+[.)]|[（(][一二三四五六七八九十0-9]+[）)])\s*/gmu) ?? []).length,
  });
}
console.log(JSON.stringify({ documents: output.length, items: output }, null, 2));
