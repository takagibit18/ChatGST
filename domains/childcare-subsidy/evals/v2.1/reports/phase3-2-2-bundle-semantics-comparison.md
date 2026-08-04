# Phase 3.2.2 — Bundle Semantics and Over-refusal Repair

## 1. 基线与范围

- Base commit：`1a0a8f16c1d3252f84513d54f180b180750a17ed`
- 分支：`codex/phase3-2-2-bundle-semantics`
- Phase 3.2.1 基线：Train answer recall `24/41 = 0.585366`，Train no-answer recall `1.0`，BM25 threshold `0`，Regression behavior `13/13`，Dev/Regression/Conversation/Safety failures 均为 `0`，Quality Gate passed，Release Gate `blocked_pending_human_review`。
- 本阶段只修复 evidence bundle、claim fact、claim extraction/support span 与 answer-recall gate；未执行真实模型、blind set、Gold human review、Top-K/chunk/BM25 权重优化。

## 2. Phase 3.2.1 Train false refusals

基线共有 17 个 expected=`answer`、predicted=`no_answer` 的案例。

| 归因 | 案例 | 基线 reason | 修复结果 |
|---|---|---|---|
| claim extraction gap | `v21-single-01`, `v21-single-04`, `v21-single-05`, `v21-temporal-03`, `v21-temporal-04`, `v21-temporal-05`, `v21-typo-01`, `v21-typo-02`, `v21-typo-05`, `v21-para-01a`, `v21-para-01b`, `v21-para-02a`, `v21-para-02b` | `no_required_claims` | 12/13 恢复；通用金额、渠道、发放时点、首次/续领时限、生效日期及口语/错别字表达得到覆盖 |
| claim extraction gap | `v21-cross-region-05` | `missing_claim`, `region_mismatch` | 恢复；“发放最晚时间”不再被重复抽取为申请 deadline |
| support span gap | `v21-cross-level-05` | `missing_claim` | 仍保守拒答；Top 5 span 未完整覆盖目标办理时限 |
| retrieval miss | `v21-multi-02`, `v21-multi-04` | `missing_claim`, `region_mismatch`, `retrieval_miss` | 仍保守拒答；不调整 Top-K 或检索权重 |

最终仍有 5 个 Train false refusals：

- `v21-cross-level-05`：`missing_claim`，deadline support span gap。
- `v21-cross-region-06`：`missing_claim`, `retrieval_miss`，缺 governance。
- `v21-multi-02`：`missing_claim`, `region_mismatch`, `retrieval_miss`，缺 deadline。
- `v21-multi-04`：`missing_claim`, `region_mismatch`, `retrieval_miss`，缺 channel。
- `v21-multi-05`：`missing_claim`, `region_mismatch`, `retrieval_miss`，缺 deadline。

这些剩余项没有通过 case ID、完整题目、降低门槛或修改 Gold 放行；后续应优先改善知识 metadata/support span，再用 blind negative set 判断是否需要检索调优。

## 3. Policy Relation Graph

每个地区独立构造 typed relation graph。节点为已选择文档，边保留：

- `same_document`
- 相同且非空/非 `unknown` 的 `same_version_group`
- 相同且非空的 `same_policy_number`
- `implements`（来自 `implementation_of`）
- `parent_policy`（来自 `parent_policy_id`）
- `supersedes`（只保留版本语义，不作为普通兼容边）

候选组合必须覆盖该地区的全部 required claims，且所有 selected documents 在允许的关系边上形成单一连通分量。部分连通、两个孤立子图、多文档 metadata 全未知分别产生 `disconnected_policy_bundle`、`cross_claim_version_conflict` 或 `unknown_policy_compatibility`；单条 A→B 关系不能再放行孤立的 C。Comparison 仍按地区分别验证，不要求北京与河北共享 policy number/version group。

## 4. `supersedes` 规则

- 查询日在 successor 生效后：过滤 predecessor，只选择 active successor。
- 查询日在 successor 生效前：future successor 不阻断仍有效的 predecessor。
- 只有问题明确包含政策变化、沿革、新旧、衔接等历史演变语义时，才允许沿 `supersedes` 观察跨版本关系。
- 普通现行答案不得同时混用 successor 与 superseded document；无法安全选择时使用 `mixed_policy_lineage` / `superseded_evidence` 语义保守处理。

## 5. Claim value mode 与 qualifiers

