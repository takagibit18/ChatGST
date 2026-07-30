# 入口 — main 启动流程

> 源文件：`bridge/src/index.ts`

```typescript
import { startServer } from './server.js'

import { ensureWorkspacesRoot } from './paths.js'

import { clearAllProjects, backfillOntoModelingMeta } from './projects.js'

import { initAuth } from './auth.js'

import { initCrypto } from './crypto.js'

import { getOntoSummary } from './onto-platform.js'

import { listRoles } from './roles-store.js'

import { listUsers } from './users-store.js'

import { initProjectStore, flushProjectStore } from './project-store.js'



async function main() {

  // Initialize crypto (RSA keys + JWT secret)

  initCrypto()



  // Initialize SQLite store first (users/roles depend on it)

  await initProjectStore()



  // Initialize auth (migrate config.json → users.json on first start)

  initAuth()



  ensureWorkspacesRoot()



  // 存量回填：老版本建模产出从 ontology.json 灌入 DB 新列（幂等，只补未回填的）

  backfillOntoModelingMeta()



  if (process.env.CLEAR_PROJECTS_ON_START === '1') {

    clearAllProjects()

    console.log('[policy-agent-bridge] cleared all local projects')

  }



  const roles = listRoles()

  const users = listUsers()

  console.log(`[policy-agent-bridge] roles: ${roles.map((r) => r.code).join(', ')}`)

  console.log(`[policy-agent-bridge] users: ${users.length} (${users.map((u) => `${u.username}/${u.role}`).join(', ')})`)

  console.log(`[policy-agent-bridge] onto-platform: ${getOntoSummary()}`)



  startServer().catch((e) => {

    console.error('[policy-agent-bridge] failed to start:', e)

    process.exit(1)

  })

}



// 进程退出前强制落盘，防止丢失最后 3 秒的数据

process.on('SIGINT', () => { flushProjectStore(); process.exit(0) })

process.on('SIGTERM', () => { flushProjectStore(); process.exit(0) })



main().catch((e) => {

  console.error('[policy-agent-bridge] bootstrap failed:', e)

  process.exit(1)

})


```
