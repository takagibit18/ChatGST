import type { PolicyIntent } from "@policy/schemas/index";
import { isRegionAncestor } from "@policy/rag/index";

export type ClaimType =
  | "amount"
  | "eligibility"
  | "claimant"
  | "materials"
  | "channel"
  | "deadline"
  | "payment_schedule"
  | "payment_account"
  | "migration"
  | "comparison"
  | "contact"
  | "address"
  | "effective_version";

export type RequiredClaim = {
  id: string;
  type: ClaimType;
  target_region_code: string | null;
  comparison_region_code?: string | null;
  required_detail?: string | null;
};

export type EvidenceBinding = {
  claim_id: string;
  document_id: string;
  chunk_id: string;
  region_code: string;
  policy_version?: string | null;
  matched_span: string;
  support_type: "direct" | "inherited";
};

export type EvidenceConflict = {
  type: "expired_evidence" | "future_evidence" | "unknown_effective_date" | "contradictory_evidence";
  claim_ids: string[];
  document_ids: string[];
  reason: string;
};

export type EvidenceSufficiencyReasonCode =
  | "no_hits"
  | "missing_claim"
  | "region_mismatch"
  | "version_conflict"
  | "contradictory_evidence"
  | "retrieval_miss"
  | "supported";

export type EvidenceSufficiencyResult = {
  sufficient: boolean;
  required_claims: RequiredClaim[];
  supported_claims: string[];
  missing_claims: string[];
  evidence_bindings: EvidenceBinding[];
  conflicts: EvidenceConflict[];
  reason_codes: EvidenceSufficiencyReasonCode[];
  /** 兼容 Phase 3.1 的监控字段；判定应读取结构化字段。 */
  reason: "no_hits" | "missing_local_evidence" | "missing_requested_detail" | "supported";
};

type EvidenceCandidate = {
  document_id?: string;
  chunk_id?: string;
  title: string;
  content: string;
  section_path?: string[];
  effective_from?: string;
  effective_to?: string | null;
  status?: "effective" | "expired" | "draft" | "unknown";
  metadata?: {
    document_id?: string | undefined;
    region_code?: string | undefined;
    effective_from?: string | undefined;
    effective_to?: string | null | undefined;
    status?: "effective" | "expired" | "draft" | "unknown" | undefined;
    version_group?: string | undefined;
    policy_number?: string | null | undefined;
  };
};

export type EvidenceSufficiencyOptions = {
  effectiveDate?: string;
  comparisonRegions?: Array<{ name: string; code: string }>;
};

const localImplementationClaims = new Set<ClaimType>([
  "amount", "materials", "channel", "deadline", "payment_schedule", "payment_account", "migration", "contact", "address",
]);

const supportPatterns: Record<ClaimType, RegExp[]> = {
  amount: [/(?:补贴|标准|金额).{0,24}(?:\d[\d,.]*|[一二三四五六七八九十百千万]+)\s*元|(?:\d[\d,.]*|[一二三四五六七八九十百千万]+)\s*元.{0,24}(?:补贴|标准|金额)/u],
  eligibility: [/(?:申领|申请|补贴)(?:对象|条件|资格)|符合.{0,20}条件|(?:婴幼儿|家庭|儿童).{0,20}(?:户籍|周岁|月龄|资格)|(?:本地|当地|本省|本市).{0,12}户籍.{0,12}(?:家庭|婴幼儿|儿童)/u],
  claimant: [/(?:申请人|申领人|经办人).{0,24}(?:父母|监护人|一方|本人)|(?:父母|监护人).{0,18}(?:申请|申领|办理)/u],
  materials: [/(?:提交|提供|携带|所需|申请材料).{0,28}(?:证明|证件|户口簿|身份证|材料)|(?:材料清单|补充材料)/u],
  channel: [/(?:通过|登录|前往|可在).{0,28}(?:小程序|平台|系统|窗口|街道|乡镇|线上|线下)|(?:申请|申领|办理)(?:渠道|入口)/u],
  deadline: [/(?:截止|期限|时限|应于|之日起).{0,24}(?:\d|日|月|年|工作日)|(?:\d+|[一二三四五六七八九十]+)\s*(?:日|个月|年|工作日).{0,16}(?:申请|办理|截止)/u],
  payment_schedule: [/(?:发放|到账|支付|计发|拨付).{0,28}(?:\d|月|日|工作日|批次|季度)|(?:\d+|[一二三四五六七八九十]+)\s*(?:日|个月|工作日).{0,16}(?:到账|发放)|每年.{0,30}(?:发放|计发)/u],
  payment_account: [/(?:发放|支付|拨付|打入).{0,24}(?:银行卡|社保卡|账户|信用社)|(?:银行卡|社保卡|银行账户).{0,20}(?:领取|发放|到账)/u],
  migration: [/(?:迁入|迁出|户籍迁移|户籍变更|迁移后|迁入后|迁出后).{0,36}(?:申请|申领|领取|资格|计发|继续|重新)|(?:继续领取|重新申请|资格延续).{0,24}(?:迁入|迁出|户籍)/u],
  comparison: [/(?:区别|不同|相比|对比|相同|分别).{0,36}(?:补贴|政策|条件|标准)|(?:补贴|政策|条件|标准).{0,36}(?:区别|不同|相比|对比|相同)/u],
  contact: [/(?:电话|热线|联系方式).{0,12}(?:\d[\s-]?){7,12}|(?:\d[\s-]?){7,12}.{0,12}(?:电话|热线)/u],
  address: [/(?:地址|地点|位于).{0,36}(?:路|街|号|政务服务中心|服务大厅)|(?:路|街).{0,18}\d+\s*号/u],
  effective_version: [/(?:自|于).{0,18}(?:起施行|生效|执行)|(?:现行|当前|有效)(?:版本|政策|规定)|有效期至/u],
};

