import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PiLocalRagRetrievalProvider, conversationScenarioV21Schema, retrievalAnnotationV21Schema, retrievalEvalCaseV21Schema, safetyEvalCaseV21Schema } from "@policy/rag/index";
import { evaluateEvidenceSufficiency, normalizePolicyQuery } from "@policy/runtime/index";
import { assertTrainOnlyCalibrationPath, runEvalV21Input } from "../../scripts/eval-v2-1-runner.js";
import { buildQualityGate, collectFailureGroups, flattenFailureGroups } from "../../scripts/eval-v2-1-quality-gate.js";
import { buildEvalV21Datasets, type GoldSourceReader } from "../../scripts/validate-eval-v2-1.js";

async function jsonl(path: string): Promise<unknown[]> {
  return (await readFile(resolve(path), "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

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

  it("stores label-free raw predictions and reports regression failures as a failed quality gate", async () => {
    const rawText = await readFile(resolve("domains/childcare-subsidy/evals/v2.1/runs/phase3-v21-raw-predictions.json"), "utf8");
    expect(rawText).not.toContain("expected_behavior"); expect(rawText).not.toContain("relevant_documents"); expect(rawText).not.toContain("required_facts");
    const report = JSON.parse(await readFile(resolve("domains/childcare-subsidy/evals/v2.1/reports/phase3-v21-provisional.json"), "utf8")) as {
      evaluation_status: string; release_gate: string; quality_claim_allowed: boolean; diagnostic_failures: string[];
      failure_groups: { dev_failures: string[]; regression_failures: string[]; conversation_failures: string[]; safety_failures: string[] };
      quality_gate: { status: string; passed: boolean; failure_reasons: string[] };
    };
    expect(report).toMatchObject({ evaluation_status: "provisional", release_gate: "blocked_quality_gate", quality_claim_allowed: false });
    expect(report.failure_groups.regression_failures).toHaveLength(6);
    expect(report.diagnostic_failures).toEqual(expect.arrayContaining(report.failure_groups.regression_failures));
    expect(report.quality_gate).toMatchObject({ status: "failed", passed: false });
    expect(report.quality_gate.failure_reasons).toEqual(expect.arrayContaining([
      "regression_behavior_not_13_of_13",
      "regression_no_answer_recall_below_1",
      "regression_failures_present",
    ]));
  });

  it("cannot produce zero diagnostics or a passing gate when regression has a failure", () => {
    const failureGroups = collectFailureGroups({
      dev: [],
      regression: [{ case_id: "regression-failure", expected: "no_answer", predicted: "answer", document_hit: null }],
      conversations: [],
      safety: [],
    });
    const diagnostics = flattenFailureGroups(failureGroups);
    const qualityGate = buildQualityGate({
      regressionCases: 13,
      regressionBehaviorAccuracy: 12 / 13,
      regressionNoAnswerRecall: 0.875,
      regressionFailures: failureGroups.regression_failures,
    });

    expect(failureGroups.regression_failures).toEqual(["regression-failure"]);
    expect(diagnostics).toEqual(["regression-failure"]);
    expect(qualityGate).toMatchObject({ status: "failed", passed: false });

    expect(buildQualityGate({
      regressionCases: 13,
      regressionBehaviorAccuracy: 1,
      regressionNoAnswerRecall: 1,
      regressionFailures: ["regression-document-miss"],
    })).toMatchObject({ status: "failed", passed: false, failure_reasons: ["regression_failures_present"] });

    expect(buildQualityGate({
      regressionCases: 13,
      regressionBehaviorAccuracy: 1,
      regressionNoAnswerRecall: 1,
      regressionFailures: [],
    })).toMatchObject({ status: "passed", passed: true, failure_reasons: [] });
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
