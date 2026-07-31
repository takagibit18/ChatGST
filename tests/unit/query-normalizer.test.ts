import { describe, expect, it } from "vitest";
import { normalizePolicyQuery } from "@policy/runtime/index";
import type { ConversationState } from "@policy/session/index";
import { testConfig } from "../helpers.js";

function clarificationState(): ConversationState {
  return {
    conversation_id: "query-normalizer-session",
    turn_count: 1,
    clarification_count: 1,
    active_domain: "childcare-subsidy",
    intent: "eligibility",
    confirmed_slots: {},
    missing_slots: ["region"],
    messages: [
      { role: "user", content: "我能不能领补贴" },
      { role: "assistant", content: "请选择地区" },
    ],
    evidence_refs: [],
    created_at: "2026-07-31T00:00:00.000Z",
    last_active_at: "2026-07-31T00:00:00.000Z",
  };
}

describe("citizen query normalization", () => {
  it("recognizes colloquial eligibility and preserves it after a region clarification", () => {
    const first = normalizePolicyQuery("我能不能领补贴", null);
    expect(first).toMatchObject({ intent: "eligibility", intentConfidence: "high", region: null, missingSlots: ["region"] });

    const second = normalizePolicyQuery("北京", clarificationState());
    expect(second).toMatchObject({ intent: "eligibility", intentConfidence: "high", region: "北京市" });
    expect(second.retrievalQuery).toBe("我能不能领补贴 北京 育儿补贴 申请资格 补贴对象 申领条件");
  });

  it.each([
    ["北京一年给多少钱", "amount"],
    ["河北这个补贴去哪领", "channel"],
    ["北京这个咋整", "unknown"],
  ] as const)("maps %s to %s with the expected confidence", (message, intent) => {
    const result = normalizePolicyQuery(message, null);
    expect(result.intent).toBe(intent);
    expect(result.intentConfidence).toBe(intent === "unknown" ? "low" : "high");
  });

  it("defaults the configurable session limit to twenty", () => {
    expect(testConfig().budget.maxSessionTurns).toBe(20);
  });

  it("does not inherit stale policy context for assistant identity questions", () => {
    const result = normalizePolicyQuery("你是什么模型", clarificationState());
    expect(result).toMatchObject({ intent: "unknown", region: null, outOfScope: true, missingSlots: [] });
  });

  it("still inherits the region for an explicit policy follow-up", () => {
    const state = { ...clarificationState(), confirmed_slots: { region: "北京市" }, missing_slots: [], intent: "eligibility" as const };
    const result = normalizePolicyQuery("申请材料", state);
    expect(result).toMatchObject({ intent: "materials", region: "北京市", outOfScope: false });
    expect(result.retrievalQuery).toContain("出生医学证明");
  });
});
