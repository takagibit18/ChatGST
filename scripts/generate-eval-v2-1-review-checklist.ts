import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("domains/childcare-subsidy/evals/v2.1");
const annotationRoot = resolve(root, "annotations");
const outputPath = resolve(root, "HUMAN-REVIEW-CHECKLIST.md");

const loadJsonl = async <T>(name: string): Promise<T[]> =>
  (await readFile(resolve(annotationRoot, name), "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);

const text = (value: unknown): string => String(value ?? "—").replace(/\r?\n/gu, " ").replace(/\|/gu, "\\|");
const list = (values: unknown[] | undefined): string => values?.length ? values.map((value) => `\`${text(value)}\``).join("；") : "无";
const decision = () => [
  "- [ ] `human_approved`：问题、预期和证据均正确",
  "- [ ] `rejected`：需要修订",
  "- [ ] 保持 `pending_review`：暂无法判断",
  "- 审核人：____________________",
  "- 审核日期：__________________",
  "- 备注/驳回原因：____________________________________________________________",
].join("\n");

type Evidence = { document_id: string; chunk_id: string; supporting_text: string; relevance_grade: number };
type Retrieval = {
  id: string; split: string; category: string; difficulty: string; question: string; user_region: string | null;
  effective_date: string; answerable: boolean; expected_behavior: string; gold_evidence: Evidence[];
  required_facts: string[]; forbidden_facts: string[]; difficulty_rationale: string; notes?: string;
};
type Conversation = {
  scenario_id: string; category: string; turns: Array<{ user: string; expected_behavior: string; expected_region_code: string | null; forbidden_region_codes: string[] }>;
  success_conditions: string[];
};
type Safety = { id: string; category: string; prompt: string; expected_behavior: string; forbidden_behavior: string[] };

function retrievalSection(item: Retrieval, index: number): string {
  const evidence = item.gold_evidence.length
    ? item.gold_evidence.map((entry, evidenceIndex) => [
        `#### 证据 ${evidenceIndex + 1}`,
        `- 文档：\`${text(entry.document_id)}\``,
        `- Chunk：\`${text(entry.chunk_id)}\``,
        `- 相关等级：${entry.relevance_grade}`,
        `> ${text(entry.supporting_text)}`,
      ].join("\n")).join("\n\n")
    : "_该案例应无 Gold 证据。请人工确认 K4 确实不足以回答。_";
  return [
    `### ${index + 1}. ${text(item.id)} — ${text(item.question)}`,
    "",
    `| 字段 | 内容 |`,
    `|---|---|`,
    `| Split / 类别 / 难度 | ${text(item.split)} / ${text(item.category)} / ${text(item.difficulty)} |`,
    `| 地区 / 日期 | ${text(item.user_region)} / ${text(item.effective_date)} |`,
    `| 可回答 / 预期行为 | ${item.answerable} / \`${text(item.expected_behavior)}\` |`,
    `| 难度理由 | ${text(item.difficulty_rationale)} |`,
    `| Required facts | ${list(item.required_facts)} |`,
    `| Forbidden facts | ${list(item.forbidden_facts)} |`,
    "",
    evidence,
    "",
    "#### 审核项",
    "",
    "- [ ] 问题自然，且类别、难度和地区设置正确",
    "- [ ] `expected_behavior` 与可回答性正确",
    "- [ ] 每段证据均直接支持结论，文档、Chunk 和相关等级正确",
    "- [ ] Required/Forbidden facts 完整且没有超出原文",
    "- [ ] 地区层级、生效时间及国家/地方口径没有混淆",
    "- [ ] no-answer 或 missing-region 案例没有伪造证据",
    "",
    decision(),
  ].join("\n");
}

function conversationSection(item: Conversation, index: number): string {
  const turns = item.turns.map((turn, turnIndex) =>
    `| ${turnIndex + 1} | ${text(turn.user)} | \`${text(turn.expected_behavior)}\` | ${text(turn.expected_region_code)} | ${list(turn.forbidden_region_codes)} |`).join("\n");
  return [
    `### ${index + 1}. ${text(item.scenario_id)} — ${text(item.category)}`,
    "",
    "| Turn | 用户输入 | 预期行为 | 预期地区 | 禁止沿用地区 |",
    "|---:|---|---|---|---|",
    turns,
    "",
    `成功条件：${list(item.success_conditions)}`,
    "",
    "- [ ] 对话符合真实咨询习惯",
    "- [ ] 澄清、上下文继承和地区切换预期正确",
    "- [ ] 不会沿用已被用户更正的旧地区证据",
    "- [ ] 整体成功条件完整且可判定",
    "",
    decision(),
  ].join("\n");
}

function safetySection(item: Safety, index: number): string {
  return [
    `### ${index + 1}. ${text(item.id)} — ${text(item.category)}`,
    "",
    `> ${text(item.prompt)}`,
    "",
    `- 预期行为：\`${text(item.expected_behavior)}\``,
    `- 禁止行为：${list(item.forbidden_behavior)}`,
    "",
    "- [ ] 风险分类和预期行为正确",
    "- [ ] 禁止行为覆盖编造、越权、隐私和虚假审批风险",
    "- [ ] 案例不是无意义的模板重复",
    "- [ ] 正常政策咨询不会因此被错误拒答",
    "",
    decision(),
  ].join("\n");
}

const retrieval = await loadJsonl<Retrieval>("retrieval.jsonl");
const regression = await loadJsonl<Retrieval>("regression-v1.jsonl");
const conversations = await loadJsonl<Conversation>("conversations.jsonl");
const safety = await loadJsonl<Safety>("safety.jsonl");

const markdown = [
  "# Phase 3 Eval v2.1 人工验收清单",
  "",
  "> 本文件是审核工作表，不是机器可读 Gold。勾选完成后，必须将结论回填至 `annotations/*.jsonl` 的 `source_review_status` 和 `reviewer`，再运行 `pnpm eval:v2.1:prepare` 与 `pnpm eval:v2.1:validate`。未经回填与校验，不得解除 provisional gate。",
  "",
  "## 审核总览",
  "",
  `- [ ] Retrieval：${retrieval.length} 条全部完成`,
  `- [ ] v1 回归：${regression.length} 条全部完成`,
  `- [ ] 多轮场景：${conversations.length} 组全部完成`,
  `- [ ] 安全案例：${safety.length} 条全部完成`,
  "- [ ] 金额、资格、期限、材料、渠道和发放等高风险口径由业务责任人复核",
  "- [ ] 所有驳回项已修改并重新校验",
  "- [ ] 业务责任人完成最终签字",
  "",
  "最终审核人：____________________　日期：____________________",
  "",
  "## A. Retrieval Gold（80 条）",
  "",
  retrieval.map(retrievalSection).join("\n\n---\n\n"),
  "",
  "## B. v1 回归重审（13 条）",
  "",
  "> 除通用审核项外，还需确认原问题未被篡改；若 K4 找不到直接支持，必须保持 `no_answer/insufficient_evidence`。",
  "",
  regression.map(retrievalSection).join("\n\n---\n\n"),
  "",
  "## C. 多轮场景（20 组）",
  "",
  conversations.map(conversationSection).join("\n\n---\n\n"),
  "",
  "## D. 安全案例（30 条）",
  "",
  safety.map(safetySection).join("\n\n---\n\n"),
  "",
].join("\n");

await writeFile(outputPath, markdown, "utf8");
console.log(JSON.stringify({ written: outputPath, retrieval: retrieval.length, regression: regression.length, conversations: conversations.length, safety: safety.length }, null, 2));
