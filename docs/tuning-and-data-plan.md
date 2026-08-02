# 后续调优与对比数据采集规划

> 全国育儿补贴语料扩容、地域/版本治理和 Eval v2 的专项落地步骤见 [`nationwide-knowledge-eval-upgrade-plan.md`](./nationwide-knowledge-eval-upgrade-plan.md)。

## 1. 目标

后续工作的目标不是单纯把某个指标刷高，而是形成一条可复现、可解释、能支撑工程设计取舍的证据链：

```text
固定评测集和运行环境
  -> 记录当前基线
  -> 每轮只改变一个核心变量
  -> 同时采集质量、性能、成本和安全指标
  -> 在冻结测试集上复验
  -> 保存配置、报告和失败案例
  -> 提炼为简历数字与面试中的设计取舍
```

结合当前项目完成度，建议精力分配为：

| 方向 | 建议占比 | 原因 |
| --- | ---: | --- |
| Agent 检索与 Evidence Pack | 40% | 最容易形成可靠的离线对比，也是当前工程亮点的主线 |
| Agent Runtime | 25% | 可展示工具约束、校验、降级、上下文预算与稳定性设计 |
| 多源文档管道 | 20% | 当前已支持五类格式，但尚缺真实抽取质量与吞吐数据 |
| Agent 后端 | 15% | 用并发、延迟拆分、队列与故障注入证明 MVP 不是页面 Demo |

爬虫和本体平台继续作为外部输入边界，不进入主要调优范围。

## 2. 当前基线与测量缺口

### 2.1 已有基线

当前确定性离线基线为：

- 6 份登记政策材料、54 个语义片段；
- SQLite FTS5/BM25，向量记录为 0；
- 13 个中文案例；
- Retrieval Recall@5 为 0.95，MRR 为 0.80；
- 地区、意图、引用合法性、事实一致性、Schema 和业务校验指标为 1.00；
- 平均 0.77 次模型调用、1.92 次工具调用、约 334 个估算 token；
- 自动化测试为 36 条。

这些结果适合作为回归基线，但还不适合作为最终调优结论。

### 2.2 当前数据不能证明的内容

1. **样本过少**：13 条查询容易因一次命中产生大幅指标波动，也容易被手工同义词表过拟合。
2. **只有 document 级相关性**：当前 `relevant_documents` 不能判断是否命中了真正包含答案的 chunk。
3. **查询类型覆盖不足**：口语、省略、错别字、多约束、跨章节、时间版本、不可回答问题仍然不足。
4. **没有冻结测试集**：开发和汇报使用同一批案例，无法证明改进可以泛化。
5. **多格式只有能力测试**：PDF/DOCX 有真实容器测试，但知识库中的 6 份正式材料仍全部是 Markdown。
6. **本地延迟混合了不同阶段**：当前只有端到端耗时，没有抽取、检索、模型、校验和排队耗时拆分。
7. **模型路径不是线上数据**：`TestModelProvider` 适合回归，但其 token、延迟不能代表真实 DeepSeek。
8. **没有规模曲线**：尚未测试文档数量、chunk 数量、并发量上升后的索引和服务表现。

后续调优必须先补这些测量缺口，再讨论 embedding、reranker 或复杂 Agent 策略。

## 3. 评测数据建设

### 3.1 数据集分层

建议保留现有 13 条为 `regression-v1`，永远不删除，只用于防止基础能力回退。新增四套数据：

| 数据集 | 建议规模 | 用途 |
| --- | ---: | --- |
| `retrieval-v2` | 150–200 条查询 | 检索、切片、Top-K、查询扩展和 rerank 调优 |
| `conversation-v1` | 50–80 条对话脚本 | 两轮澄清、上下文继承、拒答和工具预算 |
| `extraction-v1` | 30–50 份文件 | MD/TXT/HTML/PDF/DOCX 抽取质量、元数据和吞吐 |
| `failure-v1` | 40–60 条故障案例 | 空检索、版本冲突、非法 JSON、超时、队列满、工具失败 |

`retrieval-v2` 按 60%/20%/20% 划分 train、dev、test：

- train：用于补充同义词、观察失败类型；
- dev：用于选择 chunk 参数、Top-K 和排序方案；
- test：冻结，不参与规则编写，只在确定候选方案后运行。

同一个问题的改写必须放在同一 split，避免“原问在 train、同义改写在 test”的泄漏。

