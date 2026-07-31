import "dotenv/config";
import { inspectLocalOntology } from "@policy/ontology/index";

const value = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const project = value("project"); const version = value("version");
if (!project || !version) throw new Error("Usage: pnpm onto:inspect -- --project <key> --version <id>");
console.log(JSON.stringify(inspectLocalOntology(project, version), null, 2));
