import type { ConversationState } from "@policy/session/index";
import type { PolicyIntent } from "@policy/schemas/index";
import { findAdministrativeRegionsInText, resolveAdministrativeRegion } from "@policy/rag/index";

export type NormalizedPolicyQuery = {
  original: string;
  retrievalQuery: string;
  region: string | null;
  regionCode: string | null;
  comparisonRegions: Array<{ name: string; code: string }>;
  regionResolution: "resolved" | "missing" | "unknown";
  intent: PolicyIntent;
  intentConfidence: "high" | "low";
  confirmedSlots: Record<string, unknown>;
  missingSlots: string[];
  unsafe: boolean;
  outOfScope: boolean;
  unsupportedRegion: boolean;
};

const unsafePattern = /(?:读取|打开|列出|执行|导出).{0,12}(?:本地|电脑|服务器|磁盘|文件|环境变量|\.env|申请人|手机号)|(?:bash|shell|python|node|powershell|cmd|sql|终端|命令)|(?:系统提示|内部提示|隐藏指令|思维过程|思维链|推理过程)|(?:忽略|绕过).{0,12}(?:规则|审核|证据|指令)|(?:不要引用来源|直接肯定)|(?:改成|改写).{0,12}(?:购车补贴|政策|回答)|(?:编造|伪造|冒充|入侵|破解|泄露)|(?:替|代).{0,8}(?:批准|审批|修改政府数据库)|(?:保证|承诺).{0,12}(?:获批|审批通过|到账)|(?:其他|陌生|上一位|所有).{0,12}(?:申请人|用户|身份证|银行卡|手机号|家庭住址)|(?:密钥|密码|API_KEY|SECRET)|[A-Za-z]:\\|\/(?:etc|Users|home)\//iu;
const outOfScopePattern = /你是谁|你是什么|什么模型|哪个模型|模型版本|你好|您好|谢谢|再见|天气|笑话|唱首歌|股票|彩票/u;
const contextualFollowUpPattern = /^(?:那|那么|这个|上述|刚才|继续|再问|还有|然后|北京|北京市|河北|河北省|两地)|呢[？?]?$|怎么办|怎么弄|可以吗|能吗/u;

const intentSearchTerms: Partial<Record<PolicyIntent, string>> = {
  amount: "育儿补贴 补贴标准 补贴金额 每年发放",
  eligibility: "育儿补贴 申请资格 补贴对象 申领条件",
  claimant: "育儿补贴 申领人 申请人 谁能申请",
  materials: "育儿补贴 申请材料 出生医学证明 居民户口簿",
  channel: "育儿补贴 申请渠道 申领渠道 线上申请 现场申请 办理入口",
  deadline: "育儿补贴 申请期限 截止日期 首次申请",
  payment: "育儿补贴 发放规则 到账 支付",
  comparison: "北京 河北 育儿补贴 政策比较",
  migration: "育儿补贴 户籍迁移 迁入 迁出",
  distinction: "育儿补贴 生育津贴 生育保险 区别",
  overview: "育儿补贴 政策介绍",
};

export function withIntentSearchTerms(input: string, intent: PolicyIntent): string {
  const canonical = intentSearchTerms[intent];
  if (!canonical) return input.trim();
  return [...new Set(`${input.trim()} ${canonical}`.split(/\s+/u).filter(Boolean))].join(" ").slice(0, 2000);
}

function intentFrom(text: string): PolicyIntent {
  if (unsafePattern.test(text)) return "unsafe_request";
  if (/生育津贴/u.test(text) && /育儿补贴/u.test(text)) return "distinction";
  if (/迁|户籍|户口|居住地/u.test(text)) return "migration";
  if (/多少钱|金额|标准|每年|每月|补贴多少|能领多少|一年给多少|发多少钱/u.test(text)) return "amount";
  if (/资格|条件|对象|能申请|可以申请|符合|能领|能不能领|能否领|可不可以领|有资格|够不够条件/u.test(text)) return "eligibility";
  if (/谁.{0,3}(?:申请|申领)|申领人|申请人/u.test(text)) return "claimant";
  if (/材料|资料|证明/u.test(text)) return "materials";
  if (/渠道|入口|哪里申请|怎么申请|线上|线下|怎么领|咋领|去哪领|在哪办|怎么办理/u.test(text)) return "channel";
  if (/时限|期限|截止|什么时候申请/u.test(text)) return "deadline";
  if (/发放|到账|什么时候发|怎么发/u.test(text)) return "payment";
  if (/育儿补贴|补贴/u.test(text)) return "overview";
  return "unknown";
}

