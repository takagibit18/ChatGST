import { useCallback, useEffect, useRef, useState } from "react";
import { policyUiEventSchema, type PolicyResponse } from "@policy/schemas/index";

export type PolicyChatMessage =
  | { id: string; from: "user"; text: string }
  | { id: string; from: "assistant"; response: PolicyResponse };

export type ConnectionState = "connecting" | "online" | "offline";

const createConversationId = () => crypto.randomUUID();

export function usePolicySocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [conversationId, setConversationId] = useState<string>(createConversationId);
  const [messages, setMessages] = useState<PolicyChatMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      setConnection("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        setConnection("online");
        setError(null);
      });
      socket.addEventListener("message", (message) => {
        let candidate: unknown;
        try {
          candidate = JSON.parse(String(message.data)) as unknown;
        } catch {
          setError("服务返回了无法识别的消息，请新建会话后重试。");
          setBusy(false);
          return;
        }
        const event = policyUiEventSchema.safeParse(candidate);
        if (!event.success) {
          setError("服务返回了无法识别的消息，请新建会话后重试。");
          setBusy(false);
          return;
        }
        if (event.data.type === "status") {
          setStatus(event.data.message);
          return;
        }
        if (event.data.type === "result") {
          const response = event.data.response;
          setMessages((current) => [
            ...current,
            { id: crypto.randomUUID(), from: "assistant", response },
          ]);
          setStatus(null);
          setBusy(false);
          return;
        }
        if (event.data.type === "session_reset") {
          setConversationId(event.data.conversation_id);
          setMessages([]);
          setStatus(null);
          setError(null);
          setBusy(false);
          return;
        }
        setError(event.data.message);
        setStatus(null);
        setBusy(false);
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        setConnection("offline");
        setBusy(false);
        setStatus(null);
        retryTimer = window.setTimeout(connect, 1500);
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const ask = useCallback(
    (message: string) => {
      const clean = message.trim();
      const socket = socketRef.current;
      if (!clean || busy) return false;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setError("服务仍在连接，请稍后再试。");
        return false;
      }
      setMessages((current) => [...current, { id: crypto.randomUUID(), from: "user", text: clean }]);
      setError(null);
      setStatus("正在提交查询");
      setBusy(true);
      socket.send(JSON.stringify({ type: "ask", conversation_id: conversationId, message: clean }));
      return true;
    },
    [busy, conversationId],
  );

  const reset = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      setBusy(true);
      socket.send(JSON.stringify({ type: "reset", conversation_id: conversationId }));
      return;
    }
    setConversationId(createConversationId());
    setMessages([]);
    setStatus(null);
    setError(null);
    setBusy(false);
  }, [conversationId]);

  return { ask, busy, connection, error, messages, reset, status };
}
