import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PiLocalRagRetrievalProvider } from "@policy/rag/index";
import { createDeterministicTestResponse } from "@policy/runtime/index";
import { loadEvalCases, normalizedEvalQuery, retrieveForEval } from "./eval-common.js";

const outputPath = resolve("domains/childcare-subsidy/evals/goldens.generated.json");
const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
const cases = await loadEvalCases();
const records = [];
for (const item of cases) {
  const query = normalizedEvalQuery(item);
  const { pack } = await retrieveForEval(provider, query);
  const response = pack.evidence.length > 0 ? createDeterministicTestResponse(pack) : null;
  records.push({
    id: item.id,
    question: item.question,
    generated_answer: response,
    evidence: pack.evidence.map((evidence) => ({
      document_id: evidence.document_id,
      chunk_id: evidence.chunk_id,
      title: evidence.title,
      section_path: evidence.section_path,
      source_url: evidence.source_url,
      content: evidence.content,
    })),
    generation_model: "TestModelProvider/policy-test-model",
    review_status: "pending_review",
    reviewer_notes: null,
  });
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ generated_at: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputPath, records: records.length, review_status: "pending_review" }, null, 2));
