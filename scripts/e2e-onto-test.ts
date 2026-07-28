/**
 * e2e-test.ts — 本体智能体平台端到端测试 (全 Mock 本地)
 *
 * 模拟完整链路:
 *   数据扫描 → Step2 建模 → Agent 创建 → 用户查询 → 规则引擎判定 → 文档检索 → 答案生成
 *
 * 运行: MOCK_ONTO=1 npx tsx scripts/e2e-onto-test.ts
 */
import { mkdirSync, writeFileSync, existsSync, rmSync, cpSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── 模拟 Agent 工作流引擎 ───

interface AgentContext {
  cwd: string;
  configPath: string;
  history: string[];
}

/** 简易 Agent: 按 SKILL.md 工作流逐步骤执行 */
class MockAgent {
  private ctx: AgentContext;

  constructor(private skillDir: string, private dataRoot: string) {
    this.ctx = { cwd: skillDir, configPath: join(skillDir, "config.json"), history: [] };
  }

  /** 模拟 read 工具 */
  private read(path: string): string {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return `[文件不存在: ${path}]`;
    }
  }

  /** 模拟规则引擎调用 */
  private async policyRuleEngine(params: {
    region: string; policyType: string; userConditions: string; question?: string;
  }) {
    // 使用 mock-onto 的 mockQuery
    const { mockOntoResponse } = await import("../packages/onto-bridge/src/mock-onto.js");
    const result = mockOntoResponse("POST", "/api/query", {
      region: params.region,
      text: params.userConditions,
      question: params.question,
    }) as any;
    return result;
  }

  /** 执行完整工作流 */
  async answer(userQuery: string): Promise<string> {
    const sections: string[] = [];

    // Step 1: 判断是否政策相关
    if (/天气|吃饭|游戏|电影/.test(userQuery)) {
      return "您的问题不属于政策智能体服务范畴。";
    }

    // Step 2: 提取意图
    const intents: string[] = [];
    if (/条件|资格|能.*申请|符合|可以.*领/.test(userQuery)) intents.push("check_eligibility");
    if (/材料|证明|证件|带什么/.test(userQuery)) intents.push("materials_required");
    if (/流程|怎么.*申请|渠道|去哪|线上|线下/.test(userQuery)) intents.push("application_process");
    if (intents.length === 0) intents.push("other");

    // Step 3.5: 提取地域
    let region = "";
    if (/北京/.test(userQuery)) region = "北京市";
    else if (/安徽/.test(userQuery)) region = "安徽省";
    if (!region) return "请先告诉我您所在的地区（如北京市、安徽省），以便我为您查询当地政策。";

    // Step 4: check_eligibility
    if (intents.includes("check_eligibility")) {
      const resp = await this.policyRuleEngine({
        region,
        policyType: "育儿补贴",
        userConditions: userQuery,
        question: userQuery,
      });

      if (resp.verdict === "eligible") {
        sections.push("## 资格判断结果\n\n✅ 根据规则引擎判定，您符合该政策的申请要求。");
      } else if (resp.verdict === "missing_info") {
        const missing = (resp.missing ?? []).map((f: any) => f.zh || f.op).join("、");
        sections.push(`## 资格判断结果\n\n⚠️ 您提供的条件信息不完整，请补充以下信息：${missing}。`);
        return sections.join("\n\n");
      } else {
        sections.push(`## 资格判断结果\n\n❌ 很抱歉，根据您提供的条件，您不符合该政策的申请要求。`);
        return sections.join("\n\n");
      }
    }

    // Step 6: 处理其他意图 — 从本地文档检索
    const dataFiles = this.scanDataFiles(region);
    for (const intent of intents.filter(i => i !== "check_eligibility")) {
      if (intent === "materials_required") {
        const found = this.searchInDocs(dataFiles, /材料|证明|出生医学证明|户口簿/);
        if (found) {
          sections.push(`## 申请所需材料\n\n${found}`);
        } else {
          sections.push("## 申请所需材料\n\n根据政策规定，一般需要：出生医学证明、居民户口簿、身份证明等。具体以当地要求为准。");
        }
      }
      if (intent === "application_process") {
        const found = this.searchInDocs(dataFiles, /流程|线上|线下|系统|街道|乡镇|申请/);
        if (found) {
          sections.push(`## 申请流程\n\n${found}`);
        } else {
          sections.push("## 申请流程\n\n一般流程：线上预审 → 窗口办理 → 审核审批 → 结果领取。");
        }
      }
    }

    if (sections.length === 0) {
      sections.push("## 查询结果\n\n已为您检索到相关政策，但当前证据不足以给出确切结论。建议咨询当地卫生健康部门。");
    }

    return sections.join("\n\n");
  }

  private scanDataFiles(region: string): Array<{ path: string; content: string }> {
    const results: Array<{ path: string; content: string }> = [];
    const regionalDir = join(this.dataRoot, region);
    try {
      for (const entry of readdirSync(regionalDir)) {
        if (entry.endsWith(".md") && entry !== "INDEX.md") {
          results.push({
            path: join(regionalDir, entry),
            content: readFileSync(join(regionalDir, entry), "utf-8"),
          });
        }
      }
    } catch { /* dir not found */ }
    return results;
  }

  private searchInDocs(files: Array<{ path: string; content: string }>, pattern: RegExp): string | null {
    for (const f of files) {
      const match = f.content.match(pattern);
      if (match) {
        return f.content.slice(
          Math.max(0, (match.index ?? 0) - 50),
          (match.index ?? 0) + 300,
        ).replace(/\n/g, " ").trim();
      }
    }
    return null;
  }
}

