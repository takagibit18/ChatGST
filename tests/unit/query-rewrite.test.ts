import { describe, expect, it } from "vitest";
import { parseQueryRewriteResult } from "@policy/model-provider/index";

describe("structured query rewrite parsing", () => {
  const fallback = { query: "北京这个咋整", intent: "unknown" as const };

  it("accepts a valid structured rewrite", () => {
    expect(parseQueryRewriteResult('{"query":"北京 育儿补贴 申请渠道","intent":"channel"}', fallback)).toEqual({
      query: "北京 育儿补贴 申请渠道",
      intent: "channel",
    });
  });

  it.each([
    "not-json",
    '{"query":"北京 育儿补贴","intent":"invented"}',
    JSON.stringify({ query: "查".repeat(201), intent: "overview" }),
    '{"query":"","intent":"overview"}',
  ])("falls back for invalid output", (output) => {
    expect(parseQueryRewriteResult(output, fallback)).toBe(fallback);
  });
});
