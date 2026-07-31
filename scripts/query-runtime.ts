import "dotenv/config";
import { createDefaultPolicyRuntime } from "@policy/runtime/index";
import { loadRuntimeConfig } from "@policy/shared/index";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const message = arg("text");
if (!message) throw new Error("Usage: pnpm runtime:query -- --text <question> [--date YYYY-MM-DD]");
const { runtime } = createDefaultPolicyRuntime(loadRuntimeConfig());
const result = await runtime.answer({
  conversationId: `runtime-cli-${Date.now()}`,
  message,
  effectiveDate: arg("date") ?? new Date().toISOString().slice(0, 10),
});
console.log(JSON.stringify({
  answer: result.response.answer_markdown,
  status: result.response.meta.answer_status,
  sources: result.response.sources,
  usage: result.usage,
  validation: result.validation,
}, null, 2));
