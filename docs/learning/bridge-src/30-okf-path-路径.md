# OKF 路径 — 路径解析

> 源文件：`bridge/src/okf/path.ts`

```typescript
// OKF 路径生成 + NNN 自增

// 对齐 okf-forge-web/scripts/stage2_okf.py:find_next_seq + generate_okf_filename



import { readdirSync } from 'node:fs'

import { join } from 'node:path'

import { sanitizePathSegment } from './sanitize.js'



/**

 * 生成 OKF 文件名: <NNN>-<leaf-region>-<type>.md

 * 例: 001-北京-政策文件.md

 */

export function generateOkfFilename(seq: number, leafRegion: string, typeCn: string): string {

  return `${String(seq).padStart(3, '0')}-${sanitizePathSegment(leafRegion)}-${sanitizePathSegment(typeCn)}.md`

}



/**

 * 计算下一可用的 NNN 序号

 * 扫描 regionDir 下所有 <NNN>-*.md, 返回 max(NNN) + 1

 */

export function findNextSeq(regionDir: string): number {

  let maxSeq = 0

  const pattern = /^(\d+)-.*\.md$/

  try {

    const files = readdirSync(regionDir)

    for (const f of files) {

      if (f === 'INDEX.md') continue

      const m = pattern.exec(f)

      if (m) {

        const seq = parseInt(m[1], 10)

        if (seq > maxSeq) maxSeq = seq

      }

    }

  } catch {

    // 目录不存在 → 从 1 开始

  }

  return maxSeq + 1

}



/**

 * 计算 OKF 在 bundles 下的相对路径

 * @param bundleKey bundle 英文 key (e.g. "childcare-subsidy")

 * @param regionParts 多级 region 路径

 * @param leafRegion 叶子 region

 * @param typeCn 中文类型

 * @param seq NNN 序号

 */

export function okfRelPath(

  bundleKey: string,

  regionParts: string[],

  leafRegion: string,

  typeCn: string,

  seq: number

): string {

  const fileName = generateOkfFilename(seq, leafRegion, typeCn)

  const dir = regionParts.length > 0

    ? join('bundles', sanitizePathSegment(bundleKey), ...regionParts.map(sanitizePathSegment))

    : join('bundles', sanitizePathSegment(bundleKey))

  return join(dir, fileName).replace(/\\/g, '/')

}



/**

 * 计算 raw 在 raw/ 下的相对路径

 * @param keyword one_thing_name sanitized

 * @param region region 单层

 * @param fileName 文件名 (e.g. "北京市_育儿补贴_1.md")

 */

export function rawRelPath(keyword: string, region: string, fileName: string): string {

  return join('raw', sanitizePathSegment(keyword), sanitizePathSegment(region), fileName).replace(/\\/g, '/')

}


```
