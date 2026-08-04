import type { PolicyIntent } from "@policy/schemas/index";
import { isRegionAncestor } from "@policy/rag/index";
import { claimFactsConflict, claimValueMode, normalizeClaimFact, type NormalizedClaimFact } from "./claim-facts.js";
import {
  assessPolicyRelationGraph,
  type PolicyGraphIncompatibility,
  type PolicyRelationEdge,
} from "./policy-relation-graph.js";

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
  | "effective_version"
  | "governance";

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
  version_group?: string | null;
  policy_number?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  status?: "effective" | "expired" | "draft" | "unknown" | null;
  implementation_of?: string | null;
  parent_policy_id?: string | null;
  supersedes?: string | null;
  matched_span: string;
  support_type: "direct" | "inherited";
};

export type EvidenceConflict = {
  type: "expired_evidence" | "future_evidence" | "unknown_effective_date" | "contradictory_evidence" | "incompatible_policy_bundle"
    | "superseded_evidence" | "disconnected_policy_bundle" | "mixed_policy_lineage";
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
  | "no_required_claims"
  | "invalid_comparison_scope"
  | "missing_comparison_regions"
  | "duplicate_comparison_regions"
  | "unsupported_claim"
  | "incompatible_policy_bundle"
  | "cross_claim_version_conflict"
  | "unknown_policy_compatibility"
  | "superseded_evidence"
  | "disconnected_policy_bundle"
  | "mixed_policy_lineage"
  | "ambiguous_fact_scope"
  | "supported";

export type EvidenceBundle = {
  target_region_code: string | null;
  claim_ids: string[];
  bindings: EvidenceBinding[];
  policy_families: string[];
  relation_edges: PolicyRelationEdge[];
  complete: boolean;
  compatible: boolean;
  incompatibility_reasons: PolicyGraphIncompatibility[];
};

export type EvidenceSufficiencyResult = {
  sufficient: boolean;
  required_claims: RequiredClaim[];
  supported_claims: string[];
  missing_claims: string[];
  evidence_bindings: EvidenceBinding[];
  evidence_bundles: EvidenceBundle[];
  normalized_facts: NormalizedClaimFact[];
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
    implementation_of?: string | null | undefined;
    parent_policy_id?: string | null | undefined;
    supersedes?: string | null | undefined;
  };
};

export type EvidenceSufficiencyOptions = {
  effectiveDate?: string;
  comparisonRegions?: Array<{ name: string; code: string }>;
};

const localImplementationClaims = new Set<ClaimType>([
  "amount", "eligibility", "claimant", "materials", "channel", "deadline", "payment_schedule", "payment_account", "migration", "contact", "address",
]);

