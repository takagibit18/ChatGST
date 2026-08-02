import "dotenv/config";
import { resolve } from "node:path";
import pino from "pino";
import { getOntoSummary } from "@policy/ontology/index";
import { createDefaultPolicyRuntime } from "@policy/runtime/index";
import { loadRuntimeConfig } from "@policy/shared/index";
import { createPolicyServer } from "@policy/web-adapter/index";
import type { KnowledgeBrowserProvider, RetrievalProvider } from "@policy/rag/index";

function supportsKnowledgeBrowser(provider: RetrievalProvider): provider is RetrievalProvider & KnowledgeBrowserProvider {
  const candidate = provider as Partial<KnowledgeBrowserProvider>;
  return typeof candidate.listKnowledgeDocuments === "function"
    && typeof candidate.getKnowledgeDocument === "function"
    && typeof candidate.getStats === "function";
}

const config = loadRuntimeConfig();
const logger = pino({ level: config.logLevel });
const { runtime, retrieval, registry } = createDefaultPolicyRuntime(config);
const stats = retrieval.getStats?.() ?? { documents: 0, chunks: 0, vector_rows: 0, retrieval_mode: config.retrieval.mode };
// BM25 invariant only applies to bm25 mode
if (config.retrieval.mode === "bm25" && (stats.vector_rows !== 0 || stats.retrieval_mode !== "bm25-only")) {
  throw new Error("RAG index violates the pure-BM25 invariant");
}
const application = createPolicyServer({
  runtime,
  ...(supportsKnowledgeBrowser(retrieval) ? { knowledge: retrieval } : {}),
  config,
  staticDir: resolve("apps/policy-web/dist"),
});
const address = await application.listen();
logger.info(
  {
    event: "server_started",
    host: address.host,
    port: address.port,
    rag_documents: stats.documents,
    rag_chunks: stats.chunks,
    retrieval_mode: config.retrieval.mode,
    tools: registry.names(),
    onto_platform: getOntoSummary(),
    raindrop_enabled: config.raindrop.enabled && Boolean(config.raindrop.writeKey),
  },
  `Policy assistant is running at ${address.url}`,
);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ event: "server_stopping", signal });
  await application.close();
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
