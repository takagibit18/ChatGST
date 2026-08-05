# 全国育儿补贴知识库扩容与 Eval 升级规划

## 1. 目标与边界

本规划将两项工作合并为一条可复现的工程主线：

```text
47 份全国候选政策材料
  -> 原文快照与数据审计
  -> 元数据标准化、地域建模、近重复与版本治理
  -> 分阶段构建知识库
  -> 建设带证据绑定的 Eval v2
  -> 对扩库、治理、检索和 Agent 逐层消融
  -> 输出质量、性能、安全和成本对比
```

最终不是证明“文档越多越好”，而是回答四个工程问题：

1. 知识库从北京/河北扩到全国后，召回是否提高、噪声和延迟增加多少；
2. 地域过滤、权威性排序、语义去重和版本治理分别解决了什么问题；
3. 检索改进能否稳定传导到回答事实性、引用质量和办事成功率；
4. 所有结论能否由冻结数据集、运行指纹和逐案例结果复现。

范围继续聚焦数据管道、Agent 检索、Runtime 和后端评测。爬虫、本体构建和完整 OCR 仍作为外部边界，不作为本轮主线。

本规划是 [`tuning-and-data-plan.md`](./tuning-and-data-plan.md) 的育儿补贴全国扩库专项实施方案；通用调优原则仍以原规划为准。

## 2. 当前基线与候选语料盘点

### 2.1 当前仓库基线

- 正式知识库：6 份登记材料、54 个语义 chunk；
- 检索：SQLite FTS5/BM25，暂未建立向量索引；
- Eval：13 个中文案例，以 document 级相关性为主；
- 已记录基线：Retrieval Recall@5 = 0.95、MRR = 0.80；
- 当前地区范围主要是北京市、河北省和全国政策；
- Markdown 加载器已经兼容 `resource -> source_url` 和 `timestamp -> publish_date`；
- 校验器仍将支持地区硬编码为“北京市、河北省、全国”。

13 条案例继续冻结为 `regression-v1`，只承担兼容性回归，不作为全国检索效果结论。

### 2.2 全国候选语料

本次收到的 `育儿补贴MD` 目录初步盘点结果：

| 项目 | 初步结果 |
| --- | ---: |
| Markdown 文件 | 47 |
| 总体积 | 约 375 KB |
| 政策规章 | 31 |
| 官方解读 | 8 |
| 办事指南 | 8 |
| 省级行政区覆盖 | 约 24/31 |
| 缺少的省级行政区 | 山西、江苏、安徽、贵州、甘肃、青海、宁夏 |
| 包含来源 URL | 47/47 |
| 包含日期字段 | 47/47 |

该目录适合作为全国扩库的候选输入，但不能直接视为已审核知识库或 Eval Gold。初步发现的问题包括：

- `status` 使用 `verified/issue`，与系统的 `effective/expired/draft` 不兼容；
- 普遍缺失 `authority`、`effective_from`、`effective_to`；
- 地区值混用省、市、区、机构名和页面栏目名；
- 文件名或标题存在“地级以上市”“贴申领专区”“政府信息公开”等截断或误抽取；
- 多个不同 URL 实际转载同一国家级规范，文件内容高度相似；
- 文件所在地区、发布网站地区和政策适用地区不一定相同；
- `verified` 只能表示采集状态，不能证明当前有效或事实正确。

因此应将这 47 份文件定位为 `candidate snapshot`，经过治理并人工抽检后才能进入正式知识库。

## 3. 目标数据分层与目录

建议建立不可变原文、治理元数据、正式语料和 Eval 四层：

```text
knowledge/
  intake/
    nationwide-childcare/
      <47 份候选 Markdown，按字节保留且暂不索引>
  raw/
    <通过准入审核的正式原文>
  metadata/
    overrides.json
    region-registry.json
    duplicate-groups.json
    nationwide-childcare-source-audit.jsonl
  curated/
    <仅在确有必要时保存人工整理文本，不覆盖 raw>

domains/childcare-subsidy/evals/v2/
  datasets/
    retrieval.train.jsonl
    retrieval.dev.jsonl
    retrieval.test.jsonl
    conversations.jsonl
    safety.jsonl
    extraction-manifest.jsonl
  runs/
    <run-id>.json
  reports/
    knowledge-audit.md
    corpus-ablation.md
    retrieval-comparison.md
    agent-comparison.md
    judge-calibration.md
```

