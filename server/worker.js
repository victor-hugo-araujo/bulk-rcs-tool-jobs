import pLimit from 'p-limit'
import { compact } from './db/database.js'
import * as Jobs from './db/jobs.js'
import * as Contacts from './db/contacts.js'
import { sendBulkBatch, MAX_BATCH_SIZE } from './lib/twilioBulkSender.js'
import { runtimeConfig, SAFE_TEST_MODE } from './lib/runtimeConfig.js'

// Only compact the DB after jobs large enough for the VACUUM cost to be worth
// it. VACUUM rewrites the whole DB file; for a 50-contact job it's pure
// overhead.
const COMPACT_THRESHOLD = 1000

// Effective chunk/concurrency come from runtimeConfig (env-driven).
const BATCH_SIZE = Math.min(runtimeConfig.chunkSize, MAX_BATCH_SIZE)
const CONCURRENCY = runtimeConfig.maxConcurrency
const DELAY_BETWEEN_BATCHES_MS = runtimeConfig.delayBetweenBatchesMs

// Single, global queue of pending job ids. We process one job at a time so:
//   - The Twilio Bulk API isn't hit with N×concurrency calls when users upload
//     several files at once.
//   - Memory pressure stays bounded (one job's worth of buffer in flight).
//   - The MPS limit on a Twilio sender (e.g. 100 MPS for RCS) isn't shared
//     across competing jobs unpredictably.
const pendingJobIds = []
let isDraining = false

export function enqueueJob(jobId) {
  if (!pendingJobIds.includes(jobId)) {
    pendingJobIds.push(jobId)
    console.log(`[worker] Enqueued job ${jobId} (queue depth=${pendingJobIds.length})`)
  }
  drain()
}

async function drain() {
  if (isDraining) return
  isDraining = true

  while (pendingJobIds.length > 0) {
    const jobId = pendingJobIds.shift()
    try {
      await processJob(jobId)
    } catch (err) {
      console.error(`[worker] Job ${jobId} crashed:`, err)
      try {
        Jobs.complete(jobId, { successful: 0, failed: 0, error: err.message })
        Contacts.deleteByJob(jobId)
      } catch { /* swallow */ }
    }
  }

  isDraining = false
}

// Returns the queue snapshot so the UI can show "you are #3 in line".
export function queueSnapshot() {
  return {
    pending: [...pendingJobIds],
    isDraining
  }
}

async function processJob(jobId) {
  const job = Jobs.getJob(jobId)
  if (!job) {
    console.warn(`[worker] Job ${jobId} not found, skipping`)
    return
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return
  }

  // Honor a cancellation that arrived while the job was waiting in queue.
  if (job.status === 'cancelling') {
    console.log(`[worker] Job ${jobId} cancelled before it started running`)
    Jobs.complete(jobId, { successful: 0, failed: 0, status: 'cancelled', error: 'Cancelled by user' })
    Contacts.deleteByJob(jobId)
    return
  }

  Jobs.setStatus(jobId, 'processing')
  const t0 = Date.now()
  console.log(JSON.stringify({
    evt: 'job.start',
    jobId,
    channel: job.channel,
    total: job.total,
    chunkSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    delayBetweenBatchesMs: DELAY_BETWEEN_BATCHES_MS,
    estimatedApiRequests: Math.ceil(job.total / BATCH_SIZE)
  }))

  const limit = pLimit(CONCURRENCY)
  let totalSent = 0
  let totalFailed = 0
  let wasCancelled = false
  let apiRequestsSent = 0
  let retries429 = 0
  let retries5xx = 0

  while (true) {
    // Cancellation check between batches. We read fresh status from the DB so
    // a DELETE /api/jobs/:id call lands here within a few seconds.
    const current = Jobs.getJob(jobId)
    if (current?.status === 'cancelling') {
      console.log(`[worker] Job ${jobId} cancellation detected — stopping after ${totalSent} sent`)
      wasCancelled = true
      break
    }

    const batch = Contacts.fetchPending(jobId, BATCH_SIZE * CONCURRENCY)
    if (batch.length === 0) break

    const chunks = []
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      chunks.push(batch.slice(i, i + BATCH_SIZE))
    }

    const results = await Promise.all(
      chunks.map((chunk) =>
        limit(() =>
          sendBulkBatch({
            contacts: chunk,
            message: job.message,
            mediaUrl: job.mediaUrl,
            contentTemplate: job.contentTemplate,
            channel: job.channel,
            senderConfig: job.senderConfig,
            twilioConfig: job.twilioConfig,
            scheduledAt: job.scheduledAt
          }).catch((err) => ({
            successful: [],
            failed: chunk.map((c) => ({ contactId: c.id, error: err.message }))
          }))
        )
      )
    )

    let batchSent = 0
    let batchFailed = 0
    apiRequestsSent += results.length
    for (const r of results) {
      if (r.successful?.length) {
        Contacts.markSentBulk(r.successful)
        batchSent += r.successful.length
      }
      if (r.failed?.length) {
        Contacts.markFailedBulk(r.failed)
        batchFailed += r.failed.length
      }
      if (r.status === 429) retries429++
      if (r.status >= 500 && r.status < 600) retries5xx++
    }

    totalSent += batchSent
    totalFailed += batchFailed
    Jobs.incrementCounters(jobId, { successful: batchSent, failed: batchFailed })

    console.log(JSON.stringify({
      evt: 'job.progress',
      jobId,
      sent: totalSent,
      failed: totalFailed,
      apiRequestsSent,
      retries429,
      retries5xx
    }))

    // Optional throttle between batch waves. Default 500ms; skipped when 0.
    if (DELAY_BETWEEN_BATCHES_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS))
    }
  }

  if (wasCancelled) {
    Jobs.complete(jobId, {
      successful: totalSent,
      failed: totalFailed,
      status: 'cancelled',
      error: `Cancelled by user after ${totalSent} sent`
    })
  } else {
    Jobs.complete(jobId, { successful: totalSent, failed: totalFailed })
  }

  // Delete pending/sent contacts to keep the local DB small. Job summary stays.
  Contacts.deleteByJob(jobId)

  if (job.total >= COMPACT_THRESHOLD) {
    console.log(`[worker] Job ${jobId} reclaiming disk space (VACUUM)...`)
    const t0 = Date.now()
    compact()
    console.log(`[worker] Job ${jobId} compacted in ${Date.now() - t0}ms`)
  }

  const finalLabel = wasCancelled ? 'cancelled' : 'done'
  const durationMs = Date.now() - t0
  console.log(JSON.stringify({
    evt: 'job.end',
    jobId,
    outcome: finalLabel,
    sent: totalSent,
    failed: totalFailed,
    apiRequestsSent,
    retries429,
    retries5xx,
    durationMs,
    throughputMsgPerSec: durationMs > 0 ? Math.round((totalSent * 1000) / durationMs) : 0
  }))
}

// Recover any jobs that were left in 'pending', 'processing' or 'cancelling'
// after a crash. We mark them as failed so the UI doesn't show them stuck.
export function recoverOnBoot() {
  const all = Jobs.listJobs(200)
  for (const j of all) {
    if (j.status === 'processing' || j.status === 'cancelling' || j.status === 'pending') {
      Jobs.complete(j.id, {
        successful: j.successful || 0,
        failed: j.failed || 0,
        error: `Server restarted while job was ${j.status}`
      })
      Contacts.deleteByJob(j.id)
    }
  }
}
