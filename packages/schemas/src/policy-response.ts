import { z } from "zod";

export const policyIntentSchema = z.enum([
  "amount",
  "eligibility",
  "claimant",
  "materials",
  "channel",
  "deadline",
  "payment",
  "comparison",
  "migration",
  "distinction",
  "overview",
  "unsafe_request",
  "unknown",
]);
export type PolicyIntent = z.infer<typeof policyIntentSchema>;

export const answerStatusSchema = z.enum([
  "answered",
  "needs_clarification",
  "insufficient_evidence",
  "unsupported_region",
  "policy_conflict",
  "safe_error",
]);

const httpUrlSchema = z.url().refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
  message: "Only HTTP(S) sources are allowed",
});

export const policyResponseSchema = z
  .object({
    answer_markdown: z.string().min(1).max(600),
    collapsibles: z
      .array(
        z.object({
          title: z.string().min(1).max(40),
          content_markdown: z.string().min(1).max(2400),
        }),
      )
      .max(4),
    actions: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/u),
          label: z.string().min(1).max(16),
          value: z.string().min(1).max(120),
        }),
      )
      .max(4),
    sources: z
      .array(
        z.object({
          document_id: z.string().min(1),
          title: z.string().min(1),
          url: httpUrlSchema,
        }),
      )
      .max(8),
    clarification: z
      .object({
        question: z.string().min(1).max(120),
        options: z
          .array(z.object({ label: z.string().min(1).max(16), value: z.string().min(1).max(120) }))
          .max(4),
      })
      .nullable(),
    meta: z.object({
      intent: policyIntentSchema,
      region: z.enum(["北京市", "河北省", "对比"]).nullable(),
      answer_status: answerStatusSchema,
    }),
  })
  .strict();

export type PolicyResponse = z.infer<typeof policyResponseSchema>;

