import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPolicyIndex,
  ChinesePolicySearchTextProcessor,
  conversationScenarioV21Schema,
  ensurePolicySchema,
  getRegionPath,
  loadPolicyDocuments,
  nationwideKnowledgeLocations,
  openPiLocalRagDb,
  phase2NationwideKnowledgeLocations,
  PiLocalRagRetrievalProvider,
  resolveAdministrativeRegion,
  retrievalEvalCaseV21Schema,
  safetyEvalCaseV21Schema,
  SemanticPolicyChunker,
  toFtsQuery,
  verifyKnowledgeSnapshot,
  type ConversationScenarioV21,
  type KnowledgeSnapshot,
  type PolicyDocument,
  type PolicySearchResult,
  type PolicySource,
  type PolicyVersionResolution,
  type RetrievalEvalCaseV21,
  type RetrievalProvider,
  type SafetyEvalCaseV21,
  type SearchPolicyInput,
} from "@policy/rag/index";
import { createDefaultPolicyRuntime, evaluateEvidenceSufficiency, normalizePolicyQuery, type PolicyRuntimeOptions } from "@policy/runtime/index";
import { loadRuntimeConfig } from "@policy/shared/index";
import { buildQualityGate, collectFailureGroups } from "./eval-v2-1-quality-gate.js";
import { sha256 } from "./eval-v2-1-integrity.js";
import {
  percentile,
  scoreConversations,
  scoreRetrievalCases,
  scoreSafety,
  type Phase4ConversationPrediction,
  type Phase4RetrievalPrediction,
  type Phase4SafetyPrediction,
} from "./phase4-scoring.js";

const PHASE4_ROOT = resolve("domains/childcare-subsidy/evals/phase4");
const V21_ROOT = resolve("domains/childcare-subsidy/evals/v2.1");
const INDEX_ROOT = resolve(".local/phase4-indexes");
const BASE_TAG = "phase3.3-frozen-baseline";
const BASE_COMMIT = "f6f033baac1231937de377a9383fdb3117743ff7";
const TAG_OBJECT = "d4618e5511374334e0538832c9fba4ec2d98b1ed";
const K4_HASH = "041f724f04893f821bdfdb23cc76d9faa3fd10233920489e5111edafc6cb34ce";

type SnapshotId = "K0" | "K1" | "K2" | "K3" | "K4";
type RetrievalConfig = {
  query_normalization: "normalize_with_region_alias" | "raw";
  chunk_max_chars: number;
  candidate_pool_size: number;
  final_top_k: number;
  field_weighting: "section_body_equal" | "title_section_body";
  region_strategy: "hierarchy_pre_filter" | "exact_region_pre_filter";
  version_strategy: "effective_version_group_first" | "effective_only";
  bm25_threshold: number;
};
type AgentConfig = Record<
  | "query_normalizer" | "intent_classification" | "region_hierarchy" | "version_filtering"
  | "evidence_sufficiency" | "policy_bundle_compatibility" | "claim_conflict_semantics" | "citation_binding"
  | "conversation_state" | "stale_context_guard" | "safety_precheck" | "structured_response_validation",
  boolean
>;
type Phase4Config = {
  schema_version: 1;
  experiment_id: string;
  knowledge_snapshot: SnapshotId;
  retrieval: RetrievalConfig;
  agent: AgentConfig;
  model_provider: "test";
  random_seed: number;
  repeat_count: 3;
};
type MatrixEntry = { id: string; family: "knowledge_governance" | "retrieval"; changed_variable: string; baseline_value: unknown; experiment_value: unknown; config: string };
type Matrix = { schema_version: 1; base_tag: string; base_commit: string; repeat_count: number; experiments: MatrixEntry[]; agent_ablations: string };
type AgentAblation = { id: string; component: keyof AgentConfig; changed_variable: string; baseline_value: true; experiment_value: false; high_risk: boolean };
type Datasets = { dev: RetrievalEvalCaseV21[]; regression: RetrievalEvalCaseV21[]; conversations: ConversationScenarioV21[]; safety: SafetyEvalCaseV21[] };

type ExperimentIdentity = {
  id: string;
  family: "knowledge_governance" | "retrieval" | "agent_ablation";
  changed_variable: string;
  baseline_value: unknown;
  experiment_value: unknown;
  high_risk?: boolean;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function loadJsonl<T>(path: string, parse: (value: unknown) => T): Promise<T[]> {
  return (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => parse(JSON.parse(line)));
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const result = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "extends") continue;
    const current = result[key];
    result[key] = value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)
      ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
      : structuredClone(value);
  }
  return result as T;
}

async function loadConfig(path: string): Promise<Phase4Config> {
  const baseline = await readJson<Phase4Config>(resolve(PHASE4_ROOT, "configs/baseline.json"));
  const candidate = await readJson<Record<string, unknown>>(resolve(PHASE4_ROOT, path));
  const config = deepMerge(baseline as unknown as Record<string, unknown>, candidate) as unknown as Phase4Config;
  if (config.schema_version !== 1 || config.repeat_count !== 3 || config.model_provider !== "test") throw new Error(`invalid_config:${path}`);
  return config;
}

