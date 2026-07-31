/**
 * 轻量 Milvus RESTful API 客户端 (零依赖, 纯 fetch)
 *
 * Milvus 从 v2.4 起提供标准 RESTful API v2:
 *   https://milvus.io/api-reference/restful/v2.4.x/About.md
 */
import type { EvidenceItem, PolicyMetadata } from "@policy/schemas/index";

export type MilvusConfig = {
  endpoint: string;       // http://localhost:19530
  collectionName: string; // policy_chunks
  token?: string;         // default: root:Milvus
  dimension: number;      // embedding 维度 (BGE-small: 384)
  timeoutMs: number;
};

type SearchResponse = {
  code: number;
  data: Array<{
    id: string;
    distance: number;
    entity: Record<string, unknown>;
  }>;
};

function basicAuth(user: string, password: string): string {
  return Buffer.from(`${user}:${password}`).toString("base64");
}

export class MilvusRestClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: MilvusConfig) {
    this.baseUrl = config.endpoint.replace(/\/$/, "");
    const [user = "root", password = "Milvus"] = (config.token ?? "root:Milvus").split(":");
    this.authHeader = `Bearer ${basicAuth(user, password)}`;
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Authorization": this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "unknown");
      throw new Error(`Milvus API error (${response.status}): ${text.slice(0, 300)}`);
    }
    return response.json() as Promise<T>;
  }

  /** 检查 collection 是否存在 */
  async hasCollection(): Promise<boolean> {
    try {
      const result = await this.request<{ code: number }>("/v2/vectordb/collections/describe", {
        collectionName: this.config.collectionName,
      });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  /** 创建 collection */
  async createCollection(): Promise<void> {
    await this.request("/v2/vectordb/collections/create", {
      collectionName: this.config.collectionName,
      dimension: this.config.dimension,
      metricType: "COSINE",
      primaryField: "id",
      vectorField: "vector",
      autoId: false,
    });
    // 创建标量索引
    await this.request("/v2/vectordb/indexes/create", {
      collectionName: this.config.collectionName,
      indexParams: [{ fieldName: "id" }],
    });
  }

  /** 插入向量 */
  async insert(rows: Array<{ id: string; vector: number[]; document_id: string; chunk_id: string }>): Promise<void> {
    await this.request("/v2/vectordb/entities/insert", {
      collectionName: this.config.collectionName,
      data: rows.map((r) => ({
        id: r.id,
        vector: r.vector,
        document_id: r.document_id,
        chunk_id: r.chunk_id,
      })),
    });
  }

  /** 向量搜索 */
  async search(vector: number[], topK: number, filter?: string): Promise<Array<{ id: string; score: number }>> {
    const body: Record<string, unknown> = {
      collectionName: this.config.collectionName,
      data: [vector],
      limit: topK,
      outputFields: ["document_id", "chunk_id"],
    };
    if (filter) {
      body.filter = filter;
    }
    const result = await this.request<SearchResponse>("/v2/vectordb/entities/search", body);
    if (result.code !== 0 || !result.data) return [];
    return result.data.map((item) => ({
      id: String(item.id ?? ""),
      score: 1 - (item.distance ?? 0), // COSINE distance → similarity
    }));
  }

  /** 清空 collection (用于重建索引) */
  async dropCollection(): Promise<void> {
    try {
      await this.request("/v2/vectordb/collections/drop", {
        collectionName: this.config.collectionName,
      });
    } catch {
      // 不存在则忽略
    }
  }

  /** 获取统计信息 */
  async stats(): Promise<{ rowCount: number }> {
    try {
      const result = await this.request<{ code: number; data: { rowCount: number } }>("/v2/vectordb/collections/describe", {
        collectionName: this.config.collectionName,
      });
      return { rowCount: result.code === 0 ? (result.data?.rowCount ?? 0) : 0 };
    } catch {
      return { rowCount: 0 };
    }
  }
}
