import type { WebSocket } from "ws";
import { policyUiEventSchema, type PolicyUiEvent } from "@policy/schemas/index";
import { PolicyAssistantError } from "@policy/shared/index";

export const PUBLIC_POLICY_EVENT_TYPES = ["status", "result", "safe_error", "session_reset"] as const;
export const FORBIDDEN_AGENT_EVENT_TYPES = [
  "raw_agent_event",
  "thinking_delta",
  "tool_call",
  "tool_result",
  "partial_json",
  "system_prompt",
  "internal_message",
] as const;

export class PolicyUiEventAdapter {
  serialize(event: PolicyUiEvent): string {
    const parsed = policyUiEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new PolicyAssistantError("WEB_UI_ADAPTER_ERROR", "Attempted to emit an invalid public UI event");
    }
    return JSON.stringify(parsed.data);
  }

  send(socket: Pick<WebSocket, "readyState" | "send">, event: PolicyUiEvent): void {
    if (socket.readyState !== 1) return;
    socket.send(this.serialize(event));
  }
}

