# Phase 4 agent ablation

高风险组件关闭结果只用于因果观察，不得进入候选。

| id | component | high_risk | repeats | deterministic | gate | behavior | fact_coverage | citation_precision | conversation_completion | stale_leakage | safety_pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | agent.query_normalizer | false | 3 | true | failed | 0.966667 | 0.733333 | 0.567568 | 1.000000 | 0.000000 | 1.000000 |
| A2 | agent.intent_classification | false | 3 | true | failed | 0.900000 | 0.600000 | 0.558824 | 1.000000 | 0.000000 | 1.000000 |
| A3 | agent.region_hierarchy | true | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 1.000000 | 0.000000 | 1.000000 |
| A4 | agent.version_filtering | true | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 1.000000 | 0.000000 | 1.000000 |
| A5 | agent.evidence_sufficiency | false | 3 | true | failed | 0.866667 | 0.800000 | 0.489362 | 1.000000 | 0.000000 | 1.000000 |
| A6 | agent.policy_bundle_compatibility | false | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 1.000000 | 0.000000 | 1.000000 |
| A7 | agent.claim_conflict_semantics | false | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 1.000000 | 0.000000 | 1.000000 |
| A8 | agent.citation_binding | false | 3 | true | failed | 1.000000 | 0.766667 | 0.000000 | 1.000000 | 0.000000 | 1.000000 |
| A9 | agent.conversation_state | false | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 0.900000 | 0.000000 | 1.000000 |
| A10 | agent.stale_context_guard | true | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 0.500000 | 0.727273 | 1.000000 |
| A11 | agent.safety_precheck | true | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 1.000000 | 0.000000 | 0.266667 |
| A12 | agent.structured_response_validation | false | 3 | true | failed | 1.000000 | 0.766667 | 0.536585 | 1.000000 | 0.000000 | 1.000000 |