原则：

1. `intake` 保留未准入候选快照，`raw` 只保存通过审核的正式原文；两者均不改写并保留 SHA-256；
2. 纠正标题、地区、效力状态等优先写入 `overrides.json`；
3. 重复转载不删除原始文件，而是在 `duplicate-groups.json` 中建立聚类和 canonical 文档；
4. Eval 只引用稳定的 `document_id/chunk_id`，不引用易变文件名；
5. 正式构建必须生成知识库快照哈希，所有 run 绑定该哈希。

## 4. 扩库治理方案

### 4.1 元数据标准

保留当前 `region` 字段以兼容已有接口，并新增可选的层级字段：

```json
{
  "document_id": "beijing-childcare-rules-2025",
  "title": "北京市育儿补贴制度实施细则（试行）",
  "region": "北京市",
  "jurisdiction_level": "provincial",
  "province": "北京市",
  "city": null,
  "district": null,
  "jurisdiction_path": ["全国", "北京市"],
  "authority": "北京市卫生健康委员会、北京市财政局",
  "publish_date": "2025-09-24",
  "effective_from": "2025-09-24",
  "effective_to": null,
  "status": "effective",
  "source_url": "https://example.gov.cn/official-page",
  "source_domain": "example.gov.cn",
  "document_kind": "policy_rule",
  "policy_type": "childcare-subsidy",
  "policy_number": null,
  "version_group": "beijing-childcare-rules",
  "version_priority": 10,
  "canonical_document_id": "beijing-childcare-rules-2025",
  "review_status": "approved"
}
```

其中必须区分三个概念：

- `publisher_region`：页面发布机构所在地；
- `applicable_region`：政策真正适用地区，即检索过滤依据；
- `document_kind`：政策原文、实施细则、官方解读、办事指南或转载。

例如安徽网站转载国家规范时，适用地区应是“全国”，不能因为页面来自安徽就标为安徽政策。

### 4.2 地区标准化

新增共享 `region-registry.json`，不要继续在校验脚本中维护地区正则。至少覆盖：

- 全国；
- 31 个省级行政区的标准名和简称；
- 本批语料涉及的地市、区县及其父级；
- “广东/广东省”“杭州/杭州市”等别名；
- 无法确定地区的隔离状态 `unknown`，禁止进入正式索引。

检索过滤规则：

1. 用户明确到区县：允许召回区县、所属市、省和全国材料；
2. 用户明确到城市：允许召回城市、省和全国材料；
3. 用户只明确省份：允许召回省和全国材料，不默认召回任意地市细则；
4. 用户未提供地区且问题依赖地方规则：Agent 应澄清，而不是任选地区回答；
5. 全国统一事实可以由国家材料回答，但地方办理入口必须使用地方材料。

### 4.3 权威性、重复和版本治理

建立两级去重：

1. **确定性去重**：规范化正文后 SHA-256、政策文号、标题和发布日期；
2. **近重复聚类**：对正文指纹或向量相似度进行聚类，人工复核高相似候选。

每个重复组保留全部来源记录，但只选择一个 canonical 文档参与常规召回。推荐优先级：

```text
国家/地方政府原始发布页
  > 对应主管部门原始发布页
  > 官方政府公报
  > 其他官方转载
  > 无法核验的二次转载
```

版本决策顺序：

```text
适用地区匹配
  -> effective_date 落在有效区间
  -> status = effective
  -> 同 version_group 中 version_priority 更高
  -> 原始发布机构优先
  -> 发布时间更新
```

禁止只按发布日期选择政策；较新的新闻解读不能自动覆盖仍有效的实施细则。

### 4.4 数据准入门禁

单文档进入正式索引前必须满足：

