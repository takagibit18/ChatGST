# Evaluation report

## Eval v2.1 Phase 3.3 status（2026-08-05）

Eval v2.1 的 143 条 source-first Gold 已全部人工通过。审核后数据、manifest、raw predictions、score report 与三次确定性验证指纹一致；Dataset Review、自动质量、产物一致性和确定性 Gate 均通过，Phase 4 Entry 为 `ready_for_phase4`。Production Release 仍为 `blocked_pending_phase4`，frozen test 未建立，真实 DeepSeek 未运行。指标仅描述 `TestModelProvider` 确定性基线。

下文保留 2026-07-23 的旧 13-case baseline 事实；其中 `goldens.generated.json` 是与 Eval v2.1 不同的本地未审核候选。

Baseline generated 2026-07-23 from 13 repeatable Chinese cases against a local-only policy corpus and generated BM25 index. Detailed per-case metrics are in `domains/childcare-subsidy/evals/baseline-report.json`; evidence-bound, unreviewed candidates are generated locally as ignored `goldens.generated.json`.

| Metric | A: none | B: Skill | C: Skill + BM25 | D: Skill + BM25 + Validator |
| --- | ---: | ---: | ---: | ---: |
| Retrieval Recall@5 | 0.00 | 0.00 | 0.95 | 0.95 |
| MRR | 0.00 | 0.00 | 0.80 | 0.80 |
| Region accuracy | 1.00 | 1.00 | 1.00 | 1.00 |
| Intent accuracy | 1.00 | 1.00 | 1.00 | 1.00 |
| Citation accuracy | 1.00 | 1.00 | 1.00 | 1.00 |
| Source legality | 1.00 | 1.00 | 1.00 | 1.00 |
| Factual consistency | 0.23 | 0.23 | 1.00 | 1.00 |
| Unsupported-answer rate | 0.00 | 0.00 | 0.00 | 0.00 |
| Schema pass rate | 1.00 | 1.00 | 1.00 | 1.00 |
| Business Validator pass | 1.00 | 1.00 | 1.00 | 1.00 |

A and B deliberately degrade instead of guessing, so their schema and unsupported-answer metrics are safe even though factual coverage is low. C uses deterministic response composition for the retrieval ablation. D runs the real Pi Agent Core, Skill, tools, BM25, Evidence Pack, schema/business validators and deterministic `TestModelProvider`.

D local averages in this run were 0.77 model calls, 1.92 tool calls and 334 estimated input+output tokens per case. Local latency is recorded in the JSON report, but it is not a DeepSeek network benchmark and varies by machine.

The test set covers amount, eligibility, claimant, materials, channel, deadline, payment, comparison, migration, benefit distinction, missing region, unsupported region and retrieval-empty behavior. Integration tests additionally cover a second-turn clarification, third-turn rejection, policy conflict template, unsafe local-file/reasoning requests, invalid JSON repair/fallback, Raindrop disabled/failure paths and public WebSocket filtering.

Goldens are generated only after BM25 and store exact document/chunk IDs, source URL, section path, evidence text and model identity. Every record remains `pending_review`; human revisions can replace `generated_answer` and add reviewer notes without changing bound evidence. Because they contain evidence text, Golden files are intentionally excluded from Git.
