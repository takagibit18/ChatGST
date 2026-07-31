/**
 * 07-step2-data-source.ts — 扫描政策数据目录
 *
 * 对应原架构文档 step2-data-source.ts (推断实现)
 * 扫描 data/ 下的层级目录结构 → 提取地域层级信息
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import matter from "gray-matter";
import type { RegionLevels } from "./types.js";

export interface ScannedFile {
  relPath: string;
  absPath: string;
  title: string;
  display: string;       // 地域展示名
  levels: RegionLevels;
  text: string;           // 正文内容 (不含 frontmatter)
  frontmatter: Record<string, unknown>;
}

export interface Step2Config {
  default_data_root: string;
  merge_conflict_action?: "use_candidate" | "keep_existing" | "skip";
}

/** 从文件路径推断地域层级 */
function inferLevels(relPath: string): RegionLevels {
  const parts = relPath.replace(/\\/g, "/").split("/");
  // 期望: data/省级/市级/文件名.md 或 data/省级/文件名.md
  const levels: RegionLevels = {};
  let idx = 0;
  if (parts[idx] === "data") idx++;
  const province = parts[idx];
  if (province) { levels.province_level = province; idx++; }
  const prefecture = parts[idx];
  if (prefecture && !prefecture.endsWith(".md")) { levels.prefecture_level = prefecture; idx++; }
  const county = parts[idx];
  if (county && !county.endsWith(".md")) levels.county_level = county;
  return levels;
}

/** 解析 Markdown frontmatter (YAML) */
function parseFrontmatter(content: string): { fm: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) return { fm: {}, body: content };
  try {
    const parsed = matter(content);
    return { fm: parsed.data as Record<string, unknown>, body: parsed.content.trim() };
  } catch {
    return { fm: {}, body: content };
  }
}

/** 递归扫描 data 目录下的 .md 文件 */
export function scanDataDir(dataRoot: string, excludeDirs: string[] = ["skills", ".git", "node_modules"]): ScannedFile[] {
  const results: ScannedFile[] = [];
  if (!existsSync(dataRoot)) return results;

  function walk(dir: string): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (excludeDirs.includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md") {
        const content = readFileSync(full, "utf-8");
        const { fm, body } = parseFrontmatter(content);
        const relPath = relative(dataRoot, full);
        results.push({
          relPath,
          absPath: full,
          title: String(fm.title ?? basename(full, ".md")),
          display: String(fm.region ?? basename(dirname(full))),
          levels: inferLevels(relPath),
          text: body,
          frontmatter: fm,
        });
      }
    }
  }
  walk(dataRoot);
  return results;
}

export function loadStep2Config(): Step2Config {
  return {
    default_data_root: "data",
    merge_conflict_action: "use_candidate",
  };
}