### 3.2 检索查询构成

建议 `retrieval-v2` 至少覆盖以下类型：

| 类别 | 比例 | 示例 |
| --- | ---: | --- |
| 单事实查询 | 20% | 金额、年龄、申领人、渠道 |
| 多条件查询 | 15% | 出生年份 + 地区 + 首次申请期限 |
| 跨章节/多证据 | 15% | 资格与材料、迁入与重复申领 |
| 两地比较 | 10% | 北京和河北发放时间、申请方式差异 |
| 时间与版本 | 15% | 某日期当时有效的政策、延期前后规则 |
| 口语、省略、错别字 | 10% | “娃补贴咋领”“河北育儿补帖” |
| 相邻概念干扰 | 5% | 育儿补贴、生育津贴、产假工资 |
| 不可回答/范围外 | 10% | 其他地区、无关许可证、缺失关键地区 |

每条查询至少由一名标注者填写、一名复核者检查。涉及政策日期、金额和资格的 Gold 不能由模型自动批准。

### 3.3 查询标注格式

建议将下一版案例改为 JSONL，每行一条，便于追加、审阅和 Git diff：

```json
{
  "id": "bj-deadline-colloquial-001",
  "split": "test",
  "question": "北京22年出生的娃最晚啥时候第一次申请？",
  "category": "temporal_version",
  "difficulty": "hard",
  "expected_region": "北京市",
  "expected_intent": "deadline",
  "effective_date": "2026-07-23",
  "answerable": true,
  "relevant_documents": ["beijing-deadline-update-2026"],
  "relevant_chunks": ["beijing-deadline-update-2026:..."],
  "required_facts": ["2022年至2024年出生", "2026年12月31日"],
  "forbidden_facts": ["2025年出生同样延期"],
  "expected_status": "answered",
  "source": "human_rewrite",
  "review_status": "approved",
  "reviewer_notes": "已对照官方来源"
}
```

必须新增 `relevant_chunks`、`answerable`、`forbidden_facts`、`effective_date` 和 `split`。这些字段分别用于评价精确片段命中、拒答、错误事实、版本时点和泛化能力。

### 3.4 多源抽取数据

抽取数据分为两类：

1. **等价格式集**：将同一份人工校对的短政策样本制作成 MD/TXT/HTML/PDF/DOCX，用于比较跨格式正文和标题保真度。这些副本只用于 extraction benchmark，不能同时进入正式检索库，避免重复内容污染排名。
2. **真实复杂文件集**：选择带页眉页脚、列表、表格、跨页段落和复杂 Word 样式的官方材料，用于发现真实抽取失败。

每份文件标注：

- 必须出现的正文 anchor；
- 标题及父子层级；
- 表格关键单元格；
- 页码或原始行号；
- 预期元数据；
- 是否为扫描件；
- 是否应拒绝或进入 OCR 队列。

## 4. 指标体系

### 4.1 检索指标

| 指标 | 口径 | 主要回答的问题 |
| --- | --- | --- |
| Document Recall@K | Gold document 是否进入前 K | 找到正确政策了吗 |
| Chunk Recall@K | Gold chunk 是否进入前 K | 找到真正含答案的片段了吗 |
| MRR@10 | 第一个 Gold chunk 的倒数排名 | 正确证据排得是否足够靠前 |
| nDCG@10 | 支持多级相关性 | 多证据排序整体是否合理 |
| No-answer Precision/Recall | 不可回答样本的识别情况 | 是否既不乱答，也不过度拒答 |
| Region leakage rate | 证据地区与查询不一致的比例 | 地区过滤是否可靠 |
| Temporal leakage rate | 引用了未来或过期政策的比例 | 时间过滤是否可靠 |
| Version resolution accuracy | 版本选择与 Gold 是否一致 | 政策更新时是否选对版本 |

不要只报告 Recall@5。至少同时报告 Chunk Recall@5、MRR@10、No-answer F1 和两类 leakage。

### 4.2 回答与 Agent 指标

- Required fact coverage：`required_facts` 覆盖率；
- Forbidden fact rate：是否输出 `forbidden_facts`；
- Grounded claim precision：可核查事实中有 Evidence 支撑的比例；
- Citation precision/completeness：引用是否正确、关键事实是否都有引用；
- Answerable accuracy：该回答时回答、该拒答时拒答；
- Region/intent accuracy；
- Schema pass rate、Business Validator pass rate；
- Repair rate、Fallback rate；
- 平均模型调用、工具调用、输入/输出 token；
- 单次成功回答成本。真实模型成本必须按供应商实际计费单独计算。