const supportPatterns: Record<ClaimType, RegExp[]> = {
  amount: [/(?:补贴|标准|金额).{0,24}(?:\d[\d,.]*|[一二三四五六七八九十百千万]+)\s*元|(?:\d[\d,.]*|[一二三四五六七八九十百千万]+)\s*元.{0,24}(?:补贴|标准|金额)/u],
  eligibility: [/(?:申领|申请|补贴)(?:对象|条件|资格)|符合.{0,20}条件|(?:婴幼儿|家庭|儿童).{0,20}(?:户籍|周岁|月龄|资格)|(?:具有|登记在|本地|当地|本省|本市).{0,18}户籍.{0,18}(?:家庭|婴幼儿|儿童)|(?:双|多)胞胎.{0,36}(?:均可|都能|享受|领取)|同胎次子女.{0,24}(?:均可|都能|享受|领取)/u],
  claimant: [/(?:申请人|申领人|经办人).{0,24}(?:父母|监护人|一方|本人)|(?:父母|监护人).{0,18}(?:申请|申领|办理)/u],
  materials: [/(?:提交|提供|携带|所需|申请材料).{0,28}(?:证明|证件|户口簿|身份证|材料)|(?:材料清单|补充材料)/u],
  channel: [/(?:通过|登录|前往|可在|可到).{0,28}(?:小程序|平台|系统|窗口|街道|乡镇|线上|线下|现场)|(?:可|可以).{0,12}(?:线上|网上|现场).{0,12}(?:申请|办理)|(?:街道|乡镇).{0,12}(?:办理|申请)|(?:申请|申领|办理)(?:渠道|入口)/u],
  deadline: [/(?:截止|期限|时限|应于|之日起).{0,24}(?:\d|日|月|年|工作日)|(?:申请|申领).{0,30}(?:应在|应当在|截止|截至).{0,32}(?:\d|日|月|年|当年|次年)|首次(?:申请|申领).{0,24}(?:当年|次年|年度)|续领.{0,24}(?:当年|次年|年度)|(?:应在|应当在).{0,32}(?:当年|次年).{0,24}(?:申请|申领)|(?:\d+|[一二三四五六七八九十]+)\s*(?:日|个月|年|工作日).{0,20}(?:申请|办理|审核|初审|确认|完成|截止)/u],
  payment_schedule: [/(?:发放|到账|支付|计发|拨付).{0,36}(?:\d|月|日|工作日|批次|季度|最后一日|到位)|(?:每季度|按季度).{0,36}(?:发放|到账|最后一日|到位)|第[一二三四五六七八九十\d]+批.{0,20}(?:\d{1,2}月|发放|到账)|\d{1,2}月.{0,12}(?:到账|发放)|(?:\d+|[一二三四五六七八九十]+)\s*(?:日|个月|个?工作日).{0,16}(?:到账|发放)|(?:次年|当年|翌年).{0,16}(?:停止)?发放|每年.{0,30}(?:发放|计发)/u],
  payment_account: [/(?:发放|支付|拨付|打入).{0,24}(?:银行卡|社保卡|账户|信用社)|(?:银行卡|社保卡|银行账户).{0,20}(?:领取|发放|到账)/u],
  migration: [/(?:迁入|迁出|户籍迁移|户籍变更|迁移后|迁入后|迁出后).{0,36}(?:申请|申领|领取|资格|计发|发放|停止|继续|重新)|(?:继续领取|重新申请|资格延续|停止发放).{0,24}(?:迁入|迁出|户籍)/u],
  comparison: [/(?:区别|不同|相比|对比|相同|分别).{0,36}(?:补贴|政策|条件|标准)|(?:补贴|政策|条件|标准).{0,36}(?:区别|不同|相比|对比|相同)/u],
  contact: [/(?:电话|热线|联系方式).{0,12}(?:\d[\s-]?){7,12}|(?:\d[\s-]?){7,12}.{0,12}(?:电话|热线)/u],
  address: [/(?:地址|地点|位于).{0,36}(?:路|街|号|政务服务中心|服务大厅)|(?:路|街).{0,18}\d+\s*号/u],
  effective_version: [/(?:自|从|于).{0,18}(?:起施行|起实施|开始实施|生效|执行)|(?:现行|当前|有效)(?:版本|政策|规定)|有效期至/u],
  governance: [/(?:省级|市级|县级|各级).{0,48}(?:制定|出台|执行|政策|标准|限制|不得)|(?:不得|允许).{0,36}(?:自行)?(?:制定|出台|提高|提标)/u],
};

function addClaim(claims: ClaimType[], type: ClaimType, requested: boolean): void {
  if (requested && !claims.includes(type)) claims.push(type);
}

