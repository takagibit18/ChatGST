/**
 * packages/onto-bridge — 本体智能体平台 Bridge
 *
 * 从 ChatGST 的单领域 Agent 扩展到多领域、多项目、多版本的本体平台
 *
 * 模块索引:
 *   01-index.ts         入口 + 启动顺序
 *   02-paths.ts         工作区路径管理
 *   03-types.ts         核心类型 (Step2Progress, RegionLevels, OntologyMeta)
 *   04-config.ts        配置管理 (ontoPlatform, server, auth)
 *   05-onto-platform.ts 本体平台 HTTP 代理 (session + retry)
 *   06-event-log.ts     审计日志 (SQL.js)
 *   07-step2-data-source.ts  政策数据扫描 (frontmatter 解析 + 地域推断)
 *   08-step2-progress.ts     Step2 进度持久化
 *   09-step2-merge.ts        两阶段规则合并
 *   10-step2-build.ts        Step2 自动建模编排器
 *   11-step2-finalize.ts     Step2 收尾 (ontology.json)
 *   12-skill-tools.ts        jiti 动态工具加载器
 *   13-agent-template.ts     智能体模板创建
 *   14-server.ts            HTTP 服务入口
 *
 *   auth.ts / roles-store.ts / users-store.ts / project-store.ts — stub 实现
 */
export { bootstrapOntoPlatform } from "./index.js";
export { proxyOnto, OntoRequestError, getOntoSummary } from "./onto-platform.js";
export { runStep2AutoModeling } from "./step2-build.js";
export { runMergeAllWithResolutions } from "./step2-merge.js";
export { finalizeStep2 } from "./step2-finalize.js";
export { scanDataDir, loadStep2Config } from "./step2-data-source.js";
export { readStep2Progress, writeStep2Progress } from "./step2-progress.js";
export { loadSkillTools } from "./skill-tools.js";
export { createAgentFromTemplate } from "./agent-template.js";
export { logEvent } from "./event-log.js";
export * from "./types.js";
export * from "./config.js";