async function loadDatasets(): Promise<Datasets> {
  return {
    dev: await loadJsonl(resolve(V21_ROOT, "datasets/retrieval.dev.jsonl"), retrievalEvalCaseV21Schema.parse),
    regression: await loadJsonl(resolve(V21_ROOT, "datasets/regression-v1.jsonl"), retrievalEvalCaseV21Schema.parse),
    conversations: await loadJsonl(resolve(V21_ROOT, "datasets/conversations.jsonl"), conversationScenarioV21Schema.parse),
    safety: await loadJsonl(resolve(V21_ROOT, "datasets/safety.jsonl"), safetyEvalCaseV21Schema.parse),
  };
}

function neutralizeGovernance(document: PolicyDocument, stage: SnapshotId): PolicyDocument {
  const metadata = structuredClone(document.metadata);
  if (stage === "K1") {
    metadata.review_status = "approved";
    metadata.quarantine_reasons = [];
    if (metadata.status === "unknown") metadata.status = "effective";
  }
  if (stage === "K1" || stage === "K2") {
    metadata.canonical_document_id = metadata.document_id;
    metadata.duplicate_group_id = null;
  }
  if (stage !== "K4") {
    metadata.version_group = metadata.document_id;
    metadata.version_priority = 0;
    metadata.source_priority = 0;
    metadata.effective_from = "1900-01-01";
    metadata.effective_to = null;
  }
  return { ...document, metadata };
}

function rawFrontMatterField(text: string, field: string): string | null {
  const match = new RegExp(`^${field}:\\s*(?:["']([^"']*)["']|([^\\r\\n]*))$`, "mu").exec(text);
  return (match?.[1] ?? match?.[2])?.trim() || null;
}

async function rawK1Document(document: PolicyDocument): Promise<PolicyDocument> {
  const source = await readFile(document.sourcePath, "utf8");
  const rawRegion = rawFrontMatterField(source, "region") ?? "unknown";
  const resolution = resolveAdministrativeRegion(rawRegion);
  const region = resolution.status === "resolved" ? resolution.region : null;
  const rawDate = rawFrontMatterField(source, "timestamp");
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/u.test(rawDate) ? rawDate : "1900-01-01";
  const metadata = structuredClone(document.metadata);
  metadata.title = rawFrontMatterField(source, "title") ?? document.fileName;
  metadata.region = rawRegion;
  metadata.region_code = region?.code ?? "000000";
  metadata.region_level = region?.level ?? "unknown";
  metadata.parent_region_code = region?.parent_code ?? null;
  metadata.applicable_region_codes = [region?.code ?? "000000"];
  metadata.authority = "unknown";
  metadata.publish_date = date;
  metadata.effective_from = date;
  metadata.effective_to = null;
  metadata.status = "effective";
  metadata.source_url = rawFrontMatterField(source, "resource") ?? "unknown";
  metadata.document_kind = "unknown";
  metadata.version_group = metadata.document_id;
  metadata.version_priority = 0;
  metadata.canonical_document_id = metadata.document_id;
  metadata.duplicate_group_id = null;
  metadata.source_priority = 0;
  metadata.review_status = "approved";
  metadata.quarantine_reasons = [];
  return { ...document, metadata };
}

async function documentsFor(snapshot: SnapshotId): Promise<PolicyDocument[]> {
  if (snapshot === "K0") throw new Error("blocked_missing_frozen_source:K0 manifest references six unavailable local documents");
  if (snapshot === "K1") {
    const documents = await loadPolicyDocuments(nationwideKnowledgeLocations(), { includeQuarantined: true });
    return Promise.all(documents.map(rawK1Document));
  }
  if (snapshot === "K2") return (await loadPolicyDocuments(nationwideKnowledgeLocations())).map((document) => neutralizeGovernance(document, snapshot));
  return (await loadPolicyDocuments(phase2NationwideKnowledgeLocations())).map((document) => neutralizeGovernance(document, snapshot));
}

async function ensureExperimentIndex(config: Phase4Config): Promise<{ index_dir: string; index_size_bytes: number; build: Record<string, unknown>; snapshot: KnowledgeSnapshot }> {
  const snapshot = await readJson<KnowledgeSnapshot>(resolve(`knowledge/snapshots/${config.knowledge_snapshot}.json`));
  if (!verifyKnowledgeSnapshot(snapshot)) throw new Error(`snapshot_hash_invalid:${config.knowledge_snapshot}`);
  const documents = await documentsFor(config.knowledge_snapshot);
  const indexDir = resolve(INDEX_ROOT, `${config.knowledge_snapshot}-${config.retrieval.chunk_max_chars}`);
  const build = await buildPolicyIndex({ indexDir, documents, chunker: new SemanticPolicyChunker(config.retrieval.chunk_max_chars),
    textProcessor: new ChinesePolicySearchTextProcessor(), rebuild: true, now: () => new Date("2026-08-06T00:00:00.000Z"), snapshotHash: snapshot.snapshot_hash });
  const indexSize = (await stat(resolve(indexDir, "rag.db"))).size;
  return { index_dir: indexDir, index_size_bytes: indexSize, build: build as unknown as Record<string, unknown>, snapshot };
}

type SearchRow = { document_id: string; chunk_id: string; title: string; original_content: string; section_path: string; line_start: number; line_end: number; bm25_score: number };

class Phase4RetrievalProvider implements RetrievalProvider {
  private readonly base: PiLocalRagRetrievalProvider;
  private readonly processor = new ChinesePolicySearchTextProcessor();

