# 技能列表 — 全局/项目技能扫描

> 源文件：`bridge/src/skills.ts`

```typescript
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

import { basename, dirname, join } from 'node:path'

import { getAgentDir, loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent'

import { ensureProjectWorkspace, readDataContext } from './workspace.js'

import { llmComplete } from './agent-runtime.js'



export type SkillSource = 'global' | 'project'



export interface SkillSummary {

  id: string

  name: string

  description: string

  version: string

  path: string

  source: SkillSource

}



function parseVersion(content: string): string {

  const m = content.match(/^version:\s*["']?([^\n"']+)/m)

  return m?.[1]?.trim() || 'v1.0.0'

}



function skillIdFromPath(filePath: string, fallbackName: string): string {

  const parent = basename(dirname(filePath))

  if (parent && parent !== 'skills' && parent !== '.') return parent

  return fallbackName

}



function summarizeDir(skillsDir: string, source: SkillSource): SkillSummary[] {

  if (!existsSync(skillsDir)) return []



  const result: SkillSummary[] = []

  for (const ent of readdirSync(skillsDir, { withFileTypes: true })) {

    if (!ent.isDirectory()) continue

    const skillMd = join(skillsDir, ent.name, 'SKILL.md')

    if (!existsSync(skillMd) || !statSync(skillMd).isFile()) continue

    const content = readFileSync(skillMd, 'utf-8')

    const nameMatch = content.match(/^name:\s*["']?([^\n"']+)/m)

    const descMatch = content.match(/^description:\s*["']?([^\n"']+)/m)

    const name = nameMatch?.[1]?.trim() || ent.name

    const description = descMatch?.[1]?.trim() || ''

    result.push({

      id: ent.name,

      name,

      description,

      version: parseVersion(content),

      path: source === 'global' ? `~/.pi/agent/skills/${ent.name}/SKILL.md` : `skills/${ent.name}/SKILL.md`,

      source,

    })

  }

  return result

}



/** Global agent skills: ~/.pi/agent/skills */

export function globalSkillsDir(): string {

  return join(getAgentDir(), 'skills')

}



/**

 * List skills for the picker: global (~/.pi/agent/skills) ∪ project skills/.

 * Same id: project overrides global. Edit-mode file tree is unchanged (project only).

 */

export function listProjectSkills(projectId: string, versionId: string): SkillSummary[] {

  const cwd = ensureProjectWorkspace(projectId, versionId)

  const global = summarizeDir(globalSkillsDir(), 'global')

  const project = summarizeDir(join(cwd, 'skills'), 'project')



  const byId = new Map<string, SkillSummary>()

  for (const s of global) byId.set(s.id, s)

  for (const s of project) byId.set(s.id, s) // project wins

  return [...byId.values()].sort((a, b) => {

    if (a.source !== b.source) return a.source === 'global' ? -1 : 1

    return a.name.localeCompare(b.name)

  })

}



function matchSkill(skill: Skill, skillIds: Set<string>): boolean {

  if (skillIds.has(skill.name)) return true

  const id = skillIdFromPath(skill.filePath, skill.name)

  return skillIds.has(id)

}



/** Load Skill objects for pi skillsOverride from global + project dirs. */

export function loadPiSkills(projectId: string, versionId: string, skillIds?: string[]): Skill[] {

  if (!skillIds || skillIds.length === 0) return []

  const allow = new Set(skillIds)

  const cwd = ensureProjectWorkspace(projectId, versionId)



  const { skills: globalSkills } = loadSkillsFromDir({

    dir: globalSkillsDir(),

    source: 'global',

  })

  const { skills: projectSkills } = loadSkillsFromDir({

    dir: join(cwd, 'skills'),

    source: 'project',

  })



  // project overrides global on same name/id

  const byKey = new Map<string, Skill>()

  for (const s of globalSkills) {

    if (!matchSkill(s, allow)) continue

    byKey.set(skillIdFromPath(s.filePath, s.name), s)

  }

  for (const s of projectSkills) {

    if (!matchSkill(s, allow)) continue

    byKey.set(skillIdFromPath(s.filePath, s.name), s)

  }

  return [...byKey.values()]

}



// ---- LLM-powered skill generation ----



const SKILL_GENERATION_SYSTEM_PROMPT = `你是一个政务领域技能编写专家。根据用户提供的技能名称、描述和项目数据文件，生成一份完整的 SKILL.md 内容。



输出要求：

1. 必须以 YAML frontmatter 开头（--- ... ---），包含 name、description、version 字段

2. 正文使用 Markdown 格式，必须包含以下章节：

   - 技能说明与适用场景：描述这个技能的用途、适用的问题类型和业务场景

   - 操作步骤/工作流程：技能被调用时应遵循的详细步骤指引

   - 输入输出规范：定义技能期望的输入格式和输出格式

   - 示例对话：提供 1-2 个该技能被用户调用时的示例对话

   - 问题回答边界与敏感信息过滤：说明哪些问题不在技能范围内，以及敏感信息（身份证号、银行卡号、手机号等）的过滤规则

3. 只输出 SKILL.md 的内容本身，不要任何解释或代码围栏

4. 内容要专业、具体，避免空泛的占位文本

5. 结合提供的项目数据文件内容，使技能描述贴合实际数据`



/**

 * Generate a SKILL.md content using LLM, with project data files as context.

 * Delegates to llmComplete() which reuses pi's ModelRegistry for credential resolution.

 */

export async function generateSkillWithLlm(

  projectId: string,

  versionId: string,

  name: string,

  description: string,

): Promise<string> {

  // Read data files as context

  const dataSnippets = readDataContext(projectId, versionId, 5, 2000)

  const dataSection = dataSnippets.length

    ? `\n\n## 项目数据文件（参考）\n\n${dataSnippets.join('\n\n')}`

    : ''



  const userPrompt = `请为以下技能生成完整的 SKILL.md 内容：



技能名称：${name}

技能描述：${description}

${dataSection}`



  const content = await llmComplete(SKILL_GENERATION_SYSTEM_PROMPT, userPrompt)



  // Ensure frontmatter exists; prepend if missing

  let skillMd = content

  if (!skillMd.startsWith('---')) {

    const id = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

    skillMd = `---

name: ${id}

description: ${description}

version: v1.0.0

---



${skillMd}`

  }



  return skillMd

}



// ---- Agent description generation (for CreateAgentModal defaults) ----



const AGENT_DESCRIPTION_SYSTEM_PROMPT = `你是一个政务智能体描述生成器。根据项目数据文件，用一段话描述这个智能体主要关于什么、能回答哪几类问题。



输出要求：

1. 只输出描述本身，不要引号、编号或解释

2. 不超过 100 字

3. 描述应包含：智能体主题 + 能回答的问题类型（如资格判断、材料清单、办理流程等）

4. 结合数据文件内容，使描述贴合实际数据`



/**

 * 用 LLM 根据 data/ 目录下的文件生成智能体描述。

 * data/ 无文件时返回空字符串（前端让用户手写）。

 */

export async function generateAgentDescription(projectId: string, versionId: string): Promise<string> {

  const dataSnippets = readDataContext(projectId, versionId, 5, 2000)

  if (dataSnippets.length === 0) return ''



  const dataSection = dataSnippets.join('\n\n')

  const userPrompt = `根据以下项目数据文件，生成智能体描述：\n\n${dataSection}`



  const content = await llmComplete(AGENT_DESCRIPTION_SYSTEM_PROMPT, userPrompt)

  return content.trim()

}




```
