import { redactText } from "@policy/shared/index";

const hiddenKeys = /^(content|text|thinking|reasoning|arguments|args|result|output|input|prompt|systemPrompt|path|filePath)$/iu;
const safeMetadataKeys = /^(type|request_id|conversation_id|timestamp|status|stage|code|provider|provider_name|model|model_name|region|regions|answer_status)$/iu;

export function sanitizeTracePayload(value: unknown, captureContent = false, depth = 0, parentKey = ""): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    if (captureContent || safeMetadataKeys.test(parentKey)) return redactText(value).slice(0, 2000);
    return "[redacted]";
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeTracePayload(item, captureContent, depth + 1, parentKey));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (hiddenKeys.test(key) && !captureContent) output[key] = "[redacted]";
    else output[key] = sanitizeTracePayload(item, captureContent, depth + 1, key);
  }
  return output;
}
