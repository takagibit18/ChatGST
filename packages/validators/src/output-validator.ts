import {
  policyResponseSchema,
  type EvidencePack,
  type PolicyResponse,
} from "@policy/schemas/index";
import { parseJsonWithSingleRepair } from "@policy/model-provider/index";
import { validatePolicyBusiness, type PolicyValidationIssue } from "./business-validator.js";

export type OutputValidationAttempt = {
  response: PolicyResponse | null;
  issues: PolicyValidationIssue[];
  json_repaired: boolean;
};

export function validateModelOutput(raw: unknown, pack: EvidencePack): OutputValidationAttempt {
  let decoded: { value: unknown; repaired: boolean };
  try {
    decoded = parseJsonWithSingleRepair(raw);
  } catch (error) {
    return {
      response: null,
      json_repaired: false,
      issues: [{ code: "invalid_json", path: "$", message: error instanceof Error ? error.message : "Invalid JSON" }],
    };
  }
  const schema = policyResponseSchema.safeParse(decoded.value);
  if (!schema.success) {
    return {
      response: null,
      json_repaired: decoded.repaired,
      issues: schema.error.issues.slice(0, 12).map((issue) => ({
        code: "schema",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const issues = validatePolicyBusiness(schema.data, pack);
  return { response: issues.length === 0 ? schema.data : null, issues, json_repaired: decoded.repaired };
}

export function deterministicSafeResponse(pack: EvidencePack): PolicyResponse {
  const conflict = pack.knowledge_gaps.some((gap) => gap.includes("版本冲突"));
  const status = conflict ? "policy_conflict" : pack.evidence.length === 0 ? "insufficient_evidence" : "safe_error";
  const answer = conflict
    ? "检索到同一时期的政策版本冲突，暂不作确定结论。请以当地主管部门核实结果为准。"
    : pack.evidence.length === 0
      ? "暂未检索到足够的有效政策依据，因此不能给出确定结论。建议咨询当地卫生健康部门。"
      : "回答未通过安全校验，系统已停止展示该结果。请参考下列官方来源或咨询当地主管部门。";
  const seen = new Set<string>();
  const sources = pack.evidence.flatMap((item) => {
    if (item.source_url === "unknown" || seen.has(item.document_id)) return [];
    seen.add(item.document_id);
    return [{ document_id: item.document_id, title: item.title, url: item.source_url }];
  });
  return {
    answer_markdown: answer,
    collapsibles: sources.length
      ? [
          {
            title: "数据来源",
            content_markdown: sources.map((source) => `> [${source.title}](${source.url})`).join("\n\n"),
          },
        ]
      : [],
    actions: [],
    sources,
    clarification: null,
    meta: {
      intent: pack.query_context.intent as PolicyResponse["meta"]["intent"],
      region:
        pack.query_context.region === "全国" ? null : (pack.query_context.region as PolicyResponse["meta"]["region"]),
      answer_status: status,
    },
  };
}

export async function validateRepairOrFallback(
  raw: unknown,
  pack: EvidencePack,
  repair: (input: { invalid_output: unknown; errors: PolicyValidationIssue[] }) => Promise<unknown>,
): Promise<{ response: PolicyResponse; repaired: boolean; fallback: boolean; issues: PolicyValidationIssue[] }> {
  const first = validateModelOutput(raw, pack);
  if (first.response) return { response: first.response, repaired: first.json_repaired, fallback: false, issues: [] };
  let repairedRaw: unknown;
  try {
    repairedRaw = await repair({ invalid_output: raw, errors: first.issues });
  } catch {
    return { response: deterministicSafeResponse(pack), repaired: false, fallback: true, issues: first.issues };
  }
  const second = validateModelOutput(repairedRaw, pack);
  if (second.response) return { response: second.response, repaired: true, fallback: false, issues: first.issues };
  return {
    response: deterministicSafeResponse(pack),
    repaired: false,
    fallback: true,
    issues: [...first.issues, ...second.issues],
  };
}

