# 安全文件操作 — 递归复制

> 源文件：`bridge/src/fs-safe.ts`

```typescript
/**

 * 递归目录拷贝（fs.cpSync 的安全替代）。

 *

 * 背景：Node 22.17 Windows 上 fs.cpSync 遇到非 ASCII（如中文）源/目标路径

 * 会段错误（SIGSEGV）静默崩溃；而 mkdirSync/readdirSync/copyFileSync 等

 * 基础原语已验证对中文路径安全，故用它们实现。

 */

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'

import { join } from 'node:path'



/** 递归拷贝目录内容到目标（已存在则合并覆盖文件，语义同 cpSync { recursive: true, force: true }） */

export function copyDirSync(src: string, dest: string): void {

  mkdirSync(dest, { recursive: true })

  for (const entry of readdirSync(src, { withFileTypes: true })) {

    const s = join(src, entry.name)

    const d = join(dest, entry.name)

    if (entry.isDirectory()) {

      copyDirSync(s, d)

    } else if (entry.isFile()) {

      copyFileSync(s, d)

    }

  }

}


```
