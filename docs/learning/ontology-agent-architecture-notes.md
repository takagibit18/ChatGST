# 育儿补贴本体智能体平台 — 技术架构

## 二、整体架构（五层模型）

```
┌──────────────────────────────────────────────────────────────┐
│                        用户层                                 │
│  浏览器 ──→  Vite dev server                                  │
│  管理员 ──→ SSH / CLI (pi)                                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                   Bridge 桥接层 (API + WebSocket)              │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Express  │ │ WebSocket │ │ pi SDK     │ │ jiti 动态编译│  │
│  │ REST API │ │ 流式对话   │ │ Agent 运行时│ │ 工具热加载   │  │
│  └──────────┘ └───────────┘ └────────────┘ └──────────────┘  │
│  技术栈: Node 22 + TypeScript + Express + ws + SQLite        │
│  核心文件: server.ts (78KB, 全部 API), agent-runtime.ts (18KB)│
└───┬──────────────┬──────────────────┬────────────────────────┘
    │              │                  │
    ▼              ▼                  ▼
┌───────────┐ ┌─────────────┐ ┌─────────────────────────┐
│  本体平台  │ │ Python 后端  │ │      LLM 推理层          │
│  本体平台  │ │ Python 后端  │ │  LLM API                │
│           │ │              │ │  api.deepseek.com        │
│ 规则引擎  │ │ KELE 引擎    │ │  max_tokens: 16384~32768 │
│ 知识管理  │ │ .so 加密逻辑 │ │                          │
│ 冲突检测  │ │ 本体/规则JSON│ │                          │
└───────────┘ └─────────────┘ └─────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│                      数据与知识层                              │
│  ┌─────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ skeleton/       │  │ policies/      │  │ workspaces/   │  │
│  │ 骨架种子 23+202 │  │ 15 个策略本体  │  │ 项目/版本/Skill│  │
│  └─────────────────┘  └────────────────┘  └───────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ SQLite 数据库 (sql.js, 无服务端依赖)                      │ │
│  │  - ~/.gs_platform/event-log.db   (审计日志)              │ │
│  │  - 项目/用户/角色/爬虫任务/建模记录                       │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、pi Monorepo 依赖架构

Bridge 依赖 `@earendil-works/pi-coding-agent`（v0.80.7），通过 `file:` 协议链接本地构建产物：

```
pi-monorepo (v0.80.7, 开源 GitHub: earendil-works/pi)
│
├── @earendil-works/pi-ai ──────────── LLM 统一 API 层
│   ├── 30+ 模型提供商 (OpenAI/Anthropic/DeepSeek/...)
│   ├── OAuth 流程 (PKCE/设备码)
│   ├── 流式响应 + 重试 + 诊断
│   └── 图片模型注册
│
├── @earendil-works/pi-agent-core ──── Agent 框架核心
│   ├── agent-loop.ts     Agent 主循环 (think→act→observe)
│   ├── compaction/       上下文压缩 (分支摘要/智能裁剪)
│   ├── session/          会话持久化 (JSONL/SQLite)
│   ├── skills.ts         Skills 技能机制
│   └── proxy.ts          传输层抽象 (RPC 远程 Agent)
│
├── @earendil-works/pi-tui ─────────── 终端 UI 库
│   ├── 差分渲染引擎
│   ├── Markdown 渲染、编辑器、输入框、选择列表
│   └── 终端图片显示 (iTerm2/Kitty 协议)
│
├── @earendil-works/pi-coding-agent ── 主产品 CLI / SDK
│   ├── core/agent-session.ts      会话编排
│   ├── core/tools/                内置工具集 (read/bash/edit/write/...)
│   ├── core/extensions/           扩展系统
│   ├── core/skills.ts             技能系统
│   ├── modes/interactive/         交互模式 (30+ TUI 组件)
│   └── modes/rpc/                 RPC 代理模式
│
└── @earendil-works/pi-orchestrator ─ 多 Agent 编排器 (实验性)
    ├── supervisor.ts   监督者 Agent
    └── ipc/            IPC 通信协议
