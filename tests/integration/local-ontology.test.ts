import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLocalOntology, inspectLocalOntology, publishLocalOntology, queryLocalPolicy, type PolicyExtraction } from "@policy/ontology/index";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "chatgst-ontology-")); roots.push(root);
  const dataRoot = join(root, "knowledge"); mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(dataRoot, "beijing.md"), `---\ntitle: 北京育儿补贴示例\nregion: 北京市\nsource_url: https://example.test/beijing\n---\n# 申请条件\n具有北京市户籍且未满三周岁的婴幼儿可以申请。`, "utf8");
  return { dataRoot, dbPath: join(root, "ontology.db") };
}

const extraction: PolicyExtraction = {
  policy_title: "北京育儿补贴示例", policy_type: "childcare-subsidy", region: "北京市", source_url: "https://example.test/beijing", materials: ["户口簿"], procedure: ["在线申请"],
  rules: [
    { rule_key: "beijing-hukou", field: "hukou_region", field_label: "户籍地", operator: "eq", effect: "require", scope: "eligibility", value: "北京市", conclusion: "须具有北京市户籍", missing_prompt: "请说明孩子户籍地", section: "申请条件", evidence: "具有北京市户籍" },
    { rule_key: "age-under-3", field: "age_months", field_label: "月龄", operator: "lt", effect: "require", scope: "eligibility", value: 36, conclusion: "须未满三周岁", missing_prompt: "请说明孩子月龄", section: "申请条件", evidence: "未满三周岁的婴幼儿" },
  ],
};

describe("local ontology MVP", () => {
  it("builds, resumes, publishes and deterministically queries one SQLite rule set", async () => {
    const ws = workspace();
    const input = { project: "childcare", version: "v1", policyId: "childcare-subsidy", dataRoot: ws.dataRoot, dbPath: ws.dbPath, extractor: async () => extraction };
    expect(await buildLocalOntology(input)).toMatchObject({ documents: 1, rules: 2, errors: 0, conflicts: 0, status: "draft" });
    expect(await buildLocalOntology(input)).toMatchObject({ documents: 1, rules: 2 });
    expect(publishLocalOntology("childcare", "v1", ws.dbPath).status).toBe("published");
    await expect(buildLocalOntology(input)).rejects.toThrow(/已发布/u);
    expect(queryLocalPolicy({ policy_id: "childcare-subsidy", version: "v1", region: "北京市", text: "孩子5个月，北京户籍" }, ws.dbPath).verdict).toBe("eligible");
    expect(queryLocalPolicy({ policy_id: "childcare-subsidy", version: "v1", region: "北京市", text: "孩子40个月，北京户籍" }, ws.dbPath).verdict).toBe("ineligible");
    const missing = queryLocalPolicy({ policy_id: "childcare-subsidy", version: "v1", region: "北京市", text: "孩子5个月" }, ws.dbPath);
    expect(missing).toMatchObject({ verdict: "missing_info", missing: [{ op: "hukou_region" }] });
    expect(missing.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ section: "申请条件", content: "具有北京市户籍" })]));
    expect(inspectLocalOntology("childcare", "v1", ws.dbPath).status).toBe("published");
  });

  it("keeps failed extraction visible and blocks publication", async () => {
    const ws = workspace();
    const summary = await buildLocalOntology({ project: "childcare", version: "bad", policyId: "childcare-subsidy", dataRoot: ws.dataRoot, dbPath: ws.dbPath, extractor: async () => { throw new Error("recorded model failure"); } });
    expect(summary).toMatchObject({ documents: 1, rules: 0, errors: 1 });
    expect(() => publishLocalOntology("childcare", "bad", ws.dbPath)).toThrow(/版本不可发布/u);
  });
});
