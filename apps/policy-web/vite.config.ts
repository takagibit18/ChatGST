import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));
const schemasRoot = fileURLToPath(new URL("../../packages/schemas/src", import.meta.url));

export default defineConfig({
  root: appRoot,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": sourceRoot, "@policy/schemas": schemasRoot } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: { host: "127.0.0.1", port: 5173 },
  preview: { host: "127.0.0.1", port: 4173 },
});
