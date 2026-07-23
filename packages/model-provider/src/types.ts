import type { Api, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

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
}