function addClaim(claims: ClaimType[], type: ClaimType, requested: boolean): void {
  if (requested && !claims.includes(type)) claims.push(type);
}

function requestedClaimTypes(question: string, intent: PolicyIntent): ClaimType[] {
  const claims: ClaimType[] = [];
  addClaim(claims, "amount", /多少钱|多少元|金额|补贴标准|每年|每月/u.test(question));
  addClaim(claims, "eligibility", /谁能领|哪些人|资格|条件|对象|能否领取|能不能领|可以申请吗/u.test(question));
  addClaim(claims, "claimant", /谁能领|谁来领|谁申请|谁办理|申请人|申领人|父母|监护人/u.test(question));
  addClaim(claims, "materials", /材料|资料|证明|证件|户口簿/u.test(question));
  addClaim(claims, "channel", /怎么办理|怎么申请|怎么申领|哪里办|去哪办|渠道|入口|小程序|平台|窗口/u.test(question));
  addClaim(claims, "deadline", /截止|期限|时限|多久内申请|什么时候申请/u.test(question));
  addClaim(claims, "payment_schedule", /多久.*到账|什么时候.*(?:发|到账)|哪(?:几|四|个)月|哪个月|发放批次|如何发放/u.test(question));
  addClaim(claims, "payment_account", /哪张卡|什么卡|哪家银行|银行账户|发到哪|打到哪/u.test(question));
  addClaim(claims, "migration", /迁入|迁出|迁移|迁户口|户籍.*变更/u.test(question));
  addClaim(claims, "contact", /电话|热线|联系方式/u.test(question));
  addClaim(claims, "address", /详细地址|办理地址|具体地址|在哪里办/u.test(question));
  addClaim(claims, "effective_version", /现行|当前版本|是否生效|有效期|什么时候生效/u.test(question));

  const fallback: Partial<Record<PolicyIntent, ClaimType>> = {
    amount: "amount", eligibility: "eligibility", claimant: "claimant", materials: "materials", channel: "channel",
    deadline: "deadline", payment: "payment_schedule", migration: "migration", comparison: "comparison", distinction: "comparison",
  };
  const fallbackClaim = fallback[intent];
  if (claims.length === 0 && fallbackClaim) claims.push(fallbackClaim);
  return claims;
}

export function buildRequiredClaims(
  question: string,
  intent: PolicyIntent,
  targetRegionCode: string | null,
  comparisonRegions: Array<{ name: string; code: string }> = [],
): RequiredClaim[] {
  let types = requestedClaimTypes(question, intent);
  if (intent === "comparison" && types.includes("comparison") && comparisonRegions.length > 1) {
    types = ["amount", "eligibility"];
  } else if (intent === "comparison") {
    types = types.filter((type) => type !== "comparison");
  }
  const regions = intent === "comparison" && comparisonRegions.length > 0
    ? comparisonRegions.map((region) => region.code)
    : [targetRegionCode];
  return regions.flatMap((regionCode) => types.map((type) => ({
    id: `${type}:${regionCode ?? "unspecified"}`,
    type,
    target_region_code: regionCode,
  })));
}

