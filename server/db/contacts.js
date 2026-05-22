import db, { withTransaction } from './database.js'

const insertStmt = db.prepare(`
  INSERT INTO contacts (job_id, phone, variables_json, status) VALUES (?, ?, ?, 'pending')
`)

const fetchPendingStmt = db.prepare(`
  SELECT id, phone, variables_json FROM contacts WHERE job_id = ? AND status = 'pending' ORDER BY id LIMIT ?
`)
const markSentStmt = db.prepare(`UPDATE contacts SET status = 'sent', message_sid = ? WHERE id = ?`)
const markFailedStmt = db.prepare(`UPDATE contacts SET status = 'failed', error = ? WHERE id = ?`)
const deleteByJobStmt = db.prepare(`DELETE FROM contacts WHERE job_id = ?`)
const countByStatusStmt = db.prepare(`SELECT status, COUNT(*) as n FROM contacts WHERE job_id = ? GROUP BY status`)

export function insertContacts(jobId, contacts) {
  withTransaction(() => {
    for (const c of contacts) {
      insertStmt.run(jobId, c.phone, c.variablesJson || null)
    }
  })
}

export function fetchPending(jobId, limit) {
  return fetchPendingStmt.all(jobId, limit).map((row) => ({
    id: row.id,
    phone: row.phone,
    variables: row.variables_json ? JSON.parse(row.variables_json) : {}
  }))
}

export function markSent(contactId, messageSid) {
  markSentStmt.run(messageSid || null, contactId)
}

export function markFailed(contactId, error) {
  markFailedStmt.run(String(error || 'unknown').slice(0, 1000), contactId)
}

export function markSentBulk(items) {
  withTransaction(() => {
    for (const it of items) markSentStmt.run(it.messageSid || null, it.contactId)
  })
}

export function markFailedBulk(items) {
  withTransaction(() => {
    for (const it of items) markFailedStmt.run(String(it.error || 'unknown').slice(0, 1000), it.contactId)
  })
}

export function deleteByJob(jobId) {
  deleteByJobStmt.run(jobId)
}

export function countByStatus(jobId) {
  const out = { pending: 0, sent: 0, failed: 0 }
  for (const row of countByStatusStmt.all(jobId)) {
    out[row.status] = row.n
  }
  return out
}
