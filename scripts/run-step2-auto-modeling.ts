import "dotenv/config";
import { loadStep2Config, runStep2AutoModeling, writeVersionJson } from "@policy/ontology/index";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const project = arg("project") ?? process.env.POLICY_PROJECT_KEY;
const version = arg("version") ?? process.env.POLICY_VERSION_ID;
const policy = arg("policy") ?? process.env.RULE_ENGINE_POLICY_ID;
const dataRoot = arg("data-root") ?? loadStep2Config().default_data_root;
const canonical = arg("canonical");

if (!project || !version || !policy) {
  throw new Error("Usage: pnpm onto:step2 -- --project <key> --version <id> --policy <onto-policy-id> [--data-root <dir>]");
}

const current = { on_policy_id: policy, ...(canonical ? { on_policy_canonical: canonical } : {}) };
writeVersionJson(project, version, current);
await runStep2AutoModeling(project, version, policy, dataRoot);
console.log(JSON.stringify({ ok: true, project, version, policy, data_root: dataRoot }, null, 2));