function requestedClaimTypes(question: string, intent: PolicyIntent): ClaimType[] {
  const claims: ClaimType[] = [];
  const asksPaymentTiming = /哪几个月|哪个月|几月|(?:什么时候|啥时候|多久).{0,8}(?:到账|发放|打钱)|(?:审核|确认).{0,12}(?:通过|完成|完).{0,12}(?:发|打钱|到账)|发放.{0,8}(?:时点|时间|节点)/u.test(question);
  addClaim(claims, "amount", /多少钱|多少元|多钱|给多少|发多少|拿多少|金额|补贴标准|每年|每月|一年.{0,8}(?:多少|多钱|是多少)|一个(?:娃|孩子).{0,8}(?:多少|多钱)/u.test(question));
  addClaim(claims, "eligibility", /谁能领|哪些人|哪些孩子|什么孩子|资格|条件|对象|能否领取|能不能领|可以申请吗|能享受|都能领|能否都领|都能拿/u.test(question));
  addClaim(claims, "claimant", /谁能领|谁来领|谁申请|谁办理|申请人|申领人|父母|监护人/u.test(question));
  addClaim(claims, "materials", /材料|资料|证明|证件|户口簿/u.test(question));
  addClaim(claims, "channel", /怎么办理|怎么申请|怎么申领|哪里办|上哪办|去哪办|去哪里申请|在哪申请|哪些方式申请|什么方式申请|现场办理|网上办|在线申请|渠道|入口|小程序|平台|窗口|街道办/u.test(question));
  addClaim(claims, "deadline", /截止|期限|时限|办理时限|审核确认.{0,8}时限/u.test(question)
    || (!asksPaymentTiming && /多久内申请|什么时候申请|延到什么时候|最晚|首次申领|首次申请|续领.{0,8}年度|哪些年度/u.test(question)));
  addClaim(claims, "payment_schedule", asksPaymentTiming || /一季|季度|发放批次|几批.{0,8}发放|如何发放/u.test(question));
  addClaim(claims, "payment_account", /哪张卡|什么卡|哪家银行|银行账户|发到哪|打到哪/u.test(question));
  addClaim(claims, "migration", /迁入|迁出|迁移|迁户口|户籍.*变更/u.test(question));
  addClaim(claims, "contact", /电话|热线|联系方式/u.test(question));
  addClaim(claims, "address", /详细地址|办理地址|具体地址|在哪里办/u.test(question));
  addClaim(claims, "effective_version", /当前版本|是否生效|有效期|什么时候生效|从哪一天开始实施|何时开始实施|实施日期|施行日期/u.test(question));
  addClaim(claims, "governance", /自行制定|出台政策|提标|政策边界|作了什么限制/u.test(question));

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
    if (match?.[0]) {
      const index = match.index ?? 0;
      const before = text.slice(0, index);
      const after = text.slice(index + match[0].length);
      const sentenceStart = Math.max(before.lastIndexOf("。"), before.lastIndexOf("；"), before.lastIndexOf("\n")) + 1;
      const nextStops = [after.indexOf("。"), after.indexOf("；"), after.indexOf("\n")].filter((stop) => stop >= 0);
      const sentenceEnd = index + match[0].length + (nextStops.length > 0 ? Math.min(...nextStops) : 0);
      return text.slice(sentenceStart, sentenceEnd).trim().slice(0, 240);
    }
  }
  return null;
}

function regionCodeOf(hit: EvidenceCandidate): string | null {
  return hit.metadata?.region_code ?? null;
}

function supportsRegion(claim: RequiredClaim, hit: EvidenceCandidate, candidates: EvidenceCandidate[] = []): boolean {
  if (!claim.target_region_code) return true;
  const evidenceRegionCode = regionCodeOf(hit);
  if (!evidenceRegionCode) return false;
  if (evidenceRegionCode === "100000" && claim.target_region_code !== "100000" && localImplementationClaims.has(claim.type)) {
    const documentId = hit.document_id ?? hit.metadata?.document_id;
    const policyNumber = hit.metadata?.policy_number;
    const explicitlyImplemented = candidates.some((candidate) => Boolean(candidate.metadata?.region_code)
      && isRegionAncestor(candidate.metadata!.region_code!, claim.target_region_code!)
      && [candidate.metadata?.implementation_of, candidate.metadata?.parent_policy_id].some((relation) => relation && (relation === documentId || relation === policyNumber)));
    if (!explicitlyImplemented) return false;
  }
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
    version_group: hit.metadata?.version_group ?? null,
    policy_number: hit.metadata?.policy_number ?? null,
    effective_from: hit.effective_from ?? hit.metadata?.effective_from ?? null,
    effective_to: hit.effective_to ?? hit.metadata?.effective_to ?? null,
    status: hit.status ?? hit.metadata?.status ?? null,
    implementation_of: hit.metadata?.implementation_of ?? null,
    parent_policy_id: hit.metadata?.parent_policy_id ?? null,
    supersedes: hit.metadata?.supersedes ?? null,
    matched_span: span,
    support_type: claim.target_region_code === regionCode ? "direct" : "inherited",
  };
}

