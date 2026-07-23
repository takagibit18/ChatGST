import type { EvidenceItem, EvidencePack, PolicyResponse } from "@policy/schemas/index";

const intentKeywords: Record<string, RegExp> = {
  amount: /3600|300|标准|金额/u,
  eligibility: /补贴对象|3周岁|户籍|生育|收养|资格/u,
  claimant: /父母|监护人|申领人/u,
  materials: /出生医学证明|户口簿|材料|证明/u,
  channel: /线上|现场|小程序|政务服务|街道/u,
  deadline: /期限|首次申请|截止|年度/u,
  payment: /发放|到账|2 月|5 月|8 月|11 月/u,
  migration: /迁入|迁出|户籍|重复申领/u,
  distinction: /生育津贴|生育保险|产假工资/u,
  comparison: /北京市|河北省|发放|审核|户籍/u,
  overview: /育儿补贴/u,
};

function selectEvidence(pack: EvidencePack): EvidenceItem[] {
  const pattern = intentKeywords[pack.query_context.intent] ?? /育儿补贴/u;
  const matching = pack.evidence.filter((item) => pattern.test(`${item.section_path.join(" ")} ${item.content}`));
  const pool = matching.length > 0 ? matching : pack.evidence;
  if (pack.query_context.intent === "comparison") {
    const selected: EvidenceItem[] = [];
    for (const region of ["北京市", "河北省", "全国"]) {
      const hit = pool.find((item) => item.region === region);
      if (hit) selected.push(hit);
    }
    return [...selected, ...pool].filter((item, index, all) => all.findIndex((other) => other.chunk_id === item.chunk_id) === index).slice(0, 4);
  }
  if (pack.query_context.intent === "distinction") return pool.slice(0, 3);
  return pool.slice(0, 3);
}

function details(items: EvidenceItem[]): string {
  return items
    .map((item) => `- **${item.section_path.at(-1) ?? item.title}**：${item.content.replace(/^#+\s*/gmu, "").slice(0, 260)}`)
    .join("\n");
}

function sourceData(items: EvidenceItem[]) {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (item.source_url === "unknown" || seen.has(item.document_id)) return [];
    seen.add(item.document_id);
    return [{ document_id: item.document_id, title: item.title, url: item.source_url }];
  });
}

export function createDeterministicTestResponse(pack: EvidencePack): PolicyResponse {
  const selected = selectEvidence(pack);
  const joined = selected.map((item) => item.content).join("\n");
  const joinedCompact = joined.replace(/\s+/gu, "");
  const region = pack.query_context.region === "全国" ? null : (pack.query_context.region as PolicyResponse["meta"]["region"]);
  let answer: string;
  let actions: PolicyResponse["actions"] = [];
  switch (pack.query_context.intent) {
    case "amount": {
      const annual = joined.match(/每(?:孩)?每年\s*([0-9]+)\s*元/u)?.[1] ?? joined.match(/([0-9]{4})\s*元/u)?.[1];
      const monthly = joined.match(/每月(?:按)?\s*([0-9]+)\s*元/u)?.[1];
      answer = annual
        ? `按当前证据，3周岁以下婴幼儿每孩每年${annual}元${monthly ? `，不足整年按每月${monthly}元折算` : ""}。是否发放仍以当地审核为准。`
        : "当前证据提到执行统一补贴标准，但没有检索到可核验的具体金额，因此不作数值判断。";
      break;
    }
    case "eligibility":
      answer = `视情况。${joinedCompact.includes("3周岁") ? "一般需为符合法律法规规定生育或收养的3周岁以下婴幼儿" : "需核对孩子年龄和当地条件"}${joined.includes("户籍") ? "，并满足当地户籍规则" : ""}，最终以审核结果为准。`;
      break;
    case "claimant":
      answer = "原则上由婴幼儿父母一方申领；父母无法申领时，可由其他监护人按规定办理。每名婴幼儿只能由一名申领人申请。";
      break;
    case "materials":
      answer = "关键材料通常包括婴幼儿出生医学证明、居民户口簿，以及必要的亲子或监护关系证明。特殊情形以当地补充要求为准。";
      break;
    case "channel":
      answer = "可通过微信、支付宝的“育儿补贴”小程序或当地政务服务平台线上申请，也可到婴幼儿户籍所在地乡镇政府、街道办事处现场申请。";
      break;
    case "deadline": {
      const deadline = joined.match(/20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/u)?.[0]?.replace(/\s+/gu, "");
      answer = deadline
        ? `按当前有效更新，相关首次申请期限为${deadline}。具体是否适用还要结合孩子出生年份和是否首次申请。`
        : "申请按年度办理，首次申请和续领时限取决于孩子出生年份；请按证据中的地方规则及时提交。";
      break;
    }
    case "payment":
      answer = /2\s*月.*5\s*月.*8\s*月.*11\s*月/u.test(joined)
        ? "河北省原则上在每年2月、5月、8月和11月集中发放已审核确认的育儿补贴。实际到账以审核和支付进度为准。"
        : "补贴在审核确认后按当地批次发放，实际到账以当地支付进度为准。";
      break;
    case "migration":
      answer = "视情况。户籍迁入后如当年度尚未在原户籍地提交申请，可按迁入地规则办理；发现重复申领时会先核实，不能重复领取。";
      break;
    case "distinction":
      answer = "育儿补贴是面向符合条件的3周岁以下婴幼儿家庭的财政补贴；生育津贴属于生育保险待遇，主要补偿参保女职工产假期间的收入。两者不是同一制度。";
      break;
    case "comparison":
      answer = "北京与河北都执行国家育儿补贴基础制度，但地方在申请审核、户籍迁移和发放批次等细节上不同。具体问题应分别按两地当前有效规则判断。";
      actions = [
        { id: "beijing", label: "查看北京规则", value: "北京育儿补贴申请规则" },
        { id: "hebei", label: "查看河北规则", value: "河北育儿补贴申请规则" },
      ];
      break;
    default:
      answer = "可以查询北京和河北育儿补贴的金额、资格、材料、渠道、时限与发放规则。请选择想了解的内容。";
      actions = [
        { id: "amount", label: "补贴金额", value: `${region === "河北省" ? "河北" : "北京"}育儿补贴金额` },
        { id: "eligibility", label: "申请资格", value: `${region === "河北省" ? "河北" : "北京"}育儿补贴申请资格` },
        { id: "materials", label: "关键材料", value: `${region === "河北省" ? "河北" : "北京"}育儿补贴关键材料` },
        { id: "channel", label: "申领渠道", value: `${region === "河北省" ? "河北" : "北京"}育儿补贴申领渠道` },
      ];
  }
  const sources = sourceData(selected);
  const collapsibles: PolicyResponse["collapsibles"] = [];
  if (selected.length > 0) collapsibles.push({ title: "详细说明", content_markdown: details(selected) });
  if (sources.length > 0) {
    collapsibles.push({
      title: "数据来源",
      content_markdown: sources.map((source) => `> [${source.title}](${source.url})`).join("\n\n"),
    });
  }
  return {
    answer_markdown: answer,
    collapsibles,
    actions,
    sources,
    clarification: null,
    meta: { intent: pack.query_context.intent as PolicyResponse["meta"]["intent"], region, answer_status: "answered" },
  };
}
