import type { ConversationState } from "@policy/session/index";
import type { PolicyIntent } from "@policy/schemas/index";

export type NormalizedPolicyQuery = {
  original: string;
  retrievalQuery: string;
  region: "北京市" | "河北省" | "对比" | null;
  intent: PolicyIntent;
  confirmedSlots: Record<string, unknown>;
  missingSlots: string[];
  unsafe: boolean;
  unsupportedRegion: boolean;
};

const unsafePattern = /(?:读取|打开|列出).{0,8}(?:本地|电脑|磁盘|文件)|(?:bash|shell|python|node|powershell|cmd|sql|终端|命令)|(?:系统提示|内部提示|思维过程|思维链|推理过程)|[A-Za-z]:\\|\/(?:etc|Users|home)\//iu;
const unsupportedRegionPattern = /上海|天津|重庆|山西|山东|河南|湖南|湖北|广东|广西|海南|四川|贵州|云南|陕西|甘肃|青海|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|内蒙古|西藏|宁夏|新疆|香港|澳门|台湾/u;

function intentFrom(text: string): PolicyIntent {
  if (unsafePattern.test(text)) return "unsafe_request";
  if (/生育津贴/u.test(text) && /育儿补贴/u.test(text)) return "distinction";
  if (/对比|比较|区别|不同|相比/u.test(text) && /北京/u.test(text) && /河北/u.test(text)) return "comparison";
  if (/迁|户籍|户口|居住地/u.test(text)) return "migration";
  if (/多少钱|金额|标准|每年|每月|补贴多少/u.test(text)) return "amount";
  if (/资格|条件|对象|能申请|可以申请|符合/u.test(text)) return "eligibility";
  if (/谁.{0,3}(?:申请|申领)|申领人|申请人/u.test(text)) return "claimant";
  if (/材料|资料|证明/u.test(text)) return "materials";
  if (/渠道|入口|哪里申请|怎么申请|线上|线下/u.test(text)) return "channel";
  if (/时限|期限|截止|什么时候申请/u.test(text)) return "deadline";
  if (/发放|到账|什么时候发|怎么发/u.test(text)) return "payment";
  if (/育儿补贴|补贴/u.test(text)) return "overview";
  return "unknown";
}

function regionFrom(text: string): "北京市" | "河北省" | "对比" | null {
  const beijing = /北京/u.test(text);
  const hebei = /河北/u.test(text);
  if (beijing && hebei && /对比|比较|区别|不同|相比/u.test(text)) return "对比";
  if (/迁(?:入|到)河北|户籍.{0,5}河北/u.test(text)) return "河北省";
  if (/迁(?:入|到)北京|户籍.{0,5}北京/u.test(text)) return "北京市";
  if (beijing && hebei) return "对比";
  if (beijing) return "北京市";
  if (hebei) return "河北省";
  return null;
}

export function normalizePolicyQuery(message: string, state: ConversationState | null): NormalizedPolicyQuery {
  let region = regionFrom(message);
  const unsupportedRegion = !region && unsupportedRegionPattern.test(message);
  let intent = intentFrom(message);
  const confirmedSlots = { ...(state?.confirmed_slots ?? {}) };
  if (!region && typeof confirmedSlots.region === "string") {
    region = confirmedSlots.region as NormalizedPolicyQuery["region"];
  }
  if (intent === "unknown" || (intent === "overview" && !/育儿补贴|补贴/u.test(message))) {
    intent = state?.intent ?? intent;
  }
  if ((intent === "distinction" || intent === "comparison") && !region) region = "对比";
  if (region) confirmedSlots.region = region;
  const missingSlots: string[] = [];
  if (!region && intent !== "unsafe_request" && !unsupportedRegion) missingSlots.push("region");
  const priorUserQuestion = state?.messages.find((item) => item.role === "user")?.content;
  const retrievalQuery = priorUserQuestion && state?.missing_slots.includes("region") ? `${priorUserQuestion} ${message}` : message;
  return {
    original: message,
    retrievalQuery,
    region,
    intent,
    confirmedSlots,
    missingSlots,
    unsafe: intent === "unsafe_request",
    unsupportedRegion,
  };
}
