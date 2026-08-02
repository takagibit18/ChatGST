import { createRequire } from "node:module";

const checks = [
  {
    label: "SQLite / sqlite-vec platform binding",
    load: async () => {
      const requireFromRag = createRequire(import.meta.resolve("pi-local-rag"));
      requireFromRag("sqlite-vec");
    },
  },
  {
    label: "Vite / Rolldown platform binding",
    load: () => import("vite"),
  },
];

const failures = [];
for (const check of checks) {
  try {
    await check.load();
  } catch (error) {
    failures.push({
      label: check.label,
      detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
    });
  }
}

if (failures.length > 0) {
  console.error("\n缺少当前操作系统所需的原生依赖：");
  for (const failure of failures) console.error(`- ${failure.label}: ${failure.detail}`);
  console.error("\n请在项目根目录运行：\n  pnpm install --force\n");
  console.error("不要使用 --no-optional；sqlite-vec 和 Vite/Rolldown 的平台二进制包属于 optionalDependencies。\n");
  process.exitCode = 1;
} else {
  console.log(`Native dependency check passed (${process.platform}/${process.arch}).`);
}
