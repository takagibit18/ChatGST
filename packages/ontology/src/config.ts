import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { MergeConflictAction, OntoPlatformConfig, RuleEngineConfig, Step2Config } from "./types.js";
import { hasPublishedLocalOntology, localOntologyDbPath } from "./local-store.js";

export const WORKSPACES_DIR = resolve(process.env.POLICY_WORKSPACES_ROOT ?? join(homedir(), ".gs_platform", "workspaces"));

const CONFIG_PATH = resolve(process.env.POLICY_BRIDGE_CONFIG ?? "config.json");

type BridgeConfigFile = {
  ontoPlatform?: Partial<OntoPlatformConfig>;
  ruleEngine?: Partial<RuleEngineConfig>;
  step2?: Partial<Step2Config>;
};

let rawCache: BridgeConfigFile | null = null;

function readRaw(): BridgeConfigFile {
  if (rawCache) return rawCache;
  if (!existsSync(CONFIG_PATH)) {
    rawCache = {};
    return rawCache;
  }
  rawCache = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as BridgeConfigFile;
  return rawCache;
}

function fromEnvOrFile(key: keyof OntoPlatformConfig, fileValue: string | undefined): string | undefined {
  const envKey = `ONTO_PLATFORM_${key.toUpperCase()}`;
  return process.env[envKey] ?? fileValue;
}

export function getOntoPlatformConfig(): OntoPlatformConfig {
  const file = readRaw().ontoPlatform ?? {};
  const url = fromEnvOrFile("url", file.url)?.replace(/\/+$/u, "");
  const username = fromEnvOrFile("username", file.username);
  const password = fromEnvOrFile("password", file.password);
  if (!url || !username || !password) {
    throw new Error("Missing ontology platform config: set ONTO_PLATFORM_URL, ONTO_PLATFORM_USERNAME and ONTO_PLATFORM_PASSWORD.");
  }
  if (username === "REPLACE_ME" || password === "REPLACE_ME") {
    throw new Error("Ontology platform username/password still use placeholders.");
  }
  return { url, username, password };
}

export function hasOntoPlatformConfig(): boolean {
  try {
    getOntoPlatformConfig();
    return true;
  } catch {
    return false;
  }
}

export function getOntoSummary(): string {
  if (hasPublishedLocalOntology()) return `local-sqlite:${localOntologyDbPath()}`;
  if (!hasOntoPlatformConfig()) return "disabled";
  const cfg = getOntoPlatformConfig();
  return `${cfg.url} as ${cfg.username}`;
}

export function getRuleEngineConfig(): RuleEngineConfig {
  const onto = getOntoPlatformConfig();
  const file = readRaw().ruleEngine ?? {};
  const policyId = process.env.RULE_ENGINE_POLICY_ID ?? file.policyId;
  return {
    url: (process.env.RULE_ENGINE_URL ?? file.url ?? onto.url).replace(/\/+$/u, ""),
    username: process.env.RULE_ENGINE_USERNAME ?? file.username ?? onto.username,
    password: process.env.RULE_ENGINE_PASSWORD ?? file.password ?? onto.password,
    ...(policyId ? { policyId } : {}),
  };
}

export function hasRuleEngineConfig(): boolean {
  if (hasPublishedLocalOntology(process.env.RULE_ENGINE_POLICY_ID)) return true;
  try {
    getRuleEngineConfig();
    return true;
  } catch {
    return false;
  }
}

export function loadStep2Config(): Step2Config {
  const file = readRaw().step2 ?? {};
  const action = (process.env.STEP2_MERGE_CONFLICT_ACTION ?? file.merge_conflict_action ?? "use_candidate") as MergeConflictAction;
  if (action !== "use_candidate" && action !== "keep_existing" && action !== "skip") {
    throw new Error(`Invalid STEP2_MERGE_CONFLICT_ACTION: ${action}`);
  }
  return {
    default_data_root: resolve(process.env.STEP2_DATA_ROOT ?? file.default_data_root ?? "knowledge/raw"),
    merge_conflict_action: action,
  };
}
