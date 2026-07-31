import "dotenv/config";
import { inspectLocalOntology } from "@policy/ontology/index";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const project = arg("project") ?? process.env.POLICY_PROJECT_KEY;
const version = arg("version") ?? process.env.POLICY_VERSION_ID;
if (!project || !version) throw new Error("Usage: pnpm onto:finalize -- --project <key> --version <id>");
const summary = inspectLocalOntology(project, version);
if (summary.rules === 0 || summary.errors > 0 || summary.conflicts > 0) {
  throw new Error(`建模结果未通过预发布检查: rules=${summary.rules}, errors=${summary.errors}, conflicts=${summary.conflicts}`);
}
console.log(JSON.stringify({ ok: true, ready_to_publish: true, ...summary }, null, 2));
