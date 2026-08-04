import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PiLocalRagRetrievalProvider, conversationScenarioV21Schema, retrievalAnnotationV21Schema, retrievalEvalCaseV21Schema, safetyEvalCaseV21Schema } from "@policy/rag/index";
import { evaluateEvidenceSufficiency, normalizePolicyQuery } from "@policy/runtime/index";
import { assertTrainOnlyCalibrationPath, runEvalV21Input } from "../../scripts/eval-v2-1-runner.js";
import { buildQualityGate, collectFailureGroups, flattenFailureGroups, resolveReleaseGate, type FailureGroups } from "../../scripts/eval-v2-1-quality-gate.js";
import { selectCalibrationCandidate } from "../../scripts/eval-v2-1-calibration.js";
import { buildEvalV21Datasets, type GoldSourceReader } from "../../scripts/validate-eval-v2-1.js";

async function jsonl(path: string): Promise<unknown[]> {
  return (await readFile(resolve(path), "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

const emptyFailureGroups = (): FailureGroups => ({
  dev_failures: [], regression_failures: [], conversation_failures: [], safety_failures: [],
});

describe("Eval v2.1 anti-circular governance", () => {
  it("keeps the exact inventory pending review and source-first", async () => {
    const train = (await jsonl("domains/childcare-subsidy/evals/v2.1/datasets/retrieval.train.jsonl")).map((item) => retrievalEvalCaseV21Schema.parse(item));
    const dev = (await jsonl("domains/childcare-subsidy/evals/v2.1/datasets/retrieval.dev.jsonl")).map((item) => retrievalEvalCaseV21Schema.parse(item));
    const regression = (await jsonl("domains/childcare-subsidy/evals/v2.1/datasets/regression-v1.jsonl")).map((item) => retrievalEvalCaseV21Schema.parse(item));
    expect(train).toHaveLength(50); expect(dev).toHaveLength(30); expect(regression).toHaveLength(13);
    expect([...train, ...dev, ...regression].every((item) => item.source_review_status === "pending_review")).toBe(true);
    expect([...train, ...dev, ...regression].every((item) => item.annotation_method === "source_first" && !item.retriever_used_for_labeling)).toBe(true);
    expect([...train, ...dev].filter((item) => item.category === "no_answer")).toHaveLength(10);
    expect([...train, ...dev].filter((item) => item.category === "missing_region")).toHaveLength(6);
  });

  it("builds Gold while a search capability throws", async () => {
    const provider = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
    const reader = {
      listKnowledgeDocuments: provider.listKnowledgeDocuments.bind(provider),
      getKnowledgeDocument: provider.getKnowledgeDocument.bind(provider),
      search: async () => { throw new Error("search must not be called while building Gold"); },
    } satisfies GoldSourceReader & { search: () => Promise<never> };
    const annotation = retrievalAnnotationV21Schema.parse((await jsonl("domains/childcare-subsidy/evals/v2.1/annotations/retrieval.jsonl"))[0]);
    await expect(buildEvalV21Datasets(reader, [annotation])).resolves.toHaveLength(1);
  });

  it("binds complete atomic claims to exact source spans", async () => {
    const annotations = (await jsonl("domains/childcare-subsidy/evals/v2.1/annotations/retrieval.jsonl")).map((item) => retrievalAnnotationV21Schema.parse(item));
    for (const item of annotations.filter((entry) => entry.answerable)) {
      const claims = item.gold_evidence.flatMap((entry) => entry.claims.map((claim) => claim.text));
      expect(item.required_facts).toEqual(claims);
      expect(claims.every((claim) => /[。！？]$/u.test(claim) && claim.replace(/\s+/gu, "").length >= 12)).toBe(true);
      expect(item.gold_evidence.every((entry) => entry.chunk_char_end - entry.chunk_char_start === entry.supporting_text.length)).toBe(true);
      expect(item.gold_evidence.every((entry) => entry.supporting_text.length !== 180)).toBe(true);
    }
  });

  it("contains no repeated conversation transcript or shared safety template", async () => {
    const conversations = (await jsonl("domains/childcare-subsidy/evals/v2.1/annotations/conversations.jsonl")).map((item) => conversationScenarioV21Schema.parse(item));
    const transcripts = conversations.map((scenario) => scenario.turns.map((turn) => turn.user.replace(/\s+/gu, "")).join("|"));
    expect(new Set(transcripts).size).toBe(20);
    const safety = (await jsonl("domains/childcare-subsidy/evals/v2.1/annotations/safety.jsonl")).map((item) => safetyEvalCaseV21Schema.parse(item));
    const forbidden = safety.map((item) => [...item.forbidden_behavior].sort().join("|"));
    expect(new Set(forbidden).size).toBe(30);
  });

  it("preserves every v1 regression question verbatim", async () => {
    const legacy = JSON.parse(await readFile(resolve("domains/childcare-subsidy/evals/cases.json"), "utf8")) as Array<{ id: string; question: string }>;
    const regression = (await jsonl("domains/childcare-subsidy/evals/v2.1/annotations/regression-v1.jsonl")).map((item) => retrievalAnnotationV21Schema.parse(item));
    const byLegacyId = new Map(regression.map((item) => [item.legacy_case_id, item.question]));
    expect(legacy.every((item) => byLegacyId.get(item.id) === item.question)).toBe(true);
  });

  it("does not let hidden Gold alter runner predictions", async () => {
    const provider = { search: async () => { throw new Error("missing-region input must not search"); } };
    const input = { id: "isolation", question: "育儿补贴怎么办？", user_region: null, effective_date: "2026-08-02" };
    const left = await runEvalV21Input(provider as never, { ...input, expected_behavior: "answer", relevant_documents: ["poison"] }, 1);
    const right = await runEvalV21Input(provider as never, { ...input, expected_behavior: "no_answer", relevant_documents: [] }, 1);
    expect(left).toEqual(right);
    expect(left.predicted_behavior).toBe("clarify_region");
  });

  it("rejects dev and test calibration paths", () => {
    expect(() => assertTrainOnlyCalibrationPath("retrieval.train.jsonl")).not.toThrow();
    expect(() => assertTrainOnlyCalibrationPath("retrieval.dev.jsonl")).toThrow(/train/u);
    expect(() => assertTrainOnlyCalibrationPath("retrieval.test.jsonl")).toThrow(/train/u);
  });

  it("stores label-free raw predictions and keeps report diagnostics and gates internally consistent", async () => {
    const rawText = await readFile(resolve("domains/childcare-subsidy/evals/v2.1/runs/phase3-v21-raw-predictions.json"), "utf8");
    expect(rawText).not.toContain("expected_behavior"); expect(rawText).not.toContain("relevant_documents"); expect(rawText).not.toContain("required_facts");
    const report = JSON.parse(await readFile(resolve("domains/childcare-subsidy/evals/v2.1/reports/phase3-v21-provisional.json"), "utf8")) as {
      evaluation_status: string; release_gate: string; quality_claim_allowed: boolean; diagnostic_failures: string[];
      failure_groups: FailureGroups;
      retrieval: { dev: { case_results: Array<{ case_id: string; expected: string; predicted: string; document_hit: boolean | null }> }; regression: { case_results: Array<{ case_id: string; expected: string; predicted: string; document_hit: boolean | null }> } };
      conversations: { stale_context_leakage_rate: number; case_results: Array<{ scenario_id: string; passed: boolean }> };
      safety: { case_results: Array<{ case_id: string; passed: boolean }> };
      quality_gate: { status: string; passed: boolean; requirements: Record<string, { passed: boolean }>; failure_reasons: string[] };
    };
    const expectedGroups = collectFailureGroups({
      dev: report.retrieval.dev.case_results,
      regression: report.retrieval.regression.case_results,
      conversations: report.conversations.case_results,
      safety: report.safety.case_results,
    });
    const allRequirementsPassed = Object.values(report.quality_gate.requirements).every((requirement) => requirement.passed);
    const hasAutomatedFailure = flattenFailureGroups(expectedGroups).length > 0 || report.conversations.stale_context_leakage_rate > 0;

    expect(report).toMatchObject({ evaluation_status: "provisional", quality_claim_allowed: false });
    expect(report.failure_groups).toEqual(expectedGroups);
    expect(report.diagnostic_failures).toEqual(flattenFailureGroups(expectedGroups));
    expect(report.quality_gate.passed).toBe(allRequirementsPassed);
    if (hasAutomatedFailure) expect(report.quality_gate.passed).toBe(false);
    expect(report.release_gate).toBe(resolveReleaseGate({ qualityGatePassed: report.quality_gate.passed, humanReviewComplete: false }));
  });
});

describe("Eval v2.1 quality gate invariants", () => {
  const passingInput = () => ({
    regressionCases: 5,
    regressionCorrect: 5,
    regressionNoAnswerRecall: 1,
    failureGroups: emptyFailureGroups(),
    staleContextLeakageRate: 0,
  });

  it("blocks when regression passes but safety has a failure", () => {
    const input = passingInput(); input.failureGroups.safety_failures = ["safety-critical"];
    expect(buildQualityGate(input)).toMatchObject({ passed: false, failure_reasons: ["safety_failures_present"] });
  });

  it("blocks when regression passes but conversation has a failure", () => {
    const input = passingInput(); input.failureGroups.conversation_failures = ["conversation-critical"];
    expect(buildQualityGate(input)).toMatchObject({ passed: false, failure_reasons: ["conversation_failures_present"] });
  });

  it("blocks when all failure groups are empty but stale context leaks", () => {
    const input = passingInput(); input.staleContextLeakageRate = 0.25;
    expect(buildQualityGate(input)).toMatchObject({ passed: false, failure_reasons: ["stale_context_leakage_present"] });
  });

  it("passes all automatic gates but remains blocked while human review is pending", () => {
    const qualityGate = buildQualityGate(passingInput());
    expect(qualityGate).toMatchObject({ status: "passed", passed: true, failure_reasons: [] });
    expect(resolveReleaseGate({ qualityGatePassed: qualityGate.passed, humanReviewComplete: false })).toBe("blocked_pending_human_review");
    expect(resolveReleaseGate({ qualityGatePassed: false, humanReviewComplete: false })).toBe("blocked_quality_gate");
  });

  it("flattens failure groups into an exact de-duplicated union", () => {
    const groups: FailureGroups = {
      dev_failures: ["shared", "dev-only"], regression_failures: ["shared", "regression-only"],
      conversation_failures: ["conversation-only"], safety_failures: ["shared", "safety-only"],
    };
    expect(flattenFailureGroups(groups)).toEqual(["shared", "dev-only", "regression-only", "conversation-only", "safety-only"]);
  });

  it("uses real integer counts and stable reasons when regression inventory changes", () => {
    const qualityGate = buildQualityGate(passingInput());
    expect(qualityGate.requirements.regression_behavior).toMatchObject({
      actual_correct: 5, required_correct: 5, total: 5, actual_accuracy: 1, required_accuracy: 1, passed: true,
    });
    expect(qualityGate.failure_reasons.join("|")).not.toContain("13_of_13");
  });

  it("blocks dev and regression failures even when aggregate regression metrics pass", () => {
    for (const [group, reason] of [["dev_failures", "dev_failures_present"], ["regression_failures", "regression_failures_present"]] as const) {
      const input = passingInput(); input.failureGroups[group] = [`${group}-critical`];
      expect(buildQualityGate(input)).toMatchObject({ passed: false, failure_reasons: [reason] });
    }
  });

  it("rejects calibration candidates below the no-answer recall floor", () => {
    const result = selectCalibrationCandidate([
      { threshold: 0, answer_recall: 1, macro_recall: 0.915, no_answer_f1: 0.9, no_answer_recall: 0.83 },
      { threshold: 6, answer_recall: 0.8, macro_recall: 0.9, no_answer_f1: 0.8, no_answer_recall: 1 },
    ]);
    expect(result).toMatchObject({ calibration_status: "passed", eligible_candidate_count: 1, selected: { threshold: 6 } });
  });

  it("fails calibration instead of falling back to threshold zero", () => {
    const result = selectCalibrationCandidate([
      { threshold: 0, answer_recall: 1, macro_recall: 0.9, no_answer_f1: 0.8, no_answer_recall: 0.8 },
    ]);
    expect(result).toMatchObject({ calibration_status: "failed", eligible_candidate_count: 0, selected: null,
      failure_reasons: ["calibration_constraints_not_met"] });
  });
});

describe("nationwide query normalization", () => {
  it("resolves province, prefecture, county and arbitrary comparisons", () => {
    expect(normalizePolicyQuery("上海育儿补贴多少钱？", null)).toMatchObject({ region: "上海市", regionCode: "310000", regionResolution: "resolved" });
    expect(normalizePolicyQuery("济南育儿补贴去哪里办？", null)).toMatchObject({ region: "济南市", regionCode: "370100" });
    expect(normalizePolicyQuery("普陀区育儿补贴怎么办？", null)).toMatchObject({ region: "普陀区", regionCode: "310107" });
    const comparison = normalizePolicyQuery("上海和重庆的育儿补贴有什么不同？", null);
    expect(comparison.region).toBe("对比");
    expect(comparison.comparisonRegions.map((item) => item.code)).toEqual(expect.arrayContaining(["310000", "500000"]));
  });

  it.each([
    ["上海和浙江的育儿补贴有什么区别？", ["310000", "330000"]],
    ["广东和四川补贴标准一样吗？", ["440000", "510000"]],
    ["江苏和安徽谁能领的条件有什么不同？", ["320000", "340000"]],
    ["北京和河北有什么区别？", ["110000", "130000"]],
  ])("recognizes generic regional comparisons: %s", (question, codes) => {
    const result = normalizePolicyQuery(question, null);
    expect(result).toMatchObject({ intent: "comparison", region: "对比", regionCode: null });
    expect(result.comparisonRegions.map((item) => item.code)).toEqual(codes);
  });
});

describe("evidence sufficiency guard", () => {
  const hit = (content: string, regionCode = "100000") => ({ title: "育儿补贴政策", content, section_path: ["办理规则"], metadata: { region_code: regionCode } });

  it("rejects generic retrieval when the requested phone number is absent", () => {
    expect(evaluateEvidenceSufficiency("全国统一育儿补贴客服电话号码是多少？", "channel", [hit("可以线上或现场申请。")], "100000"))
      .toMatchObject({ sufficient: false, reason: "missing_requested_detail" });
  });

  it("accepts an explicit local payment schedule", () => {
    expect(evaluateEvidenceSufficiency("河北育儿补贴具体在哪四个月发放？", "payment", [hit("每年2月、5月、8月和11月集中发放。", "130000")], "130000"))
      .toMatchObject({ sufficient: true });
  });

  it("requires local evidence for a local implementation detail", () => {
    expect(evaluateEvidenceSufficiency("江苏省育儿补贴使用哪个本地政务小程序申请？", "channel", [hit("可通过育儿补贴小程序申请。")], "320000"))
      .toMatchObject({ sufficient: false, reason: "missing_local_evidence" });
  });
});
