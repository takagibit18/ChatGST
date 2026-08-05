import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256, type InputFingerprint } from "./eval-v2-1-integrity.js";

const root = resolve("domains/childcare-subsidy/evals/v2.1");
const tsx = resolve("node_modules/tsx/dist/cli.mjs");
const runner = resolve("scripts/run-eval-v2-1.ts");
const scorer = resolve("scripts/score-eval-v2-1.ts");

function run(script: string): void {
  execFileSync(process.execPath, [tsx, script], { cwd: resolve("."), stdio: "inherit" });
}

async function readRaw(): Promise<{ prediction_fingerprint: string; input_fingerprint: InputFingerprint }> {
  return JSON.parse(await readFile(resolve(root, "runs/phase3-v21-raw-predictions.json"), "utf8")) as {
    prediction_fingerprint: string;
    input_fingerprint: InputFingerprint;
  };
}

const predictionFingerprints: string[] = [];
for (let runNumber = 1; runNumber <= 3; runNumber++) {
  console.log(JSON.stringify({ determinism_full_run: runNumber, stage: "start" }));
  run(runner);
  run(scorer);
  const raw = await readRaw();
  predictionFingerprints.push(raw.prediction_fingerprint);
  console.log(JSON.stringify({ determinism_full_run: runNumber, stage: "complete", prediction_fingerprint: raw.prediction_fingerprint }));
}

const stable = new Set(predictionFingerprints).size === 1;
if (!stable) throw new Error(`determinism_failed: prediction fingerprints differ: ${predictionFingerprints.join(", ")}`);
const raw = await readRaw();
const manifestText = await readFile(resolve(root, "dataset-manifest.json"), "utf8");
let gitCommit = "unavailable";
try {
  gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve("."), encoding: "utf8" }).trim();
} catch { /* The dataset and artifact hashes remain the authoritative freeze identity. */ }
const verification = {
  schema_version: 2,
  git_commit: gitCommit,
  dataset_version: "phase3-v2.1-human-reviewed",
  dataset_manifest_sha256: sha256(manifestText),
  knowledge_snapshot_hash: raw.input_fingerprint.knowledge_snapshot_hash,
  model_provider: "test",
  review_status: "human_approved",
  full_runs: 3,
  stable: true,
  prediction_fingerprints: predictionFingerprints,
  timing_fields_excluded: true,
};
await writeFile(resolve(root, "runs/determinism-verification.json"), `${JSON.stringify(verification, null, 2)}\n`, "utf8");

// Regenerate both raw predictions and the scored report after publishing the
// verification record, so the final report is never produced by a scorer-only run.
run(runner);
run(scorer);
console.log(JSON.stringify({ determinism_verified: true, full_runs: 3, final_consistency_run: true, prediction_fingerprint: predictionFingerprints[0] }, null, 2));
