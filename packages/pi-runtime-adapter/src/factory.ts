import { resolve } from "node:path";
import { DeepSeekModelProvider, TestModelProvider, type ModelProvider } from "@policy/model-provider/index";
import {
  HybridRetrievalProvider,
  LocalEmbedder,
  MilvusRetrievalProvider,
  NoopEmbedder,
  PiLocalRagRetrievalProvider,
} from "@policy/rag/index";
import type { RetrievalProvider } from "@policy/rag/index";
import { InMemorySessionStore } from "@policy/session/index";
import type { RuntimeConfig } from "@policy/shared/index";
import { createPolicyToolRegistry } from "@policy/tools/index";
import { createTraceRecorder } from "@policy/tracing/index";
import { PolicyAgentRuntime, type TestResponseSequence } from "./runtime.js";
import { SkillLoader } from "./skill-loader.js";

function createRetrievalProvider(config: RuntimeConfig): RetrievalProvider {
  const bm25 = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));

  switch (config.retrieval.mode) {
    case "milvus": {
      const embedder = config.model.provider === "test" ? new NoopEmbedder() : new LocalEmbedder();
      return new MilvusRetrievalProvider({
        endpoint: config.retrieval.milvus.endpoint,
        collectionName: config.retrieval.milvus.collection,
        token: config.retrieval.milvus.token,
        dimension: embedder.dimension,
        timeoutMs: 10_000,
      }, embedder);
    }
    case "hybrid": {
      const embedder = config.model.provider === "test" ? new NoopEmbedder() : new LocalEmbedder();
      return new HybridRetrievalProvider(bm25, {
        endpoint: config.retrieval.milvus.endpoint,
        collectionName: config.retrieval.milvus.collection,
        token: config.retrieval.milvus.token,
        dimension: embedder.dimension,
        timeoutMs: 10_000,
      }, embedder);
    }
    default:
      return bm25;
  }
}

export function createDefaultPolicyRuntime(config: RuntimeConfig, options?: {
  testResponseSequence?: TestResponseSequence;
  modelProviderFactory?: () => ModelProvider;
  retrievalProvider?: RetrievalProvider;
}) {
  const retrieval = options?.retrievalProvider ?? createRetrievalProvider(config);
  const registry = createPolicyToolRegistry(retrieval, config);
  const session = new InMemorySessionStore(config.budget.sessionIdleTtl);
  const modelProviderFactory = options?.modelProviderFactory ?? ((): ModelProvider => {
    if (config.model.provider === "test") return new TestModelProvider();
    return new DeepSeekModelProvider({
      apiKey: config.model.apiKey as string,
      baseUrl: config.model.baseUrl,
      modelName: config.model.modelName as string,
      temperature: config.model.temperature,
      maxOutputTokens: config.model.maxOutputTokens,
      timeoutMs: config.model.timeoutMs,
    });
  });
  return {
    runtime: new PolicyAgentRuntime({
      config,
      modelProviderFactory,
      toolRegistry: registry,
      sessionStore: session,
      skillLoader: new SkillLoader(),
      traceRecorderFactory: (context) => createTraceRecorder(config.raindrop, context),
      ...(options?.testResponseSequence ? { testResponseSequence: options.testResponseSequence } : {}),
    }),
    retrieval,
    registry,
    session,
  };
}
