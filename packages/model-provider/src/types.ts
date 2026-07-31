import type { Api, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { PolicyIntent } from "@policy/schemas/index";

export type QueryRewriteResult = { query: string; intent: PolicyIntent };

export type ModelCapabilities = {
  toolCalling: boolean;
  structuredOutput: boolean;
  jsonRepair: boolean;
  streaming: boolean;
  reasoningVisible: false;
};

export interface ModelProvider {
  readonly providerName: string;
  readonly modelName: string;
  createModel(): Model<Api>;
  createStreamFunction(): StreamFn;
  getCapabilities(): ModelCapabilities;
  normalizeToolCall(input: unknown): unknown;
  normalizeResponse(input: unknown): unknown;
  /** Rewrite a citizen's vague query into precise policy search keywords. Returns the original text if unsupported. */
  rewriteQuery(input: { query: string; region: string; intent: PolicyIntent }): Promise<QueryRewriteResult>;
  /** Re-rank BM25 candidates by LLM relevance scoring. Returns sorted indices (most relevant first). */
  rerankCandidates(input: { query: string; candidates: Array<{ index: number; content: string; title: string; section: string }> }): Promise<number[]>;
  /** Generate a structured JSON answer directly (no agent loop, no tool calling). */
  generateStructuredAnswer(input: {
    systemPrompt: string;
    userQuery: string;
    evidenceJson: string;
    schemaDescription: string;
  }): Promise<string>;
}