| Mode | Claims | 合并/冲突规则 |
|---|---|---|
| scalar | `amount`, `deadline`, `effective_version`, `payment_account` | 仅在 region、effective period、age/birth range、application type、payment batch、population 等 scope 相同且 value 不同时冲突 |
| set | `materials`, `channel`, `eligibility`, `claimant`, `contact`, `address`, `payment_schedule` | 默认集合并集；不同材料、渠道、资格条件、批次可并存；明确 `仅可/唯一/不得` 且 scope 相同时才冲突 |
| rule | `migration`, `governance`, `comparison` | 比较条件、方向、polarity 与结果；迁入重新申请和迁出停止发放不冲突，迁出继续与迁出停止冲突 |

规范化 facts 保留 `region`、`effective_from/to`、age range、birth range、first application/renewal、migration direction、payment batch、policy population、policy transition 等 qualifiers。无法证明相同 scope 时不以“字符串不同”作为冲突条件。显式“原政策调整为新政策”的 transition span 不再被误判为两个同时生效的金额。

## 6. 新增测试矩阵

- Bundle graph：部分连通、完整国家→省→市链、两个孤立子图、unknown metadata、跨地区 comparison 独立验证。
- Version lineage：active successor、historical predecessor、显式政策衔接、多版本事实冲突。
- Complementary facts：eligibility、channel、materials、payment schedule 集合合并；分年龄段 amount qualifiers。
- True conflicts：同 scope deadline/amount、排他 channel、同 batch 排他 schedule、同方向 migration 相反结果。
- Over-refusal recovery：金额口语/错别字、线上/线下渠道、审核后发放时点、首次/续领年度、生效日期；保留 `no_required_claims` 反例。
- Quality gate：`calibration_answer_recall < 0.8` 以 `answer_recall_below_required` 阻断。

专项测试结果：structural `58/58`，eval v2.1 unit `27/27`。全量 Vitest：14 files passed、1 skipped；145 tests passed、16 skipped。

## 7. 前后指标

| 指标 | Phase 3.2.1 | Phase 3.2.2 |
|---|---:|---:|
| Train answer recall | `24/41 = 0.585366` | `36/41 = 0.878049` |
| Train no-answer recall | `1.0` | `1.0` |
| Selected BM25 threshold | `0` | `0` |
| Eligible calibration candidates | `48` | `48` |
| Regression behavior | `13/13` | `13/13` |
| Regression no-answer recall | `1.0` | `1.0` |
| Dev failures | `0` | `0` |
| Regression failures | `0` | `0` |
| Conversation failures | `0` | `0` |
| Safety failures | `0` | `0` |
| Stale context leakage | `0` | `0` |
| Dev behavior accuracy | `1.0` | `1.0` |
| Dev no-answer recall | `1.0` | `1.0` |

Calibration constraints passed；`minimum_no_answer_recall` 保持 `1.0`。没有强制 threshold > 0。

## 8. 三次完整运行确定性

三个完整 Eval 的 timing-excluded prediction fingerprint 完全一致：

1. `e0042f254cd069005c27acc9d28c2fbdcb95e5978dbe3144be0680d096140326`
2. `e0042f254cd069005c27acc9d28c2fbdcb95e5978dbe3144be0680d096140326`
3. `e0042f254cd069005c27acc9d28c2fbdcb95e5978dbe3144be0680d096140326`

## 9. Gates

- Calibration constraints：passed。
- Quality Gate：passed；`calibration_answer_recall.actual = 0.878049`，`required = 0.8`。
- Release Gate：`blocked_pending_human_review`。
- `quality_claim_allowed = false`；所有 Gold 仍为 `pending_review`。

## 10. 变更声明

- 修改 Gold expected behavior：**否**。
- 修改 Train/Dev/Regression/Safety/Conversation Gold：**否**。
- 修改 scorer：**是**，仅把 calibration 产出的 Train answer recall 接入 Quality Gate；未修改 fact scorer、标签、失败判定或掩盖失败。
- 降低 no-answer / regression / failure gate：**否**。
- 调整 Top-K、chunk size、chunk overlap、BM25 字段权重：**否**。
- 强制 BM25 threshold 为正：**否**。
- 加入 case ID 或完整题目专用规则：**否**。
- 运行真实 DeepSeek：**否**。
- 使用 blind set：**否**。
- 完成 Gold human review：**否**。

## 11. 剩余风险与下一步

- Train 仍有 5 个 support-span/retrieval-miss 型保守拒答；当前指标达到阶段门槛，但不构成泛化质量证明。
- Gold 尚未完成业务责任人审核，不能发布真实模型质量声明。
- 下一阶段应先补强 claim schema/知识 metadata 与支持 span，可再使用独立 blind negative set 评估 threshold、Top-K 或 chunk 调优；不得用现有 Train/Dev/Regression 反向修改 Gold。
