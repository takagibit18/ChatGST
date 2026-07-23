import {
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type FauxResponseStep,
  type Model,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { extractJsonText, normalizeToolArguments } from "./normalization.js";
import type { ModelCapabilities, ModelProvider } from "./types.js";

export class TestModelProvider implements ModelProvider {
  readonly providerName = "test";
  readonly modelName = "policy-test-model";
  private readonly faux = fauxProvider({
    provider: "policy-test",
    api: "policy-test-api",
    models: [{ id: this.modelName, name: "Deterministic policy test model", maxTokens: 4096 }],
    tokensPerSecond: 100_000,
    tokenSize: { min: 128, max: 512 },
  });

  constructor(responses: FauxResponseStep[] = [fauxAssistantMessage("{}")]) {
    this.faux.setResponses(responses);
  }

  setResponses(responses: FauxResponseStep[]): void {
    this.faux.setResponses(responses);
  }

  setTextResponses(responses: string[]): void {
    this.faux.setResponses(responses.map((response) => fauxAssistantMessage(response)));
  }

  createModel(): Model<Api> {
    return this.faux.getModel();
  }

  createStreamFunction(): StreamFn {
    return this.faux.provider.streamSimple as StreamFn;
  }

  getCapabilities(): ModelCapabilities {
    return {
      toolCalling: true,
      structuredOutput: true,
      jsonRepair: true,
      streaming: true,
      reasoningVisible: false,
    };
  }

  normalizeToolCall(input: unknown): unknown {
    return normalizeToolArguments(input);
  }

  normalizeResponse(input: unknown): unknown {
    return extractJsonText(input);
  }
}