function policyFamilies(bindings: EvidenceBinding[]): string[] {
  return [...new Set(bindings.flatMap((binding) => [binding.version_group, binding.policy_number]
    .filter((value): value is string => Boolean(value) && value !== "unknown")))];
}

function compatibleBundle(
  targetRegionCode: string | null,
  claims: RequiredClaim[],
  bindings: EvidenceBinding[],
  allowHistoricalLineage: boolean,
): EvidenceBundle {
  const claimIds = claims.map((claim) => claim.id);
  const byClaim = claimIds.map((claimId) => bindings.filter((binding) => binding.claim_id === claimId));
  if (byClaim.some((claimBindings) => claimBindings.length === 0)) {
    const available = byClaim.flatMap((claimBindings) => claimBindings.slice(0, 1));
    const assessment = assessPolicyRelationGraph(available, { allowHistoricalLineage });
    return { target_region_code: targetRegionCode, claim_ids: claimIds, bindings: available,
      policy_families: policyFamilies(available), relation_edges: assessment.edges, complete: false,
      compatible: false, incompatibility_reasons: assessment.incompatibility_reasons };
  }
  const combinations: EvidenceBinding[][] = [];
  const visit = (index: number, current: EvidenceBinding[]) => {
    if (combinations.length >= 256) return;
    if (index === byClaim.length) { combinations.push(current); return; }
    for (const binding of byClaim[index] ?? []) visit(index + 1, [...current, binding]);
  };
  visit(0, []);
  for (const selected of combinations) {
    let assessment = assessPolicyRelationGraph(selected, { allowHistoricalLineage });
    if (!assessment.compatible) continue;
    const extended = [...selected];
    for (const binding of bindings) {
      if (extended.includes(binding)) continue;
      const candidate = [...extended, binding];
      const candidateAssessment = assessPolicyRelationGraph(candidate, { allowHistoricalLineage });
      if (candidateAssessment.compatible) {
        extended.push(binding);
        assessment = candidateAssessment;
      }
    }
    return { target_region_code: targetRegionCode, claim_ids: claimIds, bindings: extended,
      policy_families: policyFamilies(extended), relation_edges: assessment.edges, complete: true,
      compatible: true, incompatibility_reasons: [] };
  }
  const selected = combinations[0] ?? [];
  const assessment = assessPolicyRelationGraph(selected, { allowHistoricalLineage });
  return { target_region_code: targetRegionCode, claim_ids: claimIds, bindings: selected,
    policy_families: policyFamilies(selected), relation_edges: assessment.edges, complete: true,
    compatible: false, incompatibility_reasons: assessment.incompatibility_reasons };
}