  constructor(private readonly indexDir: string, private readonly config: Phase4Config) {
    this.base = new PiLocalRagRetrievalProvider(indexDir);
  }

  async search(input: SearchPolicyInput): Promise<PolicySearchResult[]> {
    const query = toFtsQuery(this.processor.queryTerms(input.query));
    if (!query) return [];
    const database = openPiLocalRagDb(this.indexDir);
    try {
      ensurePolicySchema(database);
      const resolved = resolveAdministrativeRegion(input.region);
      const hierarchy = resolved.status === "resolved" ? getRegionPath(resolved.region.code).map((region) => region.name).reverse() : [input.region, "全国"];
      const regions = this.config.retrieval.region_strategy === "exact_region_pre_filter"
        || this.config.agent.region_hierarchy === false
        ? [...new Set([input.region, "全国"])] : hierarchy;
      const placeholders = regions.map(() => "?").join(", ");
      const useVersion = this.config.retrieval.version_strategy !== "effective_only" && this.config.agent.version_filtering !== false;
      const versionClause = useVersion ? "AND pd.effective_from <> 'unknown' AND pd.effective_from <= ? AND (pd.effective_to IS NULL OR (pd.effective_to <> 'unknown' AND pd.effective_to >= ?))" : "";
      const parameters: unknown[] = [query, ...regions];
      if (useVersion) parameters.push(input.effective_date, input.effective_date);
      parameters.push(this.config.retrieval.candidate_pool_size);
      const rows = database.prepare(`
        SELECT pd.document_id, pd.title, pc.chunk_id, pc.original_content, pc.section_path,
               pc.line_start, pc.line_end, bm25(chunks_fts) AS bm25_score
        FROM chunks_fts
        JOIN chunks c ON c.rowid = chunks_fts.rowid
        JOIN policy_chunks pc ON pc.chunk_id = c.id
        JOIN policy_documents pd ON pd.document_id = pc.document_id
        WHERE chunks_fts MATCH ? AND pd.region IN (${placeholders}) AND pd.status = 'effective'
        ${versionClause}
        ORDER BY bm25_score ASC, pd.version_priority DESC, pd.publish_date DESC
        LIMIT ?
      `).all(...parameters) as SearchRow[];
      const terms = this.processor.queryTerms(input.query);
      const hits: PolicySearchResult[] = [];
      for (const row of rows) {
        const metadata = await this.base.getMetadata(row.document_id);
        if (!metadata) continue;
        const fieldBoost = this.config.retrieval.field_weighting === "title_section_body"
          ? terms.filter((term) => `${row.title} ${row.section_path}`.includes(term)).length * 0.02 : 0;
        hits.push({ document_id: row.document_id, chunk_id: row.chunk_id, title: row.title, region: metadata.region,
          section_path: JSON.parse(row.section_path) as string[], content: row.original_content, source_url: metadata.source_url,
          effective_from: metadata.effective_from, effective_to: metadata.effective_to, status: metadata.status,
          retrieval_score: Number((-row.bm25_score + fieldBoost).toFixed(8)), metadata, line_start: row.line_start, line_end: row.line_end });
      }
      return hits.sort((left, right) => right.retrieval_score - left.retrieval_score).slice(0, Math.min(input.top_k, this.config.retrieval.final_top_k));
    } finally {
      database.close();
    }
  }

  async getSource(id: string): Promise<PolicySource | null> { return this.base.getSource(id); }
  async getMetadata(id: string) { return this.base.getMetadata(id); }
  async resolvePolicyVersion(input: { region: string; policy_type: string; reference_date: string }): Promise<PolicyVersionResolution> {
    if (this.config.retrieval.version_strategy === "effective_only" || this.config.agent.version_filtering === false) return { status: "not_found", policies: [] };
    return this.base.resolvePolicyVersion(input);
  }
  getStats() { return this.base.getStats(); }
}

function ablationOptions(config: Phase4Config): PolicyRuntimeOptions["experimentalAblation"] {
  return Object.fromEntries(Object.entries(config.agent).filter(([, enabled]) => !enabled)) as PolicyRuntimeOptions["experimentalAblation"];
}

function evidenceDecision(question: string, intent: ReturnType<typeof normalizePolicyQuery>["intent"], hits: PolicySearchResult[], regionCode: string | null,
  effectiveDate: string, config: Phase4Config, comparisonRegions: ReturnType<typeof normalizePolicyQuery>["comparisonRegions"]) {
  const evaluated = evaluateEvidenceSufficiency(question, intent, hits, regionCode, { effectiveDate, comparisonRegions });
  const bundleTypes = new Set(["disconnected_policy_bundle", "mixed_policy_lineage", "incompatible_policy_bundle"]);
  const conflicts = evaluated.conflicts.filter((conflict) => config.agent.policy_bundle_compatibility ? true : !bundleTypes.has(conflict.type));
  return { ...evaluated, conflicts, sufficient: config.agent.evidence_sufficiency ? evaluated.missing_claims.length === 0 && conflicts.length === 0 : hits.length > 0 };
}

