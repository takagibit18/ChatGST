import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PiLocalRagRetrievalProvider, retrievalEvalCaseV21Schema } from "@policy/rag/index";
import { assertTrainOnlyCalibrationPath, runEvalV21Input, type EvalV21Prediction } from "./eval-v2-1-runner.js";
import { selectCalibrationCandidate } from "./eval-v2-1-calibration.js";

const root = resolve("domains/childcare-subsidy/evals/v2.1");
const trainPath = resolve(root, "datasets/retrieval.train.jsonl");
assertTrainOnlyCalibrationPath(trainPath);
const trainText = await readFile(trainPath, "utf8");
const canonicalTrainText = trainText.replace(/\r\n/gu, "\n");
const train = trainText.split(/\r?\n/u).filter(Boolean).map((line) => retrievalEvalCaseV21Schema.parse(JSON.parse(line)));
const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
const raw: EvalV21Prediction[] = [];
for (const item of train) raw.push(await runEvalV21Input(provider, { id: item.id, question: item.question, user_region: item.user_region, effective_date: item.effective_date }, Number.NEGATIVE_INFINITY));
const scores = [...new Set(raw.flatMap((item) => item.top_k[0] ? [item.top_k[0].score] : []))].sort((a, b) => a - b);
const candidates = [0, ...scores.map((value, index) => index === scores.length - 1 ? value + 0.000001 : (value + scores[index + 1]!) / 2)];
const rows = candidates.map((threshold) => {
  let answerTotal = 0, answerCorrect = 0, noAnswerTotal = 0, noAnswerCorrect = 0, predictedNoAnswer = 0;
  for (const [index, item] of train.entries()) {
    if (item.expected_behavior === "clarify_region") continue;
    const score = raw[index]!.top_k[0]?.score ?? Number.NEGATIVE_INFINITY;
    const predicted = raw[index]!.evidence_sufficient && score >= threshold ? "answer" : "no_answer";
    if (item.expected_behavior === "answer") { answerTotal += 1; if (predicted === "answer") answerCorrect += 1; }
    if (item.expected_behavior === "no_answer") { noAnswerTotal += 1; if (predicted === "no_answer") noAnswerCorrect += 1; }
    if (predicted === "no_answer") predictedNoAnswer += 1;
  }
  const answerRecall = answerTotal ? answerCorrect / answerTotal : 0;
  const noAnswerRecall = noAnswerTotal ? noAnswerCorrect / noAnswerTotal : 0;
  const precision = predictedNoAnswer ? noAnswerCorrect / predictedNoAnswer : 0;
  const f1 = precision + noAnswerRecall ? 2 * precision * noAnswerRecall / (precision + noAnswerRecall) : 0;
  return { threshold, macro_recall: (answerRecall + noAnswerRecall) / 2, no_answer_f1: f1, answer_recall: answerRecall, no_answer_recall: noAnswerRecall };
});
const selection = selectCalibrationCandidate(rows);
const output = { schema_version: 1, calibration_id: "phase3-v21-train-bm25", dataset: "retrieval.train.jsonl",
  train_sha256: createHash("sha256").update(canonicalTrainText).digest("hex"),
  selection_rule: "require no-answer recall >= 1; max answer recall; tie max macro recall; tie max no-answer F1; tie lowest threshold",
  ...selection, candidates: rows, forbidden_inputs: ["retrieval.dev.jsonl", "retrieval.test.jsonl", "regression-v1.jsonl"] };
await mkdir(resolve(root, "calibration"), { recursive: true });
await writeFile(resolve(root, "calibration/bm25-threshold.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ calibrated: selection.calibration_status === "passed", ...selection }, null, 2));
if (selection.calibration_status === "failed") process.exitCode = 1;
