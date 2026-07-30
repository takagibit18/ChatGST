# OKF 打包 — 知识包导出

> 源文件：`bridge/src/okf/bundle.ts`

```typescript
// Bundle 配置：one_thing_name → bundle 映射
// 与 okf-forge-web/okf-bundles/config.yaml 等价的 TS 版本
// 改这里即可新增/调整 bundle

import { sanitizePathSegment } from './sanitize.js'

export interface BundleConfig {
  /** 英文 key，用作目录名 (e.g. 'childcare-subsidy') */
  key: string
  /** 中文显示名 (e.g. '育儿补贴') */
  name_cn: string
  /** bundle 默认 tags */
  tags: string[]
}

/**
 * one_thing_name → BundleConfig 映射
 * 匹配规则: 精确匹配优先；否则用 _default 兜底
 */
const BUNDLE_TABLE: Record<string, BundleConfig> = {
  '育儿补贴': {
    key: 'childcare-subsidy',
    name_cn: '育儿补贴',
    tags: ['育儿补贴', '生育政策', '中国']
  },
  '【260708】老年人福利补贴申领"一件事"政策梳理': {
    key: 'elderly-care-subsidy',
    name_cn: '老年人福利补贴',
    tags: ['养老', '老年人补贴', '民政']
  },
  '_default': {
    key: 'misc-policies',
    name_cn: '其他政策',
    tags: []
  }
}

/**
 * 根据 one_thing_name 解析 bundle 配置
 * 找不到时返回 _default
 */
export function resolveBundle(oneThingName: string | null | undefined): BundleConfig {
  if (oneThingName && BUNDLE_TABLE[oneThingName]) {
    return BUNDLE_TABLE[oneThingName]
  }
  // 模糊匹配: 检查是否包含已知关键词
  if (oneThingName) {
    for (const [key, cfg] of Object.entries(BUNDLE_TABLE)) {
      if (key === '_default') continue
      if (oneThingName.includes(key) || key.includes(oneThingName)) {
        return cfg
      }
    }
  }
  return BUNDLE_TABLE['_default']
}

/**
 * 用 sanitize 把 one_thing_name 转成目录安全名
 * (主要给 raw/ 用: raw/育儿补贴/...)
 */
export function rawKeywordFromOneThing(oneThingName: string | null | undefined): string {
  return sanitizePathSegment(oneThingName || 'unknown-policy')
}

```
