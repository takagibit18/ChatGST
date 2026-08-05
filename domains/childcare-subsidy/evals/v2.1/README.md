# Eval v2.1 — Phase 3.3 frozen baseline

Eval v2.1 的 143 条 Gold 已全部完成人工审核（Retrieval 80、Regression 13、Conversations 20、Safety 30）：`human_approved=143`、`pending_review=0`、`rejected=0`。`annotations/*.jsonl` 是审核状态的权威来源，`datasets/*.jsonl` 是由其严格物化的运行输入；manifest 和 scorer 会同时验证两者一致性。

Current Gold is claim-first: every answerable case records an exact K4 quote, source line range, chunk character range and complete atomic claims. `required_facts` is derived exactly from those claims; fixed-prefix extraction is forbidden.

```bash
pnpm eval:v2.1:review-checklist
pnpm eval:v2.1:build-gold
pnpm eval:v2.1:validate
pnpm eval:v2.1:calibrate
pnpm eval:v2.1
pnpm eval:v2.1:determinism
```

当前 Gate：Dataset Review `human_review_passed`；自动质量、产物一致性和确定性均通过；Phase 4 Entry `ready_for_phase4`；Production Release `blocked_pending_phase4`；frozen test `not_frozen`。

Phase 4 开始前 Gold v2.1 即告冻结，不得再根据 Dev 案例修改。当前指标来自确定性的 `TestModelProvider`，只允许描述 Phase 3 技术基线，不代表真实 DeepSeek 生成质量、frozen test 泛化能力或生产可发布性。Phase 4 尚需完成受控消融、候选选择、frozen test 和真实模型评测。
