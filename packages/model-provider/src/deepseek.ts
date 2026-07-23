import {
  createProvider,
  envApiKeyAuth,
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { extractJsonText, normalizeToolArguments } from "./normalization.js";
import type { ModelCapabilities, ModelProvider } from "./types.js";

export type DeepSeekProviderOptions = {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
};

export class DeepSeekModelProvider implements ModelProvider {
  readonly providerName = "deepseek";
  readonly modelName: string;
  private readonly model: Model<"openai-completions">;
  private readonly provider;

  constructor(private readonly options: DeepSeekProviderOptions) {
    this.modelName = options.modelName;
    this.model = {
      id: options.modelName,
      name: options.modelName,
      api: "openai-completions",
      provider: this.providerName,
      baseUrl: options.baseUrl.replace(/\/$/u, ""),
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_384,
      maxTokens: options.maxOutputTokens,
    };
    this.provider = createProvider<"openai-completions">({
      id: this.providerName,
      name: "DeepSeek",
      baseUrl: this.model.baseUrl,
      auth: { apiKey: envApiKeyAuth("DeepSeek API key", ["DEEPSEEK_API_KEY"]) },
      models: [this.model],
      api: { stream, streamSimple },
    });
  }

  createModel(): Model<Api> {
    return this.model;
  }

  createStreamFunction(): StreamFn {
    return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
      this.provider.streamSimple(model as Model<"openai-completions">, context, {
        ...options,
        apiKey: this.options.apiKey,
        temperature: this.options.temperature,
        maxTokens: this.options.maxOutputTokens,
        timeoutMs: this.options.timeoutMs,
        maxRetries: 1,
      });
  }

  getCapabilities(): ModelCapabilities {
    return {
      toolCalling: true,
      structuredOutput: false,
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