async function runRetrievalCase(provider: Phase4RetrievalProvider, runtime: ReturnType<typeof createDefaultPolicyRuntime>["runtime"], item: RetrievalEvalCaseV21,
  config: Phase4Config, repeat: number): Promise<Phase4RetrievalPrediction> {
  let normalized = normalizePolicyQuery(item.question, null);
  if (!config.agent.query_normalizer || config.retrieval.query_normalization === "raw") normalized = { ...normalized, retrievalQuery: item.question.trim() };
  if (!config.agent.intent_classification) normalized = { ...normalized, intent: "unknown", intentConfidence: "low" };
  const region = item.user_region ?? (normalized.region === "对比" ? null : normalized.region);
  if (!region) return { case_id: item.id, predicted_behavior: "clarify_region", top_k: [], retrieval_ms: [], total_ms: [], repeat_stable: true,
    evidence_sufficient: false, answer_text: "", citations: [] };
  const start = performance.now();
  const hits = await provider.search({ query: normalized.retrievalQuery, region, effective_date: item.effective_date, top_k: config.retrieval.candidate_pool_size });
  const retrievalMs = performance.now() - start;
  const resolved = resolveAdministrativeRegion(region);
  const targetCode = resolved.status === "resolved" ? resolved.region.code : normalized.regionCode;
  const sufficiency = evidenceDecision(item.question, normalized.intent, hits, targetCode, item.effective_date, config, normalized.comparisonRegions);
  const runtimeResult = await runtime.answer({ conversationId: `${config.experiment_id}-${repeat}-${item.id}`, message: item.question, effectiveDate: item.effective_date });
  const answerText = `${runtimeResult.response.answer_markdown}\n${runtimeResult.response.collapsibles.map((part) => part.content_markdown).join("\n")}`;
  const predicted = sufficiency.sufficient && hits.length > 0 && hits[0]!.retrieval_score >= config.retrieval.bm25_threshold ? "answer" : "no_answer";
  return { case_id: item.id, predicted_behavior: predicted, top_k: hits.map((hit) => ({ document_id: hit.document_id, chunk_id: hit.chunk_id,
    region_code: hit.metadata.region_code ?? "100000", effective_from: hit.effective_from, effective_to: hit.effective_to,
    duplicate_group_id: hit.metadata.duplicate_group_id ?? null, score: hit.retrieval_score, authority: hit.metadata.authority,
    source_priority: hit.metadata.source_priority ?? 0, version_group: hit.metadata.version_group ?? "unknown", version_priority: hit.metadata.version_priority ?? 0 })),
    retrieval_ms: [Number(retrievalMs.toFixed(6))], total_ms: [Number((performance.now() - start).toFixed(6))], repeat_stable: true,
    evidence_sufficient: sufficiency.sufficient, answer_text: answerText, citations: runtimeResult.response.sources.map((source) => source.document_id) };
}

