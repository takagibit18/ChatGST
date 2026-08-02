import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PiLocalRagRetrievalProvider, conversationScenarioV21Schema, retrievalEvalCaseV21Schema, safetyEvalCaseV21Schema } from "@policy/rag/index";
import { createDefaultPolicyRuntime } from "@policy/runtime/index";
import { loadRuntimeConfig } from "@policy/shared/index";
import { runEvalV21Input } from "./eval-v2-1-runner.js";

const root = resolve("domains/childcare-subsidy/evals/v2.1");
const load = async <T>(path: string, parse: (value: unknown) => T) => (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => parse(JSON.parse(line)));
const devPath = resolve(root, "datasets/retrieval.dev.jsonl"), regressionPath = resolve(root, "datasets/regression-v1.jsonl");
const devText = await readFile(devPath, "utf8"), regressionText = await readFile(regressionPath, "utf8");
const dev = devText.split(/\r?\n/u).filter(Boolean).map((line) => retrievalEvalCaseV21Schema.parse(JSON.parse(line)));
const regression = regressionText.split(/\r?\n/u).filter(Boolean).map((line) => retrievalEvalCaseV21Schema.parse(JSON.parse(line)));
const conversations = await load(resolve(root, "datasets/conversations.jsonl"), conversationScenarioV21Schema.parse);
const safety = await load(resolve(root, "datasets/safety.jsonl"), safetyEvalCaseV21Schema.parse);
const calibrationText = await readFile(resolve(root, "calibration/bm25-threshold.json"), "utf8");
const threshold = (JSON.parse(calibrationText) as { selected: { threshold: number } }).selected.threshold;
const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
const config = loadRuntimeConfig({ ...process.env, MODEL_PROVIDER: "test", RAINDROP_ENABLED: "false", RAINDROP_CAPTURE_CONTENT: "false", MAX_SESSION_TURNS: "100" });
const { runtime } = createDefaultPolicyRuntime(config);
const retrievalPredictions = [];
for (const item of [...dev, ...regression]) {
  const prediction = await runEvalV21Input(provider, { id: item.id, question: item.question, user_region: item.user_region, effective_date: item.effective_date }, threshold, { warmups: 2, measured: 5 });
  const result = await runtime.answer({ conversationId: `v21-single-${item.id}`, message: item.question, effectiveDate: item.effective_date });
  prediction.answer_text = `${result.response.answer_markdown}\n${result.response.collapsibles.map((part) => part.content_markdown).join("\n")}`;
  prediction.citations = result.response.sources.map((source) => source.document_id);
  retrievalPredictions.push({ ...prediction, runtime_behavior: result.response.meta.answer_status, runtime_region: result.response.meta.region,
    evidence_chunks: result.evidencePack.evidence.map((evidence) => evidence.chunk_id), usage: result.usage, validation: result.validation });
}
const conversationPredictions = [];
for (const scenario of conversations) {
  const turns = [];
  for (const [index, turn] of scenario.turns.entries()) {
    const result = await runtime.answer({ conversationId: `v21-${scenario.scenario_id}`, message: turn.user, effectiveDate: "2026-08-02" });
    turns.push({ turn: index + 1, answer_status: result.response.meta.answer_status, region: result.response.meta.region,
      evidence_region_codes: [...new Set(result.evidencePack.policy_versions.map((item) => item.region_code))], citations: result.response.sources.map((source) => source.document_id) });
  }
  conversationPredictions.push({ scenario_id: scenario.scenario_id, turns });
}
const safetyPredictions = [];
for (const item of safety) {
  const result = await runtime.answer({ conversationId: `v21-${item.id}`, message: item.prompt, effectiveDate: "2026-08-02" });
  safetyPredictions.push({ case_id: item.id, answer_status: result.response.meta.answer_status, answer_text: result.response.answer_markdown,
    citations: result.response.sources.map((source) => source.document_id), model_calls: result.usage.modelCalls, tool_calls: result.usage.toolCalls });
}
const stablePredictions = {
  retrieval: retrievalPredictions.map(({ retrieval_ms: _retrievalMs, total_ms: _totalMs, usage: _usage, ...prediction }) => prediction),
  conversations: conversationPredictions,
  safety: safetyPredictions,
};
const predictionFingerprint = createHash("sha256").update(JSON.stringify(stablePredictions)).digest("hex");
const raw = { schema_version: 1, run_id: "phase3-v21-provisional", generated_at: new Date().toISOString(), evaluation_status: "provisional",
  release_gate: "blocked_pending_human_review", input_fingerprint: { dev_sha256: createHash("sha256").update(devText).digest("hex"),
    regression_sha256: createHash("sha256").update(regressionText).digest("hex"), calibration_sha256: createHash("sha256").update(calibrationText).digest("hex"),
    knowledge_snapshot_hash: provider.getStats().snapshot_hash }, prediction_fingerprint: predictionFingerprint,
  config: { threshold, warmups: 2, measured: 5, model_provider: "test" },
  retrieval_predictions: retrievalPredictions, conversation_predictions: conversationPredictions, safety_predictions: safetyPredictions };
await mkdir(resolve(root, "runs"), { recursive: true });
await writeFile(resolve(root, "runs/phase3-v21-raw-predictions.json"), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ written: true, retrieval: retrievalPredictions.length, conversations: conversationPredictions.length, safety: safetyPredictions.length,
  contains_gold_labels: false, prediction_fingerprint: predictionFingerprint }, null, 2));
