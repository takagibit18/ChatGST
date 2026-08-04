# Phase 3.2 — Evidence Sufficiency Structural Repair

日期：2026-08-04  
Base commit：`1fedc5c4f2bd1b3e0f440c3f52c3eb2b24f7bc43`  
分支：`codex/phase3-2-evidence-sufficiency`

## 范围与结论

本阶段把 Evidence Sufficiency 从“拼接 Top 5 文本后统一匹配”改为“逐 claim、逐 hit、逐 span 绑定”，并增加正式行政区祖先关系、有效日期及版本冲突检查。自动 Quality Gate 已通过，但这不是 Phase 3 最终验收：Gold 仍待人工复核，未使用盲测集，也未运行真实 DeepSeek，因此 Release Gate 保持 `blocked_pending_human_review`，不允许正式质量声明。

## 前后指标

| 指标 | Phase 3.1 基线 | Phase 3.2 |
| --- | ---: | ---: |
| Regression behavior | 7/13（0.5385） | 13/13（1.0） |
| Regression no-answer recall | 0.25 | 1.0 |
| Regression failures | 6 | 0 |
| Dev behavior accuracy | 1.0 | 1.0 |
| Dev no-answer recall | 1.0 | 1.0 |
| Dev failures | 0 | 0 |
| Dev required fact coverage | 0.8333 | 0.8 |
| Dev citation precision | 0.4894 | 0.55 |
| Dev citation completeness | 0.8846 | 0.8462 |
| Conversation scenario completion | 1.0 | 1.0 |
| Stale context leakage | 0 | 0 |
| Safety pass rate | 1.0 | 1.0 |
| Safety false refusal | 0 | 0 |
| BM25 threshold | 0 | 0 |
| Retrieval p50 / p95（ms） | 70.1567 / 151.8209 | 59.7540 / 134.4277 |
| Total p50 / p95（ms） | 70.1813 / 151.8513 | 59.7751 / 134.4619 |
| Quality Gate | failed | passed |
| Release Gate | blocked_quality_gate | blocked_pending_human_review |

BM25 阈值 0 是 train-only 校准脚本按既定规则自动选择的结果，不是人工固定值；回答仍同时要求 `Evidence Sufficiency = true` 和 `BM25 score >= threshold`。性能数据来自本机 test-provider 评测，仅用于前后诊断。

## 新增结构

- `RequiredClaim`：claim ID、类型、目标地区、对比地区和细节要求。
- `EvidenceBinding`：claim 与具体 document/chunk/span 的绑定，包含地区、版本和 direct/inherited 支持类型。
- `EvidenceConflict`：过期、未来生效、日期未知和同版本矛盾证据。
- `EvidenceSufficiencyResult`：完整返回 required/supported/missing claims、bindings、conflicts 和 reason codes，不再只返回 boolean。

支持的 claim 类型：`amount`、`eligibility`、`claimant`、`materials`、`channel`、`deadline`、`payment_schedule`、`payment_account`、`migration`、`comparison`、`contact`、`address`、`effective_version`。

## 结构化测试矩阵

- 地区：精确地区、合法祖先、兄弟城市、兄弟区县、外省、子级反向支持、全国一般事实与本地实施细节。
- 跨 hit：地区与金额分离、金额与账户分离、不同地区、不同版本、矛盾内容。
- Claim：单 claim、多 claim 全覆盖、关键词非支持、迁移规则、申请截止日期、政策衔接。
- Comparison：两地与各维度均需完整绑定。
- Version：过期、未来生效、日期未知、同版本矛盾、明确的新旧政策衔接。
- Ranking：仅 Top 5 参与充分性判定；Top 6 有正确证据时标记 `retrieval_miss`，未扩大 Top-K。

结构化失败矩阵在旧实现上为 15 条中 13 条失败；最终矩阵扩展为 19 条并全部通过。

## 原 Regression failure 归因

| Case | 状态 | 主要归因 | 说明 |
| --- | --- | --- | --- |
| `regression-hebei-eligibility` | fixed | region validation / evidence binding | 全国资格材料不再自动支撑河北地方资格 claim。 |
| `regression-hebei-claimant` | fixed | claim extraction / evidence binding | 申领人 claim 必须绑定明确申请人/监护人 span。 |
| `regression-hebei-channel` | fixed | region validation / evidence binding | 全国渠道不能替代河北地方入口。 |
| `regression-regional-comparison` | fixed | claim extraction / evidence binding | 双边、逐维度 claim 均须完整覆盖。 |
| `regression-hebei-migration` | fixed | claim extraction / evidence binding | 仅出现“户籍”不再视为迁移规则。 |
| `regression-benefit-distinction` | fixed | claim extraction / evidence binding | 区分问题不再由分散关键词拼接判定。 |

评测中曾出现 `regression-beijing-deadline` failure mode 变化，以及 `v21-single-08`、`v21-multi-07` 两个 Dev failure；通过通用的截止日期、迁出停发和政策衔接 span 规则修复。最终无 still failing、changed failure mode 或 new regression。

## 验证结果

- `tsc -p tsconfig.json --noEmit`：通过。
- `vitest run tests/unit/eval-v2-1.test.ts --maxWorkers=1 --no-file-parallelism`：通过。
- `vitest run --maxWorkers=1 --no-file-parallelism`：通过。
- `tsx scripts/validate-eval-v2-1.ts`：通过；Retrieval 80、Regression 13、Conversations 20、Safety 30，`circular_labeling=false`。
- `tsx scripts/calibrate-eval-v2-1.ts`：通过；train-only，selected threshold 0，answer recall 0.9268，no-answer recall 0.8333。
- `tsx scripts/run-eval-v2-1.ts`：完整运行三次，prediction fingerprint 均为 `0e083db17c8cb0597a8f1980356ec3343f38f2c935e033406f0864ea31294221`。
- `tsx scripts/score-eval-v2-1.ts`：通过；Quality Gate passed，diagnostic failures 0。

## 诚实声明

- 使用 `model_provider: test`。
- 未运行真实 DeepSeek。
- Gold 保持 `pending_review`，未修改 expected behavior。
- 未使用 blind set。
- 未修改 scorer、Quality Gate 阈值、safety scorer 或 conversation scorer。
- 未修改 chunk size、overlap、Top-K 或字段权重。
- 当前结果不允许正式质量声明；必须完成人工审核和真实模型验证后才能继续发布流程。
