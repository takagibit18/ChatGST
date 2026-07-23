# 北京 + 河北育儿补贴政策对话助手

一个本地可运行的 TypeScript MVP，用统一 Pi Agent Runtime 承载 `childcare-subsidy` Profile。它只检索已登记的北京、河北和必要的全国政策资料，只开放五个低风险政策工具，并在结构化结果通过 Schema 与业务校验后才发送给浏览器。

当前默认使用确定性的 `TestModelProvider`，无需密钥即可完成索引、测试、评测和页面演示。真实 DeepSeek 模型 ID 不在代码中猜测，必须通过 `MODEL_NAME` 配置。

## 已验证版本

| 组件 | 锁定版本 | 集成方式 |
| --- | ---: | --- |
| `pi-local-rag` | `0.4.1` | 直接复用 SQLite、FTS5、哈希和索引状态；Adapter 增加政策切片、元数据、纯 BM25 与过滤 |
| `@raindrop-ai/pi-agent` | `0.1.0` | 直接使用程序化 Subscriber；Adapter 负责脱敏、匿名关联、降级和故障隔离 |
| `@kkkiio/pi-web-ui` | `0.1.1` | 基于上游 React/Vite/Tailwind、AI Elements 和 WebSocket 模式的最小受控 Fork |
| Pi Agent Core / Pi AI | `0.81.1` | 统一 Agent Loop、模型流与 Tool Calling |
| Node.js / pnpm | `>=22.19` / `11.1.2` | 本地运行 |

