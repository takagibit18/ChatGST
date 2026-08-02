/**
 * MilvusRetrievalProvider - 基于 Milvus 向量检索的政策查询
 *
 * 实现 RetrievalProvider 接口, 与 BM25 PiLocalRagRetrievalProvider 对等可互换
 */
import type { EvidenceItem } from "@policy/schemas/index";
import { PolicyAssistantError } from "@policy/shared/index";
import type { Embedder } from "./embedder.js";
import { MilvusRestClient, type MilvusConfig } from "./milvus-client.js";
import type { PolicySearchResult, PolicySource, PolicyVersionResolution, RetrievalProvider, SearchPolicyInput } from "./types.js";

export class MilvusRetrievalProvider implements RetrievalProvider {
  private readonly client: MilvusRestClient;

  constructor(
    config: MilvusConfig,
    private readonly embedder: Embedder,
  ) {
    this.client = new MilvusRestClient(config);
  }

  async search(input: SearchPolicyInput): Promise<PolicySearchResult[]> {
    if (!input.query.trim() || input.query.length > 2000) {
      throw new PolicyAssistantError("INVALID_INPUT", "Search query is empty or too long");
    }
    if (input.top_k < 1 || input.top_k > 8) {
      throw new PolicyAssistantError("INVALID_INPUT", "top_k must be between 1 and 8");
    }

    // 1. 向量化查询
    const queryVector = await this.embedder.embed(input.query);

    // 2. 向量检索
    const results = await this.client.search(queryVector, input.top_k * 2);

    // 3. 构建返回结果
    //    Milvus 只返回 chunk_id 和 document_id, 需要从本地 metadata 补全
    //    因为当前实现是纯 Milvus 模式, 我们用 chunk_id 作为唯一标识
    return results.map((r) => ({
      document_id: String(r.id).split(":")[0] ?? "unknown",
      chunk_id: String(r.id),
      title: "",           // 由外部 populate
      region: "全国" as const, // 由外部 populate
      section_path: [],
      content: "",
      source_url: "unknown",
      effective_from: "unknown",
      effective_to: null,
      status: "unknown" as const,
      retrieval_score: Number(r.score.toFixed(8)),
      metadata: {
        document_id: String(r.id).split(":")[0] ?? "unknown",
        title: "",
        region: "全国",
        authority: "",
        publish_date: "unknown",
        effective_from: "unknown",
        effective_to: null,
        status: "unknown",
        source_url: "unknown",
        policy_type: "childcare-subsidy",
        version_group: "unknown",
        version_priority: 0,
      },
      line_start: 0,
      line_end: 0,
    }));
  }

  async getSource(id: string): Promise<PolicySource | null> {
    // 纯 Milvus 模式下, 需要外部 SQLite 补充 metadata
    // 这里返回占位符
    return {
      document_id: id,
      chunk_id: null,
      title: "",
      section_path: [],
      content: "",
      source_url: "unknown",
    };
  }

  async getMetadata(id: string): Promise<import("@policy/schemas/index").PolicyMetadata | null> {
    return null;
  }

  async resolvePolicyVersion(_input: {
    region: string;
    policy_type: string;
    reference_date: string;
  }): Promise<PolicyVersionResolution> {
    return { status: "not_found", policies: [] };
  }

  getStats(): { documents: number; chunks: number; vector_rows: number; retrieval_mode: string } {
    // Milvus stats 需要额外 API 调用, 这里返回占位符
    return { documents: 0, chunks: 0, vector_rows: 0, retrieval_mode: "milvus" };
  }
}
