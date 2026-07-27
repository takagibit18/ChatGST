import { join } from "node:path";
import { atomicWriteJson, readJsonFile } from "./json-store.js";
import { proxyOnto } from "./onto-platform.js";
import { readVersionJson } from "./step2-progress.js";
import { versionDir } from "./workspace.js";

export type JudgeHistoryItem = {
  at: string;
  text: string;
  question?: string;
  region: string;
  matched_rule_ids: string[];
  total_rule_ids: string[];
};

type RuleLike = {
  name?: unknown;
  region?: unknown;
  head_ops?: unknown;
  body_ops?: unknown;
};

function readOnPolicyId(projectKey: string, versionId: string): string | undefined {
  const version = readVersionJson(projectKey, versionId);
  return typeof version.on_policy_id === "string" ? version.on_policy_id : undefined;
}

function appendJudgeHistory(projectKey: string, versionId: string, item: JudgeHistoryItem): void {
  const path = join(versionDir(projectKey, versionId), "judge-history.json");
  const history = readJsonFile<JudgeHistoryItem[]>(path, []);
  atomicWriteJson(path, [...history, item].slice(-500));
}

export async function recordRuleEngineJudgeHistory(
  toolResult: unknown,
  projectKey: string,
  versionId: string,
  source: { text?: string; question?: string } = {},
): Promise<void> {
  const details = toolResult as { region?: unknown; conclusions?: unknown[]; text?: string; question?: string };
  const region = typeof details.region === "string" ? details.region : undefined;
  const text = source.text ?? details.text;
  const question = source.question ?? details.question;
  if (!region || !text) return;

  const conclusions = Array.isArray(details.conclusions) ? details.conclusions : [];
  const directMatched = new Set<string>();
  const ops = new Set<string>();
  for (const conclusion of conclusions as Array<Record<string, unknown>>) {
    if (typeof conclusion.op === "string") ops.add(conclusion.op);
    if (Array.isArray(conclusion.matched_rule_ids)) {
      for (const id of conclusion.matched_rule_ids) if (typeof id === "string" && id) directMatched.add(id);
    }
  }

  let matchedRuleIds: string[] = [];
  let totalRuleIds: string[] = [];
  const policyId = readOnPolicyId(projectKey, versionId);
  if (policyId) {
    try {
      const onto = await proxyOnto<{ rules?: RuleLike[] }>("GET", `/api/ontology?policy_id=${encodeURIComponent(policyId)}`);
      const rulesInRegion = (onto?.rules ?? []).filter((rule) => rule.region === region);
      totalRuleIds = rulesInRegion.map((rule) => String(rule.name)).filter(Boolean);
      if (directMatched.size > 0) {
        matchedRuleIds = [...directMatched].filter((id) => totalRuleIds.includes(id));
      } else {
        for (const rule of rulesInRegion) {
          const headOps = new Set(Array.isArray(rule.head_ops) ? rule.head_ops : []);
          const bodyOps = new Set(Array.isArray(rule.body_ops) ? rule.body_ops : []);
          if ([...ops].some((op) => headOps.has(op) || bodyOps.has(op))) matchedRuleIds.push(String(rule.name));
        }
      }
    } catch {
      // Ontology history is best effort; rule-engine answers must not fail because audit enrichment failed.
    }
  }

  appendJudgeHistory(projectKey, versionId, {
    at: new Date().toISOString(),
    text,
    region,
    matched_rule_ids: matchedRuleIds,
    total_rule_ids: totalRuleIds,
    ...(question ? { question } : {}),
  });
}
