# 政务智能体本地 MVP：实现记录与简历说明

## 1. 项目定位

这是一个面向北京市、河北省育儿补贴办事咨询的本地可运行 MVP。项目不试图复刻完整政务平台，而是验证从政策材料进入系统，到 Agent 给出可追溯回答的核心技术闭环：

```text
政策文件（MD / TXT / HTML / PDF / DOCX）
  -> 统一抽取与元数据治理
  -> 语义切片与增量索引
  -> SQLite FTS5 / BM25 检索
  -> 地区、日期、状态与版本过滤
  -> Evidence Pack
  -> Agent Runtime + 白名单工具
  -> Schema / 业务规则校验
  -> WebSocket 对话 + REST 知识库
```

适合在简历中将它描述为“政务 Agent 应用开发”项目，而不是爬虫项目或本体平台项目。重点能力是数据管道、检索工程、Agent Runtime、后端协议、安全边界与评测。

## 2. 范围取舍

本 MVP 重点实现：

- 多源政策文档抽取与统一标准化；
- 可定位到文档、章节和原始行号的知识索引；
- 面向中文政策材料的 BM25 检索、地区/日期/版本过滤；
- Agent 工具白名单、调用预算、会话状态和失败降级；
- Evidence Pack、引用约束、结构化输出与业务校验；
- WebSocket 对话接口和类似 Wiki 的知识库浏览/检索接口；
- 无外部模型密钥也可重复运行的测试、冒烟和离线评测。

明确不做：

- 爬虫调度、反爬、网页变更发现；上游只需把文件投递到知识目录；
- 本体编辑器、图谱可视化、规则编排平台；本 MVP 只消费标准化政策元数据；
- 扫描 PDF 的 OCR、表格视觉理解和版面模型；文本型 PDF 可直接抽取，扫描件会显式失败；
- 生产级用户认证、工单提交、真实政务系统写操作；所有 Agent 工具均为只读或纯计算工具。

这样的取舍保证演示链路完整，也避免把实习项目包装成没有实际实现的“大平台”。

## 3. 多源文档数据管道

### 3.1 支持格式

| 输入 | 处理方式 | 保留结构 |
| --- | --- | --- |
| Markdown | 严格 UTF-8 + Front Matter | 标题层级、列表、表格、原始行号 |
| TXT | 严格 UTF-8 | 段落与原始行号 |
| HTML | DOM 解析并移除脚本、样式等非正文节点 | 标题、段落、列表、表格文本 |
| PDF | 逐页文本抽取，最多 200 页 | 人工加入页标题，便于切片和定位 |
| DOCX | Mammoth 转换为受控 HTML，再进入统一 HTML 规范化 | 标题、段落、列表等 Word 语义结构 |

入口实现位于 `packages/policy-rag-adapter/src/document-extractor.ts`。单文件限制为 20 MB，抽取文本限制为 200 万字符；DOCX 禁止读取外部资源，PDF 超页会记录 warning。OCR 不在本 MVP 范围内，扫描件不会被静默写入空索引。

### 3.2 元数据治理

Markdown 可以使用 Front Matter。PDF、DOCX 等二进制文件通过 `knowledge/metadata/overrides.json` 补充元数据。优先使用带目录的 key，文件名 key 仍向后兼容：

```json
{
  "raw/beijing/育儿补贴通知.pdf": {
    "document_id": "beijing-childcare-notice-2026",
    "title": "北京市育儿补贴通知",
    "region": "北京市",
    "authority": "官方发布机构",
    "publish_date": "2026-01-01",
    "effective_from": "2026-01-01",
    "effective_to": null,
    "status": "effective",
    "source_url": "https://example.gov.cn/official-page",
    "policy_type": "childcare-subsidy",
    "version_group": "beijing-childcare-notice",
    "version_priority": 10
  }
}
```

`knowledge:validate` 会检查 UTF-8/乱码、来源 URL、地区、生效日期和切片尺寸。`document_id` 重复会阻止构建，避免同一政策被错误覆盖。

### 3.3 增量与幂等

索引哈希不是只计算文件字节，而是覆盖：

```text
抽取器版本 + 源文件字节 + 标准化政策元数据
```

