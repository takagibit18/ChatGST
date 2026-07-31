/**
 * 04-config.ts — 配置管理
 *
 * 对应原架构文档 config.ts
 * 从 config.json 读取 ontoPlatform / server / crawler / publish 配置
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
export const CONFIG_PATH = process.env.ONTO_BRIDGE_CONFIG ||
  join(dirname(__filename), "..", "..", "..", "config.json");

export interface AuthConfig {
  username: string; password: string; displayName: string; role: string; email: string;
}
export interface OntoPlatformConfig {
  url: string; username: string; password: string;
}
export interface ServerConfig { port: number; host: string; }

interface ConfigFile {
  auth?: Partial<AuthConfig>;
  ontoPlatform?: Partial<OntoPlatformConfig>;
  server?: Partial<ServerConfig>;
}

let rawCache: ConfigFile | null = null;
const MOCK_MODE = process.env.MOCK_ONTO === "1" || process.env.MOCK_ONTO === "true";
function readRaw(): ConfigFile {
  if (rawCache) return rawCache;
  if (!existsSync(CONFIG_PATH)) {
    console.warn(`[onto-bridge] config.json not found at ${CONFIG_PATH}, using defaults`);
    rawCache = {};
    return rawCache;
  }
  rawCache = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ConfigFile;
  return rawCache;
}

export function getOntoPlatformConfig(): OntoPlatformConfig {
  const o = readRaw().ontoPlatform ?? {};
  if (!o.url || !o.username || !o.password) {
    throw new Error("config.json: ontoPlatform.{url,username,password} 必填");
  }
  return { url: o.url.replace(/\/+$/, ""), username: o.username, password: o.password };
}

export function getServerConfig(): ServerConfig {
  const s = readRaw().server ?? {};
  return { port: s.port ?? 3002, host: s.host ?? "127.0.0.1" };
}

export function hasOntoConfig(): boolean {
  if (MOCK_MODE) return true;
  try { getOntoPlatformConfig(); return true; } catch { return false; }
}
