import type { AgentTool as PiAgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { z } from "zod";
import { PolicyAssistantError, withTimeout } from "@policy/shared/index";
import type { AgentTool, ToolContext } from "./types.js";

type RegisteredTool = AgentTool<unknown, unknown> & {
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
};

export const POLICY_TOOL_ALLOWLIST = [
  "search_policy",
  "get_policy_source",
  "get_policy_metadata",
  "resolve_policy_version",
  "calculate_date_interval",
] as const;

export class RestrictedToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(tools: RegisteredTool[]) {
    for (const tool of tools) {
      if (!POLICY_TOOL_ALLOWLIST.includes(tool.name as (typeof POLICY_TOOL_ALLOWLIST)[number])) {
        throw new PolicyAssistantError("INVALID_INPUT", `Tool is not allowlisted: ${tool.name}`);
      }
      if (tool.sideEffect !== false || tool.riskLevel !== "low") {
        throw new PolicyAssistantError("INVALID_INPUT", `Tool violates policy safety metadata: ${tool.name}`);
      }
      if (this.tools.has(tool.name)) throw new PolicyAssistantError("INVALID_INPUT", `Duplicate tool: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new PolicyAssistantError("TOOL_ERROR", `Unknown or blocked tool: ${name}`);
    if (context.usage.toolCalls >= context.maxToolCalls) {
      throw new PolicyAssistantError("TOOL_ERROR", "Tool call budget exceeded");
    }
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new PolicyAssistantError("INVALID_INPUT", `Invalid ${name} input`, {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    context.usage.toolCalls += 1;
    try {
      const output = await withTimeout(() => tool.execute(parsed.data, context), tool.timeoutMs, "TOOL_TIMEOUT");
      const validated = tool.outputSchema.safeParse(output);
      if (!validated.success) throw new PolicyAssistantError("TOOL_ERROR", `Invalid ${name} output`);
      return validated.data;
    } catch (error) {
      if (error instanceof PolicyAssistantError) throw error;
      throw new PolicyAssistantError("TOOL_ERROR", `${name} failed`, undefined, error);
    }
  }

  toPiTools(context: ToolContext): Array<PiAgentTool<TSchema, unknown>> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.piParameters,
      execute: async (_toolCallId, params) => {
        const details = await this.execute(tool.name, params, context);
        return {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
        };
      },
      executionMode: "sequential",
    }));
  }
}

