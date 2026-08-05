import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PiLocalRagRetrievalProvider,
  conversationScenarioV21Schema,
  materializeRetrievalAnnotation,
  retrievalAnnotationV21Schema,
  retrievalEvalCaseV21Schema,
  safetyEvalCaseV21Schema,
  type KnowledgeBrowserProvider,
  type RetrievalAnnotationV21,
  type RetrievalEvalCaseV21,
} from "@policy/rag/index";

export type GoldSourceReader = Pick<KnowledgeBrowserProvider, "listKnowledgeDocuments" | "getKnowledgeDocument">;
const root = resolve("domains/childcare-subsidy/evals/v2.1");
const annotationsDir = resolve(root, "annotations");
const datasetsDir = resolve(root, "datasets");
const expectedCategories: Record<string, number> = {
  single_region_fact: 10, cross_level_policy: 9, cross_region_interference: 9, temporal_version: 8,
  multi_evidence: 8, colloquial_typo: 8, paraphrase_consistency: 8, false_premise: 4, no_answer: 10, missing_region: 6,
};

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").replace(/[\p{P}\p{S}]/gu, "").toLowerCase();
}
function jsonl(values: unknown[]): string { return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function normalizeEol(value: string): string { return value.replace(/\r\n/gu, "\n"); }
async function loadJsonl<T>(path: string): Promise<T[]> {
  return (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T);
}

export async function buildEvalV21Datasets(reader: GoldSourceReader, annotations: RetrievalAnnotationV21[]): Promise<RetrievalEvalCaseV21[]> {
  const summaries = await reader.listKnowledgeDocuments();
  const documents = new Map<string, Awaited<ReturnType<GoldSourceReader["getKnowledgeDocument"]>>>();
  for (const summary of summaries) documents.set(summary.metadata.document_id, await reader.getKnowledgeDocument(summary.metadata.document_id));
  const results: RetrievalEvalCaseV21[] = [];
  for (const annotation of annotations) {
    const item = retrievalAnnotationV21Schema.parse(annotation);
    const normalizedQuestion = normalize(item.question);
    for (const evidence of item.gold_evidence) {
      const document = documents.get(evidence.document_id);
      if (!document) throw new Error(`${item.id}: Gold document is absent from K4`);
      const chunk = document.sections.find((section) => section.chunk_id === evidence.chunk_id);
      if (!chunk) throw new Error(`${item.id}: Gold chunk is absent from its document`);
      if (chunk.content.slice(evidence.chunk_char_start, evidence.chunk_char_end) !== evidence.supporting_text) {
        throw new Error(`${item.id}: exact evidence character span does not match the Gold chunk`);
      }
      const prefix = chunk.content.slice(0, evidence.chunk_char_start);
      const expectedLineStart = chunk.line_start + (prefix.match(/\n/gu)?.length ?? 0);
      const expectedLineEnd = expectedLineStart + (evidence.supporting_text.match(/\n/gu)?.length ?? 0);
      if (evidence.source_line_start !== expectedLineStart || evidence.source_line_end !== expectedLineEnd) {
        throw new Error(`${item.id}: source line anchor does not match the exact evidence span`);
      }
      if (!normalize(chunk.content).includes(normalize(evidence.supporting_text))) throw new Error(`${item.id}: supporting text is not in Gold chunk`);
      if (/[，、：；]$/u.test(evidence.supporting_text.trim())) throw new Error(`${item.id}: supporting text ends mid-clause`);
      if (evidence.claims.some((claim) => !/[。！？]$/u.test(claim.text))) throw new Error(`${item.id}: atomic claims must be complete sentences`);
      const title = normalize(document.metadata.title);
      if (title.length >= 8 && normalizedQuestion.includes(title)) throw new Error(`${item.id}: full document title leaked into question`);
      for (const heading of chunk.section_path.map(normalize).filter((value) => value.length >= 8)) {
        if (normalizedQuestion.includes(heading)) throw new Error(`${item.id}: full section heading leaked into question`);
      }
      if (normalizedQuestion.includes(normalize(evidence.document_id)) || normalizedQuestion.includes(normalize(evidence.chunk_id))) {
        throw new Error(`${item.id}: internal ID leaked into question`);
      }
    }
    results.push(materializeRetrievalAnnotation(item));
  }
  return results;
}

function validateInventory(retrieval: RetrievalEvalCaseV21[], regression: RetrievalEvalCaseV21[]): void {
  if (retrieval.length !== 80) throw new Error(`Expected 80 retrieval cases, got ${retrieval.length}`);
  if (retrieval.filter((item) => item.split === "train").length !== 50 || retrieval.filter((item) => item.split === "dev").length !== 30) {
    throw new Error("Expected train/dev split 50/30");
  }
  for (const [category, count] of Object.entries(expectedCategories)) {
    if (retrieval.filter((item) => item.category === category).length !== count) throw new Error(`${category}: expected ${count}`);
  }
  if (regression.length !== 13) throw new Error("Expected 13 regression cases");
  const all = [...retrieval, ...regression];
  if (all.some((item) => item.source_review_status === "rejected")) throw new Error("Rejected Gold must be revised before entering the dataset");
  if (all.some((item) => item.retriever_used_for_labeling !== false || item.annotation_method !== "source_first")) throw new Error("Circular labeling guard failed");
  const groupSplits = new Map<string, Set<string>>();
  for (const item of retrieval) groupSplits.set(item.case_group_id, new Set([...(groupSplits.get(item.case_group_id) ?? []), item.split]));
  if ([...groupSplits.values()].some((splits) => splits.size > 1)) throw new Error("case_group_id leaked across splits");
  const ordinaryQuestions = retrieval.filter((item) => item.category !== "paraphrase_consistency").map((item) => normalize(item.question));
  if (new Set(ordinaryQuestions).size !== ordinaryQuestions.length) throw new Error("Non-paraphrase questions must be unique");
  const rationales = retrieval.map((item) => normalize(item.difficulty_rationale));
  if (new Set(rationales).size < Math.ceil(retrieval.length * 0.9)) throw new Error("Difficulty rationales are mechanically repeated");
  for (const item of retrieval) {
    if (item.category === "cross_region_interference" && item.challenge.interference_regions?.includes(item.user_region ?? "")) {
      throw new Error(`${item.id}: target region equals interference region`);
    }
    if (item.category === "temporal_version" && !item.gold_evidence.some((entry) => entry.claims.some((claim) => /(?:20\d{2}|出生当年|次年|年度)/u.test(claim.text)))) {
      throw new Error(`${item.id}: temporal Gold has no time-bearing atomic claim`);
    }
    if (item.answerable && item.required_facts.some((fact) => normalize(fact).length < 12)) throw new Error(`${item.id}: required fact is too short to be atomic`);
  }
  const paraphrases = retrieval.filter((item) => item.category === "paraphrase_consistency");
  const paraphraseGroups = new Map<string, number>();
  for (const item of paraphrases) paraphraseGroups.set(item.case_group_id, (paraphraseGroups.get(item.case_group_id) ?? 0) + 1);
  if ([...paraphraseGroups.values()].some((count) => count !== 2)) throw new Error("Every paraphrase group must contain exactly two cases");
}

async function main(): Promise<void> {
  const retrievalAnnotations = (await loadJsonl<unknown>(resolve(annotationsDir, "retrieval.jsonl"))).map((item) => retrievalAnnotationV21Schema.parse(item));
  const regressionAnnotations = (await loadJsonl<unknown>(resolve(annotationsDir, "regression-v1.jsonl"))).map((item) => retrievalAnnotationV21Schema.parse(item));
  const conversations = (await loadJsonl<unknown>(resolve(annotationsDir, "conversations.jsonl"))).map((item) => conversationScenarioV21Schema.parse(item));
  const safety = (await loadJsonl<unknown>(resolve(annotationsDir, "safety.jsonl"))).map((item) => safetyEvalCaseV21Schema.parse(item));
  if (conversations.length !== 20 || safety.length !== 30) throw new Error("Expected 20 conversations and 30 safety cases");
  if ([...conversations, ...safety].some((item) => item.source_review_status === "rejected")) throw new Error("Rejected scenarios must be revised before entering the dataset");
  const transcripts = conversations.map((scenario) => normalize(scenario.turns.map((turn) => turn.user).join("\n")));
  if (new Set(transcripts).size !== transcripts.length) throw new Error("Conversation scenarios contain repeated transcripts");
  const forbiddenSets = safety.map((item) => item.forbidden_behavior.map(normalize).sort().join("|"));
  if (new Set(forbiddenSets).size !== forbiddenSets.length) throw new Error("Safety cases contain a shared forbidden-behavior template");
  for (const item of safety) {
    const required = item.category === "false_premise" ? "correct" : item.category === "out_of_scope" ? "safe_answer" : "refuse";
    if (item.expected_behavior !== required) throw new Error(`${item.id}: safety category and expected behavior disagree`);
  }
  const reader: GoldSourceReader = new PiLocalRagRetrievalProvider(resolve("knowledge/index"));
  const retrieval = await buildEvalV21Datasets(reader, retrievalAnnotations);
  const regression = await buildEvalV21Datasets(reader, regressionAnnotations);
  validateInventory(retrieval, regression);
  const reviewCounts = { pending_review: 0, human_approved: 0, rejected: 0 };
  for (const item of [...retrieval, ...regression, ...conversations, ...safety]) reviewCounts[item.source_review_status]++;
  const totalCases = retrieval.length + regression.length + conversations.length + safety.length;
  const allHumanApproved = reviewCounts.human_approved === totalCases;
  const files: Record<string, string> = {
    "retrieval.train.jsonl": jsonl(retrieval.filter((item) => item.split === "train")),
    "retrieval.dev.jsonl": jsonl(retrieval.filter((item) => item.split === "dev")),
    "regression-v1.jsonl": jsonl(regression), "conversations.jsonl": jsonl(conversations), "safety.jsonl": jsonl(safety),
  };
  if (process.argv.includes("--write")) {
    await mkdir(datasetsDir, { recursive: true });
    for (const [name, contents] of Object.entries(files)) await writeFile(resolve(datasetsDir, name), contents, "utf8");
    const manifest = {
      schema_version: 3, dataset_version: "phase3-v2.1", generated_at: "2026-08-02T00:00:00.000Z",
      evaluation_status: "provisional", release_gate: allHumanApproved ? "human_review_passed" : "blocked_pending_human_review", knowledge_snapshot: "K4",
      knowledge_snapshot_hash: "041f724f04893f821bdfdb23cc76d9faa3fd10233920489e5111edafc6cb34ce",
      circular_labeling: false, mechanical_prefix_extraction: false, gold_representation: "exact_source_span+atomic_claims",
      counts: { retrieval: 80, train: 50, dev: 30, regression: 13, conversations: 20, safety: 30,
        evidence_spans: [...retrieval, ...regression].flatMap((item) => item.gold_evidence).length,
        atomic_claims: [...retrieval, ...regression].flatMap((item) => item.gold_evidence.flatMap((entry) => entry.claims)).length },
      files: Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, { sha256: hash(contents), rows: contents.trim().split(/\r?\n/u).length }])),
      review: reviewCounts, test_split: { status: "not_frozen" },
    };
    await writeFile(resolve(root, "dataset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } else {
    for (const [name, expected] of Object.entries(files)) {
      if (normalizeEol(await readFile(resolve(datasetsDir, name), "utf8")) !== normalizeEol(expected)) throw new Error(`${name}: materialized dataset is stale`);
    }
  }
  console.log(JSON.stringify({ valid: true, retrieval: retrieval.length, regression: regression.length, conversations: conversations.length, safety: safety.length, circular_labeling: false, review_status: allHumanApproved ? "human_approved" : "pending_review", review_counts: reviewCounts, release_gate: allHumanApproved ? "human_review_passed" : "blocked_pending_human_review" }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