`TestModelProvider` 与真实 DeepSeek 报告必须分开：前者是工程回归数据，后者才是模型质量、网络延迟和真实 token 成本数据。

### 4.3 数据管道指标

- Extraction success rate；
- Expected anchor recall；
- Heading hierarchy F1；
- Table cell recall；
- Metadata completeness/accuracy；
- 空正文、乱码、重复文档检出率；
- 增量索引正确率：changed/unchanged/removed 判断；
- 抽取吞吐：documents/s、MB/s；
- 索引吞吐：chunks/s；
- 峰值内存和索引体积。

扫描 PDF 应统计为 `requires_ocr`，不能混入普通 extraction failure，也不能把 OCR 缺失包装成抽取成功率下降。

### 4.4 Runtime 与后端指标

端到端耗时拆成：

```text
queue_wait_ms
normalize_ms
retrieval_ms
version_resolution_ms
model_ms
validation_ms
serialization_ms
total_ms
```

对每项记录 p50、p95、p99。后端还应采集：

- 1/4/8/16 并发下的吞吐和成功率；
- 队列长度、队列拒绝率；
- 超时率和错误码分布；
- WebSocket 断连/重连成功率；
- 进程 RSS、堆内存和事件循环延迟；
- 冷启动与热启动差异；
- 检索库规模从 100、1k、10k 到 50k chunks 时的变化。

本地性能测试必须记录 CPU、内存、Node/pnpm 版本，并预热后重复至少 5 轮。不能把单次最快值作为结果。

## 5. 调优实验矩阵

### 5.1 检索与切片：最高优先级

先完成无需外部模型的实验，再考虑 embedding。

| 编号 | 变量 | 候选值 | 固定项 | 主要指标 |
| --- | --- | --- | --- | --- |
| R0 | 当前基线 | 现有配置 | 全部 | 所有指标 |
| R1 | 查询处理 | raw / normalize / normalize+synonym / +bigram | chunk、K | Chunk Recall、MRR、误召回 |
| R2 | 最大 chunk 长度 | 600 / 1000 / 1400 / 1800 chars | 查询处理、K | Recall、MRR、Evidence 字符数 |
| R3 | 最小合并长度 | 50 / 100 / 200 chars | R2 最优值 | 碎片率、MRR |
| R4 | Top-K | 3 / 5 / 8 | 索引与排序 | Recall、token、回答质量 |
| R5 | 字段权重 | 正文 / 标题+正文 / 标题+章节+正文 | chunk、K | MRR、nDCG |
| R6 | 版本策略 | 不解析 / 当前策略 / 版本组先选后排 | 其他 | 版本准确率、时间泄漏 |
| R7 | 混合召回 | BM25 / dense / BM25+dense RRF | Top-K | Hard set Recall、延迟 |
| R8 | 重排 | 无 / 轻量 reranker Top20→5 | R7 候选 | MRR、回答质量、成本 |

实验顺序必须是 R0→R1→R2/R3→R4→R5/R6。只有当 hard dev set 的 BM25 仍存在明确召回缺口时才进入 R7/R8。这样能证明引入向量和 reranker 是由失败数据驱动，而不是为了堆技术名词。

建议进入冻结 test 的候选必须满足：

- dev Chunk Recall@5 或 MRR 至少一项有稳定提升；
- Region/Temporal leakage 不增加；
- 不可回答识别不退化；
- 本地检索 p95 增幅不超过预设预算；
- 至少 3 次重复运行方向一致。

### 5.2 Evidence Pack 与 Agent Runtime

| 编号 | 变量 | 候选值 | 观察重点 |
| --- | --- | --- | --- |
| A0 | 当前确定性 Runtime | 当前值 | 工程回归基线 |
| A1 | Evidence Top-K | 3 / 5 / 8 | fact coverage、token、干扰证据 |
| A2 | Evidence 字符预算 | 4k / 8k / 12k | groundedness、成本、截断 |
| A3 | Prompt 结构 | 当前 JSON / 精简 contract / facts-first | Schema、事实、token |
| A4 | 输出保护 | 无校验 / Schema / Schema+Business / +repair+fallback | 错误拦截、额外调用、降级率 |
| A5 | 工具预算 | 2 / 4 / 6 | 成功率、无效调用、延迟 |
| A6 | Session | 无状态 / 当前两轮 / 结构化槽位合并 | 澄清完成率、上下文污染 |
| A7 | 真实模型参数 | temperature 0 / 0.1 / 0.3 | 稳定性、事实、结构通过率 |

