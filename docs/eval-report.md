# Evaluation report

Baseline generated 2026-07-23 from 13 repeatable Chinese cases against the committed knowledge sources and a generated local BM25 index. Detailed per-case results are in `domains/childcare-subsidy/evals/baseline-report.json`; evidence-bound, unreviewed candidates are in `goldens.generated.json`.

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

Goldens are generated only after BM25 and store exact document/chunk IDs, source URL, section path, evidence text and model identity. Every record remains `pending_review`; human revisions can replace `generated_answer` and add reviewer notes without changing bound evidence.
