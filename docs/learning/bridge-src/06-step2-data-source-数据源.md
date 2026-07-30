# Step2 数据源 — 文件扫描与配置

> 源文件：`bridge/src/step2-data-source.ts`

```typescript
import { existsSync, readFileSync, readdirSync } from 'node:fs'

import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { fileURLToPath } from 'node:url'

import { parseMd } from './md-frontmatter.js'

import type { RegionLevels, Step2Config } from './types.js'



export type { Step2Config }



const CONFIG_PATH = process.env.POLICY_BRIDGE_CONFIG ||

  join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json')



let cachedConfig: Step2Config | null = null



const DEFAULT_STEP2_CONFIG: Step2Config = {

  default_data_root: 'data',

  merge_conflict_action: 'use_candidate',

}



export function loadStep2Config(): Step2Config {

  if (cachedConfig) return cachedConfig

  if (!existsSync(CONFIG_PATH)) {

    cachedConfig = { ...DEFAULT_STEP2_CONFIG }

    return cachedConfig

  }

  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as { step2?: Step2Config }

  // 字段级合并：用户只配了 default_data_root 时，merge_conflict_action 仍有默认值

  cachedConfig = { ...DEFAULT_STEP2_CONFIG, ...(raw.step2 ?? {}) }

  return cachedConfig

}



export interface ScannedFile {

  absPath: string

  /** 相对 dataRoot 的路径（含目录前缀，全局唯一，作为 done-cache 键） */

  relPath: string

  /** 最深一级地域名（日志/进度展示用，如 "武侯区"） */

  region: string

  /** 五级结构化地域（目录推导，extract/derive 的 region_selector 入参） */

  levels: RegionLevels

  /** 展示用全路径（如 "四川省 / 成都市 / 武侯区"） */

  display: string

  title: string

  text: string

}



/** 目录层级 → 五级字段映射（province/prefecture/county/township 四级 + 特殊「全国」目录） */

const LEVEL_KEYS = ['province_level', 'prefecture_level', 'county_level', 'township_level'] as const



/**

 * 从目录层级推导五级地域（以目录为准）。

 * - data/北京市/a.md            → { province_level: '北京市' }

 * - data/四川省/成都市/武侯区/a.md → { province_level, prefecture_level, county_level }

 * - data/全国/a.md              → { national: '全国' }

 * - data/a.md（根级文件）        → frontmatter.region 兜底省级；region=全国 → national

 * 推导不出任何层级时返回 null（调用方跳过该文件）。

 */

function levelsFromPath(root: string, abs: string, fmRegion?: string): RegionLevels | null {

  const rel = relative(root, dirname(abs))

  const parts = rel ? rel.split(/[\\/]/).filter(Boolean) : []



  if (parts[0] === '全国') return { national: '全国' }



  const levels: RegionLevels = {}

  for (let i = 0; i < Math.min(parts.length, LEVEL_KEYS.length); i++) {

    const name = parts[i]

    if (name) levels[LEVEL_KEYS[i]!] = name

  }



  // 根级文件：frontmatter.region 兜底（兼容旧的扁平数据布局）

  if (!levels.province_level && fmRegion) {

    if (fmRegion === '全国') return { national: '全国' }

    levels.province_level = fmRegion

  }



  if (!levels.province_level && !levels.national) return null

  return levels

}



/** 最深一级地域名（如 "武侯区"；省级则省名；全国则 "全国"） */

export function levelsToRegionName(levels: RegionLevels): string {

  return (

    levels.township_level ||

    levels.county_level ||

    levels.prefecture_level ||

    levels.province_level ||

    levels.national ||

    ''

  )

}



/** 展示用全路径（如 "四川省 / 成都市 / 武侯区"；与平台 display_name 格式一致） */

export function levelsToDisplayName(levels: RegionLevels): string {

  const parts = [

    levels.province_level,

    levels.prefecture_level,

    levels.county_level,

    levels.township_level,

  ].filter((p): p is string => Boolean(p))

  return parts.length ? parts.join(' / ') : (levels.national ?? '全国')

}



/**

 * 解析数据源根目录。优先级：

 * 1) override（项目级 / version 级覆盖）

 * 2) config.step2.default_data_root

 * 3) 兜底 'data'

 */

export function resolveDataRoot(

  workspaceRoot: string,

  override?: string,

): string {

  if (override) {

    return isAbsolute(override) ? override : resolve(workspaceRoot, override)

  }

  const cfg = loadStep2Config()

  const root = cfg.default_data_root

  return isAbsolute(root) ? root : resolve(workspaceRoot, root)

}



/**

 * 递归扫描 root 下所有 .md 文件，解析 frontmatter，地域按目录层级推导。

 * 跳过非 .md、frontmatter/title 缺失、地域层级推导失败的文件（不抛错）。

 */

export function scanDataDir(root: string): ScannedFile[] {

  if (!existsSync(root)) return []

  const out: ScannedFile[] = []

  walk(root, root, out)

  return out

}



function walk(root: string, dir: string, out: ScannedFile[]) {

  for (const ent of readdirSync(dir, { withFileTypes: true })) {

    const abs = join(dir, ent.name)

    if (ent.isDirectory()) {

      walk(root, abs, out)

    } else if (ent.isFile() && ent.name.endsWith('.md')) {

      // 跳过 INDEX.md / index.md（数据目录的索引文件，不是政策）

      if (/^index\.md$/i.test(ent.name)) continue

      const content = readFileSync(abs, 'utf-8')

      const parsed = parseMd(content)

      if (!parsed) continue

      // frontmatter category=INDEX 的也跳过（兼容分类为 INDEX 的索引）

      if (parsed.category && /^index$/i.test(parsed.category)) continue

      const levels = levelsFromPath(root, abs, parsed.region)

      if (!levels) continue

      out.push({

        absPath: abs,

        // relPath 统一为正斜杠：done-cache 持久化为 JSON，避免 Windows 反斜杠键的跨平台问题

        relPath: relative(root, abs).split(/[\\/]/).join('/'),

        region: levelsToRegionName(levels),

        levels,

        display: levelsToDisplayName(levels),

        title: parsed.title,

        text: parsed.text,

      })

    }

  }

}
```