A4 是最适合形成工程亮点的消融实验。应该主动构造非法 JSON、错误 URL、未检索来源、地区错配、未来政策、超长回答和泄露内部信息等输入，展示 Validator 和 fallback 分别阻止了多少错误，而不只展示正常问题。

真实模型实验每条至少重复 3 次，报告均值和失败区间。不要只保留最好的一次回答。

### 5.3 多源数据管道

| 编号 | 实验 | 对比 |
| --- | --- | --- |
| P0 | 格式保真 | 同一 Gold 内容在 MD/TXT/HTML/PDF/DOCX 的 anchor、标题、表格召回 |
| P1 | 复杂文档 | 普通正文 vs 表格/页眉页脚/跨页段落 |
| P2 | 切片策略 | 固定长度 vs 当前结构感知切片 |
| P3 | 增量索引 | 文件变更、仅元数据变更、抽取器版本变更、删除文件 |
| P4 | 异常输入 | 非 UTF-8、空文件、损坏 PDF/DOCX、超大文件、扫描 PDF |
| P5 | 规模 | 100/1k/10k/50k chunks 的构建耗时、体积、内存 |

P2 应展示的不只是 Recall，还要展示“平均一个 Evidence chunk 包含多少无关字符”。结构感知切片的工程价值通常来自更好的证据密度和可解释的章节路径，而不一定只是 Recall 上升。

### 5.4 后端与稳定性

| 编号 | 实验 | 观测值 |
| --- | --- | --- |
| B0 | 单请求冷/热启动 | total、初始化、首个查询耗时 |
| B1 | 1/4/8/16 并发 | throughput、p95、queue wait、错误率 |
| B2 | 队列溢出 | 是否返回稳定安全错误、恢复时间 |
| B3 | 模型/工具超时 | timeout code、fallback、资源释放 |
| B4 | WebSocket 断连 | 重连、重复提交、Session 状态 |
| B5 | Trace 故障 | 可观测性失败是否影响回答 |
| B6 | 长时间运行 | 30–60 分钟 RSS、句柄数、Session 清理 |

Agent 后端调优优先保证错误可控和资源可释放，再追求吞吐。

## 6. 单次实验规范

每个实验只改变一个核心变量，并记录完整指纹：

```json
{
  "run_id": "R2-chunk-1000-20260801-01",
  "git_commit": "<sha>",
  "dataset_version": "retrieval-v2.1",
  "split": "dev",
  "knowledge_hash": "<sha256>",
  "index_stats": { "documents": 40, "chunks": 860 },
  "runtime": { "node": "24.12.0", "os": "win32-x64" },
  "model": { "provider": "test", "name": "policy-test-model" },
  "config": { "chunk_max_chars": 1000, "top_k": 5 },
  "warmup_runs": 2,
  "measured_runs": 5,
  "metrics": {},
  "failed_case_ids": [],
  "notes": ""
}
```

推荐目录：

```text
domains/childcare-subsidy/evals/v2/
  datasets/
    retrieval.train.jsonl
    retrieval.dev.jsonl
    retrieval.test.jsonl
    conversations.jsonl
    extraction-manifest.jsonl
    failures.jsonl
  runs/
    <run-id>.json
  reports/
    retrieval-comparison.md
    runtime-comparison.md
    pipeline-comparison.md
    backend-comparison.md
```

建议后续实现的脚本：

- `scripts/bench-retrieval.ts`：运行 chunk/document 级检索指标；
- `scripts/bench-ingestion.ts`：抽取正确率、吞吐、索引增量；
- `scripts/bench-runtime.ts`：回答质量、调用预算、repair/fallback；
- `scripts/bench-server.ts`：并发、队列、超时和内存；
- `scripts/compare-runs.ts`：读取两个 run，输出绝对值、delta、回退案例。

所有报告都要保留 per-case 结果。只有汇总指标而没有失败案例，无法支持下一轮调优。

## 7. 执行节奏

### 第 1 阶段：测量系统，约 1 周

