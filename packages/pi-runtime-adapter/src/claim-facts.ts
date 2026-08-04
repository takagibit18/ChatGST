export type ClaimValueMode = "scalar" | "set" | "rule";

export type ClaimFactBinding = {
  claim_id: string;
  document_id: string;
  region_code: string;
  effective_from?: string | null;
  effective_to?: string | null;
  matched_span: string;
};

export type NormalizedClaimFact = {
  claim_id: string;
  claim_type: string;
  mode: ClaimValueMode;
  value: string;
  qualifiers: Record<string, string>;
  polarity: "positive" | "negative" | "conditional";
  exclusive: boolean;
  source_binding: ClaimFactBinding;
};

const scalarClaims = new Set(["amount", "deadline", "effective_version", "payment_account"]);
const ruleClaims = new Set(["migration", "governance", "comparison"]);

export function claimValueMode(claimType: string): ClaimValueMode {
  if (scalarClaims.has(claimType)) return "scalar";
  if (ruleClaims.has(claimType)) return "rule";
  return "set";
}

function compact(value: string): string {
  return value.replace(/[\s，。；：、]/gu, "").toLowerCase();
}

function captured(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[0]?.replace(/\s+/gu, "");
}

function factValue(claimType: string, text: string): string {
  if (claimType === "amount") return captured(text, /(?:\d[\d,.]*|[一二三四五六七八九十百千万]+)\s*元/u) ?? compact(text);
  if (claimType === "deadline") return captured(text, /(?:\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:日|个月|年|工作日))/u) ?? compact(text);
  if (claimType === "payment_account") return captured(text, /[\p{Script=Han}]{2,20}(?:银行卡|社保卡|银行|信用社|账户)/u) ?? compact(text);
  if (claimType === "effective_version") return captured(text, /\d{4}年\d{1,2}月\d{1,2}日/u) ?? compact(text);
  if (claimType === "migration") {
    if (/继续(?:发放|领取)|予以发放/u.test(text)) return "continue";
    if (/停止发放|不再发放|终止发放/u.test(text)) return "stop";
    if (/重新(?:申请|申领)/u.test(text)) return "reapply";
  }
  if (claimType === "channel") {
    if (/线上|网上|小程序|平台|系统/u.test(text)) return "online";
    if (/线下|现场|窗口|街道|乡镇/u.test(text)) return "offline";
  }
  return compact(text);
}

function qualifiers(text: string, binding: ClaimFactBinding): Record<string, string> {
  const result: Record<string, string> = { region: binding.region_code };
  if (binding.effective_from) result.effective_from = binding.effective_from;
  if (binding.effective_to) result.effective_to = binding.effective_to;
  const ageRange = captured(text, /(?:\d+\s*(?:至|到|-|—)\s*\d+\s*(?:岁|周岁)|\d+\s*周岁以下)/u);
  if (ageRange) result.age_range = ageRange;
  const birthRange = /出生/u.test(text) ? captured(text, /\d{4}年\d{1,2}月\d{1,2}日(?:以前|之后|及以后|至[^，。；]{1,18})?/u) : undefined;
  if (birthRange) result.birth_date_range = birthRange;
  if (/首次申请|首次申领/u.test(text)) result.application_type = "first_application";
  else if (/续领|续期|后续申请/u.test(text)) result.application_type = "renewal";
  if (/迁入/u.test(text)) result.migration_direction = "in";
  else if (/迁出/u.test(text)) result.migration_direction = "out";
  const batch = captured(text, /(?:第[一二三四五六七八九十\d]+批|每季度|第[一二三四]季度)/u);
  if (batch) result.payment_batch = batch;
  if (/本地|当地|本省|本市|户籍家庭/u.test(text)) result.policy_population = "local_registered";
  return result;
}

export function normalizeClaimFact(claimType: string, binding: ClaimFactBinding): NormalizedClaimFact {
  const text = binding.matched_span;
  return {
    claim_id: binding.claim_id,
    claim_type: claimType,
    mode: claimValueMode(claimType),
    value: factValue(claimType, text),
    qualifiers: qualifiers(text, binding),
    polarity: /不得|禁止|不能|不允许|不再|停止/u.test(text) ? "negative" : /如果|若|符合.*条件|经.*审核/u.test(text) ? "conditional" : "positive",
    exclusive: /仅可|只可|唯一|仅通过|只能|仅能|仅在/u.test(text),
    source_binding: binding,
  };
}

function sameScope(left: NormalizedClaimFact, right: NormalizedClaimFact): boolean {
  const keys = new Set([...Object.keys(left.qualifiers), ...Object.keys(right.qualifiers)]);
  for (const key of keys) if ((left.qualifiers[key] ?? "") !== (right.qualifiers[key] ?? "")) return false;
  return true;
}

export function claimFactsConflict(left: NormalizedClaimFact, right: NormalizedClaimFact): boolean {
  if (left.claim_id !== right.claim_id || !sameScope(left, right)) return false;
  if (left.mode === "scalar") return left.value !== right.value;
  if (left.claim_type === "channel") {
    if (left.value !== right.value) return left.exclusive && right.exclusive;
    return left.polarity !== right.polarity && (left.exclusive || right.exclusive || left.polarity === "negative" || right.polarity === "negative");
  }
  if (left.claim_type === "payment_schedule") {
    return Boolean(left.qualifiers.payment_batch) && left.qualifiers.payment_batch === right.qualifiers.payment_batch
      && left.exclusive && right.exclusive && left.value !== right.value;
  }
  if (left.mode === "set") return false;
  if (left.claim_type === "migration") {
    return left.qualifiers.migration_direction === right.qualifiers.migration_direction && left.value !== right.value;
  }
  return left.value === right.value && left.polarity !== right.polarity;
}
