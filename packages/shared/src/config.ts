import { z } from "zod";
import { PolicyAssistantError } from "./errors.js";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || String(value).toLowerCase() === "true");

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.url().default("https://api.deepseek.com"),
  MODEL_NAME: z.string().optional(),
  MODEL_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  MODEL_MAX_OUTPUT_TOKENS: integer(1200, 128, 8192),
  MODEL_TIMEOUT_MS: integer(30_000, 1000, 120_000),
  MODEL_PROVIDER: z.enum(["deepseek", "test"]).default("test"),
  RAINDROP_ENABLED: booleanFromEnv.default(false),
  RAINDROP_WRITE_KEY: z.string().optional(),
  RAINDROP_PROJECT_ID: z.string().optional(),
  RAINDROP_CAPTURE_CONTENT: booleanFromEnv.default(false),
  ONTO_PLATFORM_URL: z.url().optional(),
  ONTO_PLATFORM_USERNAME: z.string().optional(),
  ONTO_PLATFORM_PASSWORD: z.string().optional(),
  RULE_ENGINE_URL: z.url().optional(),
  RULE_ENGINE_USERNAME: z.string().optional(),
  RULE_ENGINE_PASSWORD: z.string().optional(),
  RULE_ENGINE_POLICY_ID: z.string().optional(),
  POLICY_RULE_ENGINE_TOOL_ENABLED: booleanFromEnv.default(true),
  MAX_AGENT_STEPS: integer(6, 1, 20),
  MAX_MODEL_CALLS: integer(2, 1, 12),
  MAX_TOOL_CALLS: integer(4, 1, 20),
  MAX_INPUT_LENGTH: integer(2000, 32, 20_000),
  MAX_INPUT_TOKENS: integer(1200, 32, 10_000),
  MAX_OUTPUT_TOKENS: integer(1400, 128, 8192),
  REQUEST_TIMEOUT_MS: integer(45_000, 1000, 180_000),
  MAX_CONCURRENT_RUNS: integer(4, 1, 32),
  MAX_QUEUE_SIZE: integer(16, 0, 200),
  SESSION_IDLE_TTL: integer(600_000, 10_000, 86_400_000),
  RETRIEVAL_TOP_K: integer(5, 1, 8),
  HOST: z.string().default("127.0.0.1"),
  PORT: integer(3001, 1024, 65_535),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ANSWER_MODE: z.enum(["agent", "direct"]).default("direct"),
  RETRIEVAL_MODE: z.enum(["bm25", "milvus", "hybrid"]).default("bm25"),
  MILVUS_ENDPOINT: z.string().default("http://localhost:19530"),
  MILVUS_COLLECTION: z.string().default("policy_chunks"),
  MILVUS_TOKEN: z.string().default("root:Milvus"),
});

export type RuntimeConfig = {
  model: {
    provider: "deepseek" | "test";
    apiKey: string | undefined;
    baseUrl: string;
    modelName: string | undefined;
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
  };
  raindrop: {
    enabled: boolean;
    writeKey: string | undefined;
    projectId: string | undefined;
    captureContent: boolean;
  };
  ontology: {
    platformUrl: string | undefined;
    username: string | undefined;
    password: string | undefined;
    ruleEngineUrl: string | undefined;
    ruleEngineUsername: string | undefined;
    ruleEnginePassword: string | undefined;
    ruleEnginePolicyId: string | undefined;
    ruleEngineToolEnabled: boolean;
  };
  budget: RuntimeBudget;
  server: { host: "127.0.0.1" | "::1"; port: number };
  logLevel: z.infer<typeof envSchema>["LOG_LEVEL"];
  answerMode: "agent" | "direct";
  retrieval: {
    mode: "bm25" | "milvus" | "hybrid";
    milvus: { endpoint: string; collection: string; token: string };
  };
};

export type RuntimeBudget = {
  maxAgentSteps: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxInputLength: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxConcurrentRuns: number;
  maxQueueSize: number;
  sessionIdleTtl: number;
  retrievalTopK: number;
};

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new PolicyAssistantError("INVALID_INPUT", "Invalid environment configuration", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  const value = parsed.data;
  if (value.HOST !== "127.0.0.1" && value.HOST !== "::1") {
    throw new PolicyAssistantError("INVALID_INPUT", "HOST must be a loopback address");
  }
  if (value.MODEL_PROVIDER === "deepseek" && (!value.DEEPSEEK_API_KEY || !value.MODEL_NAME)) {
    throw new PolicyAssistantError("INVALID_INPUT", "DeepSeek requires DEEPSEEK_API_KEY and MODEL_NAME");
  }
  return {
    model: {
      provider: value.MODEL_PROVIDER,
      apiKey: value.DEEPSEEK_API_KEY,
      baseUrl: value.DEEPSEEK_BASE_URL,
      modelName: value.MODEL_NAME,
      temperature: value.MODEL_TEMPERATURE,
      maxOutputTokens: value.MODEL_MAX_OUTPUT_TOKENS,
      timeoutMs: value.MODEL_TIMEOUT_MS,
    },
    raindrop: {
      enabled: value.RAINDROP_ENABLED,
      writeKey: value.RAINDROP_WRITE_KEY,
      projectId: value.RAINDROP_PROJECT_ID,
      captureContent: value.RAINDROP_CAPTURE_CONTENT,
    },
    ontology: {
      platformUrl: value.ONTO_PLATFORM_URL,
      username: value.ONTO_PLATFORM_USERNAME,
      password: value.ONTO_PLATFORM_PASSWORD,
      ruleEngineUrl: value.RULE_ENGINE_URL,
      ruleEngineUsername: value.RULE_ENGINE_USERNAME,
      ruleEnginePassword: value.RULE_ENGINE_PASSWORD,
      ruleEnginePolicyId: value.RULE_ENGINE_POLICY_ID,
      ruleEngineToolEnabled: value.POLICY_RULE_ENGINE_TOOL_ENABLED,
    },
    budget: {
      maxAgentSteps: value.MAX_AGENT_STEPS,
      maxModelCalls: value.MAX_MODEL_CALLS,
      maxToolCalls: value.MAX_TOOL_CALLS,
      maxInputLength: value.MAX_INPUT_LENGTH,
      maxInputTokens: value.MAX_INPUT_TOKENS,
      maxOutputTokens: value.MAX_OUTPUT_TOKENS,
      requestTimeoutMs: value.REQUEST_TIMEOUT_MS,
      maxConcurrentRuns: value.MAX_CONCURRENT_RUNS,
      maxQueueSize: value.MAX_QUEUE_SIZE,
      sessionIdleTtl: value.SESSION_IDLE_TTL,
      retrievalTopK: value.RETRIEVAL_TOP_K,
    },
    server: { host: value.HOST, port: value.PORT },
    logLevel: value.LOG_LEVEL,
    answerMode: value.ANSWER_MODE,
    retrieval: {
      mode: value.RETRIEVAL_MODE,
      milvus: {
        endpoint: value.MILVUS_ENDPOINT,
        collection: value.MILVUS_COLLECTION,
        token: value.MILVUS_TOKEN,
      },
    },
  };
}
