# 育儿补贴本体智能体平台 — 源码索引

> 总文件数：**39 个 .ts 源文件 + 3 个 .json 配置 + 4 个知识数据文件 = 46 个 md 文档**

---

## 架构概览

```
policy-agent-bridge (Node/Express)
    │
    ├── pi-coding-agent SDK ──→ LLM (DeepSeek V4 Flash)
    ├── onto-platform.ts ──────→ 本体平台 
    ├── step2-*.ts ────────────→ 政策数据建模流水线
    ├── okf/ ──────────────────→ 知识格式转换
    └── skills/tools ──────────→ 规则引擎工具
```

---

## 📂 bridge-src/ — 源码文档（36 个 .ts + 3 个 .json）

### 🔵 入口与配置（01-03）

| 文件 | 说明 |
|------|------|
| [01-index-入口.md](bridge-src/01-index-入口.md) | 启动入口：初始化 crypto/auth/store → startServer |
| [02-config-配置.md](bridge-src/02-config-配置.md) | 多来源配置读取：config.json → 类型化 getter |
| [03-types-核心类型.md](bridge-src/03-types-核心类型.md) | Step2Config / Step2Progress / OntologyMeta 等核心类型 |

### 🟢 本体平台对接（04）

| 文件 | 说明 |
|------|------|
| [04-onto-platform-本体平台代理.md](bridge-src/04-onto-platform-本体平台代理.md) | Cookie 会话维护 + `/api/onto/*` 请求转发，401 自动重登 |

### 🟡 Step2 流水线（05-11）— 政策数据自动建模

| 文件 | 说明 |
|------|------|
| [05-step2-progress-进度管理.md](bridge-src/05-step2-progress-进度管理.md) | 进度读写 + 幂等断点续跑缓存 |
| [06-step2-data-source-数据源.md](bridge-src/06-step2-data-source-数据源.md) | 扫描 data 目录，解析政策文件元信息 |
| [07-step2-build-自动建模编排.md](bridge-src/07-step2-build-自动建模编排.md) | **核心编排**：extract → derive → merge-all 三阶段 |
| [08-step2-merge-两阶段合并.md](bridge-src/08-step2-merge-两阶段合并.md) | 预览(dry_run) → 冲突决策(resolutions) → 提交 |
| [09-step2-policy-策略管理.md](bridge-src/09-step2-policy-策略管理.md) | 本体策略创建/克隆到 onto-platform |
| [10-step2-finalize-收尾.md](bridge-src/10-step2-finalize-收尾.md) | 生成 ontology.json 元数据记录 |
| [11-step2-judge-history-判定历史.md](bridge-src/11-step2-judge-history-判定历史.md) | 规则引擎调用后记录命中规则 ID |

### 🔴 Agent 核心（12-15）

| 文件                                                                  | 说明                                      |
| ------------------------------------------------------------------- | --------------------------------------- |
| [12-agent-runtime-代理运行时.md](bridge-src/12-agent-runtime-代理运行时.md)   | pi SDK 封装：会话管理 / 流式对话 / Skill 注入 / 规则判定 |
| [13-agent-template-智能体模板.md](bridge-src/13-agent-template-智能体模板.md) | 从 policy-template 复制生成新 Agent           |
| [14-skills-技能列表.md](bridge-src/14-skills-技能列表.md)                   | 全局 + 项目级技能扫描，LLM 辅助生成                   |
| [15-skill-tools-动态工具加载.md](bridge-src/15-skill-tools-动态工具加载.md)     | jiti 运行时编译 .ts 工具文件                     |

### 🟣 认证与安全（16-19）

| 文件 | 说明 |
|------|------|
| [16-auth-认证.md](bridge-src/16-auth-认证.md) | JWT 签发/校验 + 用户密码管理 |
| [17-crypto-加密.md](bridge-src/17-crypto-加密.md) | RSA 密钥对生成 + 加密/解密工具 |
| [18-roles-store-角色权限.md](bridge-src/18-roles-store-角色权限.md) | RBAC：角色 CRUD + 权限点校验 |
| [19-users-store-用户管理.md](bridge-src/19-users-store-用户管理.md) | 用户 CRUD + 软删除 |

### 🟠 工作空间与项目（20-23）

| 文件 | 说明 |
|------|------|
| [20-workspace-工作空间.md](bridge-src/20-workspace-工作空间.md) | 文件树 CRUD：读/写/复制/移动/删除 |
| [21-projects-项目管理.md](bridge-src/21-projects-项目管理.md) | **最大文件**（115KB）：项目/版本/审批流水线/DataSpace |
| [22-project-store-持久化存储.md](bridge-src/22-project-store-持久化存储.md) | SQLite 操作：项目/版本/爬虫任务/建模记录 |
| [23-paths-路径工具.md](bridge-src/23-paths-路径工具.md) | 工作空间目录初始化 |