```

**Bridge 使用 pi SDK 的方式**：
- `createAgentSession()` — 创建 Agent 会话实例
- `SessionManager` — 会话持久化与恢复
- `loadSkillsFromDir()` — 全局 Skill 扫描
- `defineTool()` — 注册自定义工具（如规则引擎工具）
- `DefaultResourceLoader` — 项目文件上下文注入
- `appendSystemPromptOverride` — 注入 Skill 的 SKILL.md 到 system prompt

---

## 四、Bridge 核心模块架构

### 4.1 模块依赖拓扑

```
index.ts (入口)
  ├── crypto.ts          RSA 密钥对生成, JWT secret
  ├── project-store.ts   SQLite 持久化 (sql.js)
  ├── auth.ts            JWT 签发/校验
  │   ├── users-store.ts
  │   └── roles-store.ts
  ├── paths.ts           工作空间目录初始化
  └── server.ts (78KB)   全部 REST API + WebSocket
        ├── agent-runtime.ts     pi SDK 封装, 流式对话
        │   ├── skills.ts        技能扫描 + LLM 生成
        │   ├── skill-tools.ts   jiti 动态编译
        │   └── step2-judge-history.ts
        ├── agent-template.ts    智能体模板复制器
        ├── onto-platform.ts     HTTP 代理层 → 本体平台
        ├── workspace.ts         文件树 CRUD
        ├── projects.ts (115KB)  项目/版本/审批/DataSpace
        ├── step2-build.ts       Step2 编排器
        │   ├── step2-data-source.ts
        │   ├── step2-merge.ts
        │   ├── step2-policy.ts
        │   ├── step2-finalize.ts
        │   └── step2-progress.ts
        ├── publish.ts           rsync/ssh-tar 远程发布
        ├── event-log.ts         SQLite 审计日志
        └── okf.ts               OKF 知识格式
            ├── okf/index.ts
            ├── okf/bundle.ts
            ├── okf/path.ts
            ├── okf/sanitize.ts
            ├── okf/frontmatter.ts
            └── okf/index-md.ts
```

### 4.2 模块职责矩阵

| 模块 | 类型 | 代码量 | 职责 |
|------|------|--------|------|
| `server.ts` | API 聚合 | 78KB | 全部 50+ REST 端点 + WebSocket 实时通信 |
| `projects.ts` | 业务逻辑 | 115KB | 项目 CRUD、版本管理、审批流水线、DataSpace、爬虫导入 |
| `project-store.ts` | 数据层 | 31KB | SQLite 表操作：项目、版本、爬虫任务、建模元数据 |
| `agent-runtime.ts` | Agent 核心 | 18KB | pi SDK 封装：会话创建/恢复/销毁、流式对话、Skill 注入 |
| `workspace.ts` | 文件 I/O | 11KB | 工作空间文件树的 CRUD、复制、移动、下载 |
| `onto-platform.ts` | 网络代理 | 4KB | Cookie 会话 + HTTP 转发 + 401 自动重登 |
| `step2-build.ts` | 流水线 | 8KB | 自动化建模三阶段：extract → derive → merge |
| `auth.ts` | 认证 | 4KB | JWT 签发/校验，bcrypt 密码哈希 |

### 4.3 数据层设计

```
存储层次:
  ┌─ 文件系统 ───────────────────────────────────┐
  │  ~/.gs_platform/workspace/                    │
  │    proj-<uuid>/versions/<ver>/                │
  │      version.json (含 step2_progress 内嵌)    │
  │      ontology.json (建模元数据快照)            │
  │      skills/<skillId>/SKILL.md                │
  │      data/  (政策文档)                         │
  ├─ SQLite ─────────────────────────────────────┤
  │  ~/.gs_platform/event-log.db (审计日志)        │
  │  project-store: 项目/版本/爬虫任务/建模记录    │
  ├─ JSON 配置 ──────────────────────────────────┤
  │  bridge/config.json                           │
  │  ~/.gs_platform/users.json                    │
  │  ~/.gs_platform/roles.json                    │
  └─ pi Agent 配置 ──────────────────────────────┤
     ~/.pi/agent/settings.json                    │
     ~/.pi/agent/auth.json                        │
     ~/.pi/agent/skills/  (全局 Skill)            │
```

---

## 五、知识引擎架构

### 5.1 骨架种子（skeleton）

冷启动模板，新建策略时自动继承：

```
skeleton/
├── concept.json   23 个概念 (Baby/Applicant/补贴标准/申领条件...)
├── operator.json  202 个算子 (本市户籍/本省户籍/社保/居住证/收入...)
└── meta.json      骨架元信息
```

概念结构：
```json
{
  "id": "concept_a59613efb06e",
  "canonical_name": "Baby",
  "description": "资格判定对象:0-3周岁婴幼儿",
  "supply": { "kind": "entity", "zh": "婴幼儿" }
}
```

算子结构：
```json
{
  "id": "operator_dbf6ab4cf8df",
  "canonical_name": "本市户籍",
  "input_concepts": ["concept_a59613efb06e"],
  "output_concept": "concept_866619eb6b93",
  "description": "婴幼儿是否具有本市户籍",
  "supply": {
    "kind": "attr",
    "zh": "婴幼儿是否具有本市户籍",
    "hint": "用户必须明确说明婴幼儿具有本地户籍..."
  }
}
```

### 5.2 策略本体（ontology）

每个省/市一个策略本体，15 个已部署：

```
policies/ontology_<12chars>/
├── policy.json         策略元信息
├── working/            当前工作版本 (concept/operator/rule/procedure/region.json)
├── extracted/          原始文档提取结果 (按省市分目录)
├── derived/            合并后的派生结果
├── merge_plans/        合并计划 (版本追踪)
└── 覆盖省市: 北京市、安徽省...
```

### 5.3 规则引擎调用链

```
用户输入 (自然语言)
  → pi Agent 调用 policy_rule_engine 工具
  → policy-rule-engine-tool.ts (defineTool)
  → policy-rule-engine.ts (queryPolicy)
  → POST /api/query → 本体平台规则引擎
  → 返回 { verdict: "eligible"|"missing_info"|"ineligible", missing: [...], conclusions: [...] }
  → agent-runtime.ts: recordRuleEngineJudgeHistory
  → 从 onto-platform 拉取规则全集，推导命中规则
  → appendJudgeHistory → version.json
