# OKF 清洗 — 文件名规范化

> 源文件：`bridge/src/okf/sanitize.ts`

```typescript
// OKF 路径/文件名 sanitize

// 规则与 okf-forge-web/scripts/stage2_okf.py:sanitizePathSegment 一致

// Windows 非法字符: < > : " / \ | ? *

// 空白 → 下划线; 长度截断 200; 空字符串 → 'unknown'



const ILLEGAL_CHARS = /[<>:"/\\|?*]/g



/**

 * 将任意字符串清理成"可作为目录/文件名片段"的形式

 * - 替换 Windows 非法字符为 _

 * - 空白字符合并为 _

 * - 去除前导点

 * - 截断 200 字符

 * - 空字符串返回 'unknown'

 */

export function sanitizePathSegment(s: string | null | undefined): string {

  if (!s) return 'unknown'

  return s

    .replace(ILLEGAL_CHARS, '_')

    .replace(/\s+/g, '_')

    .replace(/^\.+/, '')

    .slice(0, 200) || 'unknown'

}



/**

 * 解析多级 region 字符串

 * - "北京" → ["北京"]

 * - "河北/石家庄" → ["河北", "石家庄"]

 * - "河北 - 石家庄" → ["河北", "石家庄"]

 */

export function parseRegionPath(regionStr: string | null | undefined): string[] {

  if (!regionStr) return ['unknown']

  const s = String(regionStr).trim()

  if (!s) return ['unknown']

  if (s.includes('/')) {

    const parts = s.split('/').map((p) => p.trim()).filter(Boolean)

    return parts.length > 0 ? parts.map(sanitizePathSegment) : ['unknown']

  }

  if (s.includes(' - ')) {

    const parts = s.split(' - ').map((p) => p.trim()).filter(Boolean)

    return parts.length > 0 ? parts.map(sanitizePathSegment) : ['unknown']

  }

  return [sanitizePathSegment(s)]

}


```