async function runExperiment(identity: ExperimentIdentity, config: Phase4Config, includeAgentSuites: boolean) {
  const started = new Date().toISOString();
  if (config.knowledge_snapshot === "K0") {
    const blocked = { schema_version: 1, experiment_id: identity.id, status: "blocked_missing_frozen_source", reason: "K0 six-document source corpus was never committed; manifest-only evidence cannot be used as a retrieval run.",
      base_tag: BASE_TAG, base_commit: BASE_COMMIT, snapshot_hash: (await readJson<KnowledgeSnapshot>(resolve("knowledge/snapshots/K0.json"))).snapshot_hash, repeats_completed: 0 };
    await mkdir(resolve(PHASE4_ROOT, "runs", identity.id), { recursive: true });
    await writeFile(resolve(PHASE4_ROOT, "runs", identity.id, "summary.json"), `${JSON.stringify(blocked, null, 2)}\n`, "utf8");
    return blocked;
  }
  const datasets = await loadDatasets();
  const index = await ensureExperimentIndex(config);
  const manifestText = await readFile(resolve(V21_ROOT, "dataset-manifest.json"), "utf8");
  const calibrationText = await readFile(resolve(V21_ROOT, "calibration/bm25-threshold.json"), "utf8");
  const runCommit = git("rev-parse", "HEAD");
  const configFingerprint = hash(config);
  const repeatRows: Array<Record<string, unknown>> = [];
  let peakMemory = process.memoryUsage().rss;
  for (let repeat = 1; repeat <= config.repeat_count; repeat += 1) {
    const provider = new Phase4RetrievalProvider(index.index_dir, config);
    const runtimeConfig = loadRuntimeConfig({ ...process.env, MODEL_PROVIDER: "test", RAINDROP_ENABLED: "false", RAINDROP_CAPTURE_CONTENT: "false",
      MAX_SESSION_TURNS: "200", RETRIEVAL_TOP_K: String(config.retrieval.final_top_k), LOG_LEVEL: "silent" });
    const { runtime } = createDefaultPolicyRuntime(runtimeConfig, { retrievalProvider: provider, experimentalAblation: ablationOptions(config) });
    const cpuStart = process.cpuUsage();
    const retrievalPredictions: Phase4RetrievalPrediction[] = [];
    for (const item of [...datasets.dev, ...datasets.regression]) retrievalPredictions.push(await runRetrievalCase(provider, runtime, item, config, repeat));
    const conversationPredictions: Phase4ConversationPrediction[] = [];
    const safetyPredictions: Phase4SafetyPrediction[] = [];
    let usage = { model_requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, retries: 0, timeouts: 0 };
    if (includeAgentSuites) {
      for (const scenario of datasets.conversations) {
        const turns: Phase4ConversationPrediction["turns"] = [];
        for (const turn of scenario.turns) {
          const result = await runtime.answer({ conversationId: `${identity.id}-${repeat}-${scenario.scenario_id}`, message: turn.user, effectiveDate: "2026-08-02" });
          usage.model_requests += result.usage.modelCalls; usage.input_tokens += result.usage.inputTokens; usage.output_tokens += result.usage.outputTokens;
          turns.push({ answer_status: result.response.meta.answer_status, region: result.response.meta.region,
            evidence_region_codes: [...new Set(result.evidencePack.policy_versions.map((entry) => entry.region_code)
              .filter((code): code is string => typeof code === "string"))] });
        }
        conversationPredictions.push({ scenario_id: scenario.scenario_id, turns });
      }
      for (const item of datasets.safety) {
        const result = await runtime.answer({ conversationId: `${identity.id}-${repeat}-${item.id}`, message: item.prompt, effectiveDate: "2026-08-02" });
        usage.model_requests += result.usage.modelCalls; usage.input_tokens += result.usage.inputTokens; usage.output_tokens += result.usage.outputTokens;
        safetyPredictions.push({ case_id: item.id, answer_status: result.response.meta.answer_status, answer_text: result.response.answer_markdown,
          citations: result.response.sources.map((source) => source.document_id) });
      }
    }
    usage.total_tokens = usage.input_tokens + usage.output_tokens;
    peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
    const stablePredictions = { retrieval: retrievalPredictions.map(({ retrieval_ms: _r, total_ms: _t, ...prediction }) => prediction),
      conversations: conversationPredictions, safety: safetyPredictions };
    const predictionFingerprint = hash(stablePredictions);
    const devScore = scoreRetrievalCases(datasets.dev, retrievalPredictions);
    const regressionScore = scoreRetrievalCases(datasets.regression, retrievalPredictions);
    const conversations = includeAgentSuites ? scoreConversations(datasets.conversations, conversationPredictions) : null;
    const safety = includeAgentSuites ? scoreSafety(datasets.safety, safetyPredictions) : null;
    const cpu = process.cpuUsage(cpuStart);
    const manifest = {
      schema_version: 1, experiment_id: identity.id, experiment_family: identity.family, base_tag: BASE_TAG, base_commit: BASE_COMMIT, run_commit: runCommit,
      dataset_manifest_sha256: sha256(manifestText), knowledge_snapshot_hash: index.snapshot.snapshot_hash, calibration_sha256: sha256(calibrationText),
      changed_variable: identity.changed_variable, baseline_value: identity.baseline_value, experiment_value: identity.experiment_value,
      fixed_variables: { gold: "phase3.3-human-reviewed", quality_gate: "phase3.3-frozen", repeat_count: 3, node_major: Number(process.versions.node.split(".")[0]), model_provider: "test" },
      model_provider: "test", model_id: "TestModelProvider", random_seed: config.random_seed, repeat_index: repeat, started_at: started, completed_at: new Date().toISOString(),
      config_fingerprint: configFingerprint, prediction_fingerprint: predictionFingerprint,
    };
    const row = { manifest, config, predictions: stablePredictions, metrics: { dev: devScore, regression: regressionScore, conversations, safety },
      resources: { cpu_user_us: cpu.user, cpu_system_us: cpu.system, peak_memory_bytes: peakMemory, index_size_bytes: index.index_size_bytes, ...usage, estimated_cost: 0,
        cost_currency: "USD", latency_scope: "local_test_provider_not_real_model" } };
    repeatRows.push(row);
    await mkdir(resolve(PHASE4_ROOT, "runs", identity.id), { recursive: true });
    await writeFile(resolve(PHASE4_ROOT, "runs", identity.id, `repeat-${repeat}.json`), `${JSON.stringify(row, null, 2)}\n`, "utf8");
  }
  const fingerprints = repeatRows.map((row) => (row.manifest as { prediction_fingerprint: string }).prediction_fingerprint);
  const first = repeatRows[0]!;
  const metrics = first.metrics as { dev: ReturnType<typeof scoreRetrievalCases>; regression: ReturnType<typeof scoreRetrievalCases>; conversations: ReturnType<typeof scoreConversations> | null; safety: ReturnType<typeof scoreSafety> | null };
  const conversationsForGate = metrics.conversations?.case_results ?? [];
  const safetyForGate = metrics.safety?.case_results ?? [];
  const failureGroups = collectFailureGroups({ dev: metrics.dev.case_results, regression: metrics.regression.case_results,
    conversations: conversationsForGate, safety: safetyForGate });
  const calibration = await readJson<{ calibration_status: string; selected: { answer_recall: number } | null }>(resolve(V21_ROOT, "calibration/bm25-threshold.json"));
  const qualityGate = includeAgentSuites ? buildQualityGate({ regressionCases: metrics.regression.cases, regressionCorrect: metrics.regression.behavior_correct,
    regressionNoAnswerRecall: metrics.regression.metrics.no_answer_recall, failureGroups,
    staleContextLeakageRate: metrics.conversations?.stale_context_leakage_rate ?? 0,
    calibrationPassed: calibration.calibration_status === "passed", calibrationAnswerRecall: calibration.selected?.answer_recall ?? 0 }) : null;
  const allTimings = repeatRows.flatMap((row) => ((row.predictions as { retrieval: Phase4RetrievalPrediction[] }).retrieval)).flatMap((item) => item.retrieval_ms);
  const summary = { schema_version: 1, experiment_id: identity.id, status: "completed", identity, config, config_fingerprint: configFingerprint,
    base_tag: BASE_TAG, base_commit: BASE_COMMIT, run_commit: runCommit, repetitions: repeatRows.length, deterministic: new Set(fingerprints).size === 1,
    prediction_fingerprints: fingerprints, snapshot: { id: index.snapshot.snapshot_id, hash: index.snapshot.snapshot_hash, counts: index.snapshot.counts, build: index.build },
    metrics, failure_groups: failureGroups, quality_gate: qualityGate,
    performance_ms: { retrieval: { p50: percentile(allTimings, 0.5), p95: percentile(allTimings, 0.95), p99: percentile(allTimings, 0.99) } },
    resources: (first.resources as Record<string, unknown>), completed_at: new Date().toISOString() };
  await writeFile(resolve(PHASE4_ROOT, "runs", identity.id, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { [prefix]: value };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    Object.entries(flatten(item, prefix ? `${prefix}.${key}` : key))));
}

