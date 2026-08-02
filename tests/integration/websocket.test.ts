import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { PolicyResponse } from "@policy/schemas/index";
import { FORBIDDEN_AGENT_EVENT_TYPES, PolicyUiEventAdapter, createPolicyServer } from "@policy/web-adapter/index";
import { testConfig, validResponse } from "../helpers.js";

const openApplications: Array<ReturnType<typeof createPolicyServer>> = [];

afterEach(async () => {
  await Promise.allSettled(openApplications.splice(0).map((application) => application.close()));
});

describe("public policy HTTP and WebSocket adapter", () => {
  it("sends status events followed by one fully validated result", async () => {
    const response: PolicyResponse = validResponse();
    const runtime = {
      async answer(input: { onStatus?: (event: { type: "status"; stage: "retrieving" | "validating_output"; message: string }) => void }) {
        input.onStatus?.({ type: "status", stage: "retrieving", message: "正在检索相关政策" });
        input.onStatus?.({ type: "status", stage: "validating_output", message: "正在校验回答内容" });
        return { response };
      },
      async reset() {},
    };
    const config = testConfig();
    config.server.port = 0;
    const application = createPolicyServer({ runtime: runtime as never, config, staticDir: resolve("apps/policy-web/dist") });
    openApplications.push(application);
    const address = await application.listen();
    const health = await fetch(`${address.url}/healthz`);
    expect(await health.json()).toMatchObject({ status: "ok", host: "loopback" });
    const page = await fetch(address.url);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");

    const events = await new Promise<Array<Record<string, unknown>>>((resolveEvents, reject) => {
      const received: Array<Record<string, unknown>> = [];
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: address.url });
      const timer = setTimeout(() => reject(new Error("WebSocket result timed out")), 3000);
      socket.on("open", () => socket.send(JSON.stringify({ type: "ask", conversation_id: "websocket-test-0001", message: "北京补贴金额？" })));
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(event);
        if (event.type === "result") {
          clearTimeout(timer);
          socket.close();
          resolveEvents(received);
        }
      });
      socket.on("error", reject);
    });
    expect(events.map((event) => event.type)).toEqual(["status", "status", "result"]);
    expect(events.at(-1)).toEqual({ type: "result", response });
    expect(events.some((event) => FORBIDDEN_AGENT_EVENT_TYPES.includes(event.type as never))).toBe(false);
  });

  it("rejects malformed commands with a safe event and cannot serialize raw Agent events", async () => {
    const config = testConfig();
    config.server.port = 0;
    const application = createPolicyServer({
      runtime: { answer: async () => ({ response: validResponse() }), reset: async () => undefined } as never,
      config,
      staticDir: resolve("apps/policy-web/dist"),
    });
    openApplications.push(application);
    const address = await application.listen();
    const event = await new Promise<Record<string, unknown>>((resolveEvent, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: address.url });
      socket.on("open", () => socket.send("{broken"));
      socket.on("message", (data) => { socket.close(); resolveEvent(JSON.parse(data.toString()) as Record<string, unknown>); });
      socket.on("error", reject);
    });
    expect(event).toEqual({ type: "safe_error", code: "INVALID_INPUT", message: "消息格式无效" });
    expect(() => new PolicyUiEventAdapter().serialize({ type: "tool_call", arguments: { path: "C:\\secret" } } as never)).toThrow();
  });

  it("exposes a read-only knowledge catalog, document detail and retrieval API", async () => {
    const config = testConfig();
    config.server.port = 0;
    const metadata = {
      document_id: "beijing-demo",
      title: "北京市育儿补贴示例",
      region: "北京市",
      authority: "北京市主管部门",
      publish_date: "2026-01-01",
      effective_from: "2026-01-01",
      effective_to: null,
      status: "effective",
      source_url: "https://example.gov.cn/policy",
      policy_type: "childcare-subsidy",
      version_group: "beijing-demo",
      version_priority: 1,
    } as const;
    const summary = { metadata, source_format: "pdf", chunks: 1, characters: 12, extraction_warnings: [], indexed_at: "2026-01-01T00:00:00.000Z" } as const;
    const knowledge = {
      getStats: () => ({ documents: 1, chunks: 1, vector_rows: 0, retrieval_mode: "bm25-only" }),
      listKnowledgeDocuments: async () => [summary],
      getKnowledgeDocument: async () => ({ ...summary, sections: [{ chunk_id: "beijing-demo:1", ordinal: 0, section_path: ["标准"], content: "每年3600元", line_start: 1, line_end: 1 }] }),
      search: async () => [{ ...metadata, metadata, chunk_id: "beijing-demo:1", section_path: ["标准"], content: "每年3600元", retrieval_score: 1, line_start: 1, line_end: 1 }],
    };
    const application = createPolicyServer({
      runtime: { answer: async () => ({ response: validResponse() }), reset: async () => undefined } as never,
      knowledge: knowledge as never,
      config,
      staticDir: resolve("apps/policy-web/dist"),
    });
    openApplications.push(application);
    const address = await application.listen();
    const catalog = await fetch(`${address.url}/api/knowledge/documents?region=北京市`);
    expect(await catalog.json()).toMatchObject({ status: "ok", count: 1, documents: [{ source_format: "pdf" }] });
    const detail = await fetch(`${address.url}/api/knowledge/documents/beijing-demo`);
    expect(await detail.json()).toMatchObject({ status: "ok", document: { sections: [{ content: "每年3600元" }] } });
    const search = await fetch(`${address.url}/api/knowledge/search?q=补贴&region=北京市&effective_date=2026-07-23`);
    expect(await search.json()).toMatchObject({ status: "ok", count: 1, results: [{ chunk_id: "beijing-demo:1" }] });
  });

  it("contains no public controls for coding, model selection, reasoning, tools, files, or raw data", async () => {
    const app = await readFile(resolve("apps/policy-web/src/App.tsx"), "utf8");
    const privacy = await readFile(resolve("apps/policy-web/src/components/PrivacyNotice.tsx"), "utf8");
    const publicLabels = ["模型选择器", "Thinking Level", "命令面板", "Tool Toggle", "文件上传", "终端控制", "原始 JSON"];
    for (const label of publicLabels) expect(app).not.toContain(label);
    expect(privacy).toContain("请勿输入身份证号、手机号、银行卡号等敏感个人信息");
  });
});
