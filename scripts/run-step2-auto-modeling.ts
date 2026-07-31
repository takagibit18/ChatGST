import "dotenv/config";
import { buildLocalOntology, loadStep2Config } from "@policy/ontology/index";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const project = arg("project") ?? process.env.POLICY_PROJECT_KEY;
const version = arg("version") ?? process.env.POLICY_VERSION_ID;
const policy = arg("policy") ?? process.env.RULE_ENGINE_POLICY_ID;
const dataRoot = arg("data-root") ?? loadStep2Config().default_data_root;

if (!project || !version || !policy) {
  throw new Error("Usage: pnpm onto:step2 -- --project <key> --version <id> --policy <onto-policy-id> [--data-root <dir>]");
}

const summary = await buildLocalOntology({ project, version, policyId: policy, dataRoot });
console.log(JSON.stringify({ ok: true, data_root: dataRoot, ...summary }, null, 2));
if (summary.errors > 0 || summary.rules === 0) {
  throw new Error(`建模未完成: rules=${summary.rules}, errors=${summary.errors}；请查看 error_items 后重跑`);
}

