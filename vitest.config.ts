import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@policy/shared": `${root}packages/shared/src`,
      "@policy/schemas": `${root}packages/schemas/src`,
      "@policy/model-provider": `${root}packages/model-provider/src`,
      "@policy/rag": `${root}packages/policy-rag-adapter/src`,
      "@policy/tools": `${root}packages/tools/src`,
      "@policy/session": `${root}packages/session/src`,
      "@policy/validators": `${root}packages/validators/src`,
      "@policy/tracing": `${root}packages/raindrop-adapter/src`,
      "@policy/runtime": `${root}packages/pi-runtime-adapter/src`,
      "@policy/web-adapter": `${root}packages/policy-web-ui-adapter/src`,
    },
  },
  test: {
    environment: "node",
    sequence: { concurrent: false },
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: { reporter: ["text", "json-summary"] },
  },
});

