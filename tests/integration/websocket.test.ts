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

  it("deletes server state and returns a fresh conversation id on reset", async () => {
    let resetConversationId: string | null = null;
    const config = testConfig();
    config.server.port = 0;
    const application = createPolicyServer({
      runtime: {
        answer: async () => ({ response: validResponse() }),
        reset: async (conversationId: string) => { resetConversationId = conversationId; },
      } as never,
      config,
      staticDir: resolve("apps/policy-web/dist"),
    });
    openApplications.push(application);
    const address = await application.listen();
    const event = await new Promise<Record<string, unknown>>((resolveEvent, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: address.url });
      socket.on("open", () => socket.send(JSON.stringify({ type: "reset", conversation_id: "websocket-reset-0001" })));
      socket.on("message", (data) => { socket.close(); resolveEvent(JSON.parse(data.toString()) as Record<string, unknown>); });
      socket.on("error", reject);
    });
    expect(resetConversationId).toBe("websocket-reset-0001");
    expect(event.type).toBe("session_reset");
    expect(event.conversation_id).not.toBe("websocket-reset-0001");
    expect(String(event.conversation_id)).toHaveLength(36);
  });

  it("contains no public controls for coding, model selection, reasoning, tools, files, or raw data", async () => {
    const app = await readFile(resolve("apps/policy-web/src/App.tsx"), "utf8");
    const privacy = await readFile(resolve("apps/policy-web/src/components/PrivacyNotice.tsx"), "utf8");
    const publicLabels = ["模型选择器", "Thinking Level", "命令面板", "Tool Toggle", "文件上传", "终端控制", "原始 JSON"];
    for (const label of publicLabels) expect(app).not.toContain(label);
    expect(app).not.toContain("userTurnCount < 2");
    expect(privacy).toContain("请勿输入身份证号、手机号、银行卡号等敏感个人信息");
  });
});
