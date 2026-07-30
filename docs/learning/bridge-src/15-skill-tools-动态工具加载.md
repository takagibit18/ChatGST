# 动态工具加载 — jiti 运行时编译

> 源文件：`bridge/src/skill-tools.ts`

```typescript
/**

 * 动态工具加载器

 *

 * 从项目 skills 目录下的 tools/*.ts 文件动态加载 ToolDefinition。

 * 用 jiti 转译 TypeScript，alias 把 bare specifier（pi-coding-agent、typebox）

 * 映射到 bridge 的 node_modules，确保 TypeBox 实例一致。

 *

 * 约定：工具文件 export default defineTool(...) 或 export default function(ctx) => ToolDefinition

 */

import { createJiti } from 'jiti/static'

import { existsSync, readdirSync, statSync } from 'node:fs'

import { join } from 'node:path'

import { fileURLToPath } from 'node:url'

import { createRequire } from 'node:module'

import type { ToolDefinition } from '@earendil-works/pi-coding-agent'



const __dirname = fileURLToPath(new URL('.', import.meta.url))

const bridgeRequire = createRequire(import.meta.url)



/**

 * 构建 jiti alias：把工具文件里 import 的 bare specifier

 * 映射到 bridge node_modules 里的真实入口，保证模块实例一致。

 */

function buildAlias(): Record<string, string> {

  const alias: Record<string, string> = {}



  // typebox：require.resolve 能解析

  for (const spec of ['typebox', '@sinclair/typebox']) {

    try { alias[spec] = bridgeRequire.resolve(spec) } catch { /* skip */ }

  }

  for (const sub of ['/compile', '/value']) {

    for (const base of ['typebox', '@sinclair/typebox']) {

      try { alias[base + sub] = bridgeRequire.resolve(base + sub) } catch { /* skip */ }

    }

  }



  // @earendil-works/* ：package.json 用 exports 字段，require.resolve 失败，

  // 手动指向 dist/index.js（pi-coding-agent）/ dist/compat.js（pi-ai）

  // __dirname 是 src/，node_modules 在上一级

  const bridgeRoot = join(__dirname, '..')

  const pkgs: Array<[string, string]> = [

    ['@earendil-works/pi-coding-agent', 'dist/index.js'],

    ['@earendil-works/pi-agent-core', 'dist/index.js'],

    ['@earendil-works/pi-tui', 'dist/index.js'],

    ['@earendil-works/pi-ai', 'dist/compat.js'],

  ]

  for (const [spec, entry] of pkgs) {

    const pkgRoot = join(bridgeRoot, 'node_modules', spec)

    if (existsSync(join(pkgRoot, entry))) {

      alias[spec] = join(pkgRoot, entry)

    }

  }

  return alias

}



let jitiInstance: ReturnType<typeof createJiti> | null = null



function getJiti(): ReturnType<typeof createJiti> {

  if (jitiInstance) return jitiInstance

  jitiInstance = createJiti(import.meta.url, {

    moduleCache: true,

    alias: buildAlias(),

  })

  return jitiInstance

}



/**

 * 记录每个工具文件上次转译时的 mtime（ms）。

 * import 前比对当前文件 mtime，若已变更则从 jiti.cache 删除旧条目，强制重新转译。

 * 这样既能复用转译缓存（省 CPU），又能在用户修改 tools 文件后自动生效（无需重启）。

 */

const fileMtimes = new Map<string, number>()



function invalidateIfStale(absPath: string, jiti: ReturnType<typeof createJiti>): void {

  let mtime: number

  try {

    mtime = statSync(absPath).mtimeMs

  } catch {

    return // 文件可能已被删除，jiti.import 会自然报错

  }

  const last = fileMtimes.get(absPath)

  if (last !== undefined && last !== mtime) {

    // 文件自上次转译后已修改 → 清除 jiti 内存缓存中的旧条目

    delete (jiti.cache as Record<string, unknown>)[absPath]

  }

  fileMtimes.set(absPath, mtime)

}



/** 判断对象是否像一个 ToolDefinition（有 name + execute） */

function isToolDefinition(obj: unknown): obj is ToolDefinition {

  return (

    typeof obj === 'object' &&

    obj !== null &&

    typeof (obj as { name?: unknown }).name === 'string' &&

    typeof (obj as { execute?: unknown }).execute === 'function'

  )

}



/**

 * 从项目 skills 目录加载工具定义。

 * 只加载 skillIds 选中的 skill 的 tools/ 子目录。

 *

 * @param cwd      项目版本目录（.../proj-xxx/versions/v1.0.0/）

 * @param skillIds 选中的 skill id 列表

 * @returns        ToolDefinition[]（加载失败的文件跳过）

 */

export async function loadSkillTools(

  cwd: string,

  skillIds: string[],

): Promise<ToolDefinition[]> {

  if (skillIds.length === 0) return []



  const jiti = getJiti()

  const tools: ToolDefinition[] = []

  const seenNames = new Set<string>()



  for (const skillId of skillIds) {

    const toolsDir = join(cwd, 'skills', skillId, 'tools')

    if (!existsSync(toolsDir)) continue



    let files: string[]

    try {

      files = readdirSync(toolsDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))

    } catch {

      continue

    }



    for (const file of files) {

      const absPath = join(toolsDir, file)

      try {

        invalidateIfStale(absPath, jiti)

        const mod = (await jiti.import(absPath)) as Record<string, unknown>



        // jiti 可能不设 default，而是把 export default 的值展开到模块顶层

        // 优先取 mod.default；若不存在，检查模块自身是否就是 ToolDefinition

        let candidates: unknown[] = []

        const def = mod.default

        if (def !== undefined) {

          if (typeof def === 'function') {

            const result = (def as (ctx: { cwd: string }) => unknown)({ cwd })

            candidates = Array.isArray(result) ? result : [result]

          } else {

            candidates = [def]

          }

        } else if (isToolDefinition(mod)) {

          // jiti 把 export default 的值展开到了模块对象

          candidates = [mod]

        } else if (Array.isArray(mod.tools)) {

          candidates = mod.tools

        }



        for (const c of candidates) {

          if (isToolDefinition(c)) {

            if (seenNames.has(c.name)) {

              console.warn(`[skill-tools] 重复工具名 "${c.name}"（来自 ${file}），后者覆盖`)

              // 移除已有的同名工具

              const idx = tools.findIndex((t) => t.name === c.name)

              if (idx >= 0) tools.splice(idx, 1)

            }

            tools.push(c)

            seenNames.add(c.name)

          } else {

            console.warn(`[skill-tools] ${file} 的导出不是有效的 ToolDefinition，跳过`)

          }

        }

      } catch (e) {

        console.error(`[skill-tools] 加载工具文件失败 ${absPath}:`, (e as Error).message)

      }

    }

  }



  return tools

}


```
