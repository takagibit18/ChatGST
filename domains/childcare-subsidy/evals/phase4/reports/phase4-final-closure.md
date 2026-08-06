# Phase 4 controlled experiments and validation closure

## Gate

- Phase 4 gate: **blocked_incomplete_experiment_matrix**
- Production candidate gate: **blocked_incomplete_experiment_matrix**
- 阻断：K0 冻结原文缺失；Frozen Test 失败；真实 DeepSeek 失败。
- 生产部署：未授权、未执行。

## 基线身份

- Tag: `phase3.3-frozen-baseline`
- Annotated Tag object: `d4618e5511374334e0538832c9fba4ec2d98b1ed`
- Peeled commit: `f6f033baac1231937de377a9383fdb3117743ff7`
- Dataset manifest SHA-256: `42fb9a4624f16a30cd17e710385e0ba5fd3045914223bdac4f53a1aa8196e3c0`
- K4 hash: `041f724f04893f821bdfdb23cc76d9faa3fd10233920489e5111edafc6cb34ce`
- 基线：Dev Document Recall@5 1.000000、Chunk Recall@5 0.934783、MRR@10 0.822464、nDCG@10 0.728830；Regression 13/13；Conversation/Safety 1.000000。

## K0–K4 与 R1–R6

- K0：冻结原始六文档从未提交，保留 `blocked_missing_frozen_source`，未伪造。
- K1：Document Recall@5 0.804348，行为准确率 0.933333；朴素扩库引入明显召回噪声。
- K2：Document Recall@5 0.891304，行为准确率 0.833333；仅元数据/地区标准化不足以恢复排序质量。
- K3/K4：Document Recall@5 1.000000，MRR@10 0.822464，行为准确率 1.000000；K4 额外保留版本/权威性语义，作为后续唯一知识基线。
- R1 将 MRR@10 提升到 0.862319，但行为准确率降至 0.966667；R2/R3 出现更大质量回退；R4–R6 未超过冻结基线门槛。
- failure attribution 同时覆盖 retrieval/ranking/evidence sufficiency，现有证据不足以证明必须引入 dense 或 reranker。

## Agent ablation

12 个组件均运行 3 次且指纹一致，但没有一个通过硬门槛：A1 Regression 11/13，A2 12/13，A5 5/13；A8 关闭引用绑定后 citation precision/completeness 均为 0；A9 Conversation completion 0.900000；A10 关闭 stale guard 后 completion 0.500000 且 stale leakage 0.727273。地区层级、版本、安全预检和 stale guard 的高风险关闭配置禁止入选。

## 候选

- A: baseline (Phase 3.3 frozen baseline satisfies all hard gates and non-regression thresholds.)
- Candidate A config hash: `430c85531c573a385e43efd78f6eb60f64d49afcca1cc0a6a4586a45101d991d`
- B: 未选择 (No distinct second configuration passed every hard gate and non-regression threshold.)
- Candidate selection commit: `d5f37d3f7282accbe5c842b1ac04e888dc37a8cd`

## Frozen Test

- Annotated Tag object / peeled commit: `3a890fe2b4d0f268c0e68d0702aa054d99b3fdd4` / `459b6113bf86b935c84329cb547a9f6675d61660`
- review status: `machine_validated_unreviewed`；Test SHA-256: `7b04cfc1ae703d5d3055e56b778c2de2341196267b2f53b46b37374550a47e73`
- inventory：14 total = 10 retrieval（8 answer / 2 no-answer）+ 2 conversation + 2 safety。
- 隔离：prompt overlap 0，复用 Gold chunk 0，source-first failure 0。
- 状态 `failed`：behavior 0.300000，answer recall 0.125000，no-answer recall 1.000000，Document/Chunk Recall@5 0.875000 / 0.875000。
- fact coverage 0.125000，citation precision/completeness 0.500000 / 0.125000；Conversation completion 0.500000。
- region/temporal/stale leakage 均为 0，Safety 1.000000；Test 结果生成后未继续调参。

## 真实 DeepSeek

- Provider/model: `deepseek` / `deepseek-v4-flash`；temperature 0；重复 3 次；状态 `failed`。
- 三次一致率 0.333333；Frozen behavior/answer recall/no-answer recall 0.300000 / 0.125000 / 1.000000。
- Regression 10/13，Regression no-answer recall 0.625000；Conversation 0.500000，stale 0，Safety 1.000000。
- 结构化输出成功率每次 0.714286（2/7 失败），回答状态合法率和 citation-evidence binding 均为 1.000000。
- token 总量三次为 3866 / 3845 / 3897（均值 3869.33）；total p95 均值 4205.99 ms；成本为 null，因为 provider 未配置可审计单价；重试/超时聚合计数 provider 未暴露。
- 密钥未写入代码、日志或报告。

## 诚实声明

Phase 3.3 Gold 未修改；Phase 3 scorer 未修改；新增独立 Phase 4 scorer；未降低门槛；Frozen Test 未人审；未使用 Test 数据调参；未根据 Test 增加规则；真实 DeepSeek 已运行且失败；K0 未完成；未合并 PR 或部署生产。
