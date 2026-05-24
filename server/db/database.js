import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '..', 'data')
const DB_PATH = process.env.BULK_RCS_DB_PATH || resolve(DATA_DIR, 'app.db')

mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    message TEXT,
    media_url TEXT,
    content_template_json TEXT,
    sender_json TEXT NOT NULL,
    twilio_json TEXT NOT NULL,
    scheduled_at INTEGER,
    total INTEGER NOT NULL DEFAULT 0,
    successful INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    variables_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    message_sid TEXT,
    error TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_job_status ON contacts(job_id, status);
`)

// node:sqlite doesn't have better-sqlite3's `.transaction()` helper, so we
// expose a thin wrapper that batches synchronous statement runs.
export function withTransaction(fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// Reclaim disk space after large deletes.
// SQLite doesn't shrink the file when rows are deleted — it just marks pages
// as free for future inserts. To actually return space to the OS we have to:
//   1. Drain the WAL file (which can be tens of MB after a big job)
//   2. Run VACUUM to rebuild the main DB without free pages
// Cheap for small DBs, can take seconds for very large ones. Call after job
// completion, not on hot paths.
export function compact() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.exec('VACUUM')
  } catch (err) {
    console.warn('[db] compact() failed:', err.message)
  }
}

export default db
export { DB_PATH }
