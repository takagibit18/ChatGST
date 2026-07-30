# OKF 元数据 — Markdown frontmatter 解析

> 源文件：`bridge/src/okf/frontmatter.ts`

```typescript
// 爬虫原 MD frontmatter → OKF frontmatter 重写

// 对齐 okf-forge-web/scripts/stage2_okf.py:build_okf_frontmatter

//

// 映射规则:

//   type          ← file_type (原值)

//   title         ← file_name (原值)

//   status        ← verify_status (原值)

//   description   ← 标准化: "这是{leaf_region}关于{name_cn}的{type_cn}"

//   resource      ← policy_url (仅 URL)

//   region        ← region_path (多级用 / 连接)

//   tags          ← 原 tags + bundle.tags + leaf_region (去重保序)

//   timestamp     ← created_at 或 now



import type { BundleConfig } from './bundle.js'



export interface OkfFrontmatterInput {

  /** 爬虫返回的 19 字段政策数据 */

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

    subsidy_target?: string

  }

  bundle: BundleConfig

  /** 多级 region 路径 e.g. ["陕西"] 或 ["河北", "石家庄"] */

  regionParts: string[]

  /** 中文类型 e.g. "政策文件" / "政策解读" / "办事指南" (与 file_type 同步) */

  typeCn: string

}



export function buildOkfFrontmatter(input: OkfFrontmatterInput): Record<string, unknown> {

  const { policy, bundle, regionParts, typeCn } = input

  const leafRegion = regionParts[regionParts.length - 1] || ''

  const regionFull = regionParts.join('/')



  // tags 合并: source tags + bundle tags + leaf_region (去重保序)

  const sourceTags = Array.isArray(policy.tags)

    ? policy.tags

    : policy.tags ? [policy.tags] : []

  const mergedTags: string[] = [...sourceTags]

  for (const t of bundle.tags) {

    if (!mergedTags.includes(t)) mergedTags.push(t)

  }

  if (leafRegion && !mergedTags.includes(leafRegion)) {

    mergedTags.unshift(leafRegion)

  }



  // description 标准化

  const description = leafRegion

    ? `这是${leafRegion}关于${bundle.name_cn}的${typeCn}`

    : `这是关于${bundle.name_cn}的${typeCn}`



  // resource: 仅 URL

  const resource = policy.policy_url && /^https?:\/\//.test(policy.policy_url)

    ? policy.policy_url

    : ''



  // timestamp

  const timestamp = policy.created_at || policy.updated_at || new Date().toISOString()



  return {

    type: typeCn,

    title: policy.file_name || policy.subsidy_item_name || `政策 #${policy.id}`,

    status: policy.verify_status || 'pending',

    description,

    resource,

    region: regionFull,

    tags: mergedTags,

    timestamp

  }

}



/**

 * 将 frontmatter 对象转成 YAML 字符串

 * 简化版：值统一加双引号转义，避免特殊字符问题

 */

export function frontmatterToYaml(fm: Record<string, unknown>): string {

  const lines: string[] = ['---']

  for (const [key, value] of Object.entries(fm)) {

    if (value === undefined || value === null || value === '') continue

    if (Array.isArray(value)) {

      lines.push(`${key}: [${value.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(', ')}]`)

    } else if (typeof value === 'string') {

      lines.push(`${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)

    } else {

      lines.push(`${key}: ${value}`)

    }

  }

  lines.push('---')

  return lines.join('\n')

}



/**

 * 从 OKF 转换后的 (frontmatter + raw body) 拼成完整 MD 文本

 */

export function assembleOkfMarkdown(fm: Record<string, unknown>, rawBody: string): string {

  const yaml = frontmatterToYaml(fm)

  // raw body 去掉它自己的 frontmatter (--- ... --- 块)

  const body = stripFrontmatter(rawBody).trim()

  return `${yaml}\n\n${body}\n`

}



/**

 * 去掉 MD 顶部的 YAML frontmatter (--- ... ---)

 */

function stripFrontmatter(md: string): string {

  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)

  if (!m) return md

  return md.slice(m[0].length)

}


```
