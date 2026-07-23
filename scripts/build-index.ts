import { resolve } from "node:path";
import {
  buildPolicyIndex,
  ChinesePolicySearchTextProcessor,
  defaultKnowledgeLocations,
  loadPolicyDocuments,
  SemanticPolicyChunker,
} from "@policy/rag/index";

const documents = await loadPolicyDocuments(defaultKnowledgeLocations());
const report = await buildPolicyIndex({
  indexDir: resolve("knowledge/index"),
  documents,
  chunker: new SemanticPolicyChunker(),
  textProcessor: new ChinesePolicySearchTextProcessor(),
  rebuild: process.argv.includes("--rebuild"),
});

console.log(JSON.stringify(report, null, 2));