function contradictoryConflicts(
  claims: RequiredClaim[],
  bindings: EvidenceBinding[],
): { conflicts: EvidenceConflict[]; facts: NormalizedClaimFact[] } {
  const facts = claims.flatMap((claim) => bindings
    .filter((binding) => binding.claim_id === claim.id)
    .map((binding) => normalizeClaimFact(claim.type, binding)));
  const conflicts: EvidenceConflict[] = [];
  for (const claim of claims) {
    const claimFacts = facts.filter((fact) => fact.claim_id === claim.id);
    for (let leftIndex = 0; leftIndex < claimFacts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < claimFacts.length; rightIndex += 1) {
        const left = claimFacts[leftIndex]!;
        const right = claimFacts[rightIndex]!;
        if (!claimFactsConflict(left, right)) continue;
        conflicts.push({
          type: "contradictory_evidence",
          claim_ids: [claim.id],
          document_ids: [left.source_binding.document_id, right.source_binding.document_id],
          reason: `conflicting ${claimValueMode(claim.type)} facts in the same applicable scope`,
        });
      }
    }
  }
  return { conflicts, facts };
}

function documentIdentities(hit: EvidenceCandidate): string[] {
  return [hit.document_id, hit.metadata?.document_id, hit.metadata?.policy_number]
    .filter((value): value is string => Boolean(value));
}

