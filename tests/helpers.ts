import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { EvidencePack, PolicyResponse } from "@policy/schemas/index";
import { loadRuntimeConfig } from "@policy/shared/index";

function hasMarkdown(root: string): boolean {
  if (!existsSync(root)) return false;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) return true;
    }
  }
  return false;
}

export function hasLocalPolicyIndex(): boolean {
  return existsSync(resolve("knowledge/index/rag.db"))
    && (hasMarkdown(resolve("knowledge/raw")) || hasMarkdown(resolve("knowledge/curated")));
}

export function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadRuntimeConfig({
    ...process.env,
    MODEL_PROVIDER: "test",
    RAINDROP_ENABLED: "false",
    RAINDROP_CAPTURE_CONTENT: "false",
    POLICY_RULE_ENGINE_TOOL_ENABLED: "false",
    HOST: "127.0.0.1",
    PORT: "3001",
    ...overrides,
  });
}

export function evidencePack(): EvidencePack {
  return {
    query_context: {
      region: "北京市",
      intent: "amount",
      effective_date: "2026-07-23",
      confirmed_slots: { region: "北京市" },
      missing_slots: [],
    },
    policy_versions: [],
    evidence: [
      {
        document_id: "national-childcare-subsidy-faq-2025",
        chunk_id: "fixture-chunk",
        title: "育儿补贴制度实施方案政策问答",
        region: "全国",
        section_path: ["补贴标准"],
        content: "现阶段国家基础标准为每孩每年3600元，不足整年按每月300元折算。",
        source_url: "https://www.nhc.gov.cn/example",
        effective_from: "2025-01-01",
        effective_to: null,
        status: "effective",
        retrieval_score: 1,
      },
    ],
    knowledge_gaps: [],
  };
}

export function validResponse(): PolicyResponse {
  return {
    answer_markdown: "按当前证据，每孩每年3600元，不足整年按每月300元折算。",
    collapsibles: [],
    actions: [],
    sources: [
      {
        document_id: "national-childcare-subsidy-faq-2025",
        title: "育儿补贴制度实施方案政策问答",
        url: "https://www.nhc.gov.cn/example",
      },
    ],
    clarification: null,
    meta: { intent: "amount", region: "北京市", answer_status: "answered" },
  };
}
