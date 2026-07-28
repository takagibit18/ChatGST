/**
 * 06-event-log.ts — 审计日志
 *
 * 对应原架构文档 event-log.ts (完整实现)
 * 使用 SQL.js (浏览器端 SQLite) 持久化操作审计
 *
 * 对比 ChatGST:
 *   ChatGST 的"审计"只是 stderr [monitor] 行
 *   这里是真正的持久化 event_logs 表
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const DB_PATH = join(homedir(), ".onto-platform", "event-log.db");

export interface EventLog {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

// SQL.js 是异步初始化，延迟到第一次调用
let db: { run: (sql: string, params?: unknown[]) => void; exec: (sql: string) => void; export: () => Uint8Array; close: () => void } | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function getDb() {
  if (db) return db;
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    db = new SQL.Database(readFileSync(DB_PATH));
  } else {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    db = new SQL.Database();
  }
  db.run(`CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT DEFAULT '',
    detail TEXT DEFAULT '{}',
    ip TEXT DEFAULT ''
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_action ON event_logs(action)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_actor ON event_logs(actor)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_logs(timestamp DESC)`);
  setInterval(flush, 3000).unref?.();
  return db;
}

function flush(): void {
  if (!db || !dirty) return;
  try { writeFileSync(DB_PATH, Buffer.from(db.export())); dirty = false; } catch (e) {
    console.error("[event-log] flush failed:", e);
  }
}

export async function logEvent(params: {
  actor: string; action: string; target?: string; detail?: Record<string, unknown>; ip?: string;
}): Promise<void> {
  const d = await getDb();
  d.run(
    "INSERT INTO event_logs (timestamp, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)",
    [new Date().toISOString(), params.actor, params.action, params.target || "", JSON.stringify(params.detail || {}), params.ip || ""],
  );
  dirty = true;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 500);
}

process.on("beforeExit", flush);