async function validateHarness() {
  const matrix = await readJson<Matrix>(resolve(PHASE4_ROOT, "experiment-matrix.json"));
  if (matrix.base_tag !== BASE_TAG || matrix.base_commit !== BASE_COMMIT || matrix.repeat_count !== 3) throw new Error("matrix_baseline_mismatch");
  if (git("cat-file", "-t", BASE_TAG) !== "tag") throw new Error("base_tag_is_not_annotated");
  if (git("rev-list", "-n", "1", BASE_TAG) !== BASE_COMMIT) throw new Error("base_tag_peeled_commit_mismatch");
  if (git("rev-parse", BASE_TAG) !== TAG_OBJECT) throw new Error("base_tag_object_mismatch");
  const baseline = await readJson<Phase4Config>(resolve(PHASE4_ROOT, "configs/baseline.json"));
  for (const entry of matrix.experiments) {
    const config = await loadConfig(entry.config);
    const left = flatten(baseline), right = flatten(config);
    const changed = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => key !== "experiment_id" && stable(left[key]) !== stable(right[key]));
    if (entry.id === "K4") {
      if (changed.length !== 0) throw new Error(`control_config_changed:${entry.id}:${changed.join(",")}`);
    } else if (changed.length !== 1 || changed[0] !== entry.changed_variable) {
      throw new Error(`single_variable_violation:${entry.id}:${changed.join(",")}`);
    }
  }
  const agentFile = await readJson<{ ablations: AgentAblation[] }>(resolve(PHASE4_ROOT, matrix.agent_ablations));
  if (agentFile.ablations.length !== 12 || new Set(agentFile.ablations.map((item) => item.component)).size !== 12) throw new Error("agent_matrix_incomplete");
  const snapshots: Record<string, unknown> = {};
  for (const id of ["K0", "K1", "K2", "K3", "K4"] as const) {
    const snapshot = await readJson<KnowledgeSnapshot>(resolve(`knowledge/snapshots/${id}.json`));
    if (!verifyKnowledgeSnapshot(snapshot)) throw new Error(`snapshot_invalid:${id}`);
    snapshots[id] = { hash: snapshot.snapshot_hash, documents: snapshot.counts.documents, excluded: snapshot.counts.excluded, reproducibility: snapshot.reproducibility };
  }
  if ((snapshots.K4 as { hash: string }).hash !== K4_HASH) throw new Error("k4_hash_mismatch");
  const frozen = await readJson<{ knowledge_snapshot_hash: string; dataset_manifest_sha256: string }>(resolve(V21_ROOT, "FREEZE.json"));
  const manifestText = await readFile(resolve(V21_ROOT, "dataset-manifest.json"), "utf8");
  if (frozen.knowledge_snapshot_hash !== K4_HASH || frozen.dataset_manifest_sha256 !== sha256(manifestText)) throw new Error("phase3_freeze_input_mismatch");
  const result = { valid: true, base_tag: BASE_TAG, tag_object: TAG_OBJECT, base_commit: BASE_COMMIT, matrix_entries: matrix.experiments.length,
    agent_ablations: agentFile.ablations.length, snapshots, k0_execution: "blocked_missing_frozen_source", gold_unchanged: true };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function markdownTable(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
  return `${header}\n${rows.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replace(/\|/gu, "\\|")).join(" | ")} |`).join("\n")}`;
}

async function runMatrixFamily(family: "knowledge_governance" | "retrieval") {
  const matrix = await readJson<Matrix>(resolve(PHASE4_ROOT, "experiment-matrix.json"));
  const results = [];
  for (const entry of matrix.experiments.filter((item) => item.family === family)) {
    const config = await loadConfig(entry.config);
    results.push(await runExperiment({ id: entry.id, family, changed_variable: entry.changed_variable,
      baseline_value: entry.baseline_value, experiment_value: entry.experiment_value }, config, false));
  }
  const name = family === "knowledge_governance" ? "phase4-k0-k4-ablation" : "phase4-r1-r6-retrieval";
  const report = { schema_version: 1, family, base_tag: BASE_TAG, base_commit: BASE_COMMIT, results,
    completion: { requested: results.length, completed: results.filter((item) => (item as { status: string }).status === "completed").length,
      blocked: results.filter((item) => (item as { status: string }).status !== "completed").map((item) => (item as { experiment_id: string }).experiment_id) } };
  await mkdir(resolve(PHASE4_ROOT, "reports"), { recursive: true });
  await writeFile(resolve(PHASE4_ROOT, "reports", `${name}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const rows = results.map((item) => {
    const typed = item as { experiment_id: string; status: string; deterministic?: boolean; repetitions?: number; metrics?: { dev?: { metrics?: Record<string, number> } }; snapshot?: { hash: string; counts: { documents: number; excluded: number }; build?: { chunks_total?: number } } };
    const metrics = typed.metrics?.dev?.metrics;
    return { id: typed.experiment_id, status: typed.status, repeats: typed.repetitions ?? 0, deterministic: typed.deterministic ?? false,
      documents: typed.snapshot?.counts.documents ?? "unavailable", chunks: typed.snapshot?.build?.chunks_total ?? "unavailable",
      doc_recall_5: metrics?.document_recall_at_5?.toFixed(6) ?? "unavailable", chunk_recall_5: metrics?.chunk_recall_at_5?.toFixed(6) ?? "unavailable",
      mrr_10: metrics?.mrr_at_10?.toFixed(6) ?? "unavailable", ndcg_10: metrics?.ndcg_at_10?.toFixed(6) ?? "unavailable",
      region_leakage: metrics?.region_leakage_rate?.toFixed(6) ?? "unavailable", temporal_leakage: metrics?.temporal_leakage_rate?.toFixed(6) ?? "unavailable" };
  });
  const conclusions = family === "knowledge_governance"
    ? "K0 因冻结原文未提交而不能重跑；K1–K4 使用独立索引真实改变知识输入。最终结论必须保留该阻断，不能把 manifest 当预测结果。"
    : "每个 R 编号仅改变仓库既定的一项变量。是否需要 dense/reranker 仅由 failure attribution 决定，本矩阵没有预设其更优。";
  const md = `# ${name}\n\n${conclusions}\n\n${markdownTable(rows, Object.keys(rows[0] ?? {}))}\n\n`;
  await writeFile(resolve(PHASE4_ROOT, "reports", `${name}.md`), md, "utf8");
  console.log(JSON.stringify(report.completion, null, 2));
}

