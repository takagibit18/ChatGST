/**
 * HybridRetrievalProvider - BM25 召回 + 向量重排
 *
 * 混合检索策略:
 *   1. BM25 (PiLocalRag) 召回 Top-K × 2 候选
 *   2. Milvus 向量检索 Top-K × 2 候选
 *   3. 合并去重, 按 BM25 score + 向量 similarity 加权排序
 *   4. 返回 Top-K
 *
 * 实现 RetrievalProvider 接口, 对外透明
 */
import type { PolicyMetadata } from "@policy/schemas/index";
import { PolicyAssistantError } from "@policy/shared/index";
import { MilvusRestClient, type MilvusConfig } from "./milvus-client.js";
import type { Embedder } from "./embedder.js";
import type { PolicySearchResult, PolicySource, PolicyVersionResolution, RetrievalProvider, SearchPolicyInput } from "./types.js";
import type { PiLocalRagRetrievalProvider } from "./provider.js";

export type HybridConfig = {
  bm25Weight: number;   // BM25 权重, 默认 0.3
  vectorWeight: number;  // 向量权重, 默认 0.7
};

export class HybridRetrievalProvider implements RetrievalProvider {
  private readonly milvusClient: MilvusRestClient;

  constructor(
    private readonly bm25Provider: PiLocalRagRetrievalProvider,
    milvusConfig: MilvusConfig,
    private readonly embedder: Embedder,
    private readonly hybrid: HybridConfig = { bm25Weight: 0.3, vectorWeight: 0.7 },
  ) {
    this.milvusClient = new MilvusRestClient(milvusConfig);
  }

  async search(input: SearchPolicyInput): Promise<PolicySearchResult[]> {
    if (!input.query.trim() || input.query.length > 2000) {
      throw new PolicyAssistantError("INVALID_INPUT", "Search query is empty or too long");
    }
    if (input.top_k < 1 || input.top_k > 8) {
      throw new PolicyAssistantError("INVALID_INPUT", "top_k must be between 1 and 8");
    }

    // 并行: BM25 + 向量检索
    const expandedTopK = input.top_k * 2;
    const [bm25Results, queryVector] = await Promise.all([
      this.bm25Provider.search({ ...input, top_k: expandedTopK }).catch(() => [] as PolicySearchResult[]),
      this.embedder.embed(input.query).catch(() => null as number[] | null),
    ]);

    let vectorResults: Array<{ chunkId: string; score: number }> = [];
    if (queryVector) {
      try {
        const raw = await this.milvusClient.search(queryVector, expandedTopK);
        vectorResults = raw.map((r) => ({ chunkId: String(r.id), score: r.score }));
      } catch {
        // Milvus 不可用 → 降级为纯 BM25
        process.stderr.write("[hybrid] Milvus unavailable, falling back to BM25-only\n");
      }
    }

    // 合并分数
    const scoreMap = new Map<string, { bm25: number; vector: number }>();
    for (const hit of bm25Results) {
      const entry = scoreMap.get(hit.chunk_id) ?? { bm25: 0, vector: 0 };
      entry.bm25 = Math.max(entry.bm25, hit.retrieval_score);
      scoreMap.set(hit.chunk_id, entry);
    }
    for (const v of vectorResults) {
      const entry = scoreMap.get(v.chunkId) ?? { bm25: 0, vector: 0 };
      entry.vector = Math.max(entry.vector, v.score);
      scoreMap.set(v.chunkId, entry);
    }

    // 加权归一化 (min-max 归一化后加权)
    const entries = [...scoreMap.entries()];
    const bm25Max = Math.max(...entries.map(([, v]) => v.bm25), 0.001);
    const vectorMax = Math.max(...entries.map(([, v]) => v.vector), 0.001);

    const merged = entries.map(([chunkId, scores]) => ({
      chunkId,
      combined: (scores.bm25 / bm25Max) * this.hybrid.bm25Weight +
                (scores.vector / vectorMax) * this.hybrid.vectorWeight,
    }));

    // 按组合分数排序
    merged.sort((a, b) => b.combined - a.combined);

    // 用 BM25 结果补全 metadata (Milvus 只返回 chunk_id)
    const bm25Map = new Map(bm25Results.map((h) => [h.chunk_id, h]));
    return merged.slice(0, input.top_k).map((m) => {
      const hit = bm25Map.get(m.chunkId);
      if (hit) return { ...hit, retrieval_score: Number(m.combined.toFixed(8)) };
      // 纯向量命中的 (BM25 没召回但向量相似度高的)
      return {
        document_id: m.chunkId.split(":")[0] ?? "unknown",
        chunk_id: m.chunkId,
        title: "",
        region: "全国",
        section_path: [],
        content: "",
        source_url: "unknown",
        effective_from: "unknown",
        effective_to: null,
        status: "unknown" as const,
        retrieval_score: Number(m.combined.toFixed(8)),
        metadata: {} as PolicyMetadata,
        line_start: 0,
        line_end: 0,
      } satisfies PolicySearchResult;
    });
  }

  async getSource(id: string): Promise<PolicySource | null> {
    return this.bm25Provider.getSource(id);
  }

  async getMetadata(id: string): Promise<PolicyMetadata | null> {
    return this.bm25Provider.getMetadata(id);
  }

  async resolvePolicyVersion(input: {
    region: "北京市" | "河北省";
    policy_type: string;
    reference_date: string;
  }): Promise<PolicyVersionResolution> {
    return this.bm25Provider.resolvePolicyVersion(input);
  }

  getStats(): { documents: number; chunks: number; vector_rows: number; retrieval_mode: string } {
    const bm25Stats = this.bm25Provider.getStats();
    return { ...bm25Stats, retrieval_mode: "hybrid" };
  }
}