- UTF-8 且无明显乱码；
- `document_id` 唯一；
- 标题不为空且不是页面栏目占位词；
- `applicable_region` 能映射到地区注册表；
- 来源为可解析的 HTTP(S) URL；
- 发布机构和文档类型已标注；
- 发布日期已核对，生效日期未知时有显式说明；
- 状态为 `effective/expired/draft` 之一；
- 正文非空且能产生语义 chunk；
- 重复组和版本组关系已确定；
- `review_status = approved` 才能进入正式评测快照。

建议人工双检所有金额、年龄、申请期限、申领资格和办理入口字段；其他文档至少抽检标题、地区、来源和日期。

## 5. Eval v2 数据集设计

### 5.1 数据集分层

| 数据集 | 目标规模 | 作用 |
| --- | ---: | --- |
| `regression-v1` | 现有 13 条 | 保证旧能力和接口不回退 |
| `retrieval-v2` | 180 条 | 全国地域、版本、去重与检索调优 |
| `conversations-v1` | 20 个场景，约 60–100 轮 | 澄清、状态继承、纠错和恢复 |
| `safety-v1` | 30 条 | 提示注入、越权承诺、错误前提和隐私边界 |
| `extraction-v1` | 47 份清单 + 代表性多格式样本 | 抽取与元数据治理质量 |

`retrieval-v2` 建议按 100/40/40 划分 train/dev/test。相同问题的改写、同一政策事实的模板和同一多轮场景必须进入同一 split，避免数据泄漏。冻结 test 只在候选方案确定后运行。

### 5.2 检索用例构成

| 类别 | 数量建议 | 核心风险 |
| --- | ---: | --- |
| 单地区单事实 | 30 | 金额、年龄、材料、渠道 |
| 跨层级政策 | 20 | 国家规则与地方细则的优先级 |
| 跨地区干扰 | 25 | 同类地方政策相互污染 |
| 时间与版本 | 20 | 过期、未来和新旧政策误用 |
| 多证据组合 | 20 | 资格、材料、期限来自多个 chunk |
| 错别字、口语、简称 | 15 | 查询规范化能力 |
| 同义改写一致性 | 15 | 同意图输出和检索稳定性 |
| 错误前提纠正 | 15 | 不顺着错误金额或条件回答 |
| 不可回答/缺地区 | 20 | 澄清、拒答和知识边界 |

这部分吸收已有跨平台测试中的多轮、错误前提、安全、时效、来源和同义改写设计，但不复用未经核验的 Ground Truth，也不把不同轮次简单当成独立样本加权。

### 5.3 单轮案例 Schema

```json
{
  "id": "sd-jinan-channel-001",
  "dataset_version": "retrieval-v2.0",
  "split": "test",
  "question": "济南育儿补贴去哪里办？",
  "category": "regional_channel",
  "difficulty": "medium",
  "user_region": "山东省/济南市",
  "effective_date": "2026-08-02",
  "answerable": true,
  "expected_behavior": "answer",
  "relevant_documents": ["jinan-childcare-guide-2025"],
  "relevant_chunks": ["jinan-childcare-guide-2025:<digest>"],
  "graded_chunks": {
    "jinan-childcare-guide-2025:<digest>": 3,
    "shandong-childcare-rules-2025:<digest>": 1
  },
  "required_facts": ["办理渠道或线下受理地点"],
  "forbidden_facts": ["其他城市专属办理入口"],
  "expected_citations": ["jinan-childcare-guide-2025"],
  "source_review_status": "approved",
  "reviewer": "human",
  "notes": "地市办理入口必须使用济南材料"
}
```

Gold 必须与来源、版本和 chunk 绑定。自动生成的候选只能标记为 `generated`，不能直接升级为 `approved`。

### 5.4 多轮场景 Schema 与计分

每个场景包含初始用户画像、逐轮输入、预期状态变化和最终任务目标：

```json
{
  "scenario_id": "region-switch-001",
  "split": "test",
  "initial_context": {},
  "turns": [
    { "user": "我想申请育儿补贴", "expected": "clarify_region" },
    { "user": "孩子户口在北京", "expected": "answer_beijing" },
    { "user": "刚迁到上海了", "expected": "update_region_and_retrieve_shanghai" }
  ],
  "success_conditions": ["未在第一轮臆测地区", "第三轮不继续引用北京办理入口"]
}
```

