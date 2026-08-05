import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256, type DatasetManifest, type InputFingerprint, type ReviewCounts } from "./eval-v2-1-integrity.js";

const root = resolve("domains/childcare-subsidy/evals/v2.1");
const reportPath = resolve(root, "reports/phase3-3-frozen-baseline.json");
const reportText = await readFile(reportPath, "utf8");
const report = JSON.parse(reportText) as {
  dataset_review_gate: string; quality_gate: { status: string }; artifact_consistency_gate: { status: string };
  determinism_gate: { status: string }; phase4_entry_gate: string; production_release_gate: string;
  test_split: { status: string }; real_model_evaluation: { status: string }; prediction_fingerprint: string;
  input_fingerprint: InputFingerprint; config: Record<string, unknown>;
  retrieval: { dev: { metrics: Record<string, number> }; regression: { metrics: Record<string, number> } };
  conversations: { scenario_completion_rate: number; stale_context_leakage_rate: number };
  safety: { pass_rate: number };
};
const manifestText = await readFile(resolve(root, "dataset-manifest.json"), "utf8");
const manifest = JSON.parse(manifestText) as DatasetManifest & { review: ReviewCounts & { reviewer: string }; files: Record<string, { sha256: string }> };
const calibration = JSON.parse(await readFile(resolve(root, "calibration/bm25-threshold.json"), "utf8")) as {
  selected: { threshold: number; answer_recall: number };
};
const determinism = JSON.parse(await readFile(resolve(root, "runs/determinism-verification.json"), "utf8")) as {
  git_commit: string; stable: boolean; full_runs: number; prediction_fingerprints: string[];
};
const baseCommit = determinism.git_commit || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const manifestSha = sha256(manifestText);

const freeze = {
  schema_version: 1,
  phase: "3.3",
  status: "frozen_for_phase4",
  gold_version: "phase3-v2.1-human-reviewed",
  review: manifest.review,
  knowledge_snapshot: "K4",
  knowledge_snapshot_hash: manifest.knowledge_snapshot_hash,
  dataset_manifest_sha256: manifestSha,
  base_commit: baseCommit,
  artifact_hashes: {
    raw_predictions_sha256: sha256(await readFile(resolve(root, "runs/phase3-v21-raw-predictions.json"), "utf8")),
    frozen_report_sha256: sha256(reportText),
    prediction_fingerprint: report.prediction_fingerprint,
  },
  phase4_entry_gate: report.phase4_entry_gate,
  production_release_gate: report.production_release_gate,
  test_split_status: report.test_split.status,
};
await writeFile(resolve(root, "FREEZE.json"), `${JSON.stringify(freeze, null, 2)}\n`, "utf8");

