import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadStep2Config } from "./config.js";
import type { RegionLevels, Step2Config } from "./types.js";

export type ScannedPolicyFile = {
  absPath: string;
  relPath: string;
  title: string;
  text: string;
  display: string;
  levels: RegionLevels;
};

const REGION_PATTERN = /^(?<order>\d+)[-_](?<region>[^-_]+)(?:[-_].*)?\.md$/u;

function inferLevels(fileName: string): RegionLevels {
  const matched = REGION_PATTERN.exec(fileName);
  const region = matched?.groups?.region ?? fileName.replace(/\.md$/u, "");
  if (region.includes("全国") || region.includes("国家")) return { national: region };
  if (region.endsWith("省") || region.endsWith("市") || region.endsWith("自治区")) return { province_level: region };
  return { county_level: region };
}

function firstHeading(text: string, fallback: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => /^#\s*(.+)$/u.exec(line)?.[1]?.trim())
    .find((line): line is string => Boolean(line)) ?? fallback.replace(/\.md$/u, "");
}

function walkMarkdown(root: string): string[] {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const abs = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(abs));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(abs);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function scanDataDir(dataRoot: string): ScannedPolicyFile[] {
  const root = resolve(dataRoot);
  return walkMarkdown(root).map((absPath) => {
    const text = readFileSync(absPath, "utf-8");
    const relPath = relative(root, absPath).replace(/\\/gu, "/");
    const fileName = absPath.split(/[\\/]/u).at(-1) ?? relPath;
    return {
      absPath,
      relPath,
      title: firstHeading(text, fileName),
      text,
      display: relPath,
      levels: inferLevels(fileName),
    };
  });
}

export function validateDataDir(dataRoot: string): void {
  if (!existsSync(dataRoot) || !statSync(dataRoot).isDirectory()) {
    throw new Error(`Step2 data root is not a directory: ${dataRoot}`);
  }
}

export { loadStep2Config };
export type { Step2Config };