完整审查、许可证、Peer Dependencies、公开接口、breaking changes 和源码基准见 [third-party-assessment.md](docs/third-party-assessment.md)、[upstream-delta.md](docs/upstream-delta.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 本地运行

仓库不发布政策原文、整理快照、元数据覆盖文件或包含证据正文的 Golden。首次运行前，请按 [knowledge/README.md](knowledge/README.md) 将有权使用的政策 Markdown 放入本地忽略目录，再构建索引。

```bash
pnpm install --frozen-lockfile
pnpm inspect:extensions
pnpm knowledge:validate
pnpm rag:build -- --rebuild
pnpm rag:smoke
pnpm build
pnpm test
pnpm eval
pnpm dev
```

打开 <http://127.0.0.1:3001>。`pnpm dev` 会先构建受控前端，再启动仅监听回环地址的 HTTP + WebSocket 服务。Windows PowerShell 若阻止 `pnpm.ps1`，可等价使用 `pnpm.cmd`，无需更改系统执行策略。

额外命令：

```bash
pnpm knowledge:inspect
pnpm golden:generate
pnpm eval -- --all --output domains/childcare-subsidy/evals/baseline-report.json
pnpm smoke
pnpm test:integration
```

`golden:generate` 总是先执行 BM25，并保存实际 `document_id`、`chunk_id`、证据正文和生成模型；生成记录固定标为 `pending_review`，不会自动成为绝对真值。该输出包含证据正文，因此只保存在本地并被 Git 忽略。

## 配置 DeepSeek

复制 `.env.example` 为 `.env`，再设置：

```dotenv
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
MODEL_NAME=由实际服务商提供的 DeepSeek V4 Flash API model ID
```

`MODEL_NAME` 不能为空，也没有硬编码默认值。Provider 层负责 OpenAI Completions 兼容调用、温度、输出长度、一次重试、超时、Tool 参数规范化、JSON 提取和一次轻量 JSON 修复。没有密钥时继续使用 `MODEL_PROVIDER=test`。

## 知识库与索引

本地验收曾对用户提供目录中的 47 个 Markdown 完成严格 UTF-8、乱码和来源 URL 检查，并使用北京、河北相关原文及受控快照验证切片与检索。政策原文、快照和派生元数据均不纳入 Git 历史，也不随远端仓库发布。

将有权使用的真实 Markdown 放入本地 `knowledge/raw/`，必要时补充 `knowledge/metadata/overrides.json`，再执行 `knowledge:validate` 与 `rag:build`。这些路径已被 `.gitignore` 强制排除；切片规则见 [chunking-strategy.md](docs/chunking-strategy.md)，输入审计见 [knowledge-audit.md](docs/knowledge-audit.md)。`knowledge/index/rag.db` 也是本地生成物，不提交 Git。

索引沿用 `pi-local-rag` 的 `files`、`chunks`、`chunks_fts`、哈希和 FTS5 触发器，另建 `policy_documents` 与 `policy_chunks` 保存地区、机构、日期、状态、版本组、父级标题和原始行号。第一版运行链路只查询 SQLite `bm25()`；每次构建和服务启动都会断言 `chunks_vec` 为 0。

## 安全边界

Agent 可见工具严格等于：

- `search_policy`
- `get_policy_source`
- `get_policy_metadata`
- `resolve_policy_version`
- `calculate_date_interval`

没有 Bash、Shell、Python、Node、Git、任意文件读写、任意 URL、原始 SQL或上游索引管理工具。工具注册表、输入 Schema、超时、调用预算和无副作用元数据由代码执行。

浏览器只能发送 `ask / reset`，只能收到 `status / result / safe_error / session_reset`。原始 Agent 事件、思维过程、Tool 参数/结果、半截 JSON、Prompt、内部消息和异常栈不会进入公开协议。最终 `result` 必须经过 JSON 解析、Schema Validator 和 Policy Business Validator；第一次失败只请求修复结构，第二次失败使用确定性安全模板。

Session 仅在内存保存，TTL 默认 10 分钟，最多两次用户输入和一次澄清；不跨会话记忆，也不持久化真实对话。

Raindrop 默认关闭且默认不采集内容：

```dotenv
RAINDROP_ENABLED=false
RAINDROP_CAPTURE_CONTENT=false
```

无 Write Key 时自动使用 `LocalTraceRecorder`。启用后默认只发送匿名 ID、耗时、Token、状态等元数据；代理层移除 Prompt、消息、思维、工具参数/结果和路径，敏感号段会脱敏。观测故障不阻断回答。

## 项目结构

```text
apps/policy-runtime            本地 HTTP + WebSocket 入口
apps/policy-web                受控 pi-web-ui 前端
packages/pi-runtime-adapter    统一 Pi Runtime、Profile 与 Evidence Pack
packages/policy-rag-adapter    pi-local-rag BM25、切片、中文检索和版本过滤
packages/model-provider        DeepSeek / Test Provider
packages/tools                 五个白名单工具
packages/session               两轮内存 Session
packages/validators            Schema 与政策业务校验
packages/raindrop-adapter      Raindrop / Local / Composite Recorder
domains/childcare-subsidy      Profile、Skill、References 与 Evals
knowledge                     本地语料接入说明与被忽略的本地索引
```

详细数据流和可替换接口见 [architecture.md](docs/architecture.md)，评测口径和基线见 [eval-report.md](docs/eval-report.md)。

## 本地部署声明

本 MVP 没有生产级认证，只允许 `127.0.0.1` 或 `::1`。不得直接暴露公网。未来远程部署必须另行设计 TLS、身份认证、限流、反向代理、密钥管理、审计和隐私合规。

页面固定提示：本工具仅用于政策信息查询和技术验证，结果以当地主管部门最终审核为准。请勿输入身份证号、手机号、银行卡号等敏感个人信息。

## 已知限制

- 远端仓库不包含政策语料；全量 RAG、Runtime 和 Eval 验证需要先在本地补充已获授权的 Markdown 并重建索引。
- 当前环境没有 DeepSeek 和 Raindrop 凭据；端到端验收使用真实 Pi Agent Core + `TestModelProvider`，没有声称完成外部模型或遥测网络调用。
- 知识库是截至 2026-07-23 的固定快照，不会自动爬取或发现政策更新。
- 中文 Recall@5 基线为 `0.95`；北京/河北对比题仍是最值得扩充标注与查询扩展的检索场景。
- Session、并发队列和本地 Trace 都在单进程内存中，不适合多实例生产环境。
- Golden 尚待人工政策审核，文件中的 `pending_review` 不应被改成自动通过。

最高优先级后续工作：人工复核 Golden 与政策日期；使用真实 DeepSeek V4 Flash 凭据运行结构化输出回归；扩充两地对比/迁移标注并验证受控 Raindrop 项目的端到端脱敏 Payload。
