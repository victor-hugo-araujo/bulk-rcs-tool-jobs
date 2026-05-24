import db from './database.js'
import crypto from 'node:crypto'

const insertStmt = db.prepare(`
  INSERT INTO jobs (
    id, channel, status, message, media_url, content_template_json,
    sender_json, twilio_json, scheduled_at, total, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const getStmt = db.prepare(`SELECT * FROM jobs WHERE id = ?`)
const listStmt = db.prepare(`SELECT id, channel, status, total, successful, failed, scheduled_at, created_at, completed_at FROM jobs ORDER BY created_at DESC LIMIT ?`)
const updateStatusStmt = db.prepare(`UPDATE jobs SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`)
const updateCompletionStmt = db.prepare(`UPDATE jobs SET status = ?, successful = ?, failed = ?, completed_at = ?, error = ? WHERE id = ?`)
const incrementCountersStmt = db.prepare(`UPDATE jobs SET successful = successful + ?, failed = failed + ? WHERE id = ?`)
const updateTotalStmt = db.prepare(`UPDATE jobs SET total = ? WHERE id = ?`)
const deleteStmt = db.prepare(`DELETE FROM jobs WHERE id = ?`)

const ROW_TO_JOB = (row) => {
  if (!row) return null
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    message: row.message,
    mediaUrl: row.media_url,
    contentTemplate: row.content_template_json ? JSON.parse(row.content_template_json) : null,
    senderConfig: JSON.parse(row.sender_json),
    twilioConfig: JSON.parse(row.twilio_json),
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
    total: row.total,
    successful: row.successful,
    failed: row.failed,
    error: row.error,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  }
}

export function createJob({ channel, message, mediaUrl, contentTemplate, senderConfig, twilioConfig, scheduledAt = null }) {
  const id = crypto.randomUUID()
  const now = Date.now()
  insertStmt.run(
    id,
    channel,
    'pending',
    message || null,
    mediaUrl || null,
    contentTemplate ? JSON.stringify(contentTemplate) : null,
    JSON.stringify(senderConfig),
    JSON.stringify(twilioConfig),
    scheduledAt ? new Date(scheduledAt).getTime() : null,
    0,
    now
  )
  return id
}

export function getJob(id) {
  return ROW_TO_JOB(getStmt.get(id))
}

export function listJobs(limit = 50) {
  return listStmt.all(limit).map((row) => ({
    id: row.id,
    channel: row.channel,
    status: row.status,
    total: row.total,
    successful: row.successful,
    failed: row.failed,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  }))
}

export function setStatus(id, status) {
  updateStatusStmt.run(status, Date.now(), id)
}

export function setTotal(id, total) {
  updateTotalStmt.run(total, id)
}

export function incrementCounters(id, { successful = 0, failed = 0 }) {
  incrementCountersStmt.run(successful, failed, id)
}

export function complete(id, { successful, failed, error = null, status = null }) {
  const finalStatus = status || (error ? 'failed' : 'completed')
  updateCompletionStmt.run(
    finalStatus,
    successful,
    failed,
    Date.now(),
    error || null,
    id
  )
}

// Mark a still-running or pending job as cancelling. The worker reads this
// between batches and stops processing on the next iteration.
export function requestCancel(id) {
  updateStatusStmt.run('cancelling', Date.now(), id)
}

export function remove(id) {
  deleteStmt.run(id)
}
