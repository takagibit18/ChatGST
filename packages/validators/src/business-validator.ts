import type { EvidencePack, PolicyResponse } from "@policy/schemas/index";

export type PolicyValidationIssue = {
  code: string;
  path: string;
  message: string;
};

const forbiddenVisiblePatterns: Array<[RegExp, string]> = [
  [/[A-Za-z]:\\|\/(?:Users|home|tmp)\//u, "local_path"],
  [/\.md\b|\.jsonl\b|node_modules/u, "internal_file"],
  [/system\s*prompt|系统提示词|内部提示/u, "internal_prompt"],
  [/tool[_\s-]?(?:call|result)|工具调用|工具参数|工具返回/u, "raw_tool"],
  [/thinking|reasoning|思维链|推理过程/iu, "reasoning"],
  [/读取文件失败|stack trace|internal error/iu, "implementation_error"],
];

function visibleText(response: PolicyResponse): string {
  return [
    response.answer_markdown,
    ...response.collapsibles.flatMap((item) => [item.title, item.content_markdown]),
    ...response.actions.flatMap((item) => [item.label, item.value]),
    response.clarification?.question ?? "",
  ].join("\n");
}

export function validatePolicyBusiness(response: PolicyResponse, pack: EvidencePack): PolicyValidationIssue[] {
  const issues: PolicyValidationIssue[] = [];
  const evidenceDocuments = new Map(pack.evidence.map((item) => [item.document_id, item]));
  for (const [index, source] of response.sources.entries()) {
    const evidence = evidenceDocuments.get(source.document_id);
    if (!evidence) {
      issues.push({ code: "source_not_in_evidence", path: `sources.${index}`, message: "Source is not in Evidence Pack" });
    } else if (evidence.source_url !== source.url) {
      issues.push({ code: "source_url_mismatch", path: `sources.${index}.url`, message: "Source URL differs from Evidence Pack" });
    }
  }

  const allowedRegions =
    pack.query_context.region === "对比"
      ? new Set(["北京市", "河北省", "全国"])
      : new Set([pack.query_context.region, "全国"]);
  for (const evidence of pack.evidence) {
    if (!allowedRegions.has(evidence.region as never)) {
      issues.push({ code: "region_mismatch", path: "sources", message: `Evidence region is inconsistent: ${evidence.region}` });
    }
    if (evidence.effective_from !== "unknown" && evidence.effective_from > pack.query_context.effective_date) {
      issues.push({ code: "future_policy", path: "sources", message: "Evidence is not effective on the reference date" });
    }
    if (evidence.effective_to && evidence.effective_to !== "unknown" && evidence.effective_to < pack.query_context.effective_date) {
      issues.push({ code: "expired_policy", path: "sources", message: "Evidence expired before the reference date" });
    }
  }

  if (
    pack.evidence.length === 0 &&
    ["amount", "eligibility"].includes(response.meta.intent) &&
    response.meta.answer_status === "answered"
  ) {
    issues.push({ code: "unsupported_deterministic_claim", path: "meta.answer_status", message: "Amount/eligibility cannot be answered without evidence" });
  }

  const visible = visibleText(response);
  for (const [pattern, code] of forbiddenVisiblePatterns) {
    if (pattern.test(visible)) issues.push({ code, path: "visible_content", message: `Forbidden visible content: ${code}` });
  }

  const sentences = response.answer_markdown.split(/[。！？!?]+/u).filter((part) => part.trim());
  if (sentences.length > 3) {
    issues.push({ code: "answer_too_long", path: "answer_markdown", message: "Main answer should contain at most three sentences" });
  }
  if (response.meta.intent === "overview" && response.meta.answer_status === "answered") {
    if (response.actions.length < 3 || response.actions.length > 4) {
      issues.push({ code: "overview_actions", path: "actions", message: "Overview requires three or four narrowing actions" });
    }
  }
  if (response.meta.answer_status === "needs_clarification") {
    if (!response.clarification) {
      issues.push({ code: "missing_clarification", path: "clarification", message: "Clarification payload is required" });
    }
    if (response.actions.length > 4) {
      issues.push({ code: "clarification_actions", path: "actions", message: "Clarification supports at most four actions" });
    }
  } else if (response.clarification) {
    issues.push({ code: "unexpected_clarification", path: "clarification", message: "Clarification must be null for this status" });
  }
  const main = response.answer_markdown.replace(/\s+/gu, "");
  for (const [index, action] of response.actions.entries()) {
    const normalized = action.value.replace(/\s+/gu, "");
    if (normalized && (main === normalized || main.includes(normalized))) {
      issues.push({ code: "mechanical_repetition", path: `actions.${index}`, message: "Action mechanically repeats the main answer" });
    }
  }
  return issues;
}

