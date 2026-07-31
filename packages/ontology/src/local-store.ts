import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import matter from "gray-matter";
import { z } from "zod";

const operatorSchema = z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "in", "contains", "exists"]);
const extractedRuleSchema = z.object({
  rule_key: z.string().min(1).max(120),
  field: z.string().min(1).max(80),
  field_label: z.string().min(1).max(80),
  operator: operatorSchema,
  effect: z.enum(["require", "exclude", "info"]).default("require"),
  scope: z.enum(["eligibility", "procedure", "material", "payment"]).default("eligibility"),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  conclusion: z.string().min(1).max(500),
  missing_prompt: z.string().min(1).max(200),
  section: z.string().max(200).default(""),
  evidence: z.string().min(1).max(2000),
});

const extractionSchema = z.object({
  policy_title: z.string().min(1),
  policy_type: z.string().min(1).default("childcare-subsidy"),
  region: z.string().min(1),
  source_url: z.string().default("unknown"),
  materials: z.array(z.string()).default([]),
  procedure: z.array(z.string()).default([]),
  rules: z.array(extractedRuleSchema).min(1),
});

export type ExtractedRule = z.infer<typeof extractedRuleSchema>;
export type PolicyExtraction = z.infer<typeof extractionSchema>;

export interface LocalOntologySummary {
  project: string;
  version: string;
  policy_id: string;
  status: "draft" | "published";
  documents: number;
  rules: number;
  errors: number;
  conflicts: number;
  conflict_items: Array<{ region: string; rule_key: string; variants: number }>;
  error_items: Array<{ path: string; error: string }>;
}

export interface LocalPolicyQuery {
  policy_id: string;
  version?: string;
  region: string;
  text: string;
  question?: string;
  facts?: Record<string, unknown>;
}

export interface LocalPolicyDecision {
  ok: true;
  region: string;
  eligible: boolean;
  verdict: "eligible" | "ineligible" | "missing_info";
  missing: Array<{ op: string; zh: string; hint: string }>;
  conclusions: Array<Record<string, unknown>>;
  evidence: Array<{ document_id: string; title: string; section: string; content: string; source_url: string }>;
  version: string;
}

export function localOntologyDbPath(): string {
  return resolve(process.env.LOCAL_ONTOLOGY_DB ?? join(process.env.POLICY_WORKSPACES_ROOT ?? ".local", "ontology.db"));
}

function openDatabase(path = localOntologyDbPath()): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ontology_versions (
      project TEXT NOT NULL, version TEXT NOT NULL, policy_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, published_at TEXT,
      PRIMARY KEY(project, version), UNIQUE(policy_id, version)
    );
    CREATE TABLE IF NOT EXISTS ontology_documents (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, version TEXT NOT NULL, policy_id TEXT NOT NULL,
      path TEXT NOT NULL, sha256 TEXT NOT NULL, title TEXT NOT NULL, region TEXT NOT NULL,
      policy_type TEXT NOT NULL, source_url TEXT NOT NULL, materials_json TEXT NOT NULL,
      procedure_json TEXT NOT NULL, body TEXT NOT NULL, error TEXT,
      UNIQUE(project, version, path)
    );
    CREATE TABLE IF NOT EXISTS ontology_rules (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES ontology_documents(id) ON DELETE CASCADE,
      project TEXT NOT NULL, version TEXT NOT NULL, policy_id TEXT NOT NULL, region TEXT NOT NULL,
      rule_key TEXT NOT NULL, field TEXT NOT NULL, field_label TEXT NOT NULL, operator TEXT NOT NULL,
      value_json TEXT NOT NULL, effect TEXT NOT NULL DEFAULT 'require', scope TEXT NOT NULL DEFAULT 'eligibility', conclusion TEXT NOT NULL, missing_prompt TEXT NOT NULL,
      section TEXT NOT NULL, evidence TEXT NOT NULL, source_url TEXT NOT NULL,
      UNIQUE(document_id, rule_key)
    );
    CREATE INDEX IF NOT EXISTS idx_ontology_query ON ontology_rules(policy_id, version, region);
  `);
  const ruleColumns = db.prepare("PRAGMA table_info(ontology_rules)").all() as Array<{ name: string }>;
  if (!ruleColumns.some((column) => column.name === "effect")) db.exec("ALTER TABLE ontology_rules ADD COLUMN effect TEXT NOT NULL DEFAULT 'require'");
  if (!ruleColumns.some((column) => column.name === "scope")) db.exec("ALTER TABLE ontology_rules ADD COLUMN scope TEXT NOT NULL DEFAULT 'eligibility'");
  return db;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function markdownFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
    }
  }
  walk(root);
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function jsonText(input: string): string {
  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  const candidate = fenced ?? input;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("DeepSeek 未返回 JSON 对象");
  return candidate.slice(start, end + 1);
}

export async function extractPolicyWithDeepSeek(input: {
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}): Promise<PolicyExtraction> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.MODEL_NAME;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/u, "");
  if (!apiKey || !model) throw new Error("真实建模需要 DEEPSEEK_API_KEY 和 MODEL_NAME");
  const requestBody = JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你是政策规则建模器。仅提取原文明确表达的规则，不推测。输出严格 JSON。scope=eligibility 仅用于决定申请人是否具备资格；申请时间和续领要求属于 procedure，材料属于 material，发放属于 payment。effect=require 表示普通申请人必须满足；effect=exclude 表示条件命中即不符合；effect=info 表示迁入迁出、孤儿等特殊场景说明，不参与普通资格的布尔合取。不要把特殊人群的替代条件列为普通申请人的 require。每条规则用稳定 rule_key；field 使用 age_months、hukou_region、birth_date、applicant_relation 等英文键；operator 只能是 eq/neq/lt/lte/gt/gte/in/contains/exists。value 必须可机器比较。evidence 必须逐字来自原文。" },
        { role: "user", content: JSON.stringify({ title: input.title, metadata: input.metadata, document: input.body, output_schema: { policy_title: "string", policy_type: "string", region: "string", source_url: "string", materials: ["string"], procedure: ["string"], rules: [{ rule_key: "string", field: "string", field_label: "string", operator: "eq|neq|lt|lte|gt|gte|in|contains|exists", effect: "require|exclude|info", scope: "eligibility|procedure|material|payment", value: "scalar|string[]", conclusion: "string", missing_prompt: "string", section: "string", evidence: "string" }] } }) },
      ],
    });
  const timeoutMs = Number(process.env.ONTO_MODEL_TIMEOUT_MS ?? 120_000);
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) break;
      throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
  }
  if (!response?.ok) throw new Error(`DeepSeek 建模失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
  const message = payload.choices?.[0]?.message;
  return extractionSchema.parse(JSON.parse(jsonText(message?.content || message?.reasoning_content || "")));
}

