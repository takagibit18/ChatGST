import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPolicyIndex,
  ChinesePolicySearchTextProcessor,
  defaultKnowledgeLocations,
  loadPolicyDocuments,
  nationwideKnowledgeLocations,
  phase2NationwideKnowledgeLocations,
  SemanticPolicyChunker,
} from "@policy/rag/index";

const locations = process.argv.includes("--nationwide") ? phase2NationwideKnowledgeLocations() : defaultKnowledgeLocations();
const documents = await loadPolicyDocuments(locations);
const snapshotHash = process.argv.includes("--nationwide")
  ? (JSON.parse(await readFile(resolve("knowledge/snapshots/K4.json"), "utf8")) as { snapshot_hash: string }).snapshot_hash
  : undefined;
if (documents.length === 0) {
  throw new Error("No local policy Markdown found. See knowledge/README.md before building the index.");
}
const report = await buildPolicyIndex({
  indexDir: resolve("knowledge/index"),
  documents,
  chunker: new SemanticPolicyChunker(),
  textProcessor: new ChinesePolicySearchTextProcessor(),
  rebuild: process.argv.includes("--rebuild"),
  ...(snapshotHash ? { snapshotHash } : {}),
});

console.log(JSON.stringify(report, null, 2));
