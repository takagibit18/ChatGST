import { resolve } from "node:path";
import { DeepSeekModelProvider, TestModelProvider, type ModelProvider } from "@policy/model-provider/index";
import { PiLocalRagRetrievalProvider } from "@policy/rag/index";
import { InMemorySessionStore } from "@policy/session/index";
import type { RuntimeConfig } from "@policy/shared/index";
import { createPolicyToolRegistry } from "@policy/tools/index";
import { createTraceRecorder } from "@policy/tracing/index";
import { PolicyAgentRuntime, type TestResponseSequence } from "./runtime.js";
import { SkillLoader } from "./skill-loader.js";

export function createDefaultPolicyRuntime(config: RuntimeConfig, options?: { testResponseSequence?: TestResponseSequence }) {
  const retrieval = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
  const registry = createPolicyToolRegistry(retrieval);
  const session = new InMemorySessionStore(config.budget.sessionIdleTtl);
  const modelProviderFactory = (): ModelProvider => {
    if (config.model.provider === "test") return new TestModelProvider();
    return new DeepSeekModelProvider({
      apiKey: config.model.apiKey as string,
      baseUrl: config.model.baseUrl,
      modelName: config.model.modelName as string,
      temperature: config.model.temperature,
      maxOutputTokens: config.model.maxOutputTokens,
      timeoutMs: config.model.timeoutMs,
    });
  };
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