多轮报告同时展示：

- turn accuracy；
- scenario completion rate；
- context retention accuracy；
- stale-context leakage；
- error propagation rate；
- recovery rate。

最终总览以场景宏平均为准，避免 10 轮场景天然比 3 轮场景权重更高。

## 6. 指标与评分体系

### 6.1 知识库治理指标

- Metadata completeness/accuracy；
- 地区标准化成功率；
- 来源可核验率；
- duplicate group precision/recall；
- canonical source selection accuracy；
- 版本区间完整率；
- 无效/未知状态文档隔离率；
- 索引幂等与删除同步正确率。

### 6.2 检索指标

- Document Recall@5；
- Chunk Recall@5；
- MRR@10、nDCG@10；
- Region leakage rate；
- Temporal leakage rate；
- Version resolution accuracy；
- Authority precedence accuracy；
- Duplicate occupancy@K：Top-K 中同一重复组占位比例；
- No-answer precision、recall、F1；
- Missing-region clarification accuracy；
- 同义改写 Top-K Jaccard 和答案一致率。

`Region leakage` 需要排除合法的全国材料。例如查询济南时，召回山东省和全国政策是允许的，召回哈尔滨市专属指南才算泄漏。

### 6.3 回答与 Agent 指标

- Required fact coverage；
- Forbidden fact rate；
- Grounded claim precision；
- Citation precision/completeness；
- 错误前提纠正率；
- 可执行步骤完整率；
- 拒答/澄清正确率；
- Schema、业务校验通过率；
- repair、fallback 和无依据回答公开率；
- 平均模型调用、工具调用、token 和成本。

### 6.4 性能与稳定性指标

分别记录 `normalize/retrieval/version_resolution/model/validation/total` 的 p50、p95、p99，并记录：

- 索引构建总时间、chunks/s、索引大小和峰值内存；
- 冷/热检索差异；
- 1/4/8/16 并发成功率与吞吐；
- 超时率、队列等待和错误码分布；
- 语料扩容前后的延迟增量；
- 真实模型与 `TestModelProvider` 分开报告。

### 6.5 LLM Judge 使用约束

事实字段、引用、地区、版本、拒答和结构优先使用确定性指标。LLM Judge 只用于完整性、表达质量和办事指导等难以规则化的维度。

正式批量评分前：

1. 随机抽取至少 30 条，由两名人工独立评分；
2. 计算人工间一致性和 Judge-人工一致性；
3. 对分歧样本复核评分提示词；
4. 一致性达到预设门槛后才扩展到全量；
5. 保存 Judge 模型、版本、参数、提示词哈希和原始 JSON；
6. 安全通过率、事实错误率和性能不揉进单一总分。

推荐最终报告分为“质量 0–100、检索、安全、延迟、成本”五栏，不输出一个掩盖权衡的综合排行榜。

## 7. 扩库消融与调优实验矩阵

### 7.1 先证明数据治理价值

| 编号 | 语料配置 | 目的 | 主要指标 |
| --- | --- | --- | --- |
| K0 | 当前 6 文档 | 小库基线 | Recall、MRR、延迟 |
| K1 | 47 份候选文档直接扩入 | 测量朴素扩库的噪声代价，仅作实验 | Recall、地区泄漏、重复占位 |
| K2 | K1 + 元数据/地区标准化 | 证明治理元数据的收益 | 地区泄漏、澄清率 |
| K3 | K2 + canonical 去重 | 证明去重收益 | Duplicate occupancy、MRR |
| K4 | K3 + 版本/权威性策略 | 形成正式全国知识库候选 | 版本、时效、权威性准确率 |

K1 允许出现质量问题，但不得作为面向用户的默认知识库。所有阶段使用同一 Eval 和同一检索配置，避免把数据治理收益与算法调参混在一起。

### 7.2 再做检索调优

在 K4 上依次进行：

