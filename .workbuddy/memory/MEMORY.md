# 项目长期记忆 (ChatGST / 本体智能体平台)

## 项目定位（2026-07-28 澄清）
- **本体智能体平台（onto-platform）= 团队真实开发中产品，以它为准。**
- 原「北京+河北育儿补贴政策对话助手（ChatGST runtime）」= 用户本地练手项目，现已被本体平台覆盖/取代，不再是主项目。
- 简历与对外描述一律以本体智能体平台为准；runtime 仅作为「本体产出的规则被查询/问答消费」的演示侧。

## 真实上游链路（2026-07-28 用户补充）
- 仓库内代码默认消费 `.md`（半结构化），但 **md 不是官方直发**：由爬虫同事从政府网站抓取 → 经 OCR / vision LLM 解析 PDF、Excel → 清洗为 Markdown。
- 即系统端到端确实处理**非结构化（PDF/Excel）**，只是"非结构化→半结构化"这段在仓库外、归爬虫同事。
- 用户对该上游链路（爬虫+OCR+vision LLM 清洗归一化）**了解较多**，但本职仍是 eval。
- **用户实际贡献（2026-07-28 澄清）**：爬虫未做（同事）；用户**详细做过 PDF/Word 通过多种 OCR 调优方式提升文档质量**。这是可署名"实现/优化"的真实工作，区别于 Mock 的下游 extract。
- 真实管道（多源归一化管道架构.md）分层：爬虫采集层(同事) / 源数据识别 / 三大转换管道(HTML=readability+html2text；MarkItDown=PDF·DOCX·XLSX；Vision=Qwen图片OCR) / 质量分级&元数据推断 / OKF Markdown。用户归属需逐段确认，不能整体写"归一化管道"。

## 架构要点（持续有效）
- 两条线：Runtime（问答，较完整）与 Onto（规则建模，架构在、本体存储多为 Mock）。
- 冲突检测 = 硬规则（确定性，按 name/head_ops/body_ops 比对），非 LLM。LLM 仅在 extract/derive 上游。
- 本地 vs 线上落差：规则提取/推导/引擎本地为 Mock（正则/if-else），线上靠 LLM + 图引擎；pi-coding-agent 运行时未对接。
- 关键路径：packages/ontology (Step2 管道) / packages/onto-bridge (桥+skill加载) / packages/pi-runtime-adapter (运行时) / packages/policy-rag-adapter (BM25)。

## 用户职责与资源（2026-07-28 澄清）
- **用户在本体平台项目中主要负责 EVAL（评测）**，不是建模管道本身。
- 拥有：golden 评测集（约 300 条测试用例，用户基于真实政策语料自建）+ 真实政策语料。
- **golden 当前偏 L3（群众政策问答场景）**，非 L2 经办判定 / L1 建模质量。
- 约束：**全部本地运行，无上线/生产权限**。线上 LLM+图引擎不可达，本地评测只能打本地流水线（Mock 或本地 DeepSeek）。
- 简历与产出应以「评测体系 + golden 集 + 指标基线/调优」为主线，而非声称上线。

## 用户目标
- 大四秋招，把本体智能体平台（以 eval 视角）写成实习项目简历条目，并迭代采集调优数据（指标）。

## v2.1 评测管线约束（2026-08-05）
- **Node 版本（必踩坑）**：项目 `better-sqlite3` 原生绑定编译在 Node 24（NODE_MODULE_VERSION 137）；用 managed node 22 跑 `pnpm eval:v2.1:*` 会报 `ERR_DLOPEN_FAILED`。必须 `PATH="/c/Program Files/nodejs:$PATH" pnpm ...`（系统 node 24.17.0）。package.json engines 写 `>=22.19` 但原生模块锁死 24。
- **gate 体系（两层独立）**：
  - manifest.release_gate（`validate-eval-v2-1.ts` 生成，数据集发布 gate，记录性）：`blocked_pending_human_review` / `human_review_passed`
  - score release_gate（`score-eval-v2-1.ts` 调 `resolveReleaseGate`，运行 gate）：`blocked_quality_gate` / `blocked_pending_human_review` / `ready_for_release`，依赖 `qualityGatePassed && humanReviewComplete`
  - score 现在读 manifest review counts 算 `humanReviewComplete`（2026-08-05 改，原硬编码 false）
- **validate 脚本已改支持 human_approved**（2026-08-05）：第 85/115 行从"必须 pending"放宽为"拒绝 rejected"；manifest.release_gate/review 动态化；全 approved → `human_review_passed`。schema 层（`evalReviewStatusSchema`）早已支持 `pending_review/human_approved/rejected`，reviewer 为 `z.string().nullable()`。
- **score + run 脚本已改联动 human review**（2026-08-05）：`score-eval-v2-1.ts` 的 `humanReviewComplete` 读 manifest review counts；`review_notice` 动态化；`quality_claim_allowed` 联动 `release_gate==="ready_for_release"`（原硬编码 false）。`run-eval-v2-1.ts` 的 raw.release_gate 读 manifest。本地 Mock 下 quality gate 过 + human 过 → `ready_for_release`+`quality_claim_allowed=true`（强声明，对外用需判断 Mock 局限）。`tests/unit/eval-v2-1.test.ts` 已同步更新（27 tests 全过）。
