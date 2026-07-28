/**
 * 嵌入模型接口 + 本地 BGE 实现
 *
 * 默认使用 @xenova/transformers (已存在於依賴樹中)
 * 後續可擴展為遠程 embedding API
 */

export interface Embedder {
  /** 单文本嵌入 */
  embed(text: string): Promise<number[]>;
  /** 批量嵌入 */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** 向量维度 */
  readonly dimension: number;
  /** 是否已加载 */
  readonly ready: boolean;
  /** 初始化 */
  initialize(): Promise<void>;
}

/**
 * 本地 BGE-small-zh 嵌入器
 * 使用 @xenova/transformers (ONNX runtime)
 * 首次加载会下载模型 (~45MB)，后续缓存
 */
export class LocalEmbedder implements Embedder {
  private pipeline: unknown = null;
  private _ready = false;
  readonly dimension = 384;
  private initPromise: Promise<void> | null = null;

  get ready(): boolean {
    return this._ready;
  }

  async initialize(): Promise<void> {
    if (this._ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // 动态 import, 避免在 test 模式下强制加载
        const { pipeline } = await import("@xenova/transformers");
        this.pipeline = await pipeline("feature-extraction", "Xenova/bge-small-zh-v1.5");
        this._ready = true;
      } catch (err) {
        process.stderr.write(`[embedder] local model load failed: ${String(err).slice(0, 200)}\n`);
        // 不抛出异常, 后续 embed 会报错
      }
    })();
    return this.initPromise;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.pipeline) throw new Error("Embedder not initialized");
    const pipe = this.pipeline as (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;
    const result = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(result.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.pipeline) throw new Error("Embedder not initialized");
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

/**
 * 空嵌入器 - test 模式 / Milvus 不可用时使用
 * 返回零向量, 不做语义检索
 */
export class NoopEmbedder implements Embedder {
  readonly dimension = 384;
  readonly ready = true;
  async initialize(): Promise<void> {}
  async embed(_text: string): Promise<number[]> {
    return new Array(this.dimension).fill(0);
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimension).fill(0));
  }
}