export async function buildLocalOntology(input: {
  project: string;
  version: string;
  policyId: string;
  dataRoot: string;
  extractor?: typeof extractPolicyWithDeepSeek;
  dbPath?: string;
}): Promise<LocalOntologySummary> {
  const db = openDatabase(input.dbPath);
  const existing = db.prepare("SELECT status FROM ontology_versions WHERE project=? AND version=?").get(input.project, input.version) as { status: string } | undefined;
  if (existing?.status === "published") {
    db.close();
    throw new Error(`版本 ${input.version} 已发布，不可修改`);
  }
  db.prepare(`INSERT INTO ontology_versions(project,version,policy_id,status,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(project,version) DO UPDATE SET policy_id=excluded.policy_id`).run(input.project, input.version, input.policyId, "draft", new Date().toISOString());
  const extract = input.extractor ?? extractPolicyWithDeepSeek;
  for (const path of markdownFiles(resolve(input.dataRoot))) {
    const raw = readFileSync(path, "utf8");
    const parsed = matter(raw);
    const relPath = relative(resolve(input.dataRoot), path).replace(/\\/gu, "/");
    const documentId = hash(`${input.project}:${input.version}:${relPath}`).slice(0, 24);
    const digest = hash(raw);
    const previous = db.prepare("SELECT sha256,error FROM ontology_documents WHERE id=?").get(documentId) as { sha256: string; error: string | null } | undefined;
    if (previous?.sha256 === digest && !previous.error) continue;
    try {
      const extraction = await extract({ title: String(parsed.data.title ?? relPath), body: parsed.content, metadata: parsed.data as Record<string, unknown> });
      const transaction = db.transaction(() => {
        db.prepare(`INSERT INTO ontology_documents(id,project,version,policy_id,path,sha256,title,region,policy_type,source_url,materials_json,procedure_json,body,error)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET sha256=excluded.sha256,title=excluded.title,region=excluded.region,policy_type=excluded.policy_type,source_url=excluded.source_url,materials_json=excluded.materials_json,procedure_json=excluded.procedure_json,body=excluded.body,error=NULL`).run(
          documentId, input.project, input.version, input.policyId, relPath, digest, extraction.policy_title, extraction.region, extraction.policy_type, extraction.source_url, JSON.stringify(extraction.materials), JSON.stringify(extraction.procedure), parsed.content,
        );
        db.prepare("DELETE FROM ontology_rules WHERE document_id=?").run(documentId);
        const insert = db.prepare(`INSERT INTO ontology_rules(id,document_id,project,version,policy_id,region,rule_key,field,field_label,operator,value_json,effect,scope,conclusion,missing_prompt,section,evidence,source_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const rule of extraction.rules) insert.run(hash(`${documentId}:${rule.rule_key}`).slice(0, 24), documentId, input.project, input.version, input.policyId, extraction.region, rule.rule_key, rule.field, rule.field_label, rule.operator, JSON.stringify(rule.value), rule.effect, rule.scope, rule.conclusion, rule.missing_prompt, rule.section, rule.evidence, extraction.source_url);
      });
      transaction();
    } catch (error) {
      db.prepare(`INSERT INTO ontology_documents(id,project,version,policy_id,path,sha256,title,region,policy_type,source_url,materials_json,procedure_json,body,error)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sha256=excluded.sha256,body=excluded.body,error=excluded.error`).run(
        documentId, input.project, input.version, input.policyId, relPath, digest, String(parsed.data.title ?? relPath), String(parsed.data.region ?? "unknown"), String(parsed.data.policy_type ?? "childcare-subsidy"), String(parsed.data.source_url ?? "unknown"), "[]", "[]", parsed.content, error instanceof Error ? error.message : String(error),
      );
    }
  }
  const summary = inspectLocalOntology(input.project, input.version, input.dbPath);
  db.close();
  return summary;
}

function conflictItems(db: Database.Database, project: string, version: string): LocalOntologySummary["conflict_items"] {
  return db.prepare(`SELECT region, rule_key, COUNT(DISTINCT operator || ':' || value_json) AS variants
    FROM ontology_rules WHERE project=? AND version=? GROUP BY region, rule_key
    HAVING COUNT(DISTINCT operator || ':' || value_json) > 1`).all(project, version) as LocalOntologySummary["conflict_items"];
}

export function inspectLocalOntology(project: string, version: string, dbPath?: string): LocalOntologySummary {
  const db = openDatabase(dbPath);
  const versionRow = db.prepare("SELECT policy_id,status FROM ontology_versions WHERE project=? AND version=?").get(project, version) as { policy_id: string; status: "draft" | "published" } | undefined;
  if (!versionRow) { db.close(); throw new Error(`未找到项目版本: ${project}/${version}`); }
  const documents = (db.prepare("SELECT COUNT(*) count FROM ontology_documents WHERE project=? AND version=?").get(project, version) as { count: number }).count;
  const rules = (db.prepare("SELECT COUNT(*) count FROM ontology_rules WHERE project=? AND version=?").get(project, version) as { count: number }).count;
  const errors = (db.prepare("SELECT COUNT(*) count FROM ontology_documents WHERE project=? AND version=? AND error IS NOT NULL").get(project, version) as { count: number }).count;
  const conflict_items = conflictItems(db, project, version);
  const error_items = db.prepare("SELECT path,error FROM ontology_documents WHERE project=? AND version=? AND error IS NOT NULL ORDER BY path").all(project, version) as LocalOntologySummary["error_items"];
  const summary = { project, version, policy_id: versionRow.policy_id, status: versionRow.status, documents, rules, errors, conflicts: conflict_items.length, conflict_items, error_items };
  db.close();
  return summary;
}

export function publishLocalOntology(project: string, version: string, dbPath?: string): LocalOntologySummary {
  const before = inspectLocalOntology(project, version, dbPath);
  if (before.status === "published") return before;
  if (before.documents === 0 || before.rules === 0 || before.errors > 0 || before.conflicts > 0) throw new Error(`版本不可发布: documents=${before.documents}, rules=${before.rules}, errors=${before.errors}, conflicts=${before.conflicts}`);
  const db = openDatabase(dbPath);
  db.prepare("UPDATE ontology_versions SET status='published',published_at=? WHERE project=? AND version=?").run(new Date().toISOString(), project, version);
  const snapshot = { ...inspectLocalOntology(project, version, dbPath), published_at: new Date().toISOString() };
  const output = resolve(process.env.POLICY_WORKSPACES_ROOT ?? ".local", "workspaces", project, "versions", version, "ontology.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  db.close();
  return inspectLocalOntology(project, version, dbPath);
}

function extractFacts(text: string, supplied: Record<string, unknown> = {}): Record<string, unknown> {
  const facts = { ...supplied };
  const months = text.match(/(\d{1,2})\s*个?月/u)?.[1];
  const years = text.match(/(\d{1,2})\s*岁/u)?.[1];
  if (months) facts.age_months = Number(months);
  else if (years) facts.age_months = Number(years) * 12;
  if (typeof facts.age_months === "number" && facts.birth_date === undefined) {
    const estimated = new Date();
    estimated.setUTCMonth(estimated.getUTCMonth() - facts.age_months);
    facts.birth_date = estimated.toISOString().slice(0, 10);
  }
  const hukou = text.match(/(北京市|北京|河北省|河北)户籍/u)?.[1];
  if (hukou) facts.hukou_region = hukou.startsWith("北京") ? "北京市" : "河北省";
  if (/母亲|妈妈|父亲|爸爸|父母/u.test(text)) facts.applicant_relation = "父母一方";
  else if (/监护人/u.test(text)) facts.applicant_relation = "其他监护人";
  if (/依法|合法|符合法律法规/u.test(text)) facts.birth_or_adoption_lawful = true;
  if (/未(?:在|从).{0,8}(?:外地|迁出地).{0,8}领取/u.test(text)) facts.claimed_outside_same_year = false;
  return facts;
}

function matches(actual: unknown, operator: z.infer<typeof operatorSchema>, expected: unknown): boolean {
  if (operator === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (operator === "in") return Array.isArray(expected) && expected.includes(String(actual));
  if (operator === "contains") return String(actual).includes(String(expected));
  if (operator === "eq") return String(actual) === String(expected);
  if (operator === "neq") return String(actual) !== String(expected);
  if (typeof actual === "string" && typeof expected === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(actual) && /^\d{4}-\d{2}-\d{2}$/u.test(expected)) {
    return operator === "lt" ? actual < expected : operator === "lte" ? actual <= expected : operator === "gt" ? actual > expected : actual >= expected;
  }
  const left = Number(actual); const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return operator === "lt" ? left < right : operator === "lte" ? left <= right : operator === "gt" ? left > right : left >= right;
}

export function queryLocalPolicy(input: LocalPolicyQuery, dbPath?: string): LocalPolicyDecision {
  const db = openDatabase(dbPath);
  const versionRow = input.version
    ? db.prepare("SELECT version FROM ontology_versions WHERE policy_id=? AND version=? AND status='published'").get(input.policy_id, input.version)
    : db.prepare("SELECT version FROM ontology_versions WHERE policy_id=? AND status='published' ORDER BY published_at DESC LIMIT 1").get(input.policy_id) as { version: string } | undefined;
  if (!versionRow) { db.close(); throw new Error(`没有已发布的本体版本: ${input.policy_id}${input.version ? `/${input.version}` : ""}`); }
  const version = (versionRow as { version: string }).version;
  const rows = db.prepare(`SELECT r.*,d.title FROM ontology_rules r JOIN ontology_documents d ON d.id=r.document_id
    WHERE r.policy_id=? AND r.version=? AND r.scope='eligibility' AND r.region IN (?, '全国') ORDER BY r.rule_key`).all(input.policy_id, version, input.region) as Array<Record<string, unknown>>;
  if (rows.length === 0) { db.close(); throw new Error(`已发布版本不支持地域: ${input.region}`); }
  const facts = extractFacts(`${input.text} ${input.question ?? ""}`, input.facts);
  const missing: LocalPolicyDecision["missing"] = [];
  const conclusions: LocalPolicyDecision["conclusions"] = [];
  const evidence: LocalPolicyDecision["evidence"] = [];
  let failed = false;
  for (const row of rows) {
    const field = String(row.field); const actual = facts[field];
    const effect = String(row.effect ?? "require") as "require" | "exclude" | "info";
    if (effect === "info") continue;
    if (actual === undefined) {
      if (effect === "require") {
        if (!missing.some((item) => item.op === field)) missing.push({ op: field, zh: String(row.field_label), hint: String(row.missing_prompt) });
        const item = { document_id: String(row.document_id), title: String(row.title), section: String(row.section), content: String(row.evidence), source_url: String(row.source_url) };
        if (!evidence.some((existing) => existing.document_id === item.document_id && existing.section === item.section && existing.content === item.content)) {
          evidence.push(item);
        }
      }
      continue;
    }
    const expected = JSON.parse(String(row.value_json)) as unknown;
    const passed = matches(actual, operatorSchema.parse(row.operator), expected);
    conclusions.push({ rule_key: row.rule_key, field, operator: row.operator, effect, expected, actual, passed, conclusion: row.conclusion });
    if ((effect === "require" && !passed) || (effect === "exclude" && passed)) failed = true;
    evidence.push({ document_id: String(row.document_id), title: String(row.title), section: String(row.section), content: String(row.evidence), source_url: String(row.source_url) });
  }
  db.close();
  const verdict = failed ? "ineligible" : missing.length > 0 ? "missing_info" : "eligible";
  return { ok: true, region: input.region, eligible: verdict === "eligible", verdict, missing, conclusions, evidence, version };
}

export function hasPublishedLocalOntology(policyId?: string, dbPath?: string): boolean {
  if (!existsSync(dbPath ?? localOntologyDbPath())) return false;
  const db = openDatabase(dbPath);
  const row = policyId
    ? db.prepare("SELECT 1 ok FROM ontology_versions WHERE policy_id=? AND status='published' LIMIT 1").get(policyId)
    : db.prepare("SELECT 1 ok FROM ontology_versions WHERE status='published' LIMIT 1").get();
  db.close();
  return Boolean(row);
}
