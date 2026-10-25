import { mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function localDataDir() {
  return resolve(
    /* turbopackIgnore: true */ process.env.LOCAL_DATA_DIR ||
      join(homedir(), ".local", "share", "lifepilot"),
  );
}
let connection: DatabaseSync | undefined;
export function database() {
  if (connection) return connection;
  const dir = localDataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const db = new DatabaseSync(join(dir, "lifepilot.sqlite"));
  chmodSync(join(dir, "lifepilot.sqlite"), 0o600);
  db.exec(`
    PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS app_state(id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS local_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_plans(task_id TEXT PRIMARY KEY, version INTEGER NOT NULL, phase TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tree_drafts(task_id TEXT PRIMARY KEY, context_hash TEXT NOT NULL, draft TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_jobs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_run INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, owner TEXT, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE(task_id,version));
    CREATE TABLE IF NOT EXISTS agent_log(id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, version INTEGER NOT NULL, phase TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS worker_lease(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, task_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', extracted TEXT, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calendar_connection(id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, secret TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS event_links(connection_key TEXT NOT NULL, task_id TEXT NOT NULL, step_id TEXT NOT NULL, uid TEXT UNIQUE NOT NULL, calendar_url TEXT NOT NULL, remote_url TEXT NOT NULL, etag TEXT, start TEXT NOT NULL, end TEXT NOT NULL, title TEXT NOT NULL, instruction TEXT NOT NULL, plan_version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(connection_key,task_id,step_id));
  `);
  connection = db;
  return db;
}
export function transaction<T>(fn: () => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function setting<T>(key: string, fallback: T): T {
  const row = database()
    .prepare("SELECT value FROM local_settings WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}
export function setSetting(key: string, value: unknown) {
  database()
    .prepare(
      "INSERT INTO local_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, JSON.stringify(value));
}
