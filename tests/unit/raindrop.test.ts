import { describe, expect, it, vi } from "vitest";
import { CompositeTraceRecorder, createTraceRecorder, LocalTraceRecorder, RaindropTraceRecorder } from "@policy/tracing/index";

describe("Raindrop observability privacy boundary", () => {
  it("falls back locally when disabled or when no write key exists", () => {
    const recorder = createTraceRecorder(
      { enabled: true, writeKey: undefined, projectId: undefined, captureContent: false },
      { requestId: "request-1", conversationId: "conversation-1" },
    );
    expect(recorder).toBeInstanceOf(LocalTraceRecorder);
  });

  it("redacts sensitive content from local payloads", async () => {
    const recorder = new LocalTraceRecorder();
    await recorder.recordApplicationEvent({
      type: "request_start",
      request_id: "request-2",
      conversation_id: "conversation-2",
      timestamp: "2026-07-23T00:00:00.000Z",
      attributes: { content: "手机号 13800138000，文件 C:\\private\\policy.md" },
    });
    const payload = JSON.stringify(recorder.snapshot());
    expect(payload).not.toContain("13800138000");
    expect(payload).not.toContain("C:\\private");
    expect(payload).toContain("[redacted]");
  });

  it("registers the subscriber, correlates anonymous ids, and shuts down", async () => {
    let sourceListener: ((event: unknown, signal: AbortSignal) => void) | undefined;
    let forwarded: unknown;
    const track = vi.fn(async () => undefined);
    const flush = vi.fn(async () => undefined);
    const shutdown = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    const fakeClient = {
      subscribe(agent: { subscribe: (listener: (event: unknown, signal: AbortSignal) => void) => () => void }) {
        agent.subscribe((event, _signal) => { forwarded = event; });
        return unsubscribe;
      },
      signals: { track },
      flush,
      shutdown,
    };
    const recorder = new RaindropTraceRecorder(
      { writeKey: "test-key", requestId: "request-3", conversationId: "real-conversation-id", captureContent: false },
      () => fakeClient as never,
    );
    await recorder.attach({ subscribe(listener: typeof sourceListener) { sourceListener = listener; return () => undefined; } });
    sourceListener?.({ type: "message_update", content: "13800138000", thinking: "secret" }, new AbortController().signal);
    expect(JSON.stringify(forwarded)).not.toContain("13800138000");
    await recorder.recordApplicationEvent({
      type: "request_end",
      request_id: "request-3",
      conversation_id: "real-conversation-id",
      timestamp: "2026-07-23T00:00:00.000Z",
    });
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ eventId: "request-3", request_id: "request-3" }));
    expect(JSON.stringify(track.mock.calls)).not.toContain("real-conversation-id");
    await recorder.shutdown();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("never lets an observability failure block the caller", async () => {
    const failing = {
      attach: async () => { throw new Error("attach failed"); },
      recordApplicationEvent: async () => { throw new Error("record failed"); },
      shutdown: async () => { throw new Error("shutdown failed"); },
    };
    const recorder = new CompositeTraceRecorder([failing]);
    await expect(recorder.attach({})).resolves.toBeUndefined();
    await expect(recorder.recordApplicationEvent({
      type: "error",
      request_id: "request-4",
      conversation_id: "conversation-4",
      timestamp: "2026-07-23T00:00:00.000Z",
    })).resolves.toBeUndefined();
    await expect(recorder.shutdown()).resolves.toBeUndefined();
  });
});
