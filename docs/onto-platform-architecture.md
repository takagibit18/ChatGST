# 本体智能体平台 — 架构与本地实现文档

> 从 ChatGST 单领域 Agent 到多领域本体智能体平台的迁移记录

---

## 一、项目演进路线

```
ChatGST (单领域)
  ├── 硬编码: intent 正则 + 5 个工具 + BM25 检索
  ├── 领域绑定: 北京+河北育儿补贴
  └── 架构: 独立应用，自建 Runtime

        ↓ 迁移到

本体智能体平台 (多领域)
  ├── 配置驱动: SKILL.md + config.json + tools/*.ts
  ├── 领域扩展: 加 skills/新领域/ 目录即可
  └── 架构: onto-bridge (中间件) + pi-coding-agent (运行时) + onto-platform (本体服务)
```

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│  pi-coding-agent (Agent 运行时框架)                       │
│  · Agent Loop + 工作流引擎                                │
│  · defineTool / jiti 动态加载                             │
│  · 会话管理 / 模型运行时 / 流式输出                        │
├─────────────────────────────────────────────────────────┤
│  onto-bridge (本项目 — 中间件)                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Step2 建模管道                                     │  │
│  │   scanDataDir → extract → derive → merge → finalize │  │
│  │   文档 → 结构化规则 → 冲突合并 → ontology.json       │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ Skill 工具加载器 (skill-tools.ts)                   │  │
│  │   jiti 动态 import skills/<name>/tools/*.ts        │  │
│  │   alias 解析: @sinclair/typebox, pi-coding-agent   │  │
│  │   mtime 检测 + 热更新                              │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ 本体平台 HTTP 代理 (onto-platform.ts)               │  │
│  │   session cookie 管理 (30min TTL)                  │  │
│  │   3 次指数退避重试 (ChatGST 迁移)                   │  │
│  │   MOCK_ONTO=1 本地模拟模式                         │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ 审计日志 (event-log.ts)                            │  │
│  │   SQL.js 持久化 → ~/.onto-platform/event-log.db    │  │
│  │   3s 间隔 flush                                    │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ 多项目/多版本管理                                   │  │
│  │   workspaces/{project}/versions/{version}/          │  │
│  │   ├ version.json (step2_progress)                  │  │
│  │   ├ _step2_done.json (已处理文件缓存)               │  │
│  │   ├ ontology.json (本体元数据)                      │  │
│  │   └ skills/{skillId}/ (SKILL.md + config + tools)  │  │
│  └───────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  onto-platform (远端本体服务 — Mock 替代中)               │
│  · /api/login          session 认证                     │
│  · /api/onto/extract   文档→规则 (LLM 语义提取)          │
│  · /api/onto/derive    规则推导 (本体推理)               │
│  · /api/merge-all      多地域规则冲突合并                │
│  · /api/query          规则引擎资格判定                  │
└─────────────────────────────────────────────────────────┘
```

## 三、模块清单

| # | 文件 | 行数 | 功能 | 本地状态 |
|---|------|------|------|:--:|
| 01 | `index.ts` | 35 | 启动入口 (bootstrapOntoPlatform) | ✅ |
| 02 | `paths.ts` | 30 | 工作区路径 + 版本目录 | ✅ |
| 03 | `types.ts` | 70 | Step2Progress / RegionLevels / OntologyMeta | ✅ |
| 04 | `config.ts` | 55 | config.json 读取 + MOCK_ONTO 支持 | ✅ |
| 05 | `onto-platform.ts` | 150 | HTTP 代理 + session + retry + mock | ✅ |
| 06 | `event-log.ts` | 70 | SQL.js 审计日志 | ✅ |
| 07 | `step2-data-source.ts` | 90 | 政策文档扫描 + frontmatter 解析 + 地域推断 | ✅ |
| 08 | `step2-progress.ts` | 65 | 6 阶段进度持久化 | ✅ |
| 09 | `step2-merge.ts` | 90 | 两阶段规则合并 (preview + commit) | ✅ |
| 10 | `step2-build.ts` | 160 | Step2 编排器 (scan→extract→derive→merge) | ✅ |
| 11 | `step2-finalize.ts` | 65 | ontology.json 元数据写入 | ✅ |
| 12 | `skill-tools.ts` | 110 | jiti 动态工具加载 + alias + 热更新 | ✅ |
| 13 | `agent-template.ts` | 90 | 智能体模板创建 (SKILL.md + config.json) | ✅ |
| 14 | `server.ts` | 45 | HTTP 服务入口 | ⚠️ stub |
| - | `auth.ts` | 20 | 认证模块 | ⚠️ stub |
| - | `roles-store.ts` | 15 | 角色管理 | ⚠️ stub |
| - | `users-store.ts` | 10 | 用户管理 | ⚠️ stub |
| - | `project-store.ts` | 35 | 项目持久化 | ⚠️ stub |
| - | `mock-onto.ts` | 200 | Mock onto-platform 全部 API | ✅ |

## 四、当前本地可运行的内容

### 4.1 Step2 完整建模管道 ✅

```bash
MOCK_ONTO=1 npx tsx -e "
import { runStep2AutoModeling } from './packages/onto-bridge/src/onto-bridge.js';
await runStep2AutoModeling('demo', 'v3', 'policy_001', 'path/to/data');
"
```

输出:
```
[step2] extract+derive OK: 北京市\001-北京市-政策规章.md
[step2] extract+derive OK: 安徽市\001-安徽省-政策规章.md
phase: review  2/2 processed  0 errors
merge: 2 merged, 0 failed
```

### 4.2 Skill 工具动态加载 ✅

```bash
node --import tsx -e "
import { loadSkillTools } from './packages/onto-bridge/src/onto-bridge.js';
const tools = await loadSkillTools(process.cwd(), ['育儿补贴']);
// → 1 tool: policy_rule_engine (region, policyType, userConditions, question)
"
```

### 4.3 Mock 规则引擎查询 ✅

```bash
node --import tsx -e "
import { mockOntoResponse } from './packages/onto-bridge/src/mock-onto.js';
const result = mockOntoResponse('POST', '/api/query', {
  region: '北京市', text: '5个月孩子，北京户口'
});
// → { verdict: 'eligible', ... }
"
```

### 4.4 审计日志 ✅

```bash
node --import tsx -e "
import { logEvent } from './packages/onto-bridge/src/onto-bridge.js';
await logEvent({ actor: 'admin', action: 'step2_run', target: 'demo', detail: { files: 2 } });
"
// → ~/.onto-platform/event-log.db
```

### 4.5 Agent 模板创建 ✅

```bash
node --import tsx -e "
import { createAgentFromTemplate } from './packages/onto-bridge/src/onto-bridge.js';
const r = createAgentFromTemplate('demo', 'v1', { name: '育儿补贴', description: '...' });
// → skillId: '育儿补贴', SKILL.md + config.json 生成
"
```

### 4.6 端到端 Mock 测试 — 6/8 通过 ✅

8 个测试用例覆盖：资格判断、材料检索、流程查询、地区不支持、非政策拒绝、信息缺失提示。6/8 通过，2 个失败是 Mock 关键词库不全（非架构问题）。

## 五、与线上链路的差距

| 模块 | 线上 | 本地 | 差距等级 |
|------|------|------|:--:|
| **本体存储** | onto-platform 持久化规则库 + 图引擎 | 内存 Map（query 不与 extract/derive 共享） | 🔴 核心 |
| **规则提取** | LLM 语义理解文档 | 正则关键词匹配 | 🔴 语义质量 |
| **规则推导** | 本体推理（显式→隐式关系） | 假数据生成 | 🔴 无推理 |
| **规则引擎** | 遍历规则库 + 条件匹配 | if/else 关键词 | 🔴 无规则库 |
| **Agent 运行时** | pi-coding-agent 完整 Loop | 未对接（框架已安装） | 🟡 待对接 |
| **Skill 层** | jiti 加载合法 .ts 文件 | ✅ 已跑通 | ✅ |
| **Step2 管道** | 编排 extract/derive/merge | ✅ Mock 全链路 | ✅ |
| **数据扫描** | 相同逻辑 | ✅ 一致 | ✅ |
| **进度管理** | 相同逻辑 | ✅ 一致 | ✅ |
| **审计日志** | 相同逻辑 | ✅ 一致 | ✅ |

## 六、待补事项优先级

| 优先级 | 事项 | 工作量 |
|:--:|------|------|
| P0 | 本地 SQLite 规则库：extract→写入，derive→补充，query→遍历 | 半天 |
| P1 | 对接 ChatGST PolicyAgentRuntime 作为 Agent 引擎 | 半天 |
| P1 | 注入 onto-bridge Skill 工具到 Agent | 随 P1 |
| P2 | 接入 DeepSeek 做真正的规则提取（替换 Mock 正则） | 一天 |
| P2 | 规则引擎条件匹配（替换 Mock if/else） | 一天 |
| P3 | pi-coding-agent createAgentSession 完整对接 | 两天 |

## 七、关键技术决策

1. **MOCK_ONTO=1 环境变量控制本地/远程模式**：proxyOnto() 在 mock 模式下不走网络，直接调用 mock-onto.ts 的本地模拟函数

2. **jiti alias 解决依赖路径问题**：工具代码 `import from 'typebox'` 通过 alias 映射到本地 `@sinclair/typebox`

3. **`.ts.md` → `.ts` 转换**：平台代码文档化机制，本地需要手动提取

4. **ChatGST 能力复用**：onto-platform.ts 的 retry 机制直接复用了 ChatGST 的指数退避设计

5. **Step2 六阶段进度模型**：idle → extract → derive → merge → review → done/failed，每阶段持久化到 version.json