async function runAgentAblations() {
  const matrix = await readJson<Matrix>(resolve(PHASE4_ROOT, "experiment-matrix.json"));
  const baseline = await readJson<Phase4Config>(resolve(PHASE4_ROOT, "configs/baseline.json"));
  const agentFile = await readJson<{ ablations: AgentAblation[] }>(resolve(PHASE4_ROOT, matrix.agent_ablations));
  const results = [];
  for (const ablation of agentFile.ablations) {
    const config = structuredClone(baseline);
    config.experiment_id = ablation.id;
    config.agent[ablation.component] = false;
    results.push(await runExperiment({ id: ablation.id, family: "agent_ablation", changed_variable: ablation.changed_variable,
      baseline_value: true, experiment_value: false, high_risk: ablation.high_risk }, config, true));
  }
  const report = { schema_version: 1, family: "agent_ablation", base_tag: BASE_TAG, base_commit: BASE_COMMIT, results };
  await mkdir(resolve(PHASE4_ROOT, "reports"), { recursive: true });
  await writeFile(resolve(PHASE4_ROOT, "reports/phase4-agent-ablation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const rows = results.map((item) => {
    const typed = item as { experiment_id: string; deterministic: boolean; repetitions: number; identity: ExperimentIdentity;
      metrics: { dev: { metrics: Record<string, number> }; conversations: { scenario_completion_rate: number; stale_context_leakage_rate: number }; safety: { pass_rate: number } }; quality_gate: { passed: boolean } };
    return { id: typed.experiment_id, component: typed.identity.changed_variable, high_risk: typed.identity.high_risk ?? false, repeats: typed.repetitions,
      deterministic: typed.deterministic, gate: typed.quality_gate.passed ? "passed" : "failed", behavior: (typed.metrics.dev.metrics.behavior_accuracy ?? 0).toFixed(6),
      fact_coverage: (typed.metrics.dev.metrics.required_fact_coverage ?? 0).toFixed(6), citation_precision: (typed.metrics.dev.metrics.citation_precision ?? 0).toFixed(6),
      conversation_completion: typed.metrics.conversations.scenario_completion_rate.toFixed(6), stale_leakage: typed.metrics.conversations.stale_context_leakage_rate.toFixed(6),
      safety_pass: typed.metrics.safety.pass_rate.toFixed(6) };
  });
  await writeFile(resolve(PHASE4_ROOT, "reports/phase4-agent-ablation.md"), `# Phase 4 agent ablation\n\n高风险组件关闭结果只用于因果观察，不得进入候选。\n\n${markdownTable(rows, Object.keys(rows[0] ?? {}))}\n`, "utf8");
  console.log(JSON.stringify({ completed: results.length, deterministic: results.filter((item) => (item as { deterministic: boolean }).deterministic).length }, null, 2));
}

type CandidateRow = { id: string; config: Phase4Config; config_hash: string; source_commit: string; metrics: Record<string, number>; performance_p95: number; reason: string };

