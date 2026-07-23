import type { TSchema } from "@earendil-works/pi-ai";

export type RuntimeUsage = {
  agentSteps: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
};

export type ToolContext = {
  requestId: string;
  conversationId: string;
  effectiveDate: string;
  usage: RuntimeUsage;
  maxToolCalls: number;
};

export interface AgentTool<Input, Output> {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  piParameters: TSchema;
  permission: "read" | "calculate";
  riskLevel: "low";
  timeoutMs: number;
  sideEffect: false;
  execute(input: Input, context: ToolContext): Promise<Output>;
}

