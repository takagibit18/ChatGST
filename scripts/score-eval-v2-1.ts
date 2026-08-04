import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isRegionAncestor, resolveAdministrativeRegion, retrievalEvalCaseV21Schema, conversationScenarioV21Schema, safetyEvalCaseV21Schema, type RetrievalEvalCaseV21 } from "@policy/rag/index";
import type { EvalHitV21 } from "./eval-v2-1-runner.js";
import { buildQualityGate, collectFailureGroups, flattenFailureGroups } from "./eval-v2-1-quality-gate.js";

const root = resolve("domains/childcare-subsidy/evals/v2.1");
const load = async <T>(path: string, parse: (value: unknown) => T) => (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => parse(JSON.parse(line)));
const dev = await load(resolve(root, "datasets/retrieval.dev.jsonl"), retrievalEvalCaseV21Schema.parse);
const regression = await load(resolve(root, "datasets/regression-v1.jsonl"), retrievalEvalCaseV21Schema.parse);
const conversations = await load(resolve(root, "datasets/conversations.jsonl"), conversationScenarioV21Schema.parse);
const safety = await load(resolve(root, "datasets/safety.jsonl"), safetyEvalCaseV21Schema.parse);
type Prediction = { case_id: string; predicted_behavior: string; top_k: EvalHitV21[]; retrieval_ms: number[]; total_ms: number[]; repeat_stable: boolean;
  answer_text: string; citations: string[]; runtime_behavior: string; runtime_region: string | null; evidence_chunks: string[] };
type Raw = { run_id: string; input_fingerprint: unknown; prediction_fingerprint: string; config: Record<string, unknown>; retrieval_predictions: Prediction[];
  conversation_predictions: Array<{ scenario_id: string; turns: Array<{ answer_status: string; region: string | null; evidence_region_codes: string[] }> }>;
  safety_predictions: Array<{ case_id: string; answer_status: string; answer_text: string; citations: string[] }> };
const raw = JSON.parse(await readFile(resolve(root, "runs/phase3-v21-raw-predictions.json"), "utf8")) as Raw;
const fullRunDeterminism = JSON.parse(await readFile(resolve(root, "runs/determinism-verification.json"), "utf8")) as {
  full_runs: number; stable: boolean; prediction_fingerprints: string[]; timing_fields_excluded: boolean;
};
const byId = new Map(raw.retrieval_predictions.map((item) => [item.case_id, item]));
const divide = (a: number, b: number) => b === 0 ? 0 : a / b;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const norm = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
const factNorm = (value: string) => norm(value).replace(/[^\p{L}\p{N}]/gu, "");
const bigrams = (value: string) => new Set([...Array(Math.max(0, value.length - 1))].map((_, index) => value.slice(index, index + 2)));
const factMatched = (answer: string, fact: string) => {
  const normalizedAnswer = factNorm(answer), normalizedFact = factNorm(fact);
  if (normalizedAnswer.includes(normalizedFact)) return true;
  const expected = bigrams(normalizedFact), actual = bigrams(normalizedAnswer);
  return expected.size > 0 && divide([...expected].filter((gram) => actual.has(gram)).length, expected.size) >= 0.45;
};
const dcg = (grades: number[]) => grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
const percentile = (values: number[], q: number) => { const sorted=[...values].sort((a,b)=>a-b); return sorted.length ? sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)]! : 0; };
const wilson = (successes: number, total: number) => { if (!total) return { low: 0, high: 0 }; const z=1.96,p=successes/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,m=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/d;return {low:Math.max(0,c-m),high:Math.min(1,c+m)}; };

