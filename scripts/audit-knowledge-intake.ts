import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { auditIntakeDirectory, serializeIntakeAudit, summarizeIntakeAudit } from "@policy/rag/index";

const writeMode = process.argv.includes("--write");
const intakeDir = resolve("knowledge/intake/nationwide-childcare");
const manifestPath = resolve("knowledge/metadata/nationwide-childcare-source-audit.jsonl");
const records = await auditIntakeDirectory(intakeDir);
const generated = serializeIntakeAudit(records);

if (writeMode) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, generated, "utf8");
} else {
  let committed = "";
  try {
    committed = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Audit manifest is missing: ${manifestPath}. Run with --write first.`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
  if (committed !== generated) {
    console.error("Nationwide childcare intake differs from the committed audit manifest. Run with --write to inspect the new snapshot.");
    process.exitCode = 1;
  }
}

console.log(JSON.stringify({
  mode: writeMode ? "write" : "verify",
  intake_dir: intakeDir,
  manifest: manifestPath,
  valid: process.exitCode !== 1,
  summary: summarizeIntakeAudit(records),
}, null, 2));
