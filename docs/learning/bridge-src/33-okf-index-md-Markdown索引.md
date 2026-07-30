# OKF Markdown 索引 — 目录生成

> 源文件：`bridge/src/okf/index-md.ts`

```typescript
// INDEX.md 自动生成

// 对齐 okf-forge-web/scripts/stage2_okf.py:build_index_md

//

// 索引两层:

//   bundles/{bundle_key}/INDEX.md              ← 列出 region 子目录

//   bundles/{bundle_key}/{region_path}/INDEX.md ← 列出该 region 下的 OKF 文件



export interface IndexEntry {

  type: 'dir' | 'file'

  name: string

  desc?: string

}



export interface BuildIndexOptions {

  /** 索引目录的显示名 (e.g. "育儿补贴" / "陕西") */

  dirName: string

  /** 该目录下的条目 (子目录 + 文件) */

  entries: IndexEntry[]

  /** 自定义时间戳，默认 now */

  timestamp?: string

}



export function buildIndexMd(opts: BuildIndexOptions): string {

  const now = opts.timestamp || new Date().toISOString()

  const subdirs = opts.entries.filter((e) => e.type === 'dir')

  const files = opts.entries.filter((e) => e.type === 'file')



  const lines: string[] = [

    '---',

    `title: "${opts.dirName} - 索引"`,

    `description: "${opts.dirName} 目录下所有概念文件和子目录的导航"`,

    'tags: [index]',

    `timestamp: "${now}"`,

    '---',

    '',

    `# ${opts.dirName}`,

    ''

  ]



  if (subdirs.length > 0) {

    lines.push('## 子目录')

    lines.push('')

    for (const sd of [...subdirs].sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {

      const desc = sd.desc ? ` — ${sd.desc}` : ''

      lines.push(`- [${sd.name}](${sd.name}/INDEX.md)${desc}`)

    }

    lines.push('')

  }



  if (files.length > 0) {

    lines.push('## 文件')

    lines.push('')

    for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {

      const desc = f.desc ? ` — ${f.desc}` : ''

      lines.push(`- [${f.name}](${f.name})${desc}`)

    }

    lines.push('')

  }



  return lines.join('\n')

}


```