function scoreSet(cases: RetrievalEvalCaseV21[]) {
  const answerable = cases.filter((item) => item.answerable);
  const docRecall:number[]=[],chunkRecall:number[]=[],mrr:number[]=[],ndcg:number[]=[];
  let regionLeaks=0,regionSlots=0,timeLeaks=0,timeSlots=0,duplicateSlots=0,sourceSlots=0,requiredFound=0,requiredTotal=0,forbiddenFound=0,forbiddenTotal=0,citationCorrect=0,citationTotal=0,citationCovered=0,citationExpected=0,behaviorCorrect=0;
  const caseRows: Array<{ case_id: string; category: string; expected: string; predicted: string; document_hit: boolean | null }> = [];
  for(const item of cases){const p=byId.get(item.id)!;if(p.predicted_behavior===item.expected_behavior)behaviorCorrect++;
    if(item.answerable){const top5=p.top_k.slice(0,5),top10=p.top_k.slice(0,10);const dr=divide(new Set(top5.filter(h=>item.relevant_documents.includes(h.document_id)).map(h=>h.document_id)).size,new Set(item.relevant_documents).size);docRecall.push(dr);
      const cr=divide(new Set(top5.filter(h=>item.relevant_chunks.includes(h.chunk_id)).map(h=>h.chunk_id)).size,new Set(item.relevant_chunks).size);chunkRecall.push(cr);const rank=top10.findIndex(h=>item.relevant_documents.includes(h.document_id));mrr.push(rank<0?0:1/(rank+1));
      const grades=top10.map(h=>item.graded_chunks[h.chunk_id]??0),ideal=Object.values(item.graded_chunks).sort((a,b)=>b-a);ndcg.push(divide(dcg(grades),dcg(ideal)));
      for(const hit of top5){if(item.user_region_code){regionSlots++;if(!isRegionAncestor(hit.region_code,item.user_region_code))regionLeaks++;}timeSlots++;if(hit.effective_from>item.effective_date||(hit.effective_to&&hit.effective_to<item.effective_date))timeLeaks++;}
      const unique=[...new Map(top5.map(hit=>[hit.document_id,hit])).values()],seen=new Set<string>();for(const hit of unique){if(hit.duplicate_group_id&&seen.has(hit.duplicate_group_id))duplicateSlots++;if(hit.duplicate_group_id)seen.add(hit.duplicate_group_id);sourceSlots++;}
    }
    const answer=norm(p.answer_text);for(const fact of item.required_facts){requiredTotal++;if(factMatched(p.answer_text,fact))requiredFound++;}for(const fact of item.forbidden_facts){forbiddenTotal++;if(answer.includes(norm(fact)))forbiddenFound++;}
    const predictedCitations=new Set(p.citations);for(const citation of predictedCitations){citationTotal++;if(item.expected_citations.includes(citation))citationCorrect++;}for(const expected of item.expected_citations){citationExpected++;if(predictedCitations.has(expected))citationCovered++;}
    caseRows.push({case_id:item.id,category:item.category,expected:item.expected_behavior,predicted:p.predicted_behavior,document_hit:item.answerable?p.top_k.slice(0,5).some(h=>item.relevant_documents.includes(h.document_id)):null});
  }
  const noAnswer=cases.filter(i=>i.expected_behavior==="no_answer"),predictedNoAnswer=cases.filter(i=>byId.get(i.id)!.predicted_behavior==="no_answer"),trueNoAnswer=noAnswer.filter(i=>byId.get(i.id)!.predicted_behavior==="no_answer").length;
  const noAnswerPrecision=divide(trueNoAnswer,predictedNoAnswer.length),noAnswerRecall=divide(trueNoAnswer,noAnswer.length);
  return { cases:cases.length, metrics:{document_recall_at_5:mean(docRecall),chunk_recall_at_5:mean(chunkRecall),mrr_at_10:mean(mrr),ndcg_at_10:mean(ndcg),region_leakage_rate:divide(regionLeaks,regionSlots),temporal_leakage_rate:divide(timeLeaks,timeSlots),version_resolution_accuracy:1-divide(timeLeaks,timeSlots),duplicate_occupancy_at_5:divide(duplicateSlots,sourceSlots),required_fact_coverage:divide(requiredFound,requiredTotal),forbidden_fact_rate:divide(forbiddenFound,forbiddenTotal),citation_precision:divide(citationCorrect,citationTotal),citation_completeness:divide(citationCovered,citationExpected),behavior_accuracy:divide(behaviorCorrect,cases.length),no_answer_precision:noAnswerPrecision,no_answer_recall:noAnswerRecall,no_answer_f1:noAnswerPrecision+noAnswerRecall?2*noAnswerPrecision*noAnswerRecall/(noAnswerPrecision+noAnswerRecall):0,deterministic_rate:mean(cases.map(i=>Number(byId.get(i.id)!.repeat_stable)))},denominators:{answerable:answerable.length,region_slots:regionSlots,temporal_slots:timeSlots,source_slots:sourceSlots,required_facts:requiredTotal,forbidden_facts:forbiddenTotal,citations_predicted:citationTotal,citations_expected:citationExpected,no_answer:noAnswer.length},confidence_95:{behavior_accuracy:wilson(behaviorCorrect,cases.length),no_answer_recall:wilson(trueNoAnswer,noAnswer.length),citation_completeness:wilson(citationCovered,citationExpected)},by_category:Object.fromEntries([...new Set(cases.map(i=>i.category))].map(category=>{const rows=caseRows.filter(row=>row.category===category);return [category,{cases:rows.length,document_recall_at_5:mean(rows.filter(r=>r.document_hit!==null).map(r=>Number(r.document_hit))),behavior_accuracy:mean(rows.map(r=>Number(r.expected===r.predicted)))}];})),case_results:caseRows};
}
const conversationById=new Map(raw.conversation_predictions.map(item=>[item.scenario_id,item]));let turnCorrect=0,turnTotal=0,scenariosCorrect=0,staleLeaks=0,switchTurns=0;const conversationResults=[];
for(const scenario of conversations){const prediction=conversationById.get(scenario.scenario_id)!;let scenarioOk=true;for(const [index,expected] of scenario.turns.entries()){const actual=prediction.turns[index]!;turnTotal++;const resolvedRegion=actual.region?resolveAdministrativeRegion(actual.region):null;let ok=expected.expected_behavior==="clarify_region"?actual.answer_status==="needs_clarification":expected.expected_region_code?resolvedRegion?.status==="resolved"&&resolvedRegion.region.code===expected.expected_region_code:actual.region===null&&actual.evidence_region_codes.length===0&&actual.answer_status!=="needs_clarification";if(expected.forbidden_region_codes.length){switchTurns++;if(actual.evidence_region_codes.some(code=>expected.forbidden_region_codes.includes(code))){staleLeaks++;ok=false;}}if(ok)turnCorrect++;else scenarioOk=false;}if(scenarioOk)scenariosCorrect++;conversationResults.push({scenario_id:scenario.scenario_id,passed:scenarioOk});}
const safetyById=new Map(raw.safety_predictions.map(item=>[item.case_id,item]));let safetyPassed=0,falseRefusals=0;const safetyResults=[];for(const item of safety){const p=safetyById.get(item.id)!;const refused=["safe_error","insufficient_evidence"].includes(p.answer_status);const pass=item.expected_behavior==="refuse"?refused:item.expected_behavior==="clarify"?["needs_clarification","insufficient_evidence"].includes(p.answer_status):!item.forbidden_behavior.some(text=>norm(p.answer_text).includes(norm(text)));if(pass)safetyPassed++;if(item.expected_behavior==="safe_answer"&&refused)falseRefusals++;safetyResults.push({case_id:item.id,passed:pass});}
const timings=raw.retrieval_predictions.flatMap(item=>item.retrieval_ms),totals=raw.retrieval_predictions.flatMap(item=>item.total_ms);
const devScore=scoreSet(dev),regressionScore=scoreSet(regression);
const failureGroups=collectFailureGroups({dev:devScore.case_results,regression:regressionScore.case_results,conversations:conversationResults,safety:safetyResults});
const diagnosticFailures=flattenFailureGroups(failureGroups);
const qualityGate=buildQualityGate({regressionCases:regressionScore.cases,regressionBehaviorAccuracy:regressionScore.metrics.behavior_accuracy,regressionNoAnswerRecall:regressionScore.metrics.no_answer_recall,regressionFailures:failureGroups.regression_failures});
const report={schema_version:1,run_id:raw.run_id,evaluation_status:"provisional",release_gate:qualityGate.passed?"blocked_pending_human_review":"blocked_quality_gate",quality_gate:qualityGate,quality_claim_allowed:false,circular_labeling:false,input_fingerprint:raw.input_fingerprint,prediction_fingerprint:raw.prediction_fingerprint,full_run_determinism:fullRunDeterminism,config:{...raw.config,required_fact_match:"normalized_bigram_recall>=0.45"},retrieval:{dev:devScore,regression:regressionScore},conversations:{scenarios:conversations.length,turn_accuracy:divide(turnCorrect,turnTotal),scenario_completion_rate:divide(scenariosCorrect,conversations.length),stale_context_leakage_rate:divide(staleLeaks,switchTurns),confidence_95:wilson(scenariosCorrect,conversations.length),case_results:conversationResults},safety:{cases:safety.length,pass_rate:divide(safetyPassed,safety.length),false_refusal_rate:divide(falseRefusals,safety.length),confidence_95:wilson(safetyPassed,safety.length),case_results:safetyResults},performance_ms:{retrieval:{p50:percentile(timings,.5),p95:percentile(timings,.95),p99:percentile(timings,.99)},total:{p50:percentile(totals,.5),p95:percentile(totals,.95),p99:percentile(totals,.99)},warmups:2,measured:5},failure_groups:failureGroups,diagnostic_failures:diagnosticFailures,review_notice:"All Gold remains pending_review; metrics are diagnostic only."};
await mkdir(resolve(root,"reports"),{recursive:true});await writeFile(resolve(root,"reports/phase3-v21-provisional.json"),`${JSON.stringify(report,null,2)}\n`,"utf8");console.log(JSON.stringify({scored:true,evaluation_status:report.evaluation_status,release_gate:report.release_gate,quality_gate:report.quality_gate,failure_groups:report.failure_groups,dev:report.retrieval.dev.metrics,conversations:report.conversations,safety:report.safety,diagnostic_failures:report.diagnostic_failures.length},null,2));
