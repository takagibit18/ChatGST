import { ArrowSquareOut, Books, CircleNotch, FileText, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";

type PolicyMetadata = {
  document_id: string;
  title: string;
  region: string;
  authority: string;
  publish_date: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  source_url: string;
};

type DocumentSummary = {
  metadata: PolicyMetadata;
  source_format: "markdown" | "text" | "html" | "pdf" | "docx";
  chunks: number;
  characters: number;
  extraction_warnings: string[];
  indexed_at: string;
};

type DocumentDetail = DocumentSummary & {
  sections: Array<{
    chunk_id: string;
    ordinal: number;
    section_path: string[];
    content: string;
    line_start: number;
    line_end: number;
  }>;
};

type SearchHit = {
  document_id: string;
  chunk_id: string;
  title: string;
  region: string;
  section_path: string[];
  content: string;
  retrieval_score: number;
};

const formatLabels: Record<DocumentSummary["source_format"], string> = {
  markdown: "Markdown",
  text: "TXT",
  html: "HTML",
  pdf: "PDF",
  docx: "DOCX",
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("知识库请求失败");
  return await response.json() as T;
}

export function KnowledgeBrowser() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [region, setRegion] = useState("全部");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDocument = async (documentId: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await readJson<{ document: DocumentDetail }>(
        await fetch(`/api/knowledge/documents/${encodeURIComponent(documentId)}`),
      );
      setDetail(payload.document);
    } catch {
      setError("无法读取这份政策材料，请确认本地索引已经构建。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (region !== "全部") params.set("region", region);
        const payload = await readJson<{ documents: DocumentSummary[] }>(
          await fetch(`/api/knowledge/documents?${params.toString()}`),
        );
        if (disposed) return;
        setDocuments(payload.documents);
        setHits([]);
        if (!detail || !payload.documents.some((item) => item.metadata.document_id === detail.metadata.document_id)) {
          const first = payload.documents[0];
          if (first) void loadDocument(first.metadata.document_id);
          else setDetail(null);
        }
      } catch {
        if (!disposed) setError("知识库目录加载失败，请先运行 pnpm rag:build。");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => { disposed = true; };
  }, [region]);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = query.trim();
    if (!clean) {
      setHits([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: clean, region: region === "全部" || region === "全国" ? "对比" : region });
      const payload = await readJson<{ results: SearchHit[] }>(await fetch(`/api/knowledge/search?${params.toString()}`));
      setHits(payload.results);
    } catch {
      setError("没有完成本次全文检索，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const visibleItems = hits.length > 0
    ? hits.map((hit) => ({
        id: hit.chunk_id,
        documentId: hit.document_id,
        title: hit.title,
        region: hit.region,
        description: hit.content.slice(0, 96),
        label: hit.section_path.at(-1) ?? "正文片段",
      }))
    : documents.map((document) => ({
        id: document.metadata.document_id,
        documentId: document.metadata.document_id,
        title: document.metadata.title,
        region: document.metadata.region,
        description: `${document.metadata.authority} · ${document.metadata.publish_date}`,
        label: `${formatLabels[document.source_format]} · ${document.chunks} 个片段`,
      }));

  return (
    <section className="grid min-h-[calc(100dvh-4rem)] flex-1 overflow-hidden bg-surface sm:min-h-0 sm:rounded-2xl sm:border sm:shadow-[0_16px_50px_rgba(24,60,47,0.08)] lg:grid-cols-[20rem_1fr]">
      <aside className="flex min-h-0 flex-col border-b bg-surface-strong lg:border-b-0 lg:border-r">
        <div className="space-y-3 border-b p-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><Books aria-hidden size={19} weight="duotone" />政策知识库</h2>
            <p className="mt-1 text-xs text-muted-foreground">统一抽取、切片和可追溯全文检索</p>
          </div>
          <form className="flex gap-2" onSubmit={search}>
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] border bg-surface px-3 focus-within:ring-3 focus-within:ring-ring/20">
              <MagnifyingGlass aria-hidden className="shrink-0 text-muted-foreground" size={16} />
              <span className="sr-only">检索政策正文</span>
              <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" maxLength={1000} onChange={(event) => setQuery(event.target.value)} placeholder="检索正文" value={query} />
            </label>
            <Button aria-label="检索" disabled={loading} size="icon" type="submit"><MagnifyingGlass aria-hidden size={17} /></Button>
          </form>
          <select className="h-9 w-full rounded-[10px] border bg-surface px-3 text-sm" onChange={(event) => setRegion(event.target.value)} value={region}>
            <option>全部</option><option>北京市</option><option>河北省</option><option>全国</option>
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && visibleItems.length === 0 ? <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><CircleNotch className="animate-spin" />正在读取索引</div> : null}
          {visibleItems.map((item) => (
            <button className="mb-1 w-full rounded-xl px-3 py-3 text-left hover:bg-muted" key={item.id} onClick={() => void loadDocument(item.documentId)} type="button">
              <div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs font-medium text-primary">{item.region}</span><span className="text-[11px] text-muted-foreground">{item.label}</span></div>
              <div className="line-clamp-2 text-sm font-semibold">{item.title}</div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
            </button>
          ))}
          {!loading && visibleItems.length === 0 ? <p className="p-4 text-sm text-muted-foreground">没有匹配的政策材料。</p> : null}
        </div>
      </aside>

      <article className="min-h-0 overflow-y-auto">
        {error ? <div className="m-5 flex gap-2 rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger"><WarningCircle className="shrink-0" size={18} />{error}</div> : null}
        {detail ? (
          <div className="mx-auto max-w-3xl p-5 sm:p-8">
            <div className="border-b pb-6">
              <div className="mb-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">{detail.metadata.region}</span><span className="rounded-full bg-muted px-2.5 py-1">{formatLabels[detail.source_format]}</span><span className="rounded-full bg-muted px-2.5 py-1">{detail.chunks} 个语义片段</span></div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">{detail.metadata.title}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{detail.metadata.authority} · 发布于 {detail.metadata.publish_date} · 生效于 {detail.metadata.effective_from}</p>
              {detail.metadata.source_url !== "unknown" ? <a className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium" href={detail.metadata.source_url} rel="noreferrer" target="_blank">查看官方来源<ArrowSquareOut aria-hidden size={15} /></a> : null}
            </div>
            <div className="divide-y">
              {detail.sections.map((section) => (
                <section className="py-6" key={section.chunk_id}>
                  <div className="mb-3 flex items-center justify-between gap-4 text-xs text-muted-foreground"><span>{section.section_path.join(" / ") || "正文"}</span><span className="shrink-0">L{section.line_start}–{section.line_end}</span></div>
                  <MessageResponse className="text-sm leading-7">{section.content}</MessageResponse>
                </section>
              ))}
            </div>
          </div>
        ) : !loading ? <div className="grid h-full place-items-center p-8 text-center text-muted-foreground"><div><FileText className="mx-auto mb-3" size={32} /><p>选择一份政策材料查看正文与来源定位。</p></div></div> : null}
      </article>
    </section>
  );
}
