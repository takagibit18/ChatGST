import "dotenv/config";
import { queryLocalPolicy } from "@policy/ontology/index";

const value = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const policy = value("policy") ?? process.env.RULE_ENGINE_POLICY_ID;
const version = value("version"); const region = value("region"); const text = value("text");
if (!policy || !region || !text) throw new Error("Usage: pnpm onto:query -- --policy <id> [--version <id>] --region <region> --text <conditions>");
console.log(JSON.stringify(queryLocalPolicy({ policy_id: policy, region, text, ...(version ? { version } : {}) }), null, 2));
