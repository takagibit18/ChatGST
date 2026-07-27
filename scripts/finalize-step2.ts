import "dotenv/config";
import { finalizeStep2 } from "@policy/ontology/index";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const project = arg("project") ?? process.env.POLICY_PROJECT_KEY;
const version = arg("version") ?? process.env.POLICY_VERSION_ID;
const ruleCount = Number(arg("rule-count"));
const regions = (arg("regions") ?? "")
  .split(",")
  .map((region) => region.trim())
  .filter(Boolean);

if (!project || !version || !Number.isInteger(ruleCount) || regions.length === 0) {
  throw new Error("Usage: pnpm onto:finalize -- --project <key> --version <id> --regions 北京市,河北省 --rule-count 28");
}

const meta = finalizeStep2(project, version, regions, ruleCount);
console.log(JSON.stringify(meta, null, 2));