因此以下三种变化都会触发重新索引：原文变化、抽取逻辑升级、政策状态/日期/来源等元数据变化。完全未变化的文件会被计为 `documents_unchanged`；从输入目录删除的文件会同步从索引移除。

这修复了常见的数据管道问题：只哈希原文件会导致元数据更新后检索过滤仍使用旧值。

### 3.4 语义切片与索引

`SemanticPolicyChunker` 识别 Markdown 标题、加粗标题、中文“第 X 章/第 X 条”、段落、列表和表格。超长内容先按段落，再按中文句号/分号边界拆分。每个片段保存：

- 确定性的 `document_id` / `chunk_id`；
- 父级 `section_path`；
- `line_start` / `line_end`；
- 未做关键词扩展的原始正文；
- 用于 FTS5 的中文短语、同义词和 bigram 搜索投影。

SQLite 同时保存上游 `pi-local-rag` 的 `files/chunks/chunks_fts` 表，以及项目自己的 `policy_documents/policy_chunks` 表。运行时断言向量表行数为 0，确保当前基线确实是纯 BM25，而不是名义上的关键词检索、实际偷偷调用 embedding。

## 4. Agent 检索与 Wiki

### 4.1 检索链路

用户问题先经过地区和意图归一化。`search_policy` 执行中文查询扩展，再按以下条件过滤：

- 北京市、河北省或两地对比；
- 政策状态必须有效；
- `effective_from/effective_to` 覆盖本次参考日期；
- 同一 `version_group` 按优先级和发布日期解析；
- 非主动询问时排除“生育津贴”等相邻但不同的政策类型。

检索结果不会直接拼进前端，而是先构造 Evidence Pack。最终回答中的来源必须来自本轮 Evidence Pack，金额、资格等强事实必须有证据，避免模型引用未检索材料。

### 4.2 只读知识库 API

本地后端新增三类 REST 接口：

| 接口 | 作用 |
| --- | --- |
| `GET /api/knowledge/documents?region=北京市` | 查看已登记政策目录、格式、切片数和元数据 |
| `GET /api/knowledge/documents/:documentId` | 查看正文片段、章节路径、原始行号和官方来源 |
| `GET /api/knowledge/search?q=补贴金额&region=北京市` | 直接调用与 Agent 相同的日期/地区过滤检索 |

页面右上角可在“对话”和“知识库”之间切换。知识库不是另建一套搜索逻辑，而是复用 Agent 的 Retrieval Provider，因此适合演示“模型回答”和“底层证据”如何对应。

## 5. Agent Runtime 与后端

### 5.1 Runtime

`PolicyAgentRuntime` 统一承载 Agent Loop，主要职责包括：

1. 检查输入长度、估算 token、并发和排队预算；
2. 从带 TTL 的内存 Session 恢复最多两轮的槽位状态；
3. 归一化地区、意图和参考日期，拒绝不支持范围；
4. 通过白名单工具检索政策、读取元数据、解析版本；
5. 构造 Evidence Pack 并调用 Test/DeepSeek Model Provider；
6. 解析结构化 JSON，执行 Schema 与业务 Validator；
7. 第一次结构失败只做轻量修复，仍失败则使用确定性安全模板；
8. 记录脱敏 Trace，并持久化受限的会话状态。

Agent 只能看到五个工具：

- `search_policy`
- `get_policy_source`
- `get_policy_metadata`
- `resolve_policy_version`
- `calculate_date_interval`

注册表会同时校验工具名、Zod 输入/输出 Schema、调用次数、超时、风险等级和副作用标记。没有 Shell、文件系统、任意 URL、原始 SQL或索引管理能力。

### 5.2 后端协议

HTTP 服务只监听 `127.0.0.1` 或 `::1`。浏览器通过 WebSocket 发送 `ask/reset`，公开事件只有：

- `status`
- `result`
- `safe_error`
- `session_reset`

原始 Agent 事件、思维过程、工具参数/结果、Prompt、异常栈和半截 JSON 不会进入浏览器协议。知识库 REST API 只支持 GET/HEAD，并校验地区、日期、查询长度和文档 ID。

## 6. 本地运行与验收

环境要求：Node.js `>=22.19`、pnpm `11.1.2`。

```bash
pnpm install
pnpm deps:check
pnpm knowledge:validate
pnpm rag:build -- --rebuild
pnpm test
pnpm eval
pnpm dev
```

