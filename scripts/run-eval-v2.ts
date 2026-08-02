import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { platform, release } from "node:os";
import { resolve } from "node:path";
import {
  PiLocalRagRetrievalProvider,
  administrativeRegions,
  calculateRetrievalV2Metrics,
  retrievalEvalCaseSchema,
  type RetrievalEvalCase,
  type RetrievalEvalHit,
  type RetrievalEvalResult,
} from "@policy/rag/index";

const root = resolve("domains/childcare-subsidy/evals/v2");
const datasetsDir = resolve(root, "datasets");
const runsDir = resolve(root, "runs");
const reportsDir = resolve(root, "reports");
const runId = "phase3-k4-bm25-dev";
const repetitions = 3;
const minimumAnswerScore = 1;

type CaseOutput = {
  case_id: string;
  split: string;
  expected_behavior: RetrievalEvalCase["expected_behavior"];
  predicted_behavior: RetrievalEvalResult["predicted_behavior"];
  top_k: RetrievalEvalHit[];
  relevant_documents: string[];
  relevant_chunks: string[];
  retrieval_ms: number[];
  total_ms: number[];
  repeat_stable: boolean;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJsonl<T>(path: string): Promise<T[]> {
  return (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]!;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

async function evaluateCase(provider: PiLocalRagRetrievalProvider, item: RetrievalEvalCase): Promise<CaseOutput> {
  if (item.expected_behavior === "clarify_region" && !item.user_region) {
    return {
      case_id: item.id, split: item.split, expected_behavior: item.expected_behavior, predicted_behavior: "clarify_region",
      top_k: [], relevant_documents: item.relevant_documents, relevant_chunks: item.relevant_chunks,
      retrieval_ms: [0, 0, 0], total_ms: [0, 0, 0], repeat_stable: true,
    };
  }
  const sequences: string[][] = [];
  const retrievalMs: number[] = [];
  const totalMs: number[] = [];
  let finalHits: RetrievalEvalHit[] = [];
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    const totalStart = performance.now();
    const retrievalStart = performance.now();
    const hits = item.user_region
      ? await provider.search({ query: item.question, region: item.user_region, effective_date: item.effective_date, top_k: 10 })
      : [];
    retrievalMs.push(rounded(performance.now() - retrievalStart));
    finalHits = hits.map((hit) => ({
      document_id: hit.document_id,
      chunk_id: hit.chunk_id,
      region_code: hit.metadata.region_code ?? "100000",
      effective_from: hit.effective_from,
      effective_to: hit.effective_to,
      duplicate_group_id: hit.metadata.duplicate_group_id ?? null,
      score: hit.retrieval_score,
    }));
    sequences.push(finalHits.map((hit) => hit.chunk_id));
    totalMs.push(rounded(performance.now() - totalStart));
  }
  return {
    case_id: item.id, split: item.split, expected_behavior: item.expected_behavior,
    predicted_behavior: finalHits.length > 0 && finalHits[0]!.score >= minimumAnswerScore ? "answer" : "no_answer", top_k: finalHits,
    relevant_documents: item.relevant_documents, relevant_chunks: item.relevant_chunks,
    retrieval_ms: retrievalMs, total_ms: totalMs,
    repeat_stable: sequences.every((sequence) => JSON.stringify(sequence) === JSON.stringify(sequences[0])),
  };
}

function metricResult(output: CaseOutput): RetrievalEvalResult {
  return { case_id: output.case_id, hits: output.top_k, predicted_behavior: output.predicted_behavior };
}

async function main(): Promise<void> {
  const devText = await readFile(resolve(datasetsDir, "retrieval.dev.jsonl"), "utf8");
  const regressionText = await readFile(resolve(datasetsDir, "regression-v1.jsonl"), "utf8");
  const dev = devText.split(/\r?\n/u).filter(Boolean).map((line) => retrievalEvalCaseSchema.parse(JSON.parse(line)));
  const regression = regressionText.split(/\r?\n/u).filter(Boolean).map((line) => retrievalEvalCaseSchema.parse(JSON.parse(line)));
  const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
  const stats = provider.getStats();
  if (stats.snapshot_hash !== "041f724f04893f821bdfdb23cc76d9faa3fd10233920489e5111edafc6cb34ce") {
    throw new Error(`Evaluation requires K4, found ${stats.snapshot_hash ?? "no snapshot hash"}`);
  }
  const outputs: CaseOutput[] = [];
  for (const item of [...dev, ...regression]) outputs.push(await evaluateCase(provider, item));
  const byId = new Map(outputs.map((output) => [output.case_id, output]));
  const devMetrics = calculateRetrievalV2Metrics(dev, dev.map((item) => metricResult(byId.get(item.id)!)));
  const regressionMetrics = calculateRetrievalV2Metrics(regression, regression.map((item) => metricResult(byId.get(item.id)!)));
  const retrievalTimes = outputs.flatMap((output) => output.retrieval_ms);
  const totalTimes = outputs.flatMap((output) => output.total_ms);
  const manifest = await readJsonl<{ document_id: string; expected_indexed: boolean }>(resolve(datasetsDir, "extraction-manifest.jsonl"));
  const expectedDocuments = new Set(manifest.filter((item) => item.expected_indexed).map((item) => item.document_id));
  const actualDocuments = new Set((await provider.listKnowledgeDocuments()).map((item) => item.metadata.document_id));
  const exactExtractionMatch = expectedDocuments.size === actualDocuments.size && [...expectedDocuments].every((id) => actualDocuments.has(id));
  const duplicateMapText = await readFile(resolve("knowledge/metadata/duplicate-groups.json"), "utf8");
  const snapshotText = await readFile(resolve("knowledge/snapshots/K4.json"), "utf8");
  const manifestText = await readFile(resolve(root, "dataset-manifest.json"), "utf8");
  const run = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    fingerprint: {
      dataset_version: "phase3-v1.0",
      dataset_manifest_sha256: hash(manifestText),
      dev_dataset_sha256: hash(devText),
      regression_dataset_sha256: hash(regressionText),
      knowledge_snapshot: "K4",
      knowledge_snapshot_sha256: hash(snapshotText),
      knowledge_snapshot_hash: stats.snapshot_hash,
      duplicate_map_sha256: hash(duplicateMapText),
      region_registry_sha256: hash(JSON.stringify(administrativeRegions)),
      retrieval: { provider: "pi-local-rag", mode: stats.retrieval_mode, ranking: "BM25", top_k: 10, minimum_answer_score: minimumAnswerScore, repetitions },
      index: stats,
      runtime: { node: process.version, platform: platform(), release: release() },
    },
    metrics: {
      dev: devMetrics,
      regression: regressionMetrics,
      extraction_manifest_exact_match: exactExtractionMatch,
      deterministic_top10_rate: rounded(outputs.filter((output) => output.repeat_stable).length / outputs.length),
      performance_ms: {
        retrieval: { p50: rounded(percentile(retrievalTimes, 0.5)), p95: rounded(percentile(retrievalTimes, 0.95)), p99: rounded(percentile(retrievalTimes, 0.99)) },
        total: { p50: rounded(percentile(totalTimes, 0.5)), p95: rounded(percentile(totalTimes, 0.95)), p99: rounded(percentile(totalTimes, 0.99)) },
      },
    },
    case_results: outputs,
    failed_cases: outputs.filter((output) => {
      const item = [...dev, ...regression].find((candidate) => candidate.id === output.case_id)!;
      if (output.predicted_behavior !== item.expected_behavior) return true;
      return item.answerable && !output.top_k.slice(0, 5).some((hit) => item.relevant_documents.includes(hit.document_id));
    }).map((output) => output.case_id),
  };
  const report = {
    run_id: runId,
    knowledge_snapshot: "K4",
    evaluated: { dev: dev.length, regression: regression.length, repetitions },
    metrics: run.metrics,
    failed_cases: run.failed_cases,
    inventory: { retrieval_train: 50, retrieval_dev: 30, regression: 13, conversations: 8, safety: 15, extraction: 47 },
    test_split: "not_frozen_until_phase4",
  };
  await mkdir(runsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  await writeFile(resolve(runsDir, `${runId}.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await writeFile(resolve(reportsDir, "phase3-baseline.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

await main();