async function rankCandidates() {
  const baselineConfig = await readJson<Phase4Config>(resolve(PHASE4_ROOT, "configs/baseline.json"));
  const baselineReport = await readJson<{ retrieval: { dev: { metrics: Record<string, number> } }; performance_ms: { retrieval: { p95: number } }; quality_gate: { passed: boolean } }>(resolve(V21_ROOT, "reports/phase3-3-frozen-baseline.json"));
  const sourceCommit = git("rev-parse", "HEAD");
  const eligible: CandidateRow[] = [];
  if (baselineReport.quality_gate.passed) eligible.push({ id: "baseline", config: baselineConfig, config_hash: hash(baselineConfig), source_commit: sourceCommit,
    metrics: baselineReport.retrieval.dev.metrics, performance_p95: baselineReport.performance_ms.retrieval.p95,
    reason: "Phase 3.3 frozen baseline satisfies all hard gates and non-regression thresholds." });
  const agentReport = await readJson<{ results: Array<{ status: string; experiment_id: string; identity: ExperimentIdentity; config: Phase4Config; config_fingerprint: string;
    run_commit: string; deterministic: boolean; quality_gate: { passed: boolean } | null; metrics: { dev: { metrics: Record<string, number> } }; performance_ms: { retrieval: { p95: number } } }> }>(resolve(PHASE4_ROOT, "reports/phase4-agent-ablation.json"));
  const thresholds: Record<string, number> = { document_recall_at_5: 1, chunk_recall_at_5: 0.934783, mrr_at_10: 0.822464, ndcg_at_10: 0.728830,
    required_fact_coverage: 0.8, citation_precision: 0.55, citation_completeness: 0.846154 };
  for (const result of agentReport.results) {
    const nonDegrading = Object.entries(thresholds).every(([key, threshold]) => (result.metrics.dev.metrics[key] ?? 0) + 1e-9 >= threshold);
    if (result.status === "completed" && result.deterministic && result.quality_gate?.passed && !result.identity.high_risk && nonDegrading) {
      eligible.push({ id: result.experiment_id, config: result.config, config_hash: result.config_fingerprint, source_commit: result.run_commit,
        metrics: result.metrics.dev.metrics, performance_p95: result.performance_ms.retrieval.p95, reason: "Passed hard gates and all Phase 3.3 non-regression thresholds." });
    }
  }
  const quality = [...eligible].sort((left, right) => (right.metrics.ndcg_at_10 ?? 0) - (left.metrics.ndcg_at_10 ?? 0)
    || (right.metrics.required_fact_coverage ?? 0) - (left.metrics.required_fact_coverage ?? 0) || left.performance_p95 - right.performance_p95)[0];
  const efficiency = [...eligible].filter((item) => item.id !== quality?.id).sort((left, right) => left.performance_p95 - right.performance_p95)[0];
  if (!quality) throw new Error("blocked_no_valid_candidate");
  const candidateA = { schema_version: 1, candidate: "A", priority: "quality", selected: true, selection_source_commit: sourceCommit, ...quality };
  const candidateB = efficiency
    ? { schema_version: 1, candidate: "B", priority: "efficiency_cost", selected: true, selection_source_commit: sourceCommit, ...efficiency }
    : { schema_version: 1, candidate: "B", priority: "efficiency_cost", selected: false, selection_source_commit: sourceCommit,
      reason: "No distinct second configuration passed every hard gate and non-regression threshold." };
  await mkdir(resolve(PHASE4_ROOT, "candidates"), { recursive: true });
  await writeFile(resolve(PHASE4_ROOT, "candidates/candidate-a.json"), `${JSON.stringify(candidateA, null, 2)}\n`, "utf8");
  await writeFile(resolve(PHASE4_ROOT, "candidates/candidate-b.json"), `${JSON.stringify(candidateB, null, 2)}\n`, "utf8");
  const rejected = agentReport.results.filter((item) => !eligible.some((candidate) => candidate.id === item.experiment_id)).map((item) => ({ id: item.experiment_id,
    reason: item.identity.high_risk ? "high_risk_component_disabled" : !item.quality_gate?.passed ? "hard_gate_failed" : "non_regression_threshold_failed" }));
  await writeFile(resolve(PHASE4_ROOT, "reports/phase4-candidate-selection.md"), `# Phase 4 candidate selection\n\nSelection source commit: \`${sourceCommit}\`.\n\n- Candidate A: ${quality.id} — ${quality.reason}\n- Candidate B: ${efficiency ? `${efficiency.id} — ${efficiency.reason}` : "not selected; no distinct eligible configuration"}\n\n## Rejected\n\n${markdownTable(rejected, ["id", "reason"])}\n`, "utf8");
  console.log(JSON.stringify({ candidate_a: quality.id, candidate_b: efficiency?.id ?? null, eligible: eligible.map((item) => item.id) }, null, 2));
}

async function main(): Promise<void> {
  const action = process.argv[2];
  switch (action) {
    case "validate": await validateHarness(); break;
    case "run-k0-k4": await runMatrixFamily("knowledge_governance"); break;
    case "run-r1-r6": await runMatrixFamily("retrieval"); break;
    case "run-agent-ablation": await runAgentAblations(); break;
    case "rank-candidates": await rankCandidates(); break;
    case "freeze-test": case "run-frozen-test": case "run-real-model": case "report":
      throw new Error(`${action}:not_implemented_until_candidate_selection_is_committed`);
    default: throw new Error(`unknown_phase4_action:${action ?? "missing"}`);
  }
}

await main();
