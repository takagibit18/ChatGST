# OKF 入口 — 知识格式转换

> 源文件：`bridge/src/okf.ts`

```typescript
// OKF Markdown 转换器：把爬虫后端返回的 19 字段政策数据，转换为 OKF 规范 MD 文件

// 移植自爬虫后端 gov_policy_to_okf.py:370-420 (build_frontmatter) + 856-878 (_classify_quality)

// 用于：爬虫没导过 MD 时，我们自己生成（带 frontmatter + 提示性正文）



export interface OkfPolicyFields {

  id: number

  one_thing_name: string

  subsidy_item_name: string

  file_type?: string

  file_name?: string

  publish_region?: string

  publish_unit?: string

  publish_date?: string

  subsidy_target?: string

  subsidy_standard?: string

  apply_period?: string

  apply_condition?: string

  required_materials?: string

  distribute_time?: string

  distribute_channel?: string

  apply_procedure?: string

  handle_channel?: string

  online_entry?: string

  policy_url?: string

  verify_status?: string

  verify_note?: string

}



export type OkfQuality = { status: 'verified' | 'issues'; issueType: string }



// _classify_quality 移植：根据内容字段判断质量

// 真实爬虫里会更复杂（HTML 解析、关键词匹配等），这里做简化版

export function classifyQuality(p: OkfPolicyFields): OkfQuality {

  // 没有 URL 没法抓取 → 视为问题

  if (!p.policy_url) return { status: 'issues', issueType: 'low_quality_doc' }

  // 只有标题没有正文字段 → 视为列表页

  if (!p.subsidy_standard && !p.subsidy_target) {

    return { status: 'issues', issueType: 'list_page' }

  }

  // 缺关键字段但有 URL → 视为低质量

  const missingCritical = !p.publish_region || !p.subsidy_item_name

  if (missingCritical) return { status: 'issues', issueType: 'low_quality_doc' }

  return { status: 'verified', issueType: '' }

}



// build_frontmatter 移植：19 字段 → YAML frontmatter

export function buildFrontmatter(p: OkfPolicyFields): string {

  const q = classifyQuality(p)

  const type = p.file_type || '政策文件'

  const title = p.file_name || p.subsidy_item_name || `政策 #${p.id}`

  const description = p.subsidy_target?.slice(0, 200) || p.subsidy_standard?.slice(0, 200) || ''

  const tags: string[] = []

  if (p.subsidy_item_name) tags.push(p.subsidy_item_name)

  if (p.publish_region) tags.push(p.publish_region)

  tags.push(type)



  const lines = [

    '---',

    `type: ${type}`,

    `title: ${title}`,

    `status: ${q.status}`,

    `issue_type: ${q.issueType}`,

    `description: ${description}`,

    `resource: ${p.policy_url || ''}`,

    `region: ${p.publish_region || ''}`,

    `policy_id: ${p.id}`,

    `verify_status: ${p.verify_status || 'pending'}`,

    `tags: [${tags.join(', ')}]`,

    `timestamp: ${new Date().toISOString().slice(0, 10)}`,

    '---'

  ]

  return lines.join('\n')

}



// buildOkfMarkdown：生成完整 OKF MD 字符串（无抓取正文时用作占位）

export function buildOkfMarkdown(p: OkfPolicyFields, body?: string): string {

  const fm = buildFrontmatter(p)

  const bodyText = body || buildPlaceholderBody(p)

  return `${fm}\n\n${bodyText}\n`

}



// 当爬虫没导过 MD、没有正文时的占位 body（让前端能看到完整 19 字段）

function buildPlaceholderBody(p: OkfPolicyFields): string {

  const lines: string[] = []

  lines.push(`# ${p.file_name || p.subsidy_item_name || '政策详情'}`)

  lines.push('')

  lines.push('> **说明**：本条目由 bridge 自动生成，爬虫尚未抓取完整正文。请手动补充或等待爬虫完成 `export/markdown` 后重新导入。')

  lines.push('')

  lines.push('## 基本信息')

  lines.push('')

  lines.push(`- **一件事**：${p.one_thing_name || '—'}`)

  lines.push(`- **补贴事项**：${p.subsidy_item_name || '—'}`)

  lines.push(`- **文件类型**：${p.file_type || '—'}`)

  lines.push(`- **政策标题**：${p.file_name || '—'}`)

  lines.push(`- **发布地区**：${p.publish_region || '—'}`)

  lines.push(`- **发布单位**：${p.publish_unit || '—'}`)

  lines.push(`- **发布日期**：${p.publish_date || '—'}`)

  lines.push('')

  lines.push('## 补贴详情')

  lines.push('')

  lines.push(`- **补贴对象**：${p.subsidy_target || '—'}`)

  lines.push(`- **补贴标准**：${p.subsidy_standard || '—'}`)

  lines.push(`- **申报期限**：${p.apply_period || '—'}`)

  lines.push(`- **申报条件**：${p.apply_condition || '—'}`)

  lines.push(`- **所需材料**：${p.required_materials || '—'}`)

  lines.push('')

  lines.push('## 办理信息')

  lines.push('')

  lines.push(`- **发放时间**：${p.distribute_time || '—'}`)

  lines.push(`- **发放渠道**：${p.distribute_channel || '—'}`)

  lines.push(`- **申领程序**：${p.apply_procedure || '—'}`)

  lines.push(`- **办理渠道**：${p.handle_channel || '—'}`)

  lines.push(`- **线上办理入口**：${p.online_entry || '—'}`)

  lines.push('')

  if (p.policy_url) {

    lines.push('## 原文链接')

    lines.push('')

    lines.push(`<${p.policy_url}>`)

    lines.push('')

  }

  if (p.verify_note) {

    lines.push('## 核验备注')

    lines.push('')

    lines.push(p.verify_note)

    lines.push('')

  }

  return lines.join('\n')

}



// 计算输出路径（沿用爬虫 EXPORT_MD_PATH_FORMAT 模板）

// 模板：{policy_keyword}/{region}/{region}_{policy_keyword}_{id}.md

// policy_keyword 来自 one_thing_name（与爬虫 EXPORT_MD_KEYWORD_FIELD 默认值一致）

export function computeOutputPath(p: OkfPolicyFields): string {

  const keyword = sanitizePathSegment(p.one_thing_name || `policy-${p.id}`)

  const region = sanitizePathSegment(p.publish_region || 'unknown')

  const fileName = `${region}_${keyword}_${p.id}.md`

  // 输出相对于 data/ 目录

  return `${keyword}/${region}/${fileName}`

}



// 文件名 sanitize：替换 Windows/Unix 非法字符

function sanitizePathSegment(s: string): string {

  if (!s) return 'unknown'

  // Windows 非法字符：< > : " / \ | ? *

  return s

    .replace(/[<>:"/\\|?*]/g, '_')

    .replace(/\s+/g, '_')

    .replace(/^\.+/, '')

    .slice(0, 200) || 'unknown'

}


```
