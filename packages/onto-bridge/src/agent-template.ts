/**
 * 13-agent-template.ts — 智能体模板创建
 *
 * 对应原架构文档 agent-template.ts (完整实现)
 * 从 example/policy-template 复制 → 替换 name/description → 写入 config.json
 */
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { versionDir } from "./paths.js";
import { getOntoPlatformConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const TEMPLATE_DIR = join(dirname(__filename), "..", "example", "policy-template");
const TEMPLATE_NAME = "育儿补贴";

export interface CreateAgentOptions {
  name: string;
  description: string;
  policyId?: string;
  policyDocsDir?: string;
  ruleEngine?: { url?: string; username?: string; password?: string };
}

export interface CreateAgentResult {
  skillId: string;
  skillMdContent: string;
}

function slugify(name: string): string {
  return name.trim()
    .replace(/[^\w.\-\u4e00-\u9fff]/g, "_")
    .replace(/^[_\s]+|[_\s]+$/g, "") || "agent";
}

export function createAgentFromTemplate(
  projectId: string,
  versionId: string,
  opts: CreateAgentOptions,
): CreateAgentResult {
  const skillId = slugify(opts.name);
  const dest = join(versionDir(projectId, versionId), "skills", skillId);

  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });

  // 复制模板
  if (existsSync(TEMPLATE_DIR)) {
    mkdirSync(dest, { recursive: true });
    cpSync(TEMPLATE_DIR, dest, { recursive: true });
  } else {
    // 模板不存在 → 创建最小结构
    mkdirSync(join(dest, "tools"), { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), `---
name: ${opts.name.trim()}
description: ${opts.description.trim()}
---

# ${opts.name}

待补充工作流描述。
`, "utf-8");
  }

  // 替换 SKILL.md 中的模板名称
  const skillMdPath = join(dest, "SKILL.md");
  if (existsSync(skillMdPath)) {
    let skillMd = readFileSync(skillMdPath, "utf-8");
    skillMd = skillMd.split(TEMPLATE_NAME).join(opts.name.trim());
    skillMd = skillMd.replace(/^name:\s*.+$/m, `name: ${opts.name.trim()}`);
    skillMd = skillMd.replace(/^description:\s*.+$/m, `description: ${opts.description.trim()}`);
    writeFileSync(skillMdPath, skillMd, "utf-8");
  }

  // 写入 config.json
  let ruleEngineCfg: { url: string; username: string; password: string };
  try {
    const ontoCfg = getOntoPlatformConfig();
    ruleEngineCfg = {
      url: (opts.ruleEngine?.url?.trim() || ontoCfg.url).replace(/\/+$/, ""),
      username: opts.ruleEngine?.username?.trim() || ontoCfg.username,
      password: opts.ruleEngine?.password?.trim() || ontoCfg.password,
    };
  } catch {
    ruleEngineCfg = {
      url: opts.ruleEngine?.url?.trim() || "",
      username: opts.ruleEngine?.username?.trim() || "",
      password: opts.ruleEngine?.password?.trim() || "",
    };
  }
  writeFileSync(join(dest, "config.json"), JSON.stringify({
    policyId: opts.policyId || undefined,
    policyDocsDir: opts.policyDocsDir || "data",
    ruleEngine: ruleEngineCfg,
  }, null, 2) + "\n", "utf-8");

  const readmePath = join(dest, "README.md");
  if (existsSync(readmePath)) rmSync(readmePath, { force: true });

  return {
    skillId,
    skillMdContent: existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "",
  };
}
