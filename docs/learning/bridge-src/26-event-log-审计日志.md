# 审计日志 — SQLite 事件记录

> 源文件：`bridge/src/event-log.ts`

```typescript
/**

 * 事件日志存储层（基于 sql.js / SQLite Wasm）

 * 数据库文件：~/.gs_platform/event-log.db

 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { homedir } from 'node:os'

import { join, dirname } from 'node:path'

import initSqlJs, { type Database } from 'sql.js'



const DB_PATH = join(homedir(), '.gs_platform', 'event-log.db')

const WAL_PATH = join(homedir(), '.gs_platform', 'event-log.db-wal')



export interface EventLog {

  id: number

  timestamp: string

  actor: string

  action: string

  target: string

  detail: string

  ip: string

}



export interface EventLogQuery {

  action?: string

  actor?: string

  page?: number

  page_size?: number

}



export interface EventLogResult {

  total: number

  page: number

  page_size: number

  items: EventLog[]

}



let db: Database | null = null

let dirty = false

let flushTimer: ReturnType<typeof setTimeout> | null = null



async function getDb(): Promise<Database> {

  if (db) return db



  const SQL = await initSqlJs()



  if (existsSync(DB_PATH)) {

    const buf = readFileSync(DB_PATH)

    db = new SQL.Database(buf)

  } else {

    mkdirSync(dirname(DB_PATH), { recursive: true })

    db = new SQL.Database()

  }



  db.run(`

    CREATE TABLE IF NOT EXISTS event_logs (

      id        INTEGER PRIMARY KEY AUTOINCREMENT,

      timestamp TEXT    NOT NULL,

      actor     TEXT    NOT NULL,

      action    TEXT    NOT NULL,

      target    TEXT    DEFAULT '',

      detail    TEXT    DEFAULT '{}',

      ip        TEXT    DEFAULT ''

    );

    CREATE INDEX IF NOT EXISTS idx_event_action    ON event_logs(action);

    CREATE INDEX IF NOT EXISTS idx_event_actor     ON event_logs(actor);

    CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_logs(timestamp DESC);

  `)



  // 定时落盘（每 3 秒检查一次）

  setInterval(flush, 3000).unref?.()



  return db

}



/** 将内存数据库写入磁盘文件 */

function flush() {

  if (!db || !dirty) return

  try {

    const data = db.export()

    writeFileSync(DB_PATH, Buffer.from(data))

    dirty = false

  } catch (e) {

    console.error('[event-log] flush failed:', e)

  }

}



/** 写入事件 */

export async function logEvent(params: {

  actor: string

  action: string

  target?: string

  detail?: Record<string, unknown>

  ip?: string

}): Promise<void> {

  const d = await getDb()

  d.run(

    'INSERT INTO event_logs (timestamp, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',

    [

      new Date().toISOString(),

      params.actor,

      params.action,

      params.target || '',

      JSON.stringify(params.detail || {}),

      params.ip || '',

    ]

  )

  dirty = true

  // 立即安排一次延迟落盘（合并短时间内的多次写入）

  if (flushTimer) clearTimeout(flushTimer)

  flushTimer = setTimeout(flush, 500)

}



/** 查询事件列表 */

export async function queryEvents(query: EventLogQuery = {}): Promise<EventLogResult> {

  const d = await getDb()

  const page = query.page || 1

  const pageSize = query.page_size || 20

  const offset = (page - 1) * pageSize



  const conditions: string[] = []

  const params: (string | number)[] = []

  if (query.action) {

    conditions.push('action = ?')

    params.push(query.action)

  }

  if (query.actor) {

    conditions.push('actor = ?')

    params.push(query.actor)

  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''



  // count

  const countResult = d.exec(`SELECT COUNT(*) as cnt FROM event_logs ${where}`)

  const total = countResult.length ? (countResult[0].values[0][0] as number) : 0



  // items

  const rowsResult = d.exec(

    `SELECT id, timestamp, actor, action, target, detail, ip FROM event_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,

    [...params, pageSize, offset]

  )



  let items: EventLog[] = []

  if (rowsResult.length) {

    const cols = rowsResult[0].columns

    items = rowsResult[0].values.map((row: any[]) => {

      const obj: Record<string, unknown> = {}

      cols.forEach((c: string, i: number) => { obj[c] = row[i] })

      return obj as unknown as EventLog

    })

  }



  return { total, page, page_size: pageSize, items }

}



/** 进程退出时确保落盘 */

process.on('beforeExit', flush)


```
