# Phase 3.3 — Human-reviewed Eval Freeze & Phase 4 Entry Closure

## 1. Scope

本阶段仅完成人工审核闭环、Gate 分层、产物重生成、指纹验证、确定性重跑、文档一致性与 Phase 4 基线冻结。未修改 Gold 内容、检索参数、Runtime 策略、scorer 指标定义、K4 内容或 TestModelProvider 行为。

## 2. Human review result

- Retrieval: 80/80 approved
- Regression: 13/13 approved
- Conversations: 20/20 approved
- Safety: 30/30 approved
- Total: 143/143 approved
- Pending: 0
- Rejected: 0
- Reviewer: xinyuxing

审核权威来源为 `annotations/*.jsonl`；materialized datasets 与 manifest 已经程序化一致性校验。

## 3. Frozen inputs

| Input | Frozen value |
|---|---|
| Base Git commit | `c283225b06477d97a3d477103360e5db3e04488c` |
| K4 snapshot hash | `041f724f04893f821bdfdb23cc76d9faa3fd10233920489e5111edafc6cb34ce` |
| Dataset manifest SHA-256 | `42fb9a4624f16a30cd17e710385e0ba5fd3045914223bdac4f53a1aa8196e3c0` |
| Train SHA-256 | `14b8b52ccc2da8b8cfb7559653afa985a4d659226c0663943cb2cb44db94de5b` |
| Dev SHA-256 | `fd27ec57ffd9d41fafbc7c18dbc7ea5b942e38abb9d409c641fa28ed5387c254` |
| Regression SHA-256 | `1fee04ddf25baf601b735c1db52e942dd3d91205a1a5abfee20b3a6390202502` |
| Conversation SHA-256 | `744d84cc0d2f9bd719fe24e1e61695c1cbe728adaa7cc12fb16d704bb3ed3c85` |
| Safety SHA-256 | `12bb23d00031e9cb107708ed6f878cc228f2a86d32d6b75aedccf55006c14c8a` |
| Calibration SHA-256 | `8dd477b3b33682e6945b174aaef636243af7b75aaa990a763841574886b83660` |
| Runtime config | `{"threshold":0,"calibration_status":"passed","warmups":2,"measured":5,"model_provider":"test","required_fact_match":"normalized_bigram_recall>=0.45"}` |
| Model provider | `test` |

`base_commit` avoids a commit self-reference. After committing, the recommended annotated tag command is `git tag -a phase3.3-frozen-baseline -m "Phase 3.3 frozen baseline"`; this report does not claim that the tag has already been created.

## 4. Reproducibility

```bash
pnpm eval:v2.1:prepare
pnpm eval:v2.1:validate
pnpm eval:v2.1:calibrate
pnpm eval:v2.1
pnpm eval:v2.1:determinism
pnpm test
pnpm build:runtime
```

`eval:v2.1:determinism` executes three independent runner+scorer full runs, collects each prediction fingerprint, writes the verification record only if all three agree, and then performs a final runner+scorer consistency run.

## 5. Current metrics

这些指标从重新生成的 `phase3-3-frozen-baseline.json` 自动读取，只描述确定性的 TestModelProvider Phase 3 基线，不代表真实模型或 frozen test 泛化质量。

| Metric | Value |
|---|---:|
| Calibration answer recall | 0.878049 |
| Regression accuracy | 1.000000 |
| Regression no-answer recall | 1.000000 |
| Dev Document Recall@5 | 1.000000 |
| Dev Chunk Recall@5 | 0.934783 |
| Dev MRR@10 | 0.822464 |
| Dev nDCG@10 | 0.728830 |
| Dev required fact coverage | 0.800000 |
| Dev citation precision | 0.550000 |
| Dev citation completeness | 0.846154 |
| Conversation completion | 1.000000 |
| Stale context leakage | 0.000000 |
| Safety pass rate | 1.000000 |
| Determinism | stable (3/3 full runs) |

## 6. Gate result

- Dataset review gate: `human_review_passed`
- Automated quality gate: `passed`
- Artifact consistency gate: `passed`
- Determinism gate: `passed`
- Phase 4 entry gate: `ready_for_phase4`
- Production release gate: `blocked_pending_phase4`
- Frozen test status: `not_frozen`
- Real model evaluation: `not_run`

## 7. Known limitations

- 当前使用 TestModelProvider；结果不能直接作为生产效果结论。
- Dev 样本规模有限，当前 calibration threshold 为 0。
- Frozen test 尚未建立或执行。
- K0–K4 对照消融、R1–R6 检索实验和 Agent ablation 尚未完成。
- 真实 DeepSeek 评测尚未运行。
- 当前环境以 Node 24 验证；切换 Node 主版本时必须重新安装或 rebuild `better-sqlite3`，避免原生 ABI 不匹配。

## 8. Phase 4 entry contract

1. Gold v2.1 自本冻结基线起不得再根据 Dev case 修改。
2. 每个实验只改变一个明确变量。
3. 每个 run 保存 commit、config、dataset hash 和结果。
4. 每项候选至少重复运行三次。
5. Test 只允许最终两个候选配置执行。
6. 不允许根据 Test 结果继续调参。
7. 是否引入 dense/reranker 由 BM25 失败分布决定。
8. Production release 必须等待 Phase 4、frozen test 与真实模型评测完成。
