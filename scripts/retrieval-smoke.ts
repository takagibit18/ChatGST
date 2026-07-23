import { resolve } from "node:path";
import { PiLocalRagRetrievalProvider } from "@policy/rag/index";

const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
const cases = [
  { query: "北京育儿补贴多少钱", region: "北京市" as const },
  { query: "河北谁有申请资格", region: "河北省" as const },
  { query: "河北补贴什么时候发放", region: "河北省" as const },
  { query: "北京首次申请截止时间", region: "北京市" as const },
  { query: "户口迁到河北还能申请吗", region: "河北省" as const },
  { query: "育儿补贴和生育津贴有什么区别", region: "对比" as const },
];

const results = [];
for (const item of cases) {
  const hits = await provider.search({ ...item, effective_date: "2026-07-23", top_k: 5 });
  results.push({
    ...item,
    hit_count: hits.length,
    top: hits.slice(0, 3).map((hit) => ({
      document_id: hit.document_id,
      chunk_id: hit.chunk_id,
      region: hit.region,
      section_path: hit.section_path,
      score: hit.retrieval_score,
      preview: hit.content.slice(0, 80),
    })),
  });
}
console.log(JSON.stringify({ stats: provider.getStats(), cases: results }, null, 2));

