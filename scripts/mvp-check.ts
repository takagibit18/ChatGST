import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { hasPublishedLocalOntology, localOntologyDbPath } from "@policy/ontology/index";

function hasMarkdown(root: string): boolean {
  if (!existsSync(root)) return false;
  return readdirSync(root, { recursive: true, withFileTypes: true }).some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"));
}

const errors: string[] = [];
if (!process.env.DEEPSEEK_API_KEY) errors.push("缺少 DEEPSEEK_API_KEY");
if (!process.env.MODEL_NAME) errors.push("缺少 MODEL_NAME");
if (!hasMarkdown(resolve("knowledge/raw")) && !hasMarkdown(resolve("knowledge/curated"))) errors.push("knowledge/raw 或 knowledge/curated 中没有政策 Markdown");
if (!existsSync(resolve("knowledge/index/rag.db"))) errors.push("缺少 BM25 索引，请先运行 pnpm rag:build -- --rebuild");
const policyId = process.env.RULE_ENGINE_POLICY_ID;
if (!policyId) errors.push("缺少 RULE_ENGINE_POLICY_ID");
else if (!hasPublishedLocalOntology(policyId)) errors.push(`本地规则库没有已发布版本: ${policyId}`);

if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, ontology_db: localOntologyDbPath(), errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, policy_id: policyId, ontology_db: localOntologyDbPath() }, null, 2));
}
