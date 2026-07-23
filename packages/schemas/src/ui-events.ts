import { z } from "zod";
import { policyResponseSchema } from "./policy-response.js";

export const statusEventSchema = z.object({
  type: z.literal("status"),
  stage: z.enum(["validating", "retrieving", "generating", "validating_output"]),
  message: z.string().max(80),
});

export const resultEventSchema = z.object({ type: z.literal("result"), response: policyResponseSchema });
export const safeErrorEventSchema = z.object({
  type: z.literal("safe_error"),
  code: z.string(),
  message: z.string().max(160),
});
export const sessionResetEventSchema = z.object({ type: z.literal("session_reset"), conversation_id: z.string() });

export const policyUiEventSchema = z.discriminatedUnion("type", [
  statusEventSchema,
  resultEventSchema,
  safeErrorEventSchema,
  sessionResetEventSchema,
]);
export type PolicyUiEvent = z.infer<typeof policyUiEventSchema>;

export const browserCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ask"),
    conversation_id: z.string().min(8).max(100),
    message: z.string().min(1).max(2000),
  }),
  z.object({ type: z.literal("reset"), conversation_id: z.string().min(8).max(100) }),
]);
export type BrowserCommand = z.infer<typeof browserCommandSchema>;