// ─── 测试用例 ───

const TEST_CASES = [
  { q: "我是北京户口，有个5个月大的孩子，能申请育儿补贴吗", expect: "eligible" },
  { q: "安徽的育儿补贴，需要准备什么材料", expect: "materials" },
  { q: "北京怎么申请那个小孩的补贴", expect: "process" },
  { q: "河北的育儿补贴多少钱", expect: "unsupported_region" },
  { q: "今天天气怎么样", expect: "not_policy" },
  { q: "我孩子3岁半，安徽户口，能申请吗", expect: "check_age" },
  { q: "我想在线上申请，有没有APP", expect: "channel" },
  { q: "我是安徽的，刚生完二胎，能领补贴吗", expect: "eligible" },
];

// ─── 主测试 ───

async function main() {
  const dataRoot = "D:/Program Files/AspireCode/aspirecode-source-study/agent_learning/data";

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  本体智能体平台 — 端到端 Mock 测试            ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
  console.log(`数据源: ${dataRoot}`);
  console.log("");

  // 检查数据源
  if (!existsSync(dataRoot)) {
    console.log("❌ 数据源不存在:", dataRoot);
    process.exit(1);
  }

  const agent = new MockAgent(
    join(dataRoot, "skills", "育儿补贴研发测试验证"),
    dataRoot,
  );

  console.log("测试用例:");
  console.log("-".repeat(55));

  let pass = 0;
  let fail = 0;

  for (const tc of TEST_CASES) {
    process.stdout.write(`\n📝 ${tc.q}\n`);
    const answer = await agent.answer(tc.q);
    console.log(answer.slice(0, 300));
    console.log("");

    // 简单判定
    const ok =
      (tc.expect === "eligible" && answer.includes("符合")) ||
      (tc.expect === "materials" && answer.includes("材料")) ||
      (tc.expect === "process" && answer.includes("流程") || answer.includes("申请")) ||
      (tc.expect === "unsupported_region" && answer.includes("地区")) ||
      (tc.expect === "not_policy" && answer.includes("不属于")) ||
      (tc.expect === "check_age" && (answer.includes("不完整") || answer.includes("补充"))) ||
      (tc.expect === "channel" && (answer.includes("线上") || answer.includes("APP")));

    if (ok) { pass++; console.log("   ✅ PASS"); }
    else { fail++; console.log("   ❌ FAIL (expected: " + tc.expect + ")"); }
  }

  console.log("");
  console.log("=".repeat(55));
  console.log(`结果: ${pass}/${pass + fail} 通过`);
  console.log("=".repeat(55));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
