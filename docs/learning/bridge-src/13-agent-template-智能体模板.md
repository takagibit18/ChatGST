# 智能体模板 — 从模板创建 Agent

> 源文件：`bridge/src/agent-template.ts`

```typescript
/**

 * 智能体模板复制器

 *

 * 从 src/example/policy-template/ 参考模板复制完整智能体到项目 skills 目录：

 * - 复制 SKILL.md + tools/*.ts + config.json

 * - 替换 SKILL.md 里的"育儿补贴"为用户指定的名称，更新 description

 * - 写入 config.json（policyId + 规则引擎凭证，凭证缺失时从 bridge config.json.ontoPlatform 补全）

 *

 * 模板里的 tools/*.ts 用 import.meta.url 相对定位 config.json，不依赖目录名，复制后可直接运行。

 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { dirname, join } from 'node:path'

import { fileURLToPath } from 'node:url'

import { ensureProjectWorkspace } from './workspace.js'

import { getOntoPlatformConfig } from './config.js'

import { copyDirSync } from './fs-safe.js'



/** 模板目录：src/example/policy-template/

 *  （保持 ASCII 命名：Node 22.17 Windows 上 cpSync 遇非 ASCII 路径会段错误，

 *   本文件已改用 copyDirSync，ASCII 名同时避免其他工具链兼容问题） */

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'example', 'policy-template')



/** 模板名称（用于 SKILL.md 正文全局替换） */

const TEMPLATE_NAME = '育儿补贴'



export interface CreateAgentOptions {

  /** 智能体名称（如"人才引进"），用作 SKILL.md 的 name 和正文替换 */

  name: string

  /** 智能体描述，写入 SKILL.md frontmatter 的 description */

  description: string

  /** 规则引擎 policyId（如 "ontology_xxx"），写入 config.json */

  policyId?: string

  /** 政策文件目录路径（相对 CWD 或绝对路径），默认 "data"，写入 config.json */

  policyDocsDir?: string

  /** 规则引擎凭证；password 为空时从 bridge config.json.ontoPlatform 补全 */

  ruleEngine?: {

    url?: string

    username?: string

    password?: string

  }

}



export interface CreateAgentResult {

  /** skill 目录名（slugify 后的 name） */

  skillId: string

  /** 生成的 SKILL.md 内容（供前端预览） */

  skillMdContent: string

}



interface SkillConfig {

  policyId?: string

  policyDocsDir?: string

  ruleEngine: {

    url: string

    username: string

    password: string

  }

}



/** name → skillId：允许中文/字母/数字/._-，其余替换为 _ */

function slugify(name: string): string {

  // 保留：字母数字、下划线、点、连字符、CJK 汉字（\u4e00-\u9fff 覆盖基本区+扩展A）

  const id = name.trim().replace(/[^\w.\-\u4e00-\u9fff]/g, '_').replace(/^[_\s]+|[_\s]+$/g, '')

  return id || 'agent'

}



/**

 * 从模板创建智能体：

 * 1. 复制 src/example/育儿补贴/ → skills/<skillId>/

 * 2. 替换 SKILL.md 里的"育儿补贴"为 opts.name，更新 description

 * 3. 写入 config.json（policyId + 规则引擎凭证）

 * 4. 删除 README.md（模板说明文件，不需要随智能体分发）

 * 5. 返回 SKILL.md 内容供前端预览

 *

 * 注意：generate 阶段即落盘。如果用户在 preview 阶段取消，已写入的文件保留（可在文件树手动删除）。

 */

export function createAgentFromTemplate(projectId: string, versionId: string, opts: CreateAgentOptions): CreateAgentResult {

  if (!opts.name?.trim()) throw new Error('智能体名称必填')

  if (!opts.description?.trim()) throw new Error('智能体描述必填')



  const skillId = slugify(opts.name)

  const cwd = ensureProjectWorkspace(projectId, versionId)

  const dest = join(cwd, 'skills', skillId)



  // 1. 复制模板（目标已存在则先删除再覆盖；用 copyDirSync 替代 cpSync，兼容中文目标路径）

  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })

  copyDirSync(TEMPLATE_DIR, dest)



  // 2. 替换 SKILL.md 内容

  const skillMdPath = join(dest, 'SKILL.md')

  let skillMd = readFileSync(skillMdPath, 'utf-8')



  // 先全局替换正文里的模板名称（"育儿补贴" → opts.name），

  // 再写 frontmatter，避免先写的 name/description 被二次替换（如 name 含"育儿补贴"时会重复拼接）

  skillMd = skillMd.split(TEMPLATE_NAME).join(opts.name.trim())

  skillMd = skillMd.replace(/^name:\s*.+$/m, `name: ${opts.name.trim()}`)

  skillMd = skillMd.replace(/^description:\s*.+$/m, `description: ${opts.description.trim()}`)



  writeFileSync(skillMdPath, skillMd, 'utf-8')



  // 3. 写入 config.json（policyId + 规则引擎凭证）

  const configPath = join(dest, 'config.json')

  let ruleEngineCfg: SkillConfig['ruleEngine']



  // 规则引擎凭证：优先用用户填的，缺失字段从 bridge config.json.ontoPlatform 补全

  try {

    const ontoCfg = getOntoPlatformConfig()

    ruleEngineCfg = {

      url: (opts.ruleEngine?.url?.trim() || ontoCfg.url).replace(/\/+$/, ''),

      username: opts.ruleEngine?.username?.trim() || ontoCfg.username,

      password: opts.ruleEngine?.password?.trim() || ontoCfg.password,

    }

  } catch {

    // bridge 未配置 ontoPlatform，用用户填的值（可能不完整）

    ruleEngineCfg = {

      url: (opts.ruleEngine?.url?.trim() || '').replace(/\/+$/, ''),

      username: opts.ruleEngine?.username?.trim() || '',

      password: opts.ruleEngine?.password?.trim() || '',

    }

  }



  const config: SkillConfig = {

    policyId: opts.policyId?.trim() || undefined,

    policyDocsDir: opts.policyDocsDir?.trim() || 'data',

    ruleEngine: ruleEngineCfg,

  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')



  // 4. 删除 README.md（模板说明文件，不需要随智能体分发）

  const readmePath = join(dest, 'README.md')

  if (existsSync(readmePath)) rmSync(readmePath, { force: true })



  return { skillId, skillMdContent: skillMd }

}


```
