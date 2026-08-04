import { describe, expect, it } from "vitest";
import { evaluateEvidenceSufficiency } from "@policy/runtime/index";

type HitOptions = {
  regionCode?: string;
  documentId?: string;
  chunkId?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  status?: "effective" | "expired" | "draft" | "unknown";
  versionGroup?: string;
};

function hit(content: string, options: HitOptions = {}) {
  const documentId = options.documentId ?? "policy-1";
  return {
    document_id: documentId,
    chunk_id: options.chunkId ?? `${documentId}-chunk-1`,
    title: "育儿补贴政策",
    content,
    section_path: ["办理规则"],
    effective_from: options.effectiveFrom ?? "2025-01-01",
    effective_to: options.effectiveTo ?? null,
    status: options.status ?? "effective",
    metadata: {
      document_id: documentId,
      region_code: options.regionCode ?? "100000",
      effective_from: options.effectiveFrom ?? "2025-01-01",
      effective_to: options.effectiveTo ?? null,
      status: options.status ?? "effective",
      version_group: options.versionGroup ?? "childcare-current",
    },
  };
}

describe("evidence sufficiency structural repair matrix", () => {
  it.each([
    ["exact target", "130100", "130100", true],
    ["legal province ancestor", "130100", "130000", true],
    ["sibling prefecture", "130100", "130200", false],
    ["foreign province", "130100", "110000", false],
    ["child cannot support parent", "130000", "130100", false],
  ])("validates the region hierarchy: %s", (_name, target, evidence, sufficient) => {
    const result = evaluateEvidenceSufficiency(
      "石家庄育儿补贴多少钱？",
      "amount",
      [hit("育儿补贴标准为每孩每年3600元。", { regionCode: evidence })],
      target,
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(sufficient);
    if (!sufficient) expect(result.reason_codes).toContain("region_mismatch");
  });

  it("does not use national evidence for a local implementation detail", () => {
    const result = evaluateEvidenceSufficiency(
      "杭州育儿补贴从哪个本地小程序办理？",
      "channel",
      [hit("申请人可以通过全国育儿补贴信息管理系统申请。")],
      "330100",
      { effectiveDate: "2026-08-04" },
    );
    expect(result).toMatchObject({ sufficient: false, missing_claims: ["channel:330100"] });
  });

  it("does not use national eligibility as a complete local eligibility rule", () => {
    const result = evaluateEvidenceSufficiency(
      "河北哪些孩子有育儿补贴申请资格？",
      "eligibility",
      [hit("补贴对象为符合法律法规规定生育的3周岁以下婴幼儿。")],
      "130000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("region_mismatch");
  });

  it("does not concatenate region and amount across hits", () => {
    const result = evaluateEvidenceSufficiency(
      "石家庄育儿补贴多少钱？",
      "amount",
      [
        hit("本通知适用于石家庄市。", { regionCode: "130100", documentId: "sjz" }),
        hit("育儿补贴标准为每孩每年3600元。", { regionCode: "130200", documentId: "tangshan" }),
      ],
      "130100",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(false);
    expect(result.evidence_bindings).toHaveLength(0);
  });

  it("requires every claim in a compound question", () => {
    const result = evaluateEvidenceSufficiency(
      "河北育儿补贴多少钱，谁能领，发到哪张卡？",
      "amount",
      [
        hit("补贴标准为每孩每年3600元。", { regionCode: "130000" }),
        hit("申请人为婴幼儿父母一方。", { regionCode: "130000", documentId: "claimant" }),
      ],
      "130000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(false);
    expect(result.required_claims.map((claim) => claim.type)).toEqual(expect.arrayContaining(["amount", "claimant", "payment_account"]));
    expect(result.missing_claims).toContain("payment_account:130000");
  });

  it("requires both regions and all requested dimensions for comparisons", () => {
    const result = evaluateEvidenceSufficiency(
      "河北和北京的金额、领取条件有什么区别？",
      "comparison",
      [
        hit("补贴标准为每孩每年3600元，申领对象为本地户籍家庭。", { regionCode: "130000", documentId: "hebei" }),
        hit("补贴标准为每孩每年3600元。", { regionCode: "110000", documentId: "beijing" }),
      ],
      null,
      {
        effectiveDate: "2026-08-04",
        comparisonRegions: [{ name: "河北省", code: "130000" }, { name: "北京市", code: "110000" }],
      },
    );
    expect(result.sufficient).toBe(false);
    expect(result.missing_claims).toContain("eligibility:110000");
    expect(result.evidence_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ claim_id: "amount:130000", document_id: "hebei" }),
      expect.objectContaining({ claim_id: "amount:110000", document_id: "beijing" }),
    ]));
  });

  it("requires an explicit migration rule rather than a household-registration keyword", () => {
    const result = evaluateEvidenceSufficiency(
      "户籍刚迁入河北还能申请吗？",
      "migration",
      [hit("申请人应当具有河北省户籍。", { regionCode: "130000" })],
      "130000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result).toMatchObject({ sufficient: false, missing_claims: ["migration:130000"] });
  });

  it("binds an explicit stop-payment rule after moving out", () => {
    const result = evaluateEvidenceSufficiency(
      "孩子迁出呼和浩特后，育儿补贴什么时候停止发放？",
      "migration",
      [hit("孩子死亡或户籍迁出呼和浩特市的，次年停止发放育儿补贴。", { regionCode: "150100" })],
      "150100",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(true);
  });

  it("binds a concrete first-application deadline", () => {
    const result = evaluateEvidenceSufficiency(
      "北京2022年至2024年出生孩子首次申请截止到什么时候？",
      "deadline",
      [hit("对于2025年1月1日以前出生的婴幼儿，首次申请应在2025年12月31日前提出。", { regionCode: "110000" })],
      "110000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(true);
  });

  it("does not treat an explicit policy transition as contradictory active evidence", () => {
    const result = evaluateEvidenceSufficiency(
      "云南原来每年800元的政策如何衔接？",
      "amount",
      [hit("原育儿补助政策每孩每年800元，统一调整为国家育儿补贴每孩每年3600元。", { regionCode: "530000" })],
      "530000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.conflicts).toHaveLength(0);
  });

  it.each([
    ["expired", hit("补贴标准为每孩每年2400元。", { regionCode: "130000", effectiveTo: "2024-12-31", status: "expired" })],
    ["future", hit("补贴标准为每孩每年4800元。", { regionCode: "130000", effectiveFrom: "2027-01-01" })],
    ["unknown date", hit("补贴标准为每孩每年3600元。", { regionCode: "130000", effectiveFrom: "unknown" })],
  ])("rejects %s policy evidence", (_name, evidence) => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴多少钱？", "amount", [evidence], "130000", { effectiveDate: "2026-08-04" });
    expect(result.sufficient).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.reason_codes).toContain("version_conflict");
  });

  it("reports conflicting active versions instead of combining them", () => {
    const result = evaluateEvidenceSufficiency(
      "河北育儿补贴多少钱？",
      "amount",
      [
        hit("补贴标准为每孩每年2400元。", { regionCode: "130000", documentId: "old", versionGroup: "hebei-childcare" }),
        hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "new", versionGroup: "hebei-childcare" }),
      ],
      "130000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(false);
    expect(result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "contradictory_evidence" })]));
  });

  it("records a retrieval miss when the supporting hit is outside Top 5", () => {
    const wrong = Array.from({ length: 5 }, (_, index) => hit("这是一般政策背景。", { regionCode: "130000", documentId: `wrong-${index}` }));
    const result = evaluateEvidenceSufficiency(
      "河北育儿补贴多少钱？",
      "amount",
      [...wrong, hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "top-6" })],
      "130000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("retrieval_miss");
  });
});
