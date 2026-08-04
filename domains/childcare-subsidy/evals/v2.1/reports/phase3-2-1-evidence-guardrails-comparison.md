# Phase 3.2.1 Evidence Guardrails P1 对照报告

- Base commit：`7081c268c3b4efb46acec1ab94bf4b6be7dff0fb`
- 分支：`codex/phase3-2-1-evidence-guardrails`
- 范围：通用地区对比、空 claim fail-closed、跨 claim policy bundle、BM25 calibration 约束及必要 gate。

## 缺陷复现与修复

1. `上海和浙江……有什么区别` 等问题虽能解析两个地区，但旧 intent 仍硬编码依赖北京和河北。现按“至少两个明确地区 + 对比语义”统一设置 `intent=comparison`、`region=对比`、`regionCode=null`。
2. `requiredClaims=[]` 过去会因 missing/conflicts 均为空而判为充分。现直接返回 `no_required_claims`，不生成 sources，不进入模型生成。
3. 非法 comparison scope（少于两个地区或地区 code 重复）直接返回 `invalid_comparison_scope`，并附 `missing_comparison_regions` 或 `duplicate_comparison_regions`。
4. 多 claim 证据按目标地区分别构造 `EvidenceBundle`。同文档、相同非空 `version_group`、相同 `policy_number`，或存在显式 `implementation_of` / `parent_policy_id` / `supersedes` 关系时可兼容；多文档 metadata 均未知时 fail closed；无关系的不同版本返回 `incompatible_policy_bundle` 与 `cross_claim_version_conflict`。
5. 地区约束先于 bundle 兼容约束，禁止跨地区补 claim；comparison 的不同地区不要求相同 version group，只要求各自 bundle 完整且内部兼容。
6. 冲突标准化扩展到 `deadline`、`payment_schedule`、`channel`、`migration`、`eligibility`。同一有效政策体系出现不同明确值时返回 `contradictory_evidence`。
7. Calibration 增加 `minimum_no_answer_recall=1` 硬约束；合格候选依次按 answer recall、macro recall、no-answer F1、最低 threshold 排序。无合格候选时 `selected=null`、`calibration_status=failed`，runner 报错，Quality Gate 返回 `calibration_constraints_not_met`。

## 新增 reason codes

`no_required_claims`、`invalid_comparison_scope`、`missing_comparison_regions`、`duplicate_comparison_regions`、`unsupported_claim`、`incompatible_policy_bundle`、`cross_claim_version_conflict`、`unknown_policy_compatibility`。

## 测试矩阵

| 场景 | 结果 |
| --- | --- |
| 上海/浙江、广东/四川、江苏/安徽、北京/河北通用对比 | 全部识别为 comparison，两个地区 claims 非空 |
| comparison 0/1 个地区、重复地区 code | fail closed |
| overview 无可识别 claim | `no_required_claims`，fail closed |
| 不同无关系 version group 的金额+渠道 | `incompatible_policy_bundle` |
| 同文档的金额+渠道 | sufficient |
| 国家政策+显式地方实施关系 | sufficient |
| 多文档且兼容 metadata 均未知 | `unknown_policy_compatibility` |
| 北京、河北使用不同 version group 比较 | 各自 bundle 兼容后 sufficient |
| deadline/payment schedule/channel/migration 明确值冲突 | `contradictory_evidence` |
| threshold 0 的 no-answer recall=0.83、threshold 6=1.0（合成候选） | 仅 threshold 6 合格 |
| 无合格 calibration 候选 | calibration failed，Quality/Release gate blocked |

## 前后指标

| 指标 | Phase 3.2 基线 | Phase 3.2.1 |
| --- | ---: | ---: |
| Train answer recall | 0.926829 | 0.585366 |
| Train no-answer recall | 0.833333 | 1.000000 |
| 最终 BM25 threshold | 0 | 0 |
| Dev behavior accuracy | 1.000000 | 1.000000 |
| Dev required fact coverage | 0.800000 | 0.800000 |
| Citation precision | 0.550000 | 0.550000 |
| Citation completeness | 0.846154 | 0.846154 |
| Regression behavior | 13/13 | 13/13 |
| Dev failures | 0 | 0 |
| Conversation failures | 0 | 0 |
| Safety failures | 0 | 0 |
| Stale context leakage | 0 | 0 |
| Quality Gate | passed | passed |
| Release Gate | blocked_pending_human_review | blocked_pending_human_review |

Calibration 有 48 个候选满足 no-answer recall=1.0。按规定排序后 threshold 仍为 0：结构化 Evidence Sufficiency 已拒绝全部 train no-answer 样例，因此 threshold 0 也满足硬约束且 answer recall 最高。未手工指定正数。相对基线，train answer recall 下降 0.341463；这是 fail-closed 护栏的明确代价，未隐藏或以降低 gate 抵消。

## 验证命令与结果

- `tsc -p tsconfig.json --noEmit`：通过。
- `vitest run tests/unit/evidence-sufficiency-structural.test.ts --maxWorkers=1 --no-file-parallelism`：通过。
- `vitest run tests/unit/eval-v2-1.test.ts --maxWorkers=1 --no-file-parallelism`：通过。
- `vitest run --maxWorkers=1 --no-file-parallelism`：15 files、138 tests 全部通过。
- `tsx scripts/validate-eval-v2-1.ts`：valid，retrieval 80、regression 13、conversations 20、safety 30。
- `tsx scripts/calibrate-eval-v2-1.ts`：passed，no-answer recall floor=1.0。
- `tsx scripts/run-eval-v2-1.ts`：最终连续运行三次。
- `tsx scripts/score-eval-v2-1.ts`：Quality Gate passed；Release Gate blocked_pending_human_review。
- 三次 prediction fingerprint 均为 `4d95fc88ac9160637ba2c5c65bbf19f78334db1f3eda575d47d5cc3f547f1a21`。

## 冻结项声明

- 未修改 Gold expected behavior、retrieval train/dev/regression 问题或标签、Safety Gold、Conversation Gold。
- 未修改 scorer 指标口径，未降低现有 Quality Gate 门槛，未删除失败测试。
- 未调整 Top-K、chunk size、overlap 或 BM25 字段权重。
- 未运行真实 DeepSeek，未使用 blind set，未开展 Gold human review。
- 当前报告仍为 provisional；Release Gate 因 Gold 人审未完成而阻断。

## 剩余风险

1. 实际 calibration 仍选择 threshold 0，虽然满足新增 no-answer recall=1.0 硬约束，但 BM25 分数门禁本身未形成正阈值拦截；后续只能通过新的、经批准的 calibration 规则或 blind set 评估处理，不在本阶段手工调阈值。
2. Policy 关系 metadata 在现有知识库中主要依赖 `version_group` 与 `policy_number`；`implementation_of` 等显式关系覆盖不足时，多文档 claim 会保守拒答。
3. 真实模型质量、blind set 泛化和 Gold 人审仍未完成，不能发布最终质量声明。
