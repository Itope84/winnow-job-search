import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** One person's database: their jobs, runs, sources and settings. */
export function openDb(dir: string, file = 'winnow.db'): Db {
  const db = new DatabaseSync(file === ':memory:' ? file : join(dir, file));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      canon_url TEXT NOT NULL UNIQUE,
      fp TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      work_model TEXT,
      salary TEXT,
      posted_at TEXT,
      first_seen TEXT NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]',
      list TEXT NOT NULL,
      stage TEXT,
      archive_reason TEXT,
      archive_detail TEXT,
      moved_by TEXT NOT NULL,
      moved_at TEXT NOT NULL,
      prev_list TEXT,
      triage TEXT,
      triage_verdict TEXT,
      score REAL,
      score_json TEXT,
      added_by TEXT NOT NULL DEFAULT 'scan',
      has_jd INTEGER NOT NULL DEFAULT 0,
      has_report INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_list ON jobs(list, first_seen);
    CREATE INDEX IF NOT EXISTS jobs_fp ON jobs(fp);
    CREATE TABLE IF NOT EXISTS job_events (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      run_id TEXT
    );
    CREATE INDEX IF NOT EXISTS job_events_job ON job_events(job_id, at);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      lane TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      job_ids TEXT NOT NULL DEFAULT '[]',
      params TEXT NOT NULL DEFAULT '{}',
      progress TEXT,
      step TEXT,
      created TEXT NOT NULL,
      started TEXT,
      finished TEXT,
      error TEXT,
      summary TEXT,
      result TEXT,
      cost_usd REAL,
      model TEXT,
      cli TEXT,
      session_id TEXT,
      checkpoint TEXT,
      reviewed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS runs_status ON runs(status, created);
    CREATE TABLE IF NOT EXISTS run_log (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scan_history (
      canon_url TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL,
      outcome TEXT NOT NULL
    );
  `);
  addColumn(db, 'jobs', 'posting', 'TEXT');
  addColumn(db, 'jobs', 'application', 'TEXT');
  return db;
}

/** Columns added after a table first shipped; existing databases get them on open. */
function addColumn(db: Db, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function kvGet<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function kvSet(db: Db, key: string, value: unknown) {
  db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

/** Run `fn` in one transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