function candidateText(hit: EvidenceCandidate): string {
  return `${hit.title}\n${hit.section_path?.join(" ") ?? ""}\n${hit.content}`;
}

function matchingSpan(type: ClaimType, hit: EvidenceCandidate): string | null {
  const text = candidateText(hit);
  for (const pattern of supportPatterns[type]) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim().slice(0, 240);
  }
  return null;
}

function regionCodeOf(hit: EvidenceCandidate): string | null {
  return hit.metadata?.region_code ?? null;
}

function supportsRegion(claim: RequiredClaim, hit: EvidenceCandidate): boolean {
  if (!claim.target_region_code) return true;
  const evidenceRegionCode = regionCodeOf(hit);
  if (!evidenceRegionCode) return false;
  if (evidenceRegionCode === "100000" && claim.target_region_code !== "100000" && localImplementationClaims.has(claim.type)) return false;
  return isRegionAncestor(evidenceRegionCode, claim.target_region_code);
}

function versionConflict(hit: EvidenceCandidate, effectiveDate: string | undefined, claimId: string): EvidenceConflict | null {
  if (!effectiveDate) return null;
  const status = hit.status ?? hit.metadata?.status;
  const effectiveFrom = hit.effective_from ?? hit.metadata?.effective_from;
  const effectiveTo = hit.effective_to ?? hit.metadata?.effective_to ?? null;
  const documentId = hit.document_id ?? hit.metadata?.document_id ?? "unknown-document";
  if (!effectiveFrom || effectiveFrom === "unknown") {
    return { type: "unknown_effective_date", claim_ids: [claimId], document_ids: [documentId], reason: "evidence effective_from is unknown" };
  }
  if (status && status !== "effective" || effectiveTo && effectiveTo < effectiveDate) {
    return { type: "expired_evidence", claim_ids: [claimId], document_ids: [documentId], reason: "evidence is expired on the reference date" };
  }
  if (effectiveFrom > effectiveDate) {
    return { type: "future_evidence", claim_ids: [claimId], document_ids: [documentId], reason: "evidence is not effective yet" };
  }
  return null;
}

function bindingFor(claim: RequiredClaim, hit: EvidenceCandidate, index: number, span: string): EvidenceBinding {
  const documentId = hit.document_id ?? hit.metadata?.document_id ?? `anonymous-document-${index + 1}`;
  const regionCode = regionCodeOf(hit) ?? "000000";
  const policyVersion = hit.metadata?.version_group ?? hit.metadata?.policy_number ?? null;
  return {
    claim_id: claim.id,
    document_id: documentId,
    chunk_id: hit.chunk_id ?? `${documentId}-chunk-${index + 1}`,
    region_code: regionCode,
    policy_version: policyVersion,
    matched_span: span,
    support_type: claim.target_region_code === regionCode ? "direct" : "inherited",
  };
}

function canonicalFact(type: ClaimType, span: string): string | null {
  if (type === "amount") return span.match(/(?:\d[\d,.]*|[一二三四五六七八九十百千万]+)\s*元/u)?.[0].replace(/\s+/gu, "") ?? null;
  if (type === "payment_account") return span.match(/[\p{Script=Han}]{2,20}(?:银行卡|社保卡|银行|信用社|账户)/u)?.[0] ?? null;
  return null;
}

function contradictoryConflicts(
  claims: RequiredClaim[],
  bindings: EvidenceBinding[],
  hits: EvidenceCandidate[],
): EvidenceConflict[] {
  const documentVersion = new Map(hits.map((hit) => [
    hit.document_id ?? hit.metadata?.document_id ?? "unknown-document",
    hit.metadata?.version_group ?? "unknown",
  ]));
  const conflicts: EvidenceConflict[] = [];
  for (const claim of claims) {
    const claimBindings = bindings.filter((binding) => binding.claim_id === claim.id);
    const groups = new Map<string, EvidenceBinding[]>();
    for (const binding of claimBindings) {
      const group = documentVersion.get(binding.document_id) ?? "unknown";
      groups.set(group, [...(groups.get(group) ?? []), binding]);
    }
    for (const [group, groupBindings] of groups) {
      if (group === "unknown" || groupBindings.length < 2) continue;
      const facts = new Set(groupBindings.map((binding) => canonicalFact(claim.type, binding.matched_span)).filter((value): value is string => Boolean(value)));
      if (facts.size > 1) {
        conflicts.push({
          type: "contradictory_evidence",
          claim_ids: [claim.id],
          document_ids: groupBindings.map((binding) => binding.document_id),
          reason: `conflicting active evidence in version group ${group}`,
        });
      }
    }
  }
  return conflicts;
}

