# Phase 3.1 Quality Repair — Scorer/Report 第一轮前后对照

日期：2026-08-04  
范围：仅 scorer、Quality Gate、报告结构及相关测试。未修改 retrieval、evidence sufficiency、calibration、Runtime、chunk size、Top-K 或性能参数。

## 变更前

| 项目 | 结果 |
| --- | --- |
| Regression behavior accuracy | 0.5384615385（7/13） |
| Regression no-answer recall | 0.25 |
| Regression 实际失败 | 6 条 |
| `diagnostic_failures` | `[]` |
| 分组失败列表 | 无 |
| Quality Gate | 无独立状态 |
| Release Gate | `blocked_pending_human_review` |

变更前的 `diagnostic_failures` 只汇总 dev、conversation 和 safety，因此 6 条 regression 失败被漏报。

## 变更后

| 项目 | 结果 |
| --- | --- |
| Regression behavior accuracy | 0.5384615385（7/13，指标未改变） |
| Regression no-answer recall | 0.25（指标未改变） |
| `failure_groups.dev_failures` | 0 条 |
| `failure_groups.regression_failures` | 6 条 |
| `failure_groups.conversation_failures` | 0 条 |
| `failure_groups.safety_failures` | 0 条 |
| `diagnostic_failures` | 6 条，完整包含 regression failures |
| Quality Gate | `failed` |
| Release Gate | `blocked_quality_gate` |

Quality Gate 失败原因：

- `regression_behavior_not_13_of_13`
- `regression_no_answer_recall_below_1`
- `regression_failures_present`

暴露出的 regression failures：

1. `regression-hebei-eligibility`
2. `regression-hebei-claimant`
3. `regression-hebei-channel`
4. `regression-regional-comparison`
5. `regression-hebei-migration`
6. `regression-benefit-distinction`

## 门禁规则

Quality Gate 仅在以下条件全部成立时通过：

- Regression behavior accuracy = 1.0，即 13/13；
- Regression no-answer recall = 1.0；
- Regression failure count = 0。

Quality Gate 未通过时，评分报告的 `release_gate` 必须为 `blocked_quality_gate`。自动质量门禁通过后，由于 Gold 仍全部为 `pending_review`，release gate 仍保持 `blocked_pending_human_review`，不得发布质量声明。

## 验证

- `tsx scripts/score-eval-v2-1.ts`：通过，输出 6 条诊断失败和 failed Quality Gate。
- `tsc -p tsconfig.json --noEmit`：通过。
- `vitest run tests/unit/eval-v2-1.test.ts --maxWorkers=1 --no-file-parallelism`：13/13 通过。
- 新增合成回归测试：只要存在一条 regression expected/predicted 不一致，分组诊断和总诊断均非空，Quality Gate 必须失败。

## 结论

本轮没有改善或宣称改善模型质量，只修复了报告真实性和自动阻断能力。当前 Quality Gate 正确保持失败；下一轮才能独立开始 evidence sufficiency 重构，并应以这份报告作为不变的比较基线。
