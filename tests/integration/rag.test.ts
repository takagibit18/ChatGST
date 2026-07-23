import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPolicyIndex,
  ChinesePolicySearchTextProcessor,
  defaultKnowledgeLocations,
  loadPolicyDocuments,
  PiLocalRagRetrievalProvider,
  SemanticPolicyChunker,
} from "@policy/rag/index";
import { createPolicyToolRegistry, type RuntimeUsage } from "@policy/tools/index";

const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));

describe("pi-local-rag pure BM25 policy adapter", () => {
  it("has indexed real Beijing/Hebei Markdown without vectors", () => {
    const stats = provider.getStats();
    expect(stats.documents).toBe(6);
    expect(stats.chunks).toBeGreaterThan(30);
    expect(stats.vector_rows).toBe(0);
    expect(stats.retrieval_mode).toBe("bm25-only");
  });

  it.each([
    ["北京育儿补贴多少钱", "北京市", /3600|300/u],
    ["河北谁有申请资格", "河北省", /3\s*周岁|补贴对象|生育/u],
    ["河北补贴什么时候发放", "河北省", /2\s*月|5\s*月|8\s*月|11\s*月/u],
    ["北京首次申请截止时间", "北京市", /2026\s*年\s*12\s*月\s*31\s*日/u],
    ["户口迁到河北还能申请吗", "河北省", /迁入|重复申领/u],
    ["育儿补贴和生育津贴有什么区别", "对比", /生育津贴|生育保险/u],
  ] as const)("retrieves Chinese policy evidence for %s", async (query, region, expectedText) => {
    const hits = await provider.search({ query, region, effective_date: "2026-07-23", top_k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((hit) => hit.content).join("\n")).toMatch(expectedText);
    expect(hits.every((hit) => region === "对比" || hit.region === region || hit.region === "全国")).toBe(true);
  });

  it("filters policies that were not effective on the reference date", async () => {
    const hits = await provider.search({ query: "北京育儿补贴金额", region: "北京市", effective_date: "2024-01-01", top_k: 5 });
    expect(hits).toEqual([]);
  });

  it("uses content hashes for an unchanged incremental rebuild", async () => {
    const documents = await loadPolicyDocuments(defaultKnowledgeLocations());
    const report = await buildPolicyIndex({
      indexDir: resolve("knowledge/index"),
      documents,
      chunker: new SemanticPolicyChunker(),
      textProcessor: new ChinesePolicySearchTextProcessor(),
      rebuild: false,
    });
    expect(report.documents_indexed).toBe(0);
    expect(report.documents_unchanged).toBe(documents.length);
    expect(report.vector_rows).toBe(0);
  });

  it("chunks by Markdown policy structure and preserves source locations", async () => {
    const documents = await loadPolicyDocuments(defaultKnowledgeLocations());
    const hebei = documents.find((document) => document.metadata.document_id === "hebei-implementation-rules-2026");
    expect(hebei).toBeDefined();
    const chunks = new SemanticPolicyChunker().chunk(hebei!);
    expect(chunks.some((chunk) => chunk.section_path.some((item) => item.includes("第六条")))).toBe(true);
    expect(chunks.every((chunk) => chunk.line_start > 0 && chunk.line_end >= chunk.line_start)).toBe(true);
  });

  it("never exposes indexing, SQL, URL, or path tools to the Agent", async () => {
    const registry = createPolicyToolRegistry(provider);
    expect(registry.names()).toEqual([
      "search_policy",
      "get_policy_source",
      "get_policy_metadata",
      "resolve_policy_version",
      "calculate_date_interval",
    ]);
    expect(registry.names()).not.toEqual(expect.arrayContaining(["rag_index", "rag_clear", "bash", "read", "write"]));
    const usage: RuntimeUsage = { agentSteps: 0, modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, startedAt: 0 };
    await expect(
      registry.execute("get_policy_source", { document_id: "C:\\secret.md" }, {
        requestId: "request",
        conversationId: "conversation",
        effectiveDate: "2026-07-23",
        usage,
        maxToolCalls: 4,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
