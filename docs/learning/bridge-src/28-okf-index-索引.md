# OKF 索引 — 策略目录构建

> 源文件：`bridge/src/okf/index.ts`

```typescript
// OKF 转换统一入口

// 调用方 (importSingleSpace) 用 convertOne() 单条转换；用 loadOrCreateMap() 维护 _okf_map.json



export * from './sanitize.js'

export * from './bundle.js'

export * from './frontmatter.js'

export * from './path.js'

export * from './index-md.js'

export { existsSync, readFileSync, writeFileSync } from 'node:fs'



import { readFileSync, writeFileSync, existsSync } from 'node:fs'

import { join } from 'node:path'

import { resolveBundle } from './bundle.js'

import { parseRegionPath, sanitizePathSegment } from './sanitize.js'

import { buildOkfFrontmatter, assembleOkfMarkdown } from './frontmatter.js'

import { findNextSeq, okfRelPath, rawRelPath } from './path.js'



// ============== _okf_map.json 维护 ==============



export interface OkfMapEntry {

  bundle_key: string

  /** 多级 region 路径 e.g. ["陕西"] 或 ["河北", "石家庄"] */

  region_path: string[]

  raw_path: string

  okf_path: string

  okf_seq: number

  type_cn: string

  /** 同空间其他字段供调试 */

  policy_id: number

}



export interface OkfMap {

  version: 1

  generated_at: string

  mappings: Record<string /* policy_id */, OkfMapEntry>

}



const OKF_MAP_FILE = '_okf_map.json'



export function loadOrCreateMap(spaceCwd: string): OkfMap {

  const fp = join(spaceCwd, OKF_MAP_FILE)

  if (existsSync(fp)) {

    try {

      const j = JSON.parse(readFileSync(fp, 'utf-8'))

      if (j && j.mappings) return j as OkfMap

    } catch (e) {

      console.warn('[okf] _okf_map.json 解析失败, 重置:', e)

    }

  }

  return { version: 1, generated_at: new Date().toISOString(), mappings: {} }

}



export function saveMap(spaceCwd: string, map: OkfMap): void {

  map.generated_at = new Date().toISOString()

  const fp = join(spaceCwd, OKF_MAP_FILE)

  writeFileSync(fp, JSON.stringify(map, null, 2), 'utf-8')

}



// ============== 单条转换 ==============



export interface ConvertInput {

  policy: {

    id: number

    one_thing_name?: string

    file_type?: string

    file_name?: string

    subsidy_item_name?: string

    publish_region?: string

    policy_url?: string

    verify_status?: string

    tags?: string | string[]

    created_at?: string

    updated_at?: string

  }

  /** 爬虫原 MD 文本 (可能含 frontmatter) */

  rawContent: string

  /** raw 文件名 (e.g. "北京市_育儿补贴_1.md") */

  rawFileName: string

  /** 空间 cwd (绝对路径) */

  spaceCwd: string

  /** 现有的 _okf_map (调用方持有) */

  map: OkfMap

}



export interface ConvertResult {

  /** raw 在 data/ 下的相对路径 */

  rawRelPath: string

  /** OKF 在 data/ 下的相对路径 */

  okfRelPath: string

  /** OKF 完整内容 (含 frontmatter) */

  okfContent: string

  /** 分配到的 NNN 序号 */

  seq: number

  /** bundle key */

  bundleKey: string

  /** region parts (sanitized) */

  regionParts: string[]

}



/**

 * 转换单条政策: 算出 raw/OKF 路径, 生成 OKF 内容, 更新 map

 * 幂等: 同一 policy.id 重跑会复用旧 OKF 路径

 */

export function convertOne(input: ConvertInput): ConvertResult {

  const { policy, rawContent, rawFileName, spaceCwd, map } = input

  const policyId = String(policy.id)



  // 1. 解析 bundle / region

  const bundle = resolveBundle(policy.one_thing_name)

  const regionParts = parseRegionPath(policy.publish_region)

  const leafRegion = regionParts[regionParts.length - 1] || 'unknown'

  const typeCn = sanitizePathSegment(policy.file_type || '政策文件')

  const rawKeyword = sanitizePathSegment(policy.one_thing_name || 'unknown-policy')



  // 2. raw 路径

  const rawPath = rawRelPath(rawKeyword, leafRegion, rawFileName)



  // 3. OKF 路径: 查 map 复用, 否则自增 NNN

  let okfPath: string

  let seq: number

  const existing = map.mappings[policyId]

  if (existing && existing.bundle_key === bundle.key) {

    // 幂等: 复用旧路径和 NNN

    okfPath = existing.okf_path

    seq = existing.okf_seq

  } else {

    // 新分配: 扫目录找 max NNN + 1

    const regionDir = join(

      spaceCwd,

      'bundles',

      sanitizePathSegment(bundle.key),

      ...regionParts.map(sanitizePathSegment)

    )

    seq = findNextSeq(regionDir)

    okfPath = okfRelPath(bundle.key, regionParts, leafRegion, typeCn, seq)

  }



  // 4. 生成 OKF frontmatter

  const fm = buildOkfFrontmatter({ policy, bundle, regionParts, typeCn })

  const okfContent = assembleOkfMarkdown(fm, rawContent)



  // 5. 更新 map

  map.mappings[policyId] = {

    bundle_key: bundle.key,

    region_path: regionParts,

    raw_path: rawPath,

    okf_path: okfPath,

    okf_seq: seq,

    type_cn: typeCn,

    policy_id: policy.id

  }



  return {

    rawRelPath: rawPath,

    okfRelPath: okfPath,

    okfContent,

    seq,

    bundleKey: bundle.key,

    regionParts

  }

}


```