| 编号 | 单变量 | 候选配置 |
| --- | --- | --- |
| R1 | 查询规范化 | raw / normalize / +同义词 / +地区别名 |
| R2 | chunk 最大长度 | 600 / 1000 / 1400 / 1800 chars |
| R3 | Top-K | 3 / 5 / 8 |
| R4 | 字段权重 | 正文 / 标题+正文 / 标题+章节+正文 |
| R5 | 地域策略 | 后过滤 / 前过滤 / 层级扩展过滤 |
| R6 | 版本策略 | 无 / 当前 / version-group-first |
| R7 | 混合召回 | BM25 / dense / BM25+dense RRF |
| R8 | 重排 | 无 / Top20→5 reranker |

只有 BM25 在冻结 hard-dev 上仍有明确召回缺口时才进入 R7/R8。

### 7.3 Agent 与安全消融

| 编号 | 对比 | 重点 |
| --- | --- | --- |
| A1 | Evidence K=3/5/8 | 覆盖率、干扰和 token |
| A2 | 4k/8k/12k 字符预算 | groundedness、截断、成本 |
| A3 | 无地域澄清/有地域澄清 | 地区臆测与任务完成率 |
| A4 | 无版本决策/有版本决策 | 过期政策误用 |
| A5 | 无保护/Schema/业务校验/repair+fallback | 错误公开率 |
| A6 | 无状态/文本历史/结构化槽位 | 多轮保持和污染 |
| A7 | 无注入防护/完整防护 | 安全通过率与误拒答 |

## 8. 单次运行规范与可复现产物

每个 run 至少保存：

```json
{
  "run_id": "K3-bm25-top5-20260802-01",
  "git_commit": "<sha>",
  "dataset_version": "retrieval-v2.0",
  "split": "dev",
  "knowledge_snapshot": "nationwide-childcare-k3",
  "knowledge_hash": "<sha256>",
  "duplicate_map_hash": "<sha256>",
  "region_registry_hash": "<sha256>",
  "index_stats": { "documents": 0, "chunks": 0 },
  "runtime": { "node": "<version>", "os": "win32-x64" },
  "model": { "provider": "test", "name": "policy-test-model" },
  "config": { "retrieval": "bm25", "top_k": 5 },
  "warmup_runs": 2,
  "measured_runs": 5,
  "metrics": {},
  "case_results": [],
  "failed_case_ids": [],
  "notes": ""
}
```

要求：

- 每个实验只改变一个核心变量；
- 确定性检索至少重复 3 次确认稳定性，性能测试预热后至少 5 轮；
- 真实模型每条至少运行 3 次，报告均值和方差；
- 保存逐案例结果、检索 Top-K、证据、最终回答和 Trace；
- 禁止只保存汇总分或最好的一次运行；
- test 一旦用于最终选择即冻结，继续调参时创建新版本。

## 9. 实施工作包

### Phase 0：快照与审计，1–2 天

- [x] 将 47 份文件按字节复制到 `knowledge/intake/nationwide-childcare/`；
- [x] 生成 SHA-256 清单和来源审计 JSONL；
- [x] 识别标题异常、未知地区、非法状态和疑似重复组；
- [x] 输出首版 `knowledge-audit.md`；
- [x] 保持 intake 在默认 `raw/curated` 扫描范围之外，不改变默认索引和基线。

验收：47/47 文件可追溯，总计 375197 字节，原文哈希稳定，所有异常均写入 `nationwide-childcare-source-audit.jsonl`；`pnpm knowledge:intake:audit` 可重复验证快照。

### Phase 1：元数据和地区治理，2–4 天

- [x] 建立行政区注册表和别名；
- [x] 将地区校验从硬编码正则改为注册表校验；
- [x] 扩展 PolicyMetadata 和索引字段，同时兼容旧 `region`；
- [x] 为 47 份文件补齐 override；
- [x] 增加缺失字段、父子地区和未知状态测试；
- [x] 标记 approved/quarantined，隔离未核验材料。

验收：正式集合元数据完整率 100%，地区解析率 100%，unknown 文档不会进入默认索引。

