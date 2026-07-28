/**
 * 12-skill-tools.ts — 动态工具加载器 (jiti)
 *
 * 对应原架构文档 skill-tools.ts (完整实现)
 *
 * 对比 ChatGST:
 *   ChatGST: RestrictedToolRegistry 静态注册 5 个工具
 *   本体平台: jiti 动态加载 skills/<name>/tools/*.ts，支持热更新
 */
let createJitiFn: typeof import("jiti/static").createJiti | null = null;
async function ensureJiti() {
  if (!createJitiFn) {
    createJitiFn = (await import("jiti/static")).createJiti;
  }
}
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const bridgeRequire = createRequire(import.meta.url);

function buildAlias(): Record<string, string> {
  const alias: Record<string, string> = {};
  // TypeBox: 工具代码用 "typebox"，实际包是 "@sinclair/typebox"
  try {
    const resolved = bridgeRequire.resolve("@sinclair/typebox");
    alias["typebox"] = resolved;
    alias["@sinclair/typebox"] = resolved;
  } catch { /* missing */ }
  // Pi Agent 生态
  const pkgs: Array<[string, string]> = [
    ["@earendil-works/pi-coding-agent", "dist/index.js"],
    ["@earendil-works/pi-agent-core", "dist/index.js"],
    ["@earendil-works/pi-ai", "dist/compat.js"],
  ];
  for (const [spec, entry] of pkgs) {
    // 从当前模块向上查找 node_modules
    let dir = join(import.meta.dirname, "..");
    for (let i = 0; i < 5; i++) {
      const pkgRoot = join(dir, "node_modules", spec);
      if (existsSync(join(pkgRoot, entry))) {
        alias[spec] = join(pkgRoot, entry);
        break;
      }
      dir = join(dir, "..");
    }
  }
  return alias;
}

let jitiInstance: Awaited<ReturnType<typeof createJitiFn>> | null = null;
async function getJiti() {
  if (jitiInstance) return jitiInstance;
  await ensureJiti();
  jitiInstance = createJitiFn!(import.meta.url, { moduleCache: true, alias: buildAlias() });
  return jitiInstance;
}

const fileMtimes = new Map<string, number>();
function invalidateIfStale(absPath: string, jiti: Awaited<ReturnType<typeof getJiti>>) {
  let mtime: number;
  try { mtime = statSync(absPath).mtimeMs; } catch { return; }
  const last = fileMtimes.get(absPath);
  if (last !== undefined && last !== mtime) {
    delete (jiti.cache as Record<string, unknown>)[absPath];
  }
  fileMtimes.set(absPath, mtime);
}

interface ToolDefinitionLike {
  name?: string;
  execute?: unknown;
  [k: string]: unknown;
}

function isToolDefinition(obj: unknown): obj is ToolDefinitionLike {
  return typeof obj === "object" && obj !== null
    && typeof (obj as any).name === "string"
    && typeof (obj as any).execute === "function";
}

export async function loadSkillTools(
  cwd: string,
  skillIds: string[],
): Promise<ToolDefinitionLike[]> {
  if (skillIds.length === 0) return [];
  const jiti = await getJiti();
  const tools: ToolDefinitionLike[] = [];
  const seenNames = new Set<string>();

  for (const skillId of skillIds) {
    const toolsDir = join(cwd, "skills", skillId, "tools");
    if (!existsSync(toolsDir)) continue;
    let files: string[];
    try {
      files = readdirSync(toolsDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
    } catch { continue; }

    for (const file of files) {
      const absPath = join(toolsDir, file);
      try {
        invalidateIfStale(absPath, jiti);
        const mod = (await jiti.import(absPath)) as Record<string, unknown>;
        let candidates: unknown[] = [];
        if (mod.default !== undefined) {
          if (typeof mod.default === "function") {
            const r = (mod.default as any)({ cwd });
            candidates = Array.isArray(r) ? r : [r];
          } else candidates = [mod.default];
        } else if (isToolDefinition(mod)) candidates = [mod];
        else if (Array.isArray(mod.tools)) candidates = mod.tools as unknown[];

        for (const c of candidates) {
          if (isToolDefinition(c)) {
            if (seenNames.has(c.name!)) {
              const idx = tools.findIndex((t) => t.name === c.name);
              if (idx >= 0) tools.splice(idx, 1);
            }
            tools.push(c);
            seenNames.add(c.name!);
          }
        }
      } catch (e) {
        console.error(`[skill-tools] 加载 ${absPath} 失败:`, (e as Error).message);
      }
    }
  }
  return tools;
}
