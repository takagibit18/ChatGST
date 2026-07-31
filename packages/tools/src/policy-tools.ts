import { Type } from "@earendil-works/pi-ai";
import { z } from "zod";
import { hasRuleEngineConfig, queryPolicy } from "@policy/ontology/index";
import { evidenceItemSchema, policyMetadataSchema } from "@policy/schemas/index";
import { PolicyAssistantError, type RuntimeConfig } from "@policy/shared/index";
import type { RetrievalProvider } from "@policy/rag/index";
import { RestrictedToolRegistry } from "./registry.js";
import type { AgentTool } from "./types.js";

const safeId = z.string().min(1).max(160)
  .regex(/^[^/\\\r\n]+$/u)
  .refine((value) => !value.includes("://") && !/^[A-Za-z]:/u.test(value), "must be a registered identifier, not a path or URL");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function fullMonthsBetween(start: Date, end: Date): number {
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return months;
}

export function createPolicyToolRegistry(retrieval: RetrievalProvider, config?: RuntimeConfig): RestrictedToolRegistry {
  const searchInput = z
    .object({
      query: z.string().min(1).max(1000),
      region: z.enum(["北京市", "河北省", "对比"]),
      effective_date: date,
      top_k: z.number().int().min(1).max(8),
    })
    .strict();
  const searchTool: AgentTool<z.infer<typeof searchInput>, unknown> = {
    name: "search_policy",
    description: "Search the registered Beijing/Hebei policy index with region and date filters.",
    inputSchema: searchInput,
    outputSchema: z.array(
      evidenceItemSchema.extend({ metadata: policyMetadataSchema, line_start: z.number(), line_end: z.number() }),
    ),
    piParameters: Type.Object(
      {
        query: Type.String({ minLength: 1, maxLength: 1000 }),
        region: Type.Union([Type.Literal("北京市"), Type.Literal("河北省"), Type.Literal("对比")]),
        effective_date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        top_k: Type.Integer({ minimum: 1, maximum: 8 }),
      },
      { additionalProperties: false },
    ),
    permission: "read",
    riskLevel: "low",
    timeoutMs: 5000,
    sideEffect: false,
    execute: (input) => retrieval.search(input),
  };

  const sourceInput = z
    .object({ document_id: safeId, chunk_id: safeId.optional() })
    .strict();
  const sourceTool: AgentTool<z.infer<typeof sourceInput>, unknown> = {
    name: "get_policy_source",
    description: "Return a registered policy source by document_id and optional chunk_id. Paths and URLs are rejected.",
    inputSchema: sourceInput,
    outputSchema: z
      .object({
        document_id: z.string(),
        chunk_id: z.string().nullable(),
        title: z.string(),
        section_path: z.array(z.string()),
        content: z.string(),
        source_url: z.string(),
      })
      .nullable(),
    piParameters: Type.Object(
      {
        document_id: Type.String({ pattern: "^[^/\\\\\\r\\n]+$" }),
        chunk_id: Type.Optional(Type.String({ pattern: "^[^/\\\\\\r\\n]+$" })),
      },
      { additionalProperties: false },
    ),
    permission: "read",
    riskLevel: "low",
    timeoutMs: 3000,
    sideEffect: false,
    execute: async (input) => {
      const source = await retrieval.getSource(input.chunk_id ?? input.document_id);
      if (source && source.document_id !== input.document_id) {
        throw new PolicyAssistantError("INVALID_INPUT", "chunk_id does not belong to document_id");
      }
      return source;
    },
  };

  const metadataInput = z.object({ document_id: safeId, chunk_id: safeId.optional() }).strict();
  const metadataTool: AgentTool<z.infer<typeof metadataInput>, unknown> = {
    name: "get_policy_metadata",
    description: "Return region, authority, policy dates, status and official source for a registered policy.",
    inputSchema: metadataInput,
    outputSchema: policyMetadataSchema.nullable(),
    piParameters: Type.Object(
      {
        document_id: Type.String({ pattern: "^[^/\\\\\\r\\n]+$" }),
        chunk_id: Type.Optional(Type.String({ pattern: "^[^/\\\\\\r\\n]+$" })),
      },
      { additionalProperties: false },
    ),
    permission: "read",
    riskLevel: "low",
    timeoutMs: 3000,
    sideEffect: false,
    execute: (input) => retrieval.getMetadata(input.chunk_id ?? input.document_id),
  };

  const versionInput = z
    .object({ region: z.enum(["北京市", "河北省"]), policy_type: z.string().min(1).max(80), reference_date: date })
    .strict();
  const versionTool: AgentTool<z.infer<typeof versionInput>, unknown> = {
    name: "resolve_policy_version",
    description: "Resolve effective registered policy versions for a region, policy type and reference date.",
    inputSchema: versionInput,
    outputSchema: z.union([
      z.object({ status: z.literal("resolved"), policies: z.array(policyMetadataSchema) }),
      z.object({ status: z.literal("not_found"), policies: z.tuple([]) }),
      z.object({
        status: z.literal("conflict"),
        policies: z.array(policyMetadataSchema),
        conflict_groups: z.array(z.string()),
      }),
    ]),
    piParameters: Type.Object(
      {
        region: Type.Union([Type.Literal("北京市"), Type.Literal("河北省")]),
        policy_type: Type.String({ minLength: 1, maxLength: 80 }),
        reference_date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
      },
      { additionalProperties: false },
    ),
    permission: "read",
    riskLevel: "low",
    timeoutMs: 3000,
    sideEffect: false,
    execute: (input) => retrieval.resolvePolicyVersion(input),
  };

  const intervalInput = z
    .object({ start_date: date, end_date: date, unit: z.enum(["days", "months", "years_months"]) })
    .strict();
  const intervalOutput = z.object({ days: z.number().int(), full_months: z.number().int(), years: z.number().int(), months: z.number().int() });
  const intervalTool: AgentTool<z.infer<typeof intervalInput>, z.infer<typeof intervalOutput>> = {
    name: "calculate_date_interval",
    description: "Calculate child age or an application window without executing user code.",
    inputSchema: intervalInput,
    outputSchema: intervalOutput,
    piParameters: Type.Object(
      {
        start_date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        end_date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        unit: Type.Union([Type.Literal("days"), Type.Literal("months"), Type.Literal("years_months")]),
      },
      { additionalProperties: false },
    ),
    permission: "calculate",
    riskLevel: "low",
    timeoutMs: 1000,
    sideEffect: false,
    execute: async (input) => {
      const start = new Date(`${input.start_date}T00:00:00.000Z`);
      const end = new Date(`${input.end_date}T00:00:00.000Z`);
      if (end < start) throw new PolicyAssistantError("INVALID_INPUT", "end_date precedes start_date");
      const fullMonths = fullMonthsBetween(start, end);
      return { days: daysBetween(start, end), full_months: fullMonths, years: Math.floor(fullMonths / 12), months: fullMonths % 12 };
    },
  };

  const tools: Array<AgentTool<never, unknown>> = [
    searchTool,
    sourceTool,
    metadataTool,
    versionTool,
    intervalTool,
  ];

  if (config?.ontology.ruleEngineToolEnabled && hasRuleEngineConfig()) {
    const ruleEngineInput = z
      .object({
        region: z.string().min(1).max(80),
        policyType: z.string().min(1).max(80),
        userConditions: z.string().min(1).max(1500),
        question: z.string().max(500).optional(),
      })
      .strict();
    const ruleEngineOutput = z.object({
      decision: z.enum(["allow", "missing", "deny"]),
      message: z.string(),
      missing_fields: z.array(z.object({ op: z.string(), zh: z.string().optional(), hint: z.string().optional() })),
      region: z.string(),
      conclusions: z.array(z.unknown()).optional(),
    });
    const ruleEngineTool: AgentTool<z.infer<typeof ruleEngineInput>, z.infer<typeof ruleEngineOutput>> = {
      name: "policy_rule_engine",
      description: "Query the ontology-backed policy rule engine for eligibility decisions; use RAG tools as fallback when unavailable.",
      inputSchema: ruleEngineInput,
      outputSchema: ruleEngineOutput,
      piParameters: Type.Object(
        {
          region: Type.String({ minLength: 1, maxLength: 80 }),
          policyType: Type.String({ minLength: 1, maxLength: 80 }),
          userConditions: Type.String({ minLength: 1, maxLength: 1500 }),
          question: Type.Optional(Type.String({ maxLength: 500 })),
        },
        { additionalProperties: false },
      ),
      permission: "read",
      riskLevel: "low",
      timeoutMs: 10_000,
      sideEffect: false,
      execute: async (input) => {
        const response = await queryPolicy({
          region: input.region,
          text: input.userConditions,
          ...(input.question ? { question: input.question } : {}),
          ...(config.ontology.ruleEnginePolicyId ? { policy_id: config.ontology.ruleEnginePolicyId } : {}),
        });
        const decision = response.verdict === "eligible" ? "allow" : response.verdict === "missing_info" ? "missing" : "deny";
        const missingFields = response.missing ?? [];
        const message =
          decision === "allow"
            ? "符合条件。"
            : decision === "missing"
              ? `需要补充：${missingFields.map((field) => field.zh || field.op).join("、")}`
              : "不符合条件。";
        return { decision, message, missing_fields: missingFields, region: response.region, conclusions: response.conclusions };
      },
    };
    tools.push(ruleEngineTool as never);
  }

  return new RestrictedToolRegistry(tools as never);
}
