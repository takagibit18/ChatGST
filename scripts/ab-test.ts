import "dotenv/config";
import { WebSocket } from "ws";

const QUESTIONS = [
  { q: "孩子刚生不久，有没有什么补贴可以拿的", intent: "overview", note: "模糊口语无地区" },
  { q: "河北生二胎，能拿多少钱", intent: "amount", note: "口语+金额" },
  { q: "北京怎么申请那个小孩补贴", intent: "channel", note: "口语+渠道" },
  { q: "我是河北户口，孩子在北京出生，能在北京领吗", intent: "migration", note: "跨地区迁移" },
  { q: "北京申请需要什么材料", intent: "materials", note: "明确+材料" },
  { q: "补贴多久能到账啊", intent: "payment", note: "缺地区+发放" },
  { q: "什么人可以领这个补贴，有啥要求", intent: "eligibility", note: "缺地区+资格" },
  { q: "河北育儿补贴，谁可以去申请", intent: "claimant", note: "有地区+申领人" },
  { q: "北京那个补贴，一年能拿多少", intent: "amount", note: "口语+金额明确" },
  { q: "申请有没有时间限制，最晚啥时候", intent: "deadline", note: "缺地区+时限" },
  { q: "河北和北京的补贴，哪个给的多", intent: "comparison", note: "两地对比" },
  { q: "线上能申请吗，什么APP或者网站", intent: "channel", note: "缺地区+渠道" },
  { q: "生二胎和三胎，补贴一样吗", intent: "amount", note: "缺地区+多胎比较" },
  { q: "我户口刚从河北迁到北京，补贴该找哪边", intent: "migration", note: "户籍迁移" },
  { q: "申请补贴要带身份证吗，还要什么", intent: "materials", note: "缺地区+材料" },
];

type Result = {
  q: string;
  note: string;
  status: string;
  intent: string;
  region: string | null;
  answer: string;
  elapsed: number;
  sources: number;
  events: string[];
};

async function testOne(q: string): Promise<Result> {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://127.0.0.1:3001/ws");
    const start = Date.now();
    const events: string[] = [];
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "ask", conversation_id: `ab-${Date.now()}-${Math.random().toString(36).slice(2)}`, message: q })),
    );
    ws.on("message", (data) => {
      const e = JSON.parse(data.toString()) as { type: string; stage?: string; message?: string; response?: { meta: { answer_status: string; intent: string; region: string | null }; answer_markdown: string; sources: Array<unknown> }; code?: string };
      if (e.type === "status") events.push(e.message ?? e.stage ?? "");
      if (e.type === "result" || e.type === "safe_error") {
        const r = e.type === "result" ? e.response! : { meta: { answer_status: "safe_error", intent: "?", region: "?" }, answer_markdown: "", sources: [] };
        resolve({ q, note: "", status: r.meta.answer_status, intent: r.meta.intent, region: r.meta.region, answer: r.answer_markdown.slice(0, 120), elapsed: Date.now() - start, sources: r.sources.length, events });
        ws.close();
      }
    });
    setTimeout(() => resolve({ q, note: "", status: "TIMEOUT", intent: "?", region: null, answer: "", elapsed: 60000, sources: 0, events }), 60000);
  });
}

async function main() {
  const mode = process.env.ANSWER_MODE ?? "unknown";
  console.log(`\nA/B Test - Mode: ${mode} - ${QUESTIONS.length} questions\n`);
  console.log("=".repeat(65));
  let results: Result[] = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const t = QUESTIONS[i]!;
    process.stderr.write(`[${i + 1}/${QUESTIONS.length}] ${t.q.slice(0, 30)}... `);
    const r = await testOne(t.q);
    r.note = t.note;
    results.push(r);
    const icon = r.status === "answered" ? "✅" : r.status === "needs_clarification" ? "❓" : r.status === "insufficient_evidence" ? "⚠️" : "❌";
    process.stderr.write(`${icon} ${r.status} ${r.elapsed}ms\n`);
  }
  
  console.log(`\n结果汇总 (${mode}):`);
  console.log("-".repeat(65));
  const answered = results.filter((r) => r.status === "answered");
  const clarified = results.filter((r) => r.status === "needs_clarification");
  const insufficient = results.filter((r) => r.status === "insufficient_evidence");
  const safeErrors = results.filter((r) => r.status === "safe_error");
  const timeouts = results.filter((r) => r.status === "TIMEOUT");
  
  console.log(`  answered:              ${answered.length}`);
  console.log(`  needs_clarification:   ${clarified.length}`);
  console.log(`  insufficient_evidence: ${insufficient.length}`);
  console.log(`  safe_error:            ${safeErrors.length}`);
  console.log(`  TIMEOUT:               ${timeouts.length}`);
  console.log(`  有效回答率: ${answered.length}/${results.length}`);
  
  const avgTime = results.filter((r) => r.status !== "TIMEOUT").reduce((s, r) => s + r.elapsed, 0) / Math.max(1, results.filter((r) => r.status !== "TIMEOUT").length);
  console.log(`  平均耗时: ${Math.round(avgTime)}ms`);
  
  console.log(`\n明细:`);
  console.log("-".repeat(65));
  for (const r of results) {
    const icon = r.status === "answered" ? "✅" : r.status === "needs_clarification" ? "❓" : r.status === "insufficient_evidence" ? "⚠️" : "❌";
    console.log(`${icon} [${r.note}] ${r.q}`);
    console.log(`   status=${r.status} intent=${r.intent} ${r.elapsed}ms`);
    if (r.answer) console.log(`   answer: ${r.answer}`);
  }
  
  process.exit(0);
}

main();
