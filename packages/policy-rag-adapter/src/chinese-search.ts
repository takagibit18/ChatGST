import type { SearchTextProcessor } from "./types.js";

const phrases = [
  "育儿补贴",
  "生育津贴",
  "申请资格",
  "补贴对象",
  "申领人",
  "申请材料",
  "关键材料",
  "申请渠道",
  "申领渠道",
  "申领时限",
  "首次申请",
  "发放规则",
  "户籍迁移",
  "出生医学证明",
  "居民户口簿",
  "北京市",
  "河北省",
  "工作日",
];

const synonymGroups = [
  ["金额", "标准", "多少钱", "补贴标准"],
  ["资格", "条件", "对象", "能否申请", "可以申请"],
  ["申领人", "申请人", "谁能申请"],
  ["材料", "资料", "证明"],
  ["渠道", "入口", "线上申请", "现场申请"],
  ["时限", "截止日期", "申请期限", "窗口"],
  ["发放", "到账", "支付", "集中发放"],
  ["户籍", "户口", "迁入", "迁出", "居住地"],
  ["生育津贴", "生育保险", "产假工资"],
];

function normalized(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/北京市/gu, "北京市 北京")
    .replace(/河北省/gu, "河北省 河北")
    .replace(/[\u0000-\u001f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function terms(input: string): string[] {
  const text = normalized(input);
  const output: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !output.includes(trimmed)) output.push(trimmed);
  };
  for (const phrase of phrases) if (text.includes(phrase)) add(phrase);
  for (const group of synonymGroups) {
    if (group.some((item) => text.includes(item))) group.forEach(add);
  }
  for (const match of text.matchAll(/[A-Za-z]+|\d+(?:\.\d+)?|[\p{Script=Han}]+/gu)) {
    const token = match[0];
    if (!/^\p{Script=Han}+$/u.test(token)) {
      add(token.toLowerCase());
      continue;
    }
    if (token.length <= 8) add(token);
    for (let index = 0; index < token.length - 1; index += 1) add(token.slice(index, index + 2));
  }
  if (text.includes("北京")) {
    add("北京");
    add("北京市");
  }
  if (text.includes("河北")) {
    add("河北");
    add("河北省");
  }
  return output;
}

export class ChinesePolicySearchTextProcessor implements SearchTextProcessor {
  indexText(text: string): string {
    return `${normalized(text)}\n${terms(text).join(" ")}`;
  }

  queryText(text: string): string {
    return terms(text).join(" ");
  }

  queryTerms(text: string): string[] {
    return terms(text).slice(0, 32);
  }
}

export function toFtsQuery(searchTerms: string[]): string {
  return searchTerms
    .filter((term) => /^[\p{Script=Han}A-Za-z0-9.]+$/u.test(term))
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