打开 <http://127.0.0.1:3001>。默认 `MODEL_PROVIDER=test`，无需密钥即可运行完整 Agent Loop、工具调用、检索、校验和 UI。要使用真实模型，再复制 `.env.example` 为 `.env` 并配置 DeepSeek Key 与准确的模型 ID。

本轮完成时的本地验收结果：

- 6 份登记政策材料；
- 54 个语义片段；
- 0 条向量记录，检索模式为 `bm25-only`；
- 36 个单元/集成测试全部通过；
- PDF 与 DOCX 测试使用运行时生成的真实容器进行抽取；
- 13 个中文评测案例的 Retrieval Recall@5 基线为 0.95，详情见 `docs/eval-report.md`。

### 6.1 建议演示顺序

1. 运行 `pnpm knowledge:validate`，说明输入质量门禁；
2. 运行两次 `pnpm rag:build`，展示第一次索引、第二次全部 unchanged；
3. 打开“知识库”，搜索“首次申请截止时间”，查看命中片段和来源定位；
4. 切回“对话”，询问“北京首次申请截止时间”，对照回答来源；
5. 询问“北京和河北育儿补贴有什么不同”，展示地区和版本过滤；
6. 询问读取本地文件或内部思维过程，展示安全拒绝；
7. 运行 `pnpm smoke` 或 `pnpm eval` 展示可重复验收。

## 7. 简历写法

项目名称可写为：`政务政策 Agent 与多源知识检索平台（个人实习项目）`。

建议使用下面 3 条，并根据简历篇幅压缩：

- 基于 TypeScript 搭建政务政策 Agent MVP，设计 MD/TXT/HTML/PDF/DOCX 统一抽取、元数据治理、语义切片与内容/元数据感知的增量索引链路，实现政策材料从入库到可追溯检索的本地闭环。
- 基于 SQLite FTS5/BM25 实现中文政策检索，加入地区、生效日期、政策类型和版本过滤，以 Evidence Pack 约束回答引用；在 13 个中文案例上取得 Recall@5 0.95，并提供 Wiki 式知识目录、正文定位和检索 API。
- 基于 Pi Agent Core 实现受预算约束的 Agent Runtime，封装 5 个低风险白名单工具、两轮 TTL Session、结构化输出修复、Schema/业务校验和安全降级；通过 WebSocket/REST 提供本地服务，完成 36 个自动化测试。

面试时应主动说明：当前 0.95 是小规模、固定政策快照上的离线检索基线，不是线上生产指标；真实 DeepSeek 网络延迟、OCR 准确率和大规模知识库性能尚未验证。这样比夸大指标更可信。

## 8. 可继续迭代的方向

按对求职价值和技术闭环的优先级排序：

1. 增加异步 ingestion job、失败重试、文档状态机和抽取质量指标；
2. 为扫描 PDF 增加 OCR，并保存页码、表格和版面坐标；
3. 扩充人工标注集，分别评估切片、召回、重排、版本冲突和拒答；
4. 在 BM25 基线之上加入 embedding + reranker，保留可复现的消融对比；
5. 将 Session、Trace 和任务状态迁移到 Redis/PostgreSQL，支持多实例；
6. 增加认证、RBAC、限流、审计日志和政务隐私合规后再考虑远程部署；
7. 把上游本体平台输出映射为受版本控制的领域 Schema，而不是让 Agent 直接查询任意图数据库。

## 9. 关键代码入口

- 多源抽取：`packages/policy-rag-adapter/src/document-extractor.ts`
- 文档加载与哈希：`packages/policy-rag-adapter/src/loader.ts`
- 语义切片：`packages/policy-rag-adapter/src/chunker.ts`
- 增量索引：`packages/policy-rag-adapter/src/index-builder.ts`
- 检索与 Wiki 数据访问：`packages/policy-rag-adapter/src/provider.ts`
- Agent Runtime：`packages/pi-runtime-adapter/src/runtime.ts`
- 工具白名单：`packages/tools/src/policy-tools.ts`
- HTTP/WebSocket 后端：`packages/policy-web-ui-adapter/src/server.ts`
- 知识库页面：`apps/policy-web/src/components/KnowledgeBrowser.tsx`
- 自动化验证：`tests/`、`scripts/smoke.ts`、`scripts/run-eval.ts`