function legacyReason(reasonCodes: EvidenceSufficiencyReasonCode[]): EvidenceSufficiencyResult["reason"] {
  if (reasonCodes.includes("no_hits")) return "no_hits";
  if (reasonCodes.includes("region_mismatch")) return "missing_local_evidence";
  if (reasonCodes.includes("supported")) return "supported";
  return "missing_requested_detail";
}

/**
 * 按 claim、按单个 hit 绑定证据。只用 Top 5 作充分性判定；Top 5 之外仅用于标记 retrieval miss。
 * 规则只依赖用户问题、规范化地区和候选原文，不读取 Gold 标签。
 */
export function evaluateEvidenceSufficiency(
  question: string,
  intent: PolicyIntent,
  hits: EvidenceCandidate[],
  targetRegionCode: string | null = null,
  options: EvidenceSufficiencyOptions = {},
): EvidenceSufficiencyResult {
  const requiredClaims = buildRequiredClaims(question, intent, targetRegionCode, options.comparisonRegions);
  if (hits.length === 0) {
    return {
      sufficient: false,
      required_claims: requiredClaims,
      supported_claims: [],
      missing_claims: requiredClaims.map((claim) => claim.id),
      evidence_bindings: [],
      conflicts: [],
      reason_codes: ["no_hits", "missing_claim"],
      reason: "no_hits",
    };
  }

  const topHits = hits.slice(0, 5);
  const evidenceBindings: EvidenceBinding[] = [];
  const conflicts: EvidenceConflict[] = [];
  let sawRegionMismatch = false;
  for (const claim of requiredClaims) {
    for (const [index, hit] of topHits.entries()) {
      const span = matchingSpan(claim.type, hit);
      if (!span) continue;
      if (!supportsRegion(claim, hit)) {
        sawRegionMismatch = true;
        continue;
      }
      const conflict = versionConflict(hit, options.effectiveDate, claim.id);
      if (conflict) {
        conflicts.push(conflict);
        continue;
      }
      evidenceBindings.push(bindingFor(claim, hit, index, span));
    }
  }

  conflicts.push(...contradictoryConflicts(requiredClaims, evidenceBindings, topHits));
  const conflictedClaims = new Set(conflicts.flatMap((conflict) => conflict.claim_ids));
  const supportedClaims = requiredClaims
    .filter((claim) => evidenceBindings.some((binding) => binding.claim_id === claim.id) && !conflictedClaims.has(claim.id))
    .map((claim) => claim.id);
  const missingClaims = requiredClaims.filter((claim) => !supportedClaims.includes(claim.id)).map((claim) => claim.id);
  const retrievalMiss = missingClaims.some((claimId) => {
    const claim = requiredClaims.find((item) => item.id === claimId)!;
    return hits.slice(5).some((hit) => matchingSpan(claim.type, hit) && supportsRegion(claim, hit) && !versionConflict(hit, options.effectiveDate, claim.id));
  });
  const reasonCodes: EvidenceSufficiencyReasonCode[] = [];
  if (missingClaims.length > 0) reasonCodes.push("missing_claim");
  if (missingClaims.length > 0 && sawRegionMismatch) reasonCodes.push("region_mismatch");
  if (conflicts.length > 0) reasonCodes.push("version_conflict");
  if (conflicts.some((conflict) => conflict.type === "contradictory_evidence")) reasonCodes.push("contradictory_evidence");
  if (retrievalMiss) reasonCodes.push("retrieval_miss");
  const sufficient = missingClaims.length === 0 && conflicts.length === 0;
  if (sufficient) reasonCodes.push("supported");
  return {
    sufficient,
    required_claims: requiredClaims,
    supported_claims: supportedClaims,
    missing_claims: missingClaims,
    evidence_bindings: evidenceBindings,
    conflicts,
    reason_codes: [...new Set(reasonCodes)],
    reason: legacyReason(reasonCodes),
  };
}
