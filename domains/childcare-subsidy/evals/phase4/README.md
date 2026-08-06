# Phase 4 controlled experiment protocol

本目录实现 Phase 3.3 冻结基线之上的受控消融、候选筛选、冻结测试和真实模型复验。所有实验都绑定 `phase3.3-frozen-baseline`（peeled commit `f6f033baac1231937de377a9383fdb3117743ff7`），不会修改 Eval v2.1 Gold、calibration、scorer 门槛或 K4 快照。

## 固定定义

- K0：历史本地 6 文档/54 chunks 小库；冻结原文未提交，当前只能验证 manifest，不能伪造重跑。
- K1：47 份 intake 候选直接扩入。
- K2：K1 加元数据和地区标准化。
- K3：K2 加 canonical 去重。
- K4：K3 加版本、有效期和来源权威性策略。
- R1：查询规范化；R2：chunk 最大长度；R3：最终 Top-K；R4：字段权重；R5：地域策略；R6：版本策略。
- Agent A1–A12：依次为 Query Normalizer、Intent classification、Region hierarchy、Version filtering、Evidence Sufficiency、Policy Bundle compatibility、Claim conflict semantics、Citation binding、Conversation state、Stale-context guard、Safety pre-check、Structured response validation。

每个编号只改变一个主要变量。`baseline.json` 是机械比较基准；所有确定性实验运行三次，预测 fingerprint 必须一致。实验索引写入 `.local/phase4-indexes`，不提交 SQLite 文件。

## 顺序

```bash
pnpm phase4:validate
pnpm phase4:run:k0-k4
pnpm phase4:run:r1-r6
pnpm phase4:run:agent-ablation
pnpm phase4:rank-candidates
pnpm phase4:freeze-test
pnpm phase4:run:frozen-test
pnpm phase4:run:real-model
pnpm phase4:report
```

候选配置必须先提交并记录 commit/config hash，之后才允许生成 frozen test。Frozen Test 的自动 source-first 校验只能产生 `machine_validated_unreviewed`，不能写成 `human_approved`。真实 DeepSeek 缺少凭据或网络不可达时必须阻断，禁止以 `TestModelProvider` 冒充。