function applicableTopHits(hits: EvidenceCandidate[], effectiveDate: string | undefined, allowHistoricalLineage: boolean): EvidenceCandidate[] {
  const topHits = hits.slice(0, 5);
  if (allowHistoricalLineage) return topHits;
  const activeSuccessors = topHits.filter((hit) => {
    if (!hit.metadata?.supersedes) return false;
    const effectiveFrom = hit.effective_from ?? hit.metadata.effective_from;
    const effectiveTo = hit.effective_to ?? hit.metadata.effective_to;
    if (!effectiveDate) return (hit.status ?? hit.metadata.status) === "effective";
    return (!effectiveFrom || effectiveFrom <= effectiveDate) && (!effectiveTo || effectiveTo >= effectiveDate);
  });
  const superseded = new Set(activeSuccessors.map((hit) => hit.metadata!.supersedes!));
  return topHits.filter((hit) => !documentIdentities(hit).some((identity) => superseded.has(identity)));
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
  if (intent === "comparison") {
    const comparisonRegions = options.comparisonRegions ?? [];
    const uniqueCodes = new Set(comparisonRegions.map((region) => region.code).filter(Boolean));
    if (comparisonRegions.length < 2 || uniqueCodes.size < 2) {
      const scopeReason: EvidenceSufficiencyReasonCode = comparisonRegions.length < 2 ? "missing_comparison_regions" : "duplicate_comparison_regions";
      return { sufficient: false, required_claims: [], supported_claims: [], missing_claims: [], evidence_bindings: [], evidence_bundles: [], normalized_facts: [], conflicts: [],
        reason_codes: ["invalid_comparison_scope", scopeReason], reason: "missing_requested_detail" };
    }
  }
  if (requiredClaims.length === 0) {
    return { sufficient: false, required_claims: [], supported_claims: [], missing_claims: [], evidence_bindings: [], evidence_bundles: [], normalized_facts: [], conflicts: [],
      reason_codes: ["no_required_claims"], reason: "missing_requested_detail" };
  }
  if (hits.length === 0) {
    return {
      sufficient: false,
      required_claims: requiredClaims,
      supported_claims: [],
      missing_claims: requiredClaims.map((claim) => claim.id),
      evidence_bindings: [],
      evidence_bundles: [],
      normalized_facts: [],
      conflicts: [],
      reason_codes: ["no_hits", "missing_claim"],
      reason: "no_hits",
    };
  }

  const allowHistoricalLineage = /变化|沿革|新旧|调整前后|历年|历史版本|政策演变/u.test(question);
  const topHits = applicableTopHits(hits, options.effectiveDate, allowHistoricalLineage);
  const evidenceBindings: EvidenceBinding[] = [];
  const conflicts: EvidenceConflict[] = [];
  const candidateVersionConflicts: EvidenceConflict[] = [];
  let sawRegionMismatch = false;
  for (const claim of requiredClaims) {
    for (const [index, hit] of topHits.entries()) {
      const span = matchingSpan(claim.type, hit);
      if (!span) continue;
      if (!supportsRegion(claim, hit, topHits)) {
        sawRegionMismatch = true;
        continue;
      }
      const conflict = versionConflict(hit, options.effectiveDate, claim.id);
      if (conflict) {
        candidateVersionConflicts.push(conflict);
        continue;
      }
      evidenceBindings.push(bindingFor(claim, hit, index, span));
    }
  }
  conflicts.push(...candidateVersionConflicts.filter((conflict) => !evidenceBindings.some((binding) => conflict.claim_ids.includes(binding.claim_id))));

  const factAssessment = contradictoryConflicts(requiredClaims, evidenceBindings);
  conflicts.push(...factAssessment.conflicts);
  const bundleRegions = [...new Set(requiredClaims.map((claim) => claim.target_region_code))];
  const evidenceBundles = bundleRegions.map((regionCode) => compatibleBundle(regionCode,
    requiredClaims.filter((claim) => claim.target_region_code === regionCode), evidenceBindings, allowHistoricalLineage));
  for (const bundle of evidenceBundles.filter((item) => !item.compatible && item.incompatibility_reasons.length > 0)) {
    const primaryReason = bundle.incompatibility_reasons[0]!;
    const conflictType = primaryReason === "disconnected_policy_bundle" || primaryReason === "mixed_policy_lineage"
      ? primaryReason
      : "incompatible_policy_bundle";
    conflicts.push({ type: conflictType, claim_ids: bundle.claim_ids,
      document_ids: bundle.bindings.map((binding) => binding.document_id), reason: bundle.incompatibility_reasons.join(",") });
  }
  const selectedBindings = evidenceBundles.flatMap((bundle) => bundle.bindings);
  const conflictedClaims = new Set(conflicts.flatMap((conflict) => conflict.claim_ids));
  const supportedClaims = requiredClaims
    .filter((claim) => selectedBindings.some((binding) => binding.claim_id === claim.id) && !conflictedClaims.has(claim.id))
    .map((claim) => claim.id);
  const missingClaims = requiredClaims.filter((claim) => !supportedClaims.includes(claim.id)).map((claim) => claim.id);
  const retrievalMiss = missingClaims.some((claimId) => {
    const claim = requiredClaims.find((item) => item.id === claimId)!;
    return hits.slice(5).some((hit) => matchingSpan(claim.type, hit) && supportsRegion(claim, hit, hits) && !versionConflict(hit, options.effectiveDate, claim.id));
  });
  const reasonCodes: EvidenceSufficiencyReasonCode[] = [];
  if (missingClaims.length > 0) reasonCodes.push("missing_claim");
  if (missingClaims.length > 0 && sawRegionMismatch) reasonCodes.push("region_mismatch");
  if (conflicts.length > 0) reasonCodes.push("version_conflict");
  if (conflicts.some((conflict) => conflict.type === "contradictory_evidence")) reasonCodes.push("contradictory_evidence");
  if (conflicts.some((conflict) => ["incompatible_policy_bundle", "disconnected_policy_bundle", "mixed_policy_lineage"].includes(conflict.type))) reasonCodes.push("incompatible_policy_bundle");
  for (const reason of evidenceBundles.flatMap((bundle) => bundle.incompatibility_reasons)) reasonCodes.push(reason);
  if (retrievalMiss) reasonCodes.push("retrieval_miss");
  const sufficient = missingClaims.length === 0 && conflicts.length === 0 && evidenceBundles.every((bundle) => bundle.complete && bundle.compatible);
  if (sufficient) reasonCodes.push("supported");
  return {
    sufficient,
    required_claims: requiredClaims,
    supported_claims: supportedClaims,
    missing_claims: missingClaims,
    evidence_bindings: selectedBindings,
    evidence_bundles: evidenceBundles,
    normalized_facts: factAssessment.facts,
    conflicts,
    reason_codes: [...new Set(reasonCodes)],
    reason: legacyReason(reasonCodes),
  };
}
