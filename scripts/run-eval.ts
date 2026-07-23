import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { policyResponseSchema, type EvidencePack, type PolicyResponse } from "@policy/schemas/index";
import { PiLocalRagRetrievalProvider } from "@policy/rag/index";
import { createDefaultPolicyRuntime, createDeterministicTestResponse } from "@policy/runtime/index";
import { loadRuntimeConfig } from "@policy/shared/index";
import { validatePolicyBusiness, deterministicSafeResponse } from "@policy/validators/index";
import { loadEvalCases, normalizedEvalQuery, retrieveForEval, type EvalCase } from "./eval-common.js";

type Mode = "A" | "B" | "C" | "D";
type CaseResult = {
  id: string;
  retrieval_recall: number;
  reciprocal_rank: number;
  region_correct: boolean;
  intent_correct: boolean;
  citation_correct: boolean;
  sources_legal: boolean;
  factual_consistency: boolean;
  unsupported_answer: boolean;
  schema_pass: boolean;
  business_validator_pass: boolean;
  model_calls: number;
  tool_calls: number;
  tokens: number;
  latency_ms: number;
  answer_status: string;
};

const config = loadRuntimeConfig({ ...process.env, MODEL_PROVIDER: "test", RAINDROP_ENABLED: "false", RAINDROP_CAPTURE_CONTENT: "false" });
const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
const cases = await loadEvalCases();
const modeFlag = process.argv.indexOf("--mode");
const requested = modeFlag >= 0 ? process.argv[modeFlag + 1]?.toUpperCase() : "D";
const modes: Mode[] = process.argv.includes("--all") ? ["A", "B", "C", "D"] : [requested as Mode];
if (modes.some((mode) => !["A", "B", "C", "D"].includes(mode))) throw new Error("--mode must be A, B, C, or D");
const outputFlag = process.argv.indexOf("--output");
const outputPath = resolve(outputFlag >= 0 ? (process.argv[outputFlag + 1] ?? "domains/childcare-subsidy/evals/latest-report.json") : "domains/childcare-subsidy/evals/latest-report.json");

