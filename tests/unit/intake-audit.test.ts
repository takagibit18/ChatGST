import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditIntakeDirectory,
  defaultKnowledgeLocations,
  loadPolicyDocuments,
  serializeIntakeAudit,
  summarizeIntakeAudit,
} from "@policy/rag/index";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "chatgst-intake-audit-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fixture(overrides: Partial<Record<"title" | "region" | "resource" | "timestamp" | "status" | "body", string>> = {}): string {
  const values = {
    title: "测试育儿补贴实施细则",
    region: "北京市",
    resource: "https://example.gov.cn/policy",
    timestamp: "2026-01-02",
    status: "effective",
    body: "第一条 本细则用于审计测试。",
    ...overrides,
  };
  return [
    "---",
    "type: 政策规章",
    `title: ${values.title}`,
    `status: ${values.status}`,
    `resource: "${values.resource}"`,
    `region: ${values.region}`,
    `timestamp: "${values.timestamp}"`,
    "---",
    "",
    values.body,
    "",
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("nationwide intake audit", () => {
  it("is deterministic, sorted and unique", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "b.md"), fixture({ title: "乙地育儿补贴实施细则" }), "utf8");
    await writeFile(join(directory, "a.md"), fixture({ title: "甲地育儿补贴实施细则" }), "utf8");

    const first = await auditIntakeDirectory(directory);
    const second = await auditIntakeDirectory(directory);

    expect(first.map((record) => record.relative_path)).toEqual(["a.md", "b.md"]);
    expect(new Set(first.map((record) => record.relative_path)).size).toBe(first.length);
    expect(serializeIntakeAudit(first)).toBe(serializeIntakeAudit(second));
  });

  it("flags invalid UTF-8 and missing or malformed metadata", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "invalid-utf8.md"), Buffer.from([0xc3, 0x28]));
    await writeFile(join(directory, "invalid-metadata.md"), fixture({
      title: "政府信息公开",
      region: "",
      resource: "not-a-url",
      timestamp: "2026-02-30",
      status: "verified",
      body: "",
    }), "utf8");

    const records = await auditIntakeDirectory(directory);
    const invalidUtf8 = records.find((record) => record.relative_path === "invalid-utf8.md");
    const invalidMetadata = records.find((record) => record.relative_path === "invalid-metadata.md");

    expect(invalidUtf8?.flags).toContain("invalid_utf8");
    expect(invalidMetadata?.flags).toEqual(expect.arrayContaining([
      "empty_body",
      "invalid_date",
      "invalid_source_url",
      "missing_region",
      "non_index_status",
      "suspicious_title",
    ]));
  });

  it("changes the serialized manifest when a file is modified, added or removed", async () => {
    const directory = await temporaryDirectory();
    const originalPath = join(directory, "original.md");
    await writeFile(originalPath, fixture(), "utf8");
    const committed = serializeIntakeAudit(await auditIntakeDirectory(directory));

    await writeFile(originalPath, fixture({ body: "正文发生变化。" }), "utf8");
    expect(serializeIntakeAudit(await auditIntakeDirectory(directory))).not.toBe(committed);

    await writeFile(originalPath, fixture(), "utf8");
    await writeFile(join(directory, "added.md"), fixture({ title: "新增政策材料" }), "utf8");
    expect(serializeIntakeAudit(await auditIntakeDirectory(directory))).not.toBe(committed);

    await unlink(join(directory, "added.md"));
    await unlink(originalPath);
    expect(serializeIntakeAudit(await auditIntakeDirectory(directory))).not.toBe(committed);
  });

  it("audits the committed 47-file snapshot without changing the default corpus", async () => {
    const intake = resolve("knowledge/intake/nationwide-childcare");
    const records = await auditIntakeDirectory(intake);
    const summary = summarizeIntakeAudit(records);
    const indexed = await loadPolicyDocuments(defaultKnowledgeLocations());

    expect(summary.files).toBe(47);
    expect(summary.bytes).toBe(375_197);
    expect(summary.utf8_invalid).toBe(0);
    expect(summary.source_url_invalid).toBe(0);
    expect(summary.date_invalid).toBe(0);
    expect(indexed.every((document) => !document.sourcePath.includes("knowledge\\intake"))).toBe(true);
  });

  it("keeps the committed audit hash-bound to the cross-platform canonical snapshot", async () => {
    const generated = serializeIntakeAudit(await auditIntakeDirectory(resolve("knowledge/intake/nationwide-childcare")));
    const committed = await readFile(resolve("knowledge/metadata/nationwide-childcare-source-audit.jsonl"), "utf8");
    expect(generated.replace(/\r\n/gu, "\n")).toBe(committed.replace(/\r\n/gu, "\n"));
  });
});
