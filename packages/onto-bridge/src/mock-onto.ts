/**
 * mock-onto.ts — 本地 Mock 本体平台
 *
 * 模拟 onto-platform 的所有 API 端点，零网络依赖。
 * 用于本地开发/测试，不连接 36.133.53.196:18222。
 *
 * 模拟端点:
 *   POST /api/login              → session cookie
 *   POST /api/onto/extract       → 文档→规则提取
 *   POST /api/onto/derive        → 规则补全推导
 *   POST /api/policies/:id/merge-all → 规则合并
 *   POST /api/query              → 规则引擎资格判定
 */

/** Mock 规则提取结果 */
interface MockExtraction {
  id: string;
  items: Array<{
    question: string;
    answer: string;
    conditions: string[];
    region?: string;
  }>;
}

/** Mock 规则推导结果 */
interface MockDerivation {
  id: string;
  rules: Array<{
    name: string;
    head: string;
    body: string[];
    region: string;
  }>;
}

/** Mock 合并结果 */
interface MockMergeResult {
  ok: boolean;
  dry_run: boolean;
  plan_id?: string;
  merged: number;
  failed: number;
  conflict_items: Array<{ key: string }>;
  blocked_rules: unknown[];
  warnings: string[];
  results: Array<{ region: string; ok: boolean; reason?: string }>;
}

/** Mock 规则引擎查询结果 */
interface MockQueryResult {
  ok: boolean;
  region: string;
  eligible: boolean;
  verdict: "eligible" | "missing_info" | "ineligible";
  missing?: Array<{ op: string; zh?: string; hint?: string }>;
  conclusions?: unknown[];
}

// ─── 状态存储 ───

const extractions = new Map<string, MockExtraction>();
const derivations = new Map<string, MockDerivation>();
let mergeCount = 0;

// ─── 简易 regex 规则提取 ───

/**
 * 从政策正文中模拟提取 QA 规则
 * 真实版本由 LLM 做 (onto-platform /api/onto/extract)
 * 这里用关键词匹配模拟
 */
function mockExtract(text: string, region: string, title: string): MockExtraction {
  const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const items: MockExtraction["items"] = [];

  // 从文本中提取关键条款
  const lines = text.split(/\n/);

  // 查找金额相关
  const amountMatch = text.match(/(?:每孩每年|每名婴幼儿每年|一次性补贴|按月发放)\s*(\d+)\s*元/);
  if (amountMatch) {
    items.push({
      question: `${region}育儿补贴金额是多少`,
      answer: `每名婴幼儿每年${amountMatch[1]}元`,
      conditions: ["符合法律法规规定生育或收养", "3周岁以下婴幼儿"],
      region,
    });
  }

  // 查找申请资格
  if (text.includes("户籍") || text.includes("3周岁")) {
    items.push({
      question: `${region}育儿补贴申请资格`,
      answer: `具有${region}户籍的3周岁以下婴幼儿`,
      conditions: text.includes("户籍") ? [`具有${region}户籍`] : [],
      region,
    });
  }

  // 查找申请材料
  if (text.includes("出生医学证明") || text.includes("户口簿")) {
    const materials: string[] = [];
    if (text.includes("出生医学证明")) materials.push("出生医学证明");
    if (text.includes("户口簿") || text.includes("居民户口簿")) materials.push("居民户口簿");
    if (text.includes("身份证")) materials.push("身份证明");
    items.push({
      question: `${region}育儿补贴申请材料`,
      answer: materials.join("、"),
      conditions: [],
      region,
    });
  }

  // 查找申请渠道
  if (text.includes("线上") || text.includes("系统") || text.includes("乡镇")) {
    items.push({
      question: `${region}育儿补贴申请渠道`,
      answer: "线上通过育儿补贴信息管理系统，线下到户籍所在地乡镇政府/街道办事处",
      conditions: [],
      region,
    });
  }

  // 兜底：至少有一个规则
  if (items.length === 0) {
    items.push({
      question: `${title}政策要点`,
      answer: text.slice(0, 200).replace(/\n/g, " "),
      conditions: [],
      region,
    });
  }

  const extraction = { id, items };
  extractions.set(id, extraction);
  return extraction;
}