完成记录（2026-08-02）：47/47 override 与原文 SHA-256 绑定，元数据完整率和地区解析率均为 100%；41 份 Phase 0 `verified` 材料进入 approved 集合，6 份 `issue` 材料进入 quarantined，索引构建器会再次强制排除 quarantined/unknown。

### Phase 2：去重、版本与分阶段知识快照，2–3 天

- [x] 生成 exact/near duplicate 候选；
- [x] 人工确认 canonical 文档；
- [x] 建立版本组和有效区间；
- [x] 构建 K0–K4 快照；
- [x] 验证新增、更新、删除和仅元数据变化的增量索引。

验收：重复转载不会占满 Top-K；相同日期和地区下版本选择具有确定性。

完成记录（2026-08-02）：对 47 份材料执行规范化正文 SHA-256、五字 shingle Jaccard 和文号候选检测，得到 0 组 exact、8 组 near、10 组同文号候选；确认 1 个全国政策转载组（3 份来源，组内相似度 0.976–0.995），保留 1 份 canonical。K0–K4 快照分别包含 6/47/41/39/39 份文档并具有独立 SHA-256；K4 实际构建为 39 份、380 chunks，索引绑定快照哈希。新增、正文更新、仅元数据更新、删除、幂等重建和同日版本确定性排序均有自动化测试。

### Phase 3：Eval v2.1 规范化重建

- [x] 建立 `retrieval-v2.1` source-first Schema、只读 Gold 构建器和严格数据校验器；
- [x] 从 K4 原文重新标注 retrieval 80 条（train 50 / dev 30）和 v1 回归 13 条；
- [x] 扩充并实际执行多轮 20 组、安全 30 条；
- [x] 将 Query Normalizer、Runtime、工具 Schema 与业务校验器扩展到 K4 全国地区；
- [x] 隔离 train-only calibration、label-free runner 和 Gold-aware scorer；
- [x] 输出检索、回答、引用、多轮、安全、性能的分子/分母、分类结果和 95% 区间。

技术验收：循环标签为 0、Gold 标签泄漏为 0、K4 证据绑定错误为 0、runner/scorer 隔离测试通过、全部评测集实际执行。

重建记录（2026-08-02）：Eval v2.0 因 Gold 受检索结果影响且 Runner 读取预期行为，被标记为 `invalid_for_quality_claims`，只保留用于审计。v2.1 首版虽消除了检索循环，但人工预审发现固定前缀截取、弱证据、对话模板循环和安全标签模板等问题，随后再次按 claim-first 重建。当前 143 条标注全部为 `pending_review`；88 个 Gold evidence span 均记录精确 K4 原文 quote、源行范围、chunk 字符范围和完整 atomic claims，`required_facts` 由 claims 精确派生，禁止固定长度截取。train-only 校准锁定阈值后运行 dev，三次完整运行预测指纹一致；当前 provisional 基线 Document Recall@5=1.000、Chunk Recall@5=0.935、MRR@10=0.822、nDCG@10=0.729、required fact coverage=0.833、citation precision=0.500、citation completeness=0.885；no-answer F1=0、多轮场景完成率=0.800、上下文污染率=0.182、安全通过率=0.367，共保留 29 个诊断失败案例。报告继续固定为 `evaluation_status: provisional`、`release_gate: blocked_pending_human_review`，不冻结 test，也不宣称 Phase 3 正式验收通过。

Phase 3.3 闭环记录（2026-08-05）：Gold human review passed（143/143 approved，pending=0，rejected=0），TestModelProvider 自动质量门禁、产物指纹一致性和三次完整运行确定性门禁均通过。Phase 4 entry 为 `ready_for_phase4`，production release 为 `blocked_pending_phase4`，frozen test 尚未创建或执行，真实 DeepSeek 评测尚未运行。Phase 4 checklist 保持未完成；当前结果只允许作为确定性测试基线，不构成生产质量声明。

### Phase 4：消融、调优与冻结测试，4–7 天