```

---

## 六、安全架构

| 层次 | 机制 | 实现 |
|------|------|------|
| 传输层 | JWT Bearer Token | `auth.ts` — HS256 签发，24h 过期 |
| 传输层 | bcrypt | 密码哈希存储 |
| 传输层 | RSA 密钥对 | `crypto.ts` — 加密字段（如 onto-platform 密码） |
| 会话层 | Cookie 会话 | `onto-platform.ts` — 30min TTL，401 自动重登 |
| 应用层 | RBAC | `roles-store.ts` — 18 个权限点，角色可自定义 |
| 应用层 | 软删除 | `users-store.ts` — disable/enable 用户 |
| 代码层 | .so 加密 | gov-policy-secure: 核心逻辑 + KELE 引擎编译为机器码 |
| 审计层 | 事件日志 | `event-log.ts` — SQLite 记录，3s 批量落盘 |

### RBAC 权限模型

```
角色 (Role)
  ├── code: "admin" | "reviewer" | "developer" | "viewer"
  ├── permissions: [18 个权限点]
  │   ├── project:create / project:delete
  │   ├── version:create / version:submit_review
  │   ├── review:approve / review:reject
  │   ├── user:manage / role:manage
  │   ├── skill:edit / skill:generate
  │   └── ...
  └── 内置角色不可删除，自定义角色可增删
```

---

## 七、通信协议

### 7.1 Bridge ↔ 前端

| 协议 | 用途 | 端点 |
|------|------|------|
| REST | 项目管理/用户/权限/文件树/审批 | `server.ts` 50+ 端点 |
| WebSocket | Agent 流式对话 | `/ws/chat` |

### 7.2 Bridge ↔ 本体平台

| 协议 | 鉴权 | 特性 |
|------|------|------|
| HTTP REST | Cookie (30min TTL) | `proxyOnto()` 统一代理，401 自动重登，默认超时 300s |

### 7.3 Bridge ↔ LLM

| 配置项 | 值 |
|--------|-----|
| Provider | DeepSeek (兼容 Anthropic 协议) |
| Model | deepseek-v4-flash |
| Endpoint | https://api.deepseek.com |
| Max Tokens | 16384 (bridge) / 32768 (secure backend) |

---

## 八、性能与资源观测

| 指标 | 值 | 备注 |
|------|-----|------|
| Bridge 进程内存 | ~197MB (Node) | PID 189536, 0.3% CPU |
| Python 后端内存 | ~290MB | PID 1030, 3.3% CPU |
| PM2 守护进程 | ~75MB | PID 52152 |
| EDG 安全监控 | ~180MB | edr-watch (root) |
| MinIO 服务 | ~147MB | root 进程 |
| Docker daemon | ~110MB | root 进程 |
| 系统总内存 | 15GB, 已用 2.2GB | 可用 12GB, 无 Swap |
| 磁盘 | 46GB/99GB (48%) | 有大文件 gov-subsidy-tool.zip (570MB) |
| 网络 | 公网可达 | 5174/8787/18221 端口对外开放 |

---

## 九、技术栈汇总

| 层 | 技术 | 版本/说明 |
|----|------|-----------|
| 运行时 | Node.js | ≥22.19.0 |
| 语言 | TypeScript | 5.9.3 |
| 编译/运行 | tsx + tsgo | jiti 热重载, tsgo 构建 |
| Web 框架 | Express | 4.x |
| WebSocket | ws | 8.x |
| 数据库 | SQLite (sql.js) | 纯 JS 实现，无服务端依赖 |
| LLM SDK | pi-ai | 30+ 统一 API |
| Agent 框架 | pi-agent-core / pi-coding-agent | v0.80.7 |
| 动态编译 | jiti | 2.7.0 |
| 类型校验 | typebox | 1.1.38 |
| 认证 | JWT + bcrypt + RSA | HS256, 10 salt rounds |
| 前端 | Vue 3 + Vite | SPA 单页应用 |
| Python | 3.13 | venv, 核心逻辑 .so 加密 |
| 本体引擎 | KELE | .whl 加密 wheel |
| LLM 后端 | DeepSeek V4 Flash | Anthropic 协议兼容 |
| 对象存储 | MinIO | 内网部署 |
| 反向代理 | Nginx | (参考配置已提供) |
| 进程管理 | PM2 | v5.4.3 |
| 容器 | Docker | (bridge 用户无权限) |
| OS | Linux (x86_64) | 国产 Linux 发行版 |