function noInfrastructureResponse(): PolicyResponse {
  return {
    answer_markdown: "暂时无法回答该问题。",
    collapsibles: [],
    actions: [],
    sources: [],
    clarification: null,
    meta: { intent: "unknown", region: null, answer_status: "insufficient_evidence" },
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function p95(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

async function evaluateCase(mode: Mode, item: EvalCase, index: number): Promise<CaseResult> {
  const started = performance.now();
  const query = normalizedEvalQuery(item);
  const retrieved = mode === "A" || mode === "B" ? { hits: [], pack: {
    query_context: { region: query.region, intent: query.intent, effective_date: "2026-07-23", confirmed_slots: query.confirmedSlots, missing_slots: query.missingSlots },
    policy_versions: [], evidence: [], knowledge_gaps: ["消融模式未启用检索"],
  } satisfies EvidencePack } : await retrieveForEval(provider, query);
  let response: PolicyResponse;
  let modelCalls = 0;
  let toolCalls = 0;
  let tokens = 0;
  let evaluationPack = retrieved.pack;
  let hitDocuments = retrieved.hits.map((hit) => hit.document_id);
  if (mode === "A") response = noInfrastructureResponse();
  else if (mode === "B") response = deterministicSafeResponse(retrieved.pack);
  else if (mode === "C") response = retrieved.pack.evidence.length ? createDeterministicTestResponse(retrieved.pack) : deterministicSafeResponse(retrieved.pack);
  else {
    const runtime = createDefaultPolicyRuntime(config).runtime;
    const result = await runtime.answer({ conversationId: `eval-${index.toString().padStart(3, "0")}-${item.id}`, message: item.question, effectiveDate: "2026-07-23" });
    response = result.response;
    evaluationPack = result.evidencePack;
    hitDocuments = result.evidencePack.evidence.map((evidence) => evidence.document_id);
    modelCalls = result.usage.modelCalls;
    toolCalls = result.usage.toolCalls;
    tokens = result.usage.inputTokens + result.usage.outputTokens;
  }
  const relevantRanks = item.relevant_documents.map((document) => hitDocuments.indexOf(document)).filter((rank) => rank >= 0);
  const retrievalRecall = item.relevant_documents.length === 0
    ? 1
    : new Set(hitDocuments.filter((document) => item.relevant_documents.includes(document))).size / new Set(item.relevant_documents).size;
  const evidenceDocuments = new Set(evaluationPack.evidence.map((item) => item.document_id));
  const citationCorrect = response.sources.every((source) => evidenceDocuments.has(source.document_id));
  const sourcesLegal = response.sources.every((source) => /^https?:\/\//u.test(source.url) && evidenceDocuments.has(source.document_id));
  const visible = `${response.answer_markdown}\n${response.collapsibles.map((item) => item.content_markdown).join("\n")}`.replace(/\s+/gu, "");
  const factualConsistency = item.expected_terms.length === 0 || item.expected_terms.every((term) => visible.includes(term.replace(/\s+/gu, "")));
  return {
    id: item.id,
    retrieval_recall: retrievalRecall,
    reciprocal_rank: relevantRanks.length ? 1 / (Math.min(...relevantRanks) + 1) : item.relevant_documents.length === 0 ? 1 : 0,
    region_correct: query.region === item.expected_region,
    intent_correct: query.intent === item.expected_intent,
    citation_correct: citationCorrect,
    sources_legal: sourcesLegal,
    factual_consistency: factualConsistency,
    unsupported_answer: evaluationPack.evidence.length === 0 && response.meta.answer_status === "answered",
    schema_pass: policyResponseSchema.safeParse(response).success,
    business_validator_pass: validatePolicyBusiness(response, evaluationPack).length === 0,
    model_calls: modelCalls,
    tool_calls: toolCalls,
    tokens,
    latency_ms: Number((performance.now() - started).toFixed(2)),
    answer_status: response.meta.answer_status,
  };
}

const reports: Record<string, unknown> = {};
for (const mode of modes) {
  const results: CaseResult[] = [];
  for (const [index, item] of cases.entries()) results.push(await evaluateCase(mode, item, index));
  const retrievalResults = results.filter((_result, index) => (cases[index]?.relevant_documents.length ?? 0) > 0);
  reports[mode] = {
    label: { A: "无 Skill、无检索", B: "Skill only", C: "Skill + pi-local-rag BM25", D: "Skill + pi-local-rag BM25 + Validator" }[mode],
    metrics: {
      retrieval_recall_at_5: mean(retrievalResults.map((result) => result.retrieval_recall)),
      mrr: mean(retrievalResults.map((result) => result.reciprocal_rank)),
      region_accuracy: mean(results.map((result) => Number(result.region_correct))),
      intent_accuracy: mean(results.map((result) => Number(result.intent_correct))),
      citation_accuracy: mean(results.map((result) => Number(result.citation_correct))),
      source_legality: mean(results.map((result) => Number(result.sources_legal))),
      factual_consistency: mean(results.map((result) => Number(result.factual_consistency))),
      unsupported_answer_rate: mean(results.map((result) => Number(result.unsupported_answer))),
      schema_pass_rate: mean(results.map((result) => Number(result.schema_pass))),
      business_validator_pass_rate: mean(results.map((result) => Number(result.business_validator_pass))),
      average_model_calls: mean(results.map((result) => result.model_calls)),
      average_tool_calls: mean(results.map((result) => result.tool_calls)),
      average_tokens: mean(results.map((result) => result.tokens)),
      average_latency_ms: mean(results.map((result) => result.latency_ms)),
      p95_latency_ms: p95(results.map((result) => result.latency_ms)),
    },
    cases: results,
  };
}

const report = {
  generated_at: new Date().toISOString(),
  effective_date: "2026-07-23",
  default_mode: "D",
  requested_modes: modes,
  knowledge_stats: provider.getStats(),
  reports,
  notes: [
    "A/B/C/D are deterministic architecture ablations; D uses the real Pi Agent Core with TestModelProvider.",
    "Goldens remain pending_review and are not treated as absolute truth.",
    "Latency is a local test-model baseline and does not represent the DeepSeek network path.",
  ],
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  default_mode: "D",
  evaluated_modes: modes,
  metrics: Object.fromEntries(modes.map((mode) => [mode, (reports[mode] as { metrics: unknown }).metrics])),
}, null, 2));