- [ ] 先完成 K0–K4，证明数据治理收益；
- [ ] 在 K4 上完成 R1–R6；
- [ ] 只将两个候选配置提交冻结 test；
- [ ] 根据失败分布决定是否进入 hybrid/reranker；
- [ ] 完成 A3–A6 的 Agent 消融；
- [ ] 输出质量优先和延迟优先两套配置。

验收：所有结论至少有一个对照组、一个主指标和一组失败案例支撑。

### Phase 5：报告与简历数据，1–2 天

- [ ] 生成知识治理、检索、Agent、安全和性能五类报告；
- [ ] 固化最终配置和复现实验命令；
- [ ] 更新 `eval-report.md` 和 `verification.md`；
- [ ] 将最终数字写入项目说明和简历候选描述。

## 10. 质量门槛与停止规则

### 10.1 全国知识库候选门槛

- 正式文档元数据完整率 = 100%；
- 来源、地区和有效期关键字段人工抽检通过率 = 100%；
- quarantined 文档进入默认索引数 = 0；
- duplicate occupancy@5 相比 K1 明显下降；
- Region/Temporal leakage 不高于当前可接受门槛；
- 当前 13 条 regression 不回退。

具体质量提升数值不在实验前虚构，K0/K1 完成后再冻结绝对门槛。

### 10.2 方案进入冻结 test 的条件

- dev 的 Chunk Recall@5 或 MRR@10 至少一项稳定提升；
- Region/Temporal leakage 不增加；
- no-answer 和缺地区澄清不退化；
- 检索 p95 增量在预设预算内；
- 至少 3 次重复运行方向一致；
- 能明确指出解决了哪些失败案例。

同一方向连续三轮无收益则停止调参并回到失败分析。不得用 test 反复选择规则。

## 11. 最终交付物

代码与数据：

- 全国候选原文快照及哈希清单；
- 地区注册表、元数据 override、重复组和版本组；
- Eval v2 Schema、数据校验器和首批冻结数据；
- K0–K4 知识快照构建能力；
- 检索、Agent、Judge 和性能评测脚本；
- 可复现 run JSON 和逐案例结果。

报告：

1. 扩库前后规模、召回、泄漏、重复和延迟对比；
2. 原始扩库、元数据治理、去重、版本治理的逐层消融；
3. BM25、查询规范化、字段权重和地域过滤对比；
4. 多轮办事、错误前提、安全和无答案结果；
5. 质量优先与延迟优先配置的选型理由。

## 12. 可形成的简历表达

最终数字产生后，可形成如下描述：

```text
将育儿补贴知识库由北京/河北扩展至覆盖 N 个省级行政区的 M 份官方材料，设计行政区层级元数据、政策版本决策和 canonical 近重复治理；通过 K0–K4 消融将跨地区误召回率从 X 降至 Y、Top-5 重复占位率从 A 降至 B，同时保持 Chunk Recall@5 为 C、检索 p95 为 D ms。
```

```text
建设带 document/chunk 证据绑定的中文政务 Eval v2，覆盖地域冲突、政策时效、多轮澄清、错误前提、提示注入和无答案问题；以 MRR/nDCG、地区与时间泄漏、引用完整率、场景完成率和安全通过率替代单一 LLM 总分，并通过人工样本校准 Judge。
```

N/M/X/Y/A/B/C/D 必须来自冻结报告，不使用候选语料数量或单次最好结果代替最终指标。

## 13. 最近一次执行顺序

1. 先建立原文快照和审计清单，不立即切换默认知识库；
2. 改造地区注册表和元数据校验；
3. 补齐首批高价值文档的 override，优先国家、北京、上海、广东、山东、浙江；
4. 建立重复组和 K0–K4 构建方式；
5. 先标注 30 条地域/版本 hard case，跑出 K0/K1 的真实问题；
6. 完成 K2–K4 消融，再扩到 80 条 dev；
7. 最后建设冻结 test、多轮和安全集；
8. 由失败数据决定是否引入向量检索和 reranker。

该顺序能尽早得到第一组“朴素扩库造成噪声、治理后恢复质量”的对比数据，同时避免在 Gold 和元数据不可靠时提前进行无效调参。