function mockDerive(extractionId: string, region: string, policyId: string): MockDerivation {
  const id = `der_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = extractions.get(extractionId);
  const rules: MockDerivation["rules"] = [];

  if (ext) {
    for (const item of ext.items) {
      rules.push({
        name: `${region}_${item.question.slice(0, 20)}_${rules.length}`,
        head: item.answer,
        body: item.conditions.length > 0 ? item.conditions : ["符合政策规定"],
        region,
      });
    }
  }

  const derivation = { id, rules };
  derivations.set(id, derivation);
  return derivation;
}

function mockMergeAll(dryRun: boolean, planId?: string): MockMergeResult {
  const plan_id = dryRun ? `plan_${Date.now()}` : planId;
  if (!dryRun) mergeCount++;

  return {
    ok: true,
    dry_run: dryRun,
    ...(plan_id ? { plan_id } : {}),
    merged: dryRun ? 0 : 2,
    failed: 0,
    conflict_items: [],
    blocked_rules: [],
    warnings: [],
    results: [
      { region: "北京市", ok: true },
      { region: "安徽省", ok: true },
    ],
  };
}

function mockQuery(region: string, text: string): MockQueryResult {
  const hasBeijing = /北京/.test(region) || /北京/.test(text);
  const hasAnhui = /安徽/.test(region) || /安徽/.test(text);
  const hasChild = /孩子|婴幼儿|子女|宝宝/.test(text);
  const hasAge = /周岁|岁|月/.test(text);

  if (!hasBeijing && !hasAnhui) {
    return {
      ok: false,
      region,
      eligible: false,
      verdict: "ineligible",
      conclusions: [],
    };
  }

  // 模拟资格判断逻辑
  if (!hasChild) {
    return {
      ok: true,
      region,
      eligible: false,
      verdict: "missing_info",
      missing: [
        { op: "has_child", zh: "是否有孩子", hint: "请确认家庭是否有孩子" },
        { op: "child_age", zh: "孩子年龄", hint: "请提供孩子出生日期或年龄" },
      ],
      conclusions: [],
    };
  }

  if (!hasAge) {
    return {
      ok: true,
      region,
      eligible: false,
      verdict: "missing_info",
      missing: [
        { op: "child_age", zh: "孩子年龄", hint: "请提供孩子出生日期" },
      ],
      conclusions: [],
    };
  }

  // 有孩子且有年龄 → eligible
  return {
    ok: true,
    region,
    eligible: true,
    verdict: "eligible",
    conclusions: [],
  };
}

// ─── Mock HTTP 处理器 ───

/**
 * 拦截 proxyOnto 调用，返回模拟响应。
 * 调用方式: mockOntoResponse("POST", "/api/onto/extract", body) → 返回模拟 JSON
 */
export function mockOntoResponse(
  method: string,
  path: string,
  body: unknown,
): unknown {
  // 登录
  if (method === "POST" && path === "/api/login") {
    return { ok: true, token: "mock-session-token" };
  }

  const params = (body ?? {}) as Record<string, unknown>;

  // extract
  if (method === "POST" && path === "/api/onto/extract") {
    const region = typeof params.region_selector === "object"
      ? (((params.region_selector as any)?.levels?.province_level as string) ?? "未知")
      : String(params.region ?? "未知");
    const title = String(params.title ?? "未知政策");
    const text = String(params.text ?? "");
    return mockExtract(text, region, title);
  }

  // derive
  if (method === "POST" && path === "/api/onto/derive") {
    const extractionId = String(params.extraction_id ?? "");
    const region = typeof params.region_selector === "object"
      ? (((params.region_selector as any)?.levels?.province_level as string) ?? "未知")
      : String(params.region ?? "未知");
    const policyId = String(params.policy_id ?? "unknown");
    return mockDerive(extractionId, region, policyId);
  }

  // merge-all (匹配 /api/policies/:id/merge-all)
  if (method === "POST" && /^\/api\/policies\/[^/]+\/merge-all$/.test(path)) {
    const dryRun = Boolean(params.dry_run);
    const planId = typeof params.plan_id === "string" ? params.plan_id : undefined;
    return mockMergeAll(dryRun, planId);
  }

  // query (规则引擎)
  if (method === "POST" && path === "/api/query") {
    const region = String(params.region ?? "");
    const text = String(params.text ?? "");
    return mockQuery(region, text);
  }

  throw new Error(`Mock: unknown endpoint ${method} ${path}`);
}