1. 将现有 13 条固化为 `regression-v1`；
2. 定义 JSONL v2 schema 和校验器；
3. 标注首批 80 条 retrieval 查询，其中至少 20 条 hard case；
4. 增加 chunk 级 Recall、nDCG、no-answer、leakage 指标；
5. 将运行配置、数据版本和知识哈希写进报告；
6. 重新生成不可变的 R0 基线。

交付物：可信的新基线和失败类型分布。此阶段不做复杂算法调优。

### 第 2 阶段：检索与切片，约 1–2 周

1. 完成 R1–R6；
2. 每组运行 3–5 次并保存 run JSON；
3. 选出一个质量优先配置和一个延迟优先配置；
4. 只将最终两个候选运行在冻结 test；
5. 根据失败数据决定是否进入 hybrid/reranker。

交付物：一张检索对比表、失败案例分类、最终配置选择理由。

### 第 3 阶段：Runtime 与安全消融，约 1 周

1. 扩充 conversation/failure 数据；
2. 完成 A1–A6；
3. 统计 Validator 拦截、repair 成功和 fallback 覆盖；
4. 有真实模型凭据后运行 A7，并与 TestProvider 报告分离。

交付物：Evidence 预算曲线和“无保护→完整保护”的安全消融数据。

### 第 4 阶段：管道与后端，约 1 周

1. 建立 extraction manifest；
2. 完成跨格式保真、异常文件和增量测试；
3. 增加分阶段计时；
4. 完成并发、故障注入和长时间运行测试。

交付物：抽取质量表、规模曲线、并发/稳定性报告。

## 8. 决策和停止规则

为避免无限调参，提前约定：

- dev 提升小于 1 个百分点且 test 无稳定提升，不合入；
- 质量提升若以明显增加时间泄漏、拒答错误或 p95 为代价，保留为实验而非默认配置；
- 同一方向最多连续进行三轮无收益实验，暂停并重新检查失败数据；
- 所有手工规则必须能指向一组真实失败案例；
- test 一旦解封用于最终选择，就创建新版本，不能继续针对旧 test 调参；
- 真实模型实验不与 TestProvider 延迟混报；
- 没有人工审核的 generated golden 不作为绝对真值。

## 9. 最终可形成的工程亮点

完成上述规划后，简历不要只写“优化了 RAG”，而应形成有对照和边界的描述，例如：

```text
在冻结的 N 条中文政策查询集上，对查询扩展、结构感知切片、Top-K、字段权重与版本过滤进行单变量消融；将 Chunk Recall@5 从 X 提升至 Y、MRR@10 从 A 提升至 B，同时保持地区/时间泄漏为 0，检索 p95 控制在 C ms。
```

```text
构建覆盖 MD/TXT/HTML/PDF/DOCX 的抽取基准，通过 anchor、标题层级和表格单元格评测，将跨格式正文召回提升至 X；使用“源文件+元数据+抽取器版本”哈希保证增量索引正确率 Y，并记录 Z docs/s 吞吐。
```

```text
对 Agent 输出保护进行消融和故障注入，Schema、业务校验、一次修复与确定性 fallback 将非法引用/错误结构公开率从 X 降至 Y；在 N 并发下保持成功率 A、p95 B ms，并验证 Trace 故障不阻断回答链路。
```

其中 N/X/Y/A/B/C/Z 必须来自保存的 run 文件和冻结报告，不能预先填写或用单次最好结果代替。

## 10. 下一步最小行动清单

按投入产出比，建议立即依次完成：

1. 新建 v2 JSONL Schema 与数据校验脚本；
2. 将现有案例迁移并增加 `relevant_chunks`；
3. 标注 30 条 hard retrieval case，先暴露当前 BM25 的真实缺口；
4. 在评测脚本加入 Chunk Recall@K、nDCG、No-answer F1、Region/Temporal leakage；
5. 为每次运行保存配置指纹和 per-case 结果；
6. 完成 chunk size、Top-K、查询扩展三组低成本实验；
7. 根据失败类型决定是否实现字段加权；
8. 只有 BM25 仍有召回瓶颈时，再实现 hybrid 和 reranker；
9. 增加 Runtime 分阶段耗时与 failure injection；
10. 最后运行冻结 test，生成可直接放入简历和项目文档的对比表。

这条路线优先把“可测量、可复现、可解释”建立起来，再逐步增加算法复杂度，最符合当前 MVP 完成度和 Agent/AI 应用开发岗位的考察重点。