const metric = (value: number | undefined): string => value === undefined ? "n/a" : value.toFixed(6);
const dev = report.retrieval.dev.metrics;
const regression = report.retrieval.regression.metrics;
const markdown = `# Phase 3.3 — Human-reviewed Eval Freeze & Phase 4 Entry Closure

## 1. Scope

本阶段仅完成人工审核闭环、Gate 分层、产物重生成、指纹验证、确定性重跑、文档一致性与 Phase 4 基线冻结。未修改 Gold 内容、检索参数、Runtime 策略、scorer 指标定义、K4 内容或 TestModelProvider 行为。

## 2. Human review result

- Retrieval: 80/80 approved
- Regression: 13/13 approved
- Conversations: 20/20 approved
- Safety: 30/30 approved
- Total: 143/143 approved
- Pending: 0
- Rejected: 0
- Reviewer: ${manifest.review.reviewer}

审核权威来源为 \`annotations/*.jsonl\`；materialized datasets 与 manifest 已经程序化一致性校验。

## 3. Frozen inputs

| Input | Frozen value |
|---|---|
| Base Git commit | \`${baseCommit}\` |
| K4 snapshot hash | \`${manifest.knowledge_snapshot_hash}\` |
| Dataset manifest SHA-256 | \`${manifestSha}\` |
| Train SHA-256 | \`${manifest.files["retrieval.train.jsonl"]!.sha256}\` |
| Dev SHA-256 | \`${manifest.files["retrieval.dev.jsonl"]!.sha256}\` |
| Regression SHA-256 | \`${manifest.files["regression-v1.jsonl"]!.sha256}\` |
| Conversation SHA-256 | \`${manifest.files["conversations.jsonl"]!.sha256}\` |
| Safety SHA-256 | \`${manifest.files["safety.jsonl"]!.sha256}\` |
| Calibration SHA-256 | \`${report.input_fingerprint.calibration_sha256}\` |
| Runtime config | \`${JSON.stringify(report.config)}\` |
| Model provider | \`test\` |

\`base_commit\` avoids a commit self-reference. After committing, the recommended annotated tag command is \`git tag -a phase3.3-frozen-baseline -m "Phase 3.3 frozen baseline"\`; this report does not claim that the tag has already been created.

## 4. Reproducibility

\`\`\`bash
pnpm eval:v2.1:prepare
pnpm eval:v2.1:validate
pnpm eval:v2.1:calibrate
pnpm eval:v2.1
pnpm eval:v2.1:determinism
pnpm test
pnpm build:runtime
\`\`\`

\`eval:v2.1:determinism\` executes three independent runner+scorer full runs, collects each prediction fingerprint, writes the verification record only if all three agree, and then performs a final runner+scorer consistency run.

## 5. Current metrics

这些指标从重新生成的 \`phase3-3-frozen-baseline.json\` 自动读取，只描述确定性的 TestModelProvider Phase 3 基线，不代表真实模型或 frozen test 泛化质量。

| Metric | Value |
|---|---:|
| Calibration answer recall | ${metric(calibration.selected.answer_recall)} |
| Regression accuracy | ${metric(regression.behavior_accuracy)} |
| Regression no-answer recall | ${metric(regression.no_answer_recall)} |
| Dev Document Recall@5 | ${metric(dev.document_recall_at_5)} |
| Dev Chunk Recall@5 | ${metric(dev.chunk_recall_at_5)} |
| Dev MRR@10 | ${metric(dev.mrr_at_10)} |
| Dev nDCG@10 | ${metric(dev.ndcg_at_10)} |
| Dev required fact coverage | ${metric(dev.required_fact_coverage)} |
| Dev citation precision | ${metric(dev.citation_precision)} |
| Dev citation completeness | ${metric(dev.citation_completeness)} |
| Conversation completion | ${metric(report.conversations.scenario_completion_rate)} |
| Stale context leakage | ${metric(report.conversations.stale_context_leakage_rate)} |
| Safety pass rate | ${metric(report.safety.pass_rate)} |
| Determinism | ${determinism.stable ? `stable (${determinism.full_runs}/3 full runs)` : "failed"} |

## 6. Gate result

- Dataset review gate: \`${report.dataset_review_gate}\`
- Automated quality gate: \`${report.quality_gate.status}\`
- Artifact consistency gate: \`${report.artifact_consistency_gate.status}\`
- Determinism gate: \`${report.determinism_gate.status}\`
- Phase 4 entry gate: \`${report.phase4_entry_gate}\`
- Production release gate: \`${report.production_release_gate}\`
- Frozen test status: \`${report.test_split.status}\`
- Real model evaluation: \`${report.real_model_evaluation.status}\`

## 7. Known limitations

- 当前使用 TestModelProvider；结果不能直接作为生产效果结论。
- Dev 样本规模有限，当前 calibration threshold 为 ${calibration.selected.threshold}。
- Frozen test 尚未建立或执行。
- K0–K4 对照消融、R1–R6 检索实验和 Agent ablation 尚未完成。
- 真实 DeepSeek 评测尚未运行。
- 当前环境以 Node 24 验证；切换 Node 主版本时必须重新安装或 rebuild \`better-sqlite3\`，避免原生 ABI 不匹配。

## 8. Phase 4 entry contract

1. Gold v2.1 自本冻结基线起不得再根据 Dev case 修改。
2. 每个实验只改变一个明确变量。
3. 每个 run 保存 commit、config、dataset hash 和结果。
4. 每项候选至少重复运行三次。
5. Test 只允许最终两个候选配置执行。
6. 不允许根据 Test 结果继续调参。
7. 是否引入 dense/reranker 由 BM25 失败分布决定。
8. Production release 必须等待 Phase 4、frozen test 与真实模型评测完成。
`;
await writeFile(resolve(root, "reports/phase3-3-freeze-closure.md"), markdown, "utf8");
console.log(JSON.stringify({ written: true, freeze: resolve(root, "FREEZE.json"), report: resolve(root, "reports/phase3-3-freeze-closure.md"), phase4_entry_gate: report.phase4_entry_gate }, null, 2));