### 🔵 HTTP 服务（24）

| 文件 | 说明 |
|------|------|
| [24-server-主服务.md](bridge-src/24-server-主服务.md) | **全部 REST API + WebSocket**：对话/项目/用户/审批/发布 |

### 🟤 发布与审计（25-26）

| 文件 | 说明 |
|------|------|
| [25-publish-远程发布.md](bridge-src/25-publish-远程发布.md) | rsync/ssh-tar 同步到远程生产环境 |
| [26-event-log-审计日志.md](bridge-src/26-event-log-审计日志.md) | SQLite 事件记录，3 秒批量落盘 |

### ⚪ OKF 知识格式（27-33）

| 文件                                                                        | 说明                      |
| ------------------------------------------------------------------------- | ----------------------- |
| [27-okf-入口.md](bridge-src/27-okf-入口.md)                                   | OKF 转换入口                |
| [28-okf-index-索引.md](bridge-src/28-okf-index-索引.md)                       | 本体策略目录构建                |
| [29-okf-bundle-打包.md](bridge-src/29-okf-bundle-打包.md)                     | 知识包导出                   |
| [30-okf-path-路径.md](bridge-src/30-okf-path-路径.md)                         | 路径解析                    |
| [31-okf-sanitize-清洗.md](bridge-src/31-okf-sanitize-清洗.md)                 | 文件名安全处理                 |
| [32-okf-frontmatter-元数据.md](bridge-src/32-okf-frontmatter-元数据.md)         | Markdown frontmatter 解析 |
| [33-okf-index-md-Markdown索引.md](bridge-src/33-okf-index-md-Markdown索引.md) | Markdown 目录索引生成         |

### 🟢 规则引擎工具（34-35）

| 文件 | 说明 |
|------|------|
| [34-policy-rule-engine-规则引擎客户端.md](bridge-src/34-policy-rule-engine-规则引擎客户端.md) | HTTP 调用 onto-platform `/api/query` |
| [35-policy-rule-engine-tool-pi自定义工具.md](bridge-src/35-policy-rule-engine-tool-pi自定义工具.md) | pi `defineTool` 注册为 Agent 工具 |

### 🔶 其他（36 + 50-52）

| 文件                                                              | 说明                               |
| --------------------------------------------------------------- | -------------------------------- |
| [36-fs-safe-安全文件操作.md](bridge-src/36-fs-safe-安全文件操作.md)         | 递归复制（兼容中文路径）                     |
| [50-SKILL-md-育儿补贴模板.md](bridge-src/50-SKILL-md-育儿补贴模板.md)       | **核心提示词**：育儿补贴 Agent 完整 SKILL.md |
| [51-config-json-模板配置.md](bridge-src/51-config-json-模板配置.md)     | Agent 模板 config.json             |
| [52-bridge-config-桥接配置.md](bridge-src/52-bridge-config-桥接配置.md) | Bridge 根配置                       |

---

## 📂 data-skeleton/ — 育儿补贴知识骨架

| 文件                                       | 说明                             |
| ---------------------------------------- | ------------------------------ |
| [meta.md](data-skeleton/meta.md)         | 骨架元信息：23 概念 + 202 算子           |
| [concept.md](data-skeleton/concept.md)   | 23 个本体概念（Baby/Applicant/补贴标准等） |
| [operator.md](data-skeleton/operator.md) | 202 个算子（户籍/社保/居住证等判定逻辑）        |
| [manifest.md](data-skeleton/manifest.md) | 15 个策略本体版本索引                   |

---

## 📊 模块依赖关系

```
index.ts
  ├── crypto.ts ──────→ RSA 密钥对
  ├── project-store.ts → SQLite
  ├── auth.ts ─────────→ JWT + crypto
  │   ├── users-store.ts → SQLite
  │   └── roles-store.ts → SQLite
  ├── paths.ts
  └── server.ts ───────→ 全部 REST/WS
        ├── agent-runtime.ts → pi SDK
        │   ├── skills.ts
        │   ├── skill-tools.ts → jiti
        │   └── step2-judge-history.ts
        ├── agent-template.ts → policy-template/
        │   └── fs-safe.ts
        ├── onto-platform.ts → 本体平台 API
        ├── workspace.ts
        ├── projects.ts (115KB) → project-store.ts
        ├── step2-build.ts → step2-*.ts
        ├── publish.ts → rsync/ssh
        ├── event-log.ts → SQLite
        └── okf.ts → okf/*.ts
```

