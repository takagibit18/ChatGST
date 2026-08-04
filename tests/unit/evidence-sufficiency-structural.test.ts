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
  policyNumber?: string;
  implementationOf?: string;
  parentPolicyId?: string;
  supersedes?: string;
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
      policy_number: options.policyNumber,
      implementation_of: options.implementationOf,
      parent_policy_id: options.parentPolicyId,
      supersedes: options.supersedes,
    },
  };
}

describe("evidence sufficiency structural repair matrix", () => {
  it.each([
    ["福建省双胞胎或多胞胎，同一胎的孩子都能享受育儿补贴吗？", "eligibility", "符合法律法规规定生育双胞胎或多胞胎子女的，同胎次子女均可享受育儿补贴。", "350000"],
    ["云南首次申领最晚可以在孩子出生后的哪个年度提出？", "deadline", "申领人应当在婴幼儿出生当年或次年提出首次申请。", "530000"],
    ["陕西育儿补帖一季啥时候发到位？", "payment_schedule", "原则上按季度集中发放，在每季度最后一日前及时足额发放到位。", "610000"],
    ["陕西对市县自行制定或提标作了什么限制？", "governance", "各市级行政区域内执行统一政策及标准，县级以下政府不得自行出台育儿补贴政策或标准。", "610000"],
  ])("recognizes an explicit claim instead of failing open: %s", (question, claimType, content, regionCode) => {
    const result = evaluateEvidenceSufficiency(question, "unknown", [hit(content, { regionCode })], regionCode);
    expect(result.sufficient).toBe(true);
    expect(result.required_claims.map((claim) => claim.type)).toContain(claimType);
  });

  it.each([
    ["上海市现阶段每个孩子一年发多少育儿补贴？", "amount", "补贴标准为每孩每年3600元。", "310000"],
    ["河北一个宝宝一年能拿多钱补贴？", "amount", "补贴标准为每孩每年3600元。", "130000"],
    ["吉林省不能在线申请育儿补贴时，可以到哪里现场办理？", "channel", "可到婴幼儿户籍所在地街道办事处现场办理。", "220000"],
    ["河北育儿补贴能网上办，也能去街道办吗？", "channel", "可线上申请，也可到街道办事处现场办理。", "130000"],
    ["重庆育儿补贴审核通过后通常在哪几个月发？", "payment_schedule", "分别于5月、8月、11月和次年2月发放。", "500000"],
    ["河北补贴审核完啥时候打钱？", "payment_schedule", "审核确认后10个工作日发放到账。", "130000"],
    ["首次申请可以延到什么时候？", "deadline", "首次申请应在婴幼儿出生当年或者次年提出。", "130000"],
    ["首次申请和后续续领分别在哪些年度？", "deadline", "首次申请在出生当年提出，后续两个年度分别续领。", "130000"],
    ["福建育儿补贴制度从哪一天开始实施？", "effective_version", "本制度自2025年1月1日起实施。", "350000"],
    ["河北育儿补贴何时开始实施？", "effective_version", "本制度从2025年1月1日起开始实施。", "130000"],
  ])("recovers reusable claim extraction and support-span variants: %s", (question, claimType, content, regionCode) => {
    const result = evaluateEvidenceSufficiency(question, "overview", [hit(content, { regionCode })], regionCode);
    expect(result.sufficient).toBe(true);
    expect(result.required_claims.map((claim) => claim.type)).toContain(claimType);
  });

  it.each([
    ["deadline", "河北育儿补贴申请截止日期是什么？", "申请截止日期为2026年8月31日。", "申请截止日期为2026年9月30日。"],
    ["payment_schedule", "河北育儿补贴第一批仅在哪个月到账？", "第一批仅在2月发放到账。", "第一批仅在3月发放到账。"],
    ["channel", "河北育儿补贴能在线申请吗？", "育儿补贴仅可通过线上政务平台申请。", "育儿补贴不得通过线上政务平台申请。"],
    ["migration", "迁出河北后补贴是否继续发放？", "户籍迁出后继续发放育儿补贴。", "户籍迁出后停止发放育儿补贴。"],
  ])("blocks contradictory high-risk %s evidence", (_type, question, left, right) => {
    const result = evaluateEvidenceSufficiency(question, "unknown", [
      hit(left, { regionCode: "130000", documentId: "left", versionGroup: "same-policy" }),
      hit(right, { regionCode: "130000", documentId: "right", versionGroup: "same-policy" }),
    ], "130000");
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("contradictory_evidence");
  });

  it("fails closed when no required claim can be built", () => {
    const result = evaluateEvidenceSufficiency(
      "介绍一下",
      "overview",
      [hit("育儿补贴标准为每孩每年3600元。", { regionCode: "130000" })],
      "130000",
    );
    expect(result).toMatchObject({ sufficient: false, required_claims: [], supported_claims: [], missing_claims: [],
      evidence_bindings: [], conflicts: [], reason_codes: ["no_required_claims"], reason: "missing_requested_detail" });
  });

  it.each([
    [[], "missing_comparison_regions"],
    [[{ name: "河北省", code: "130000" }], "missing_comparison_regions"],
    [[{ name: "河北省", code: "130000" }, { name: "河北", code: "130000" }], "duplicate_comparison_regions"],
  ])("fails closed for invalid comparison scope %#", (comparisonRegions, reasonCode) => {
    const result = evaluateEvidenceSufficiency("两地有什么区别？", "comparison", [hit("补贴标准为每孩每年3600元。")], null, { comparisonRegions });
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("invalid_comparison_scope");
    expect(result.reason_codes).toContain(reasonCode);
  });

  it("rejects a cross-claim bundle from unrelated policy versions", () => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴多少钱，去哪里申请？", "amount", [
      hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "policy-a", versionGroup: "version-a" }),
      hit("可通过政务服务平台申请。", { regionCode: "130000", documentId: "policy-b", versionGroup: "version-b" }),
    ], "130000");
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toEqual(expect.arrayContaining(["incompatible_policy_bundle", "cross_claim_version_conflict"]));
  });

  it("accepts multiple claims from the same document", () => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴多少钱，去哪里申请？", "amount", [
      hit("补贴标准为每孩每年3600元，可通过政务服务平台申请。", { regionCode: "130000", documentId: "policy-a", versionGroup: "unknown" }),
    ], "130000");
    expect(result.sufficient).toBe(true);
  });

  it("accepts an explicit national-to-local implementation relationship", () => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴多少钱，去哪里申请？", "amount", [
      hit("补贴标准为每孩每年3600元。", { regionCode: "100000", documentId: "national", versionGroup: "national-v1", policyNumber: "国育发1号" }),
      hit("可通过河北政务服务平台申请。", { regionCode: "130000", documentId: "local", versionGroup: "local-v1", implementationOf: "national" }),
    ], "130000");
    expect(result.sufficient).toBe(true);
  });

  it("rejects a partially connected policy bundle with an unrelated document", () => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴多少钱，去哪里申请，截止日期是什么？", "amount", [
      hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "national", versionGroup: "national-v1" }),
      hit("可通过河北政务服务平台申请。", { regionCode: "130000", documentId: "local", versionGroup: "local-v1", implementationOf: "national" }),
      hit("申请截止日期为2026年8月31日。", { regionCode: "130000", documentId: "unrelated", versionGroup: "unrelated-v1" }),
    ], "130000");
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("disconnected_policy_bundle");
  });

  it("accepts a fully connected national-province-city policy chain", () => {
    const result = evaluateEvidenceSufficiency("石家庄育儿补贴多少钱，去哪里申请，截止日期是什么？", "amount", [
      hit("补贴标准为每孩每年3600元。", { regionCode: "100000", documentId: "national", versionGroup: "national-v1" }),
      hit("可通过河北政务服务平台申请。", { regionCode: "130000", documentId: "province", versionGroup: "hebei-v1", implementationOf: "national" }),
      hit("首次申请截止日期为2026年8月31日。", { regionCode: "130100", documentId: "city", versionGroup: "sjz-v1", parentPolicyId: "province" }),
    ], "130100");
    expect(result.sufficient).toBe(true);
    expect(result.evidence_bundles[0]).toMatchObject({ compatible: true });
  });

  it("rejects a bundle composed from two disconnected policy subgraphs", () => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴多少钱，去哪里申请，截止日期是什么，多久到账？", "amount", [
      hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "a", versionGroup: "a-v1" }),
      hit("可通过河北政务服务平台申请。", { regionCode: "130000", documentId: "b", versionGroup: "b-v1", implementationOf: "a" }),
      hit("首次申请截止日期为2026年8月31日。", { regionCode: "130000", documentId: "c", versionGroup: "c-v1" }),
      hit("审核后10个工作日发放到账。", { regionCode: "130000", documentId: "d", versionGroup: "d-v1", parentPolicyId: "c" }),
    ], "130000");
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("disconnected_policy_bundle");
  });

  it("uses the active successor without mixing superseded evidence", () => {
    const result = evaluateEvidenceSufficiency("河北现行育儿补贴多少钱？", "amount", [
      hit("补贴标准为每孩每年2400元。", { regionCode: "130000", documentId: "old", versionGroup: "hebei-old", effectiveFrom: "2024-01-01" }),
      hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "new", versionGroup: "hebei-new", effectiveFrom: "2025-01-01", supersedes: "old" }),
    ], "130000", { effectiveDate: "2026-08-04" });
    expect(result.sufficient).toBe(true);
    expect(result.evidence_bindings.map((binding) => binding.document_id)).toEqual(["new"]);
  });

  it("uses the predecessor for a historical query before the successor takes effect", () => {
    const result = evaluateEvidenceSufficiency("河北2024年育儿补贴多少钱？", "amount", [
      hit("补贴标准为每孩每年2400元。", { regionCode: "130000", documentId: "old", versionGroup: "hebei-old", effectiveFrom: "2024-01-01" }),
      hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "new", versionGroup: "hebei-new", effectiveFrom: "2025-01-01", supersedes: "old" }),
    ], "130000", { effectiveDate: "2024-08-04" });
    expect(result.sufficient).toBe(true);
    expect(result.evidence_bindings.map((binding) => binding.document_id)).toEqual(["old"]);
  });

  it("fails closed when multiple documents have unknown compatibility metadata", () => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴多少钱，去哪里申请？", "amount", [
      hit("补贴标准为每孩每年3600元。", { regionCode: "130000", documentId: "a", versionGroup: "" }),
      hit("可通过河北政务服务平台申请。", { regionCode: "130000", documentId: "b", versionGroup: "" }),
    ], "130000");
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("unknown_policy_compatibility");
  });

  it("builds compatible bundles independently for comparison regions", () => {
    const result = evaluateEvidenceSufficiency("河北和北京的补贴金额、领取条件有什么区别？", "comparison", [
      hit("补贴标准为每孩每年3600元，申领对象为本地户籍家庭。", { regionCode: "130000", documentId: "hebei", versionGroup: "hb-v1" }),
      hit("补贴标准为每孩每年4200元，申领对象为本地户籍家庭。", { regionCode: "110000", documentId: "beijing", versionGroup: "bj-v9" }),
    ], null, { comparisonRegions: [{ name: "河北省", code: "130000" }, { name: "北京市", code: "110000" }] });
    expect(result.sufficient).toBe(true);
    expect(result.evidence_bundles).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_region_code: "130000", compatible: true }),
      expect.objectContaining({ target_region_code: "110000", compatible: true }),
    ]));
  });
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
      [
        hit("现行育儿补贴标准为每孩每年3600元。", { regionCode: "530000", documentId: "yunnan", chunkId: "current" }),
        hit("原育儿补助政策每孩每年800元，统一调整为国家育儿补贴每孩每年3600元。", { regionCode: "530000", documentId: "yunnan", chunkId: "transition" }),
      ],
      "530000",
      { effectiveDate: "2026-08-04" },
    );
    expect(result.sufficient).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it.each([
    ["eligibility", "河北哪些家庭符合育儿补贴条件？", "申领条件包括3周岁以下婴幼儿。", "申领条件包括本地户籍家庭。"],
    ["channel", "河北育儿补贴可以通过哪些渠道申请？", "可通过政务小程序申请。", "也可通过街道窗口申请。"],
    ["materials", "河北育儿补贴需要哪些材料？", "申请材料需要提供身份证。", "申请材料需要提供出生医学证明。"],
    ["payment_schedule", "河北育儿补贴分几批发放？", "第一批在2月发放。", "第二批在8月发放。"],
  ])("keeps complementary %s facts as a set", (_type, question, left, right) => {
    const result = evaluateEvidenceSufficiency(question, "unknown", [
      hit(left, { regionCode: "130000", documentId: "left", versionGroup: "same-policy" }),
      hit(right, { regionCode: "130000", documentId: "right", versionGroup: "same-policy" }),
    ], "130000");
    expect(result.sufficient).toBe(true);
    expect(result.evidence_bindings.map((binding) => binding.document_id)).toEqual(expect.arrayContaining(["left", "right"]));
    expect(result.reason_codes).not.toContain("contradictory_evidence");
  });

  it("keeps scalar amounts with different age qualifiers", () => {
    const result = evaluateEvidenceSufficiency("河北不同年龄段的育儿补贴分别多少钱？", "amount", [
      hit("补贴标准为0至1岁每孩每年3600元。", { regionCode: "130000", documentId: "infant", versionGroup: "same-policy" }),
      hit("补贴标准为1至3岁每孩每年2400元。", { regionCode: "130000", documentId: "toddler", versionGroup: "same-policy" }),
    ], "130000");
    expect(result.sufficient).toBe(true);
    expect(result.reason_codes).not.toContain("contradictory_evidence");
  });

  it("blocks mutually exclusive channel rules", () => {
    const result = evaluateEvidenceSufficiency("河北育儿补贴能在线申请吗？", "channel", [
      hit("育儿补贴仅可通过线上政务平台申请。", { regionCode: "130000", documentId: "online-only", versionGroup: "same-policy" }),
      hit("育儿补贴不得通过线上政务平台申请。", { regionCode: "130000", documentId: "online-forbidden", versionGroup: "same-policy" }),
    ], "130000");
    expect(result.sufficient).toBe(false);
    expect(result.reason_codes).toContain("contradictory_evidence");
  });

  it("distinguishes migration directions while blocking opposite outcomes for the same direction", () => {
    const complementary = evaluateEvidenceSufficiency("河北户籍迁入和迁出分别怎么办？", "migration", [
      hit("户籍迁入后需要重新申请育儿补贴。", { regionCode: "130000", documentId: "move-in", versionGroup: "same-policy" }),
      hit("户籍迁出后停止发放育儿补贴。", { regionCode: "130000", documentId: "move-out", versionGroup: "same-policy" }),
    ], "130000");
    expect(complementary.sufficient).toBe(true);

    const contradictory = evaluateEvidenceSufficiency("迁出河北后补贴是否继续发放？", "migration", [
      hit("户籍迁出后继续发放育儿补贴。", { regionCode: "130000", documentId: "continue", versionGroup: "same-policy" }),
      hit("户籍迁出后停止发放育儿补贴。", { regionCode: "130000", documentId: "stop", versionGroup: "same-policy" }),
    ], "130000");
    expect(contradictory.sufficient).toBe(false);
    expect(contradictory.reason_codes).toContain("contradictory_evidence");
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
