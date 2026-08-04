import type { PolicyIntent } from "@policy/schemas/index";

type EvidenceCandidate = {
  title: string;
  content: string;
  section_path?: string[];
  metadata?: { region_code?: string | undefined };
};

export type EvidenceSufficiency = {
  sufficient: boolean;
  reason: "no_hits" | "missing_local_evidence" | "missing_requested_detail" | "supported";
};

const intentPatterns: Partial<Record<PolicyIntent, RegExp>> = {
  amount: /金额|标准|每年|每月|元/u,
  eligibility: /资格|条件|对象|户籍|周岁|月龄|申领人/u,
  claimant: /申领人|申请人|父母|监护人/u,
  materials: /材料|证明|户口簿|证件/u,
  channel: /渠道|入口|线上|现场|系统|平台|街道|乡镇|小程序/u,
  deadline: /时限|期限|截止|日期|年度|工作日/u,
  payment: /发放|到账|支付|银行|批次|计发/u,
  migration: /迁入|迁出|落户|户籍|计发/u,
};

function countDistinctMonths(text: string): number {
  const matches = text.matchAll(/(?<!\d)(1[0-2]|[1-9])\s*月|([一二三四五六七八九十]+)\s*月/gu);
  return new Set([...matches].map((match) => match[0].replace(/\s+/gu, ""))).size;
}

/**
 * 判断检索结果是否包含问题明确要求的细节，而不只看 BM25 的通用词命中。
 * 规则只依赖问题和候选原文，不读取任何 Gold 标签。
 */
export function evaluateEvidenceSufficiency(
  question: string,
  intent: PolicyIntent,
  hits: EvidenceCandidate[],
  targetRegionCode: string | null = null,
): EvidenceSufficiency {
  if (hits.length === 0) return { sufficient: false, reason: "no_hits" };

  const topHits = hits.slice(0, 5);
  const text = topHits.map((hit) => `${hit.title}\n${hit.section_path?.join(" ") ?? ""}\n${hit.content}`).join("\n");
  const asksLocalDetail = /地方|本地|当地|窗口|小程序|工作日|哪(?:几|四|个)月|哪个月|哪家银行|客服电话|详细地址/u.test(question);
  const hasTargetLocalEvidence = !targetRegionCode || targetRegionCode === "100000" || topHits.some((hit) => {
    const code = hit.metadata?.region_code;
    return Boolean(code && code !== "100000" && (code === targetRegionCode || code.slice(0, 2) === targetRegionCode.slice(0, 2)));
  });
  if (asksLocalDetail && !hasTargetLocalEvidence) return { sufficient: false, reason: "missing_local_evidence" };

  const requestedDetails: Array<[boolean, boolean]> = [
    [/(?:电话|热线|客服电话)/u.test(question), /(?:\d[\s-]?){7,12}/u.test(text)],
    [/详细地址|地址(?:和|及).*电话/u.test(question), /地址|路|街|号|政务服务中心/u.test(text)],
    [/小程序/u.test(question), /小程序/u.test(text)],
    [/多少个?工作日/u.test(question), /(?:\d+|[一二三四五六七八九十]+)\s*个?工作日/u.test(text)],
    [/哪(?:几|四)个月/u.test(question), countDistinctMonths(text) >= 2],
    [/哪个月(?:开始)?计发/u.test(question), /(?:\d+|[一二三四五六七八九十]+)\s*月.{0,16}(?:开始)?计发|计发.{0,16}(?:\d+|[一二三四五六七八九十]+)\s*月/u.test(text)],
    [/哪家银行/u.test(question), /[\p{Script=Han}]{2,20}(?:银行|农信社|信用社)/u.test(text)],
    [/多少(?:元|钱)|补贴金额/u.test(question), /(?:\d[\d,.]*|[一二三四五六七八九十百千万]+)\s*元/u.test(text)],
    [/地方补充材料/u.test(question), /补充材料|另需(?:提交|提供)|当地.{0,12}材料/u.test(text)],
  ];
  if (requestedDetails.some(([requested, supported]) => requested && !supported)) {
    return { sufficient: false, reason: "missing_requested_detail" };
  }

  const intentPattern = intentPatterns[intent];
  if (intentPattern && !intentPattern.test(text)) return { sufficient: false, reason: "missing_requested_detail" };
  return { sufficient: true, reason: "supported" };
}
