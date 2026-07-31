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
import { policyIntentSchema, type PolicyIntent } from "@policy/schemas/index";
import { z } from "zod";
import { extractJsonText, normalizeToolArguments, parseJsonWithSingleRepair } from "./normalization.js";
import type { ModelCapabilities, ModelProvider, QueryRewriteResult } from "./types.js";

const queryRewriteSchema = z.object({
  query: z.string().trim().min(1).max(200),
  intent: policyIntentSchema,
}).strict();

export function parseQueryRewriteResult(input: unknown, fallback: QueryRewriteResult): QueryRewriteResult {
  try {
    const parsed = queryRewriteSchema.safeParse(parseJsonWithSingleRepair(input).value);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

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
      reasoning: true,
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
        // DeepSeek V4 Flash defaults to reasoning mode; explicitly disable it
        // so the model writes answers to content instead of reasoning_content.
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

  private async chatCompletion(
    tag: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ content: string; reasoning: string; status: number; ms: number }> {
    const maxAttempts = 3;
    let lastErr = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const fetchStart = Date.now();
      try {
        const response = await fetch(`${this.options.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const json = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> } | null;
        const content = json?.choices?.[0]?.message?.content?.trim() ?? "";
        const reasoning = json?.choices?.[0]?.message?.reasoning_content?.trim() ?? "";
        const ms = Date.now() - fetchStart;
        process.stderr.write(`[${tag}] attempt=${attempt}/${maxAttempts} status=${response.status} ms=${ms} content_len=${content.length} reasoning_len=${reasoning.length}\n`);
        return { content, reasoning, status: response.status, ms };
      } catch (err) {
        lastErr = String(err).slice(0, 150);
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          process.stderr.write(`[${tag}] attempt=${attempt} failed (${lastErr}), retrying in ${delay}ms...\n`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    process.stderr.write(`[${tag}] all ${maxAttempts} attempts failed: ${lastErr}\n`);
    return { content: "", reasoning: "", status: 0, ms: 0 };
  }

  async rewriteQuery(input: { query: string; region: string; intent: PolicyIntent }): Promise<QueryRewriteResult> {
    const result = await this.chatCompletion("rewrite", {
      model: this.options.modelName,
      messages: [{ role: "user", content: [
        "理解这条群众政策咨询，将其改写成适合检索政策原文的简短关键词，并识别咨询意图。",
        "只输出 JSON：{\"query\":\"空格分隔的检索关键词\",\"intent\":\"意图\"}。不要输出解释。",
        "意图只能是 amount、eligibility、claimant、materials、channel、deadline、payment、comparison、migration、distinction、overview、unknown。",
        "不得猜测用户没有提供的地区、户籍、年龄、身份或其他资格事实。query 不超过 50 个汉字。",
        "",
        `Query: "${input.query}"`,
        `Region: ${input.region}`,
        `Intent: ${input.intent}`,
      ].join("\n") }],
      max_tokens: 60,
      temperature: 0,
      thinking: { type: "disabled" },
    }, 20_000);
    const text = result.content || result.reasoning;
    if (!result.content && result.reasoning) {
      process.stderr.write(`[rewrite-warn] content empty, reasoning present - V4 Flash returned reasoning instead of content\n`);
    }
    if (!text) return { query: input.query, intent: input.intent };
    const fallback = { query: input.query, intent: input.intent };
    const parsed = parseQueryRewriteResult(text, fallback);
    if (parsed === fallback) process.stderr.write("[rewrite-warn] invalid structured rewrite, using original query\n");
    return parsed;
  }

  async rerankCandidates(input: { query: string; candidates: Array<{ index: number; content: string; title: string; section: string }> }): Promise<number[]> {
    if (input.candidates.length <= 3) return input.candidates.map((_, i) => i);
    const blocks = input.candidates.map((c, i) =>
      `[${i}] ${c.title} | ${c.section} | ${c.content.slice(0, 200)}`
    ).join("\n");
    const result = await this.chatCompletion("rerank", {
      model: this.options.modelName,
      messages: [{ role: "user", content: [
        "Rank these policy chunks by relevance to the query.",
        "Output ONLY a JSON array of indices, most relevant first. No other text.",
        `Query: ${input.query}`,
        "",
        "Chunks:",
        blocks,
      ].join("\n") }],
      max_tokens: 80,
      temperature: 0,
      thinking: { type: "disabled" },
    }, 20_000);
    const text = result.content || result.reasoning;
    if (!text) return input.candidates.map((_, i) => i);
    try {
      const indices = JSON.parse(text) as number[];
      if (Array.isArray(indices) && indices.every((v) => typeof v === "number" && v >= 0 && v < input.candidates.length)) {
        process.stderr.write(`[rerank-llm] BM25=[${input.candidates.map((_,i)=>i).join(",")}] LLM=[${indices.join(",")}]\n`);
        return indices;
      }
    } catch { /* fall through */ }
    return input.candidates.map((_, i) => i);
  }

  async generateStructuredAnswer(input: {
    systemPrompt: string;
    userQuery: string;
    evidenceJson: string;
    schemaDescription: string;
  }): Promise<string> {
    const result = await this.chatCompletion("direct-gen", {
      model: this.options.modelName,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: [
          `用户问题: ${input.userQuery}`,
          "",
          "你必须输出一个 JSON 对象。不要输出 markdown 围栏、HTML 标签或任何解释文字。只输出 JSON。",
          "JSON 结构要求:",
          input.schemaDescription,
          "",
          "检索到的政策依据 (Evidence):",
          input.evidenceJson,
        ].join("\n") },
      ],
      max_tokens: this.options.maxOutputTokens,
      temperature: this.options.temperature,
      thinking: { type: "disabled" },
    }, this.options.timeoutMs);
    if (result.content) return result.content;
    if (result.reasoning) {
      process.stderr.write(`[direct-gen-warn] using reasoning_content as answer\n`);
      return result.reasoning;
    }
    return "";
  }
}