export function normalizePolicyQuery(message: string, state: ConversationState | null): NormalizedPolicyQuery {
  const detectedRegions = findAdministrativeRegionsInText(message);
  const comparisonRequested = detectedRegions.length >= 2 && /对比|比较|区别|不同|相比|一样吗|相同吗|分别|哪个更/u.test(message);
  const previousRegion = typeof state?.confirmed_slots.region === "string"
    ? resolveAdministrativeRegion(state.confirmed_slots.region)
    : null;
  const switchRequested = /说错|改(?:成|为|查)|更正|实际|重新查|现在查|不要沿用|迁到|办理地/u.test(message);
  const switchTargetText = message.match(/(?:改查|现在查|重新查|迁到|办理地(?:改成|改为)?|实际(?:是|为)?)(.*)/u)?.[1] ?? "";
  const switchTarget = switchTargetText
    ? findAdministrativeRegionsInText(switchTargetText).sort((left, right) => {
      const firstMention = (region: typeof left) => Math.min(...[region.name, ...region.aliases]
        .map((alias) => switchTargetText.indexOf(alias))
        .filter((index) => index >= 0));
      return firstMention(left) - firstMention(right);
    })[0]
    : undefined;
  const selectedRegion = !comparisonRequested && switchRequested && detectedRegions.length > 1
    ? switchTarget ?? detectedRegions.find((item) => previousRegion?.status === "resolved" && item.code !== previousRegion.region.code) ?? detectedRegions.at(-1)
    : detectedRegions[0];
  let comparisonRegions = comparisonRequested ? detectedRegions.map((item) => ({ name: item.name, code: item.code })) : [];
  let region = comparisonRequested ? "对比" : selectedRegion?.name ?? null;
  let regionCode = comparisonRequested ? null : selectedRegion?.code ?? null;
  let intent = intentFrom(message);
  if (comparisonRequested) intent = "comparison";
  const explicitOutOfScope = outOfScopePattern.test(message) && /先不聊|与政策无关|股票|彩票|天气|笑话|模型|你是谁|你是什么/u.test(message);
  const directlyRecognizedIntent = explicitOutOfScope ? "unknown" : intent;
  const outOfScope = directlyRecognizedIntent === "unknown" && outOfScopePattern.test(message);
  if (outOfScope) intent = "unknown";
  const contextualFollowUp = Boolean(state) && contextualFollowUpPattern.test(message.trim());
  const canInheritContext = !outOfScope && (directlyRecognizedIntent !== "unknown" || contextualFollowUp);
  const confirmedSlots = { ...(state?.confirmed_slots ?? {}) };
  if (selectedRegion || comparisonRequested) {
    delete confirmedSlots.region;
    delete confirmedSlots.region_code;
    delete confirmedSlots.comparison_regions;
  }
  if (!region && canInheritContext && typeof confirmedSlots.region === "string") {
    region = confirmedSlots.region;
    const inherited = resolveAdministrativeRegion(region);
    regionCode = inherited.status === "resolved" ? inherited.region.code : null;
    comparisonRegions = Array.isArray(confirmedSlots.comparison_regions)
      ? confirmedSlots.comparison_regions as Array<{ name: string; code: string }>
      : [];
  }
  if (intent === "unknown" && contextualFollowUp) {
    intent = state?.intent ?? intent;
  }
  const inheritedIntent = directlyRecognizedIntent === "unknown" && intent !== "unknown";
  const intentConfidence = intent === "unknown" || (intent === "overview" && !inheritedIntent && !/育儿补贴|补贴政策|是什么|介绍|了解/u.test(message))
    ? "low"
    : "high";
  if ((intent === "distinction" || intent === "comparison") && comparisonRegions.length > 1) region = "对比";
  if (region) {
    confirmedSlots.region = region;
    if (regionCode) confirmedSlots.region_code = regionCode;
    if (comparisonRegions.length > 0) confirmedSlots.comparison_regions = comparisonRegions;
  }
  const missingSlots: string[] = [];
  if (!region && intent !== "unsafe_request" && !outOfScope) missingSlots.push("region");
  const priorUserQuestion = state?.messages.find((item) => item.role === "user")?.content;
  const contextualQuery = priorUserQuestion && state?.missing_slots.includes("region") ? `${priorUserQuestion} ${message}` : message;
  const retrievalQuery = withIntentSearchTerms(contextualQuery, intent);
  return {
    original: message,
    retrievalQuery,
    region,
    regionCode,
    comparisonRegions,
    regionResolution: region ? "resolved" : "missing",
    intent,
    intentConfidence,
    confirmedSlots,
    missingSlots,
    unsafe: intent === "unsafe_request",
    outOfScope,
    unsupportedRegion: false,
  };
}
