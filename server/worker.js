import pLimit from 'p-limit'
import * as Jobs from './db/jobs.js'
import * as Contacts from './db/contacts.js'
import { sendBulkBatch, BATCH_SIZE } from './lib/twilioBulkSender.js'

// Max concurrent Twilio Bulk requests in flight per job. The Bulk API queues
// internally, so we don't need huge concurrency from our side — a handful is
// plenty and keeps memory low.
const CONCURRENCY = Number(process.env.BULK_RCS_CONCURRENCY || 4)

const runningJobs = new Set()

export function enqueueJob(jobId) {
  if (runningJobs.has(jobId)) return
  runningJobs.add(jobId)
  // Run on next tick so the HTTP response can flush first.
  setImmediate(() => {
    processJob(jobId).catch((err) => {
      console.error(`[worker] Job ${jobId} crashed:`, err)
      try {
        Jobs.complete(jobId, { successful: 0, failed: 0, error: err.message })
        Contacts.deleteByJob(jobId)
      } catch { /* swallow */ }
    }).finally(() => {
      runningJobs.delete(jobId)
    })
  })
}

async function processJob(jobId) {
  const job = Jobs.getJob(jobId)
  if (!job) {
    console.warn(`[worker] Job ${jobId} not found, skipping`)
    return
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return
  }

  Jobs.setStatus(jobId, 'processing')
  console.log(`[worker] Job ${jobId} started — ${job.total} contacts on channel=${job.channel}`)

  const limit = pLimit(CONCURRENCY)
  let totalSent = 0
  let totalFailed = 0

  // We process in batches of BATCH_SIZE. Each batch is fully consumed before
  // we ask the DB for more pending rows, so we never load everything in RAM.
  // eslint-disable-next-line no-constant-condition
  while (true) {
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
    for (const r of results) {
      if (r.successful?.length) {
        Contacts.markSentBulk(r.successful)
        batchSent += r.successful.length
      }
      if (r.failed?.length) {
        Contacts.markFailedBulk(r.failed)
        batchFailed += r.failed.length
      }
    }

    totalSent += batchSent
    totalFailed += batchFailed
    Jobs.incrementCounters(jobId, { successful: batchSent, failed: batchFailed })

    console.log(`[worker] Job ${jobId} progress — sent=${totalSent} failed=${totalFailed}`)
  }

  Jobs.complete(jobId, { successful: totalSent, failed: totalFailed })
  // Delete the contacts to keep the local DB small.
  // The job row itself (with sumário) stays for the user to see.
  Contacts.deleteByJob(jobId)
  console.log(`[worker] Job ${jobId} done — sent=${totalSent} failed=${totalFailed}`)
}

// Recover any jobs that were left in 'pending' or 'processing' after a crash.
// We mark them as failed so the UI doesn't show them stuck forever.
export function recoverOnBoot() {
  // No public list-by-status in jobs.js; check listJobs and filter.
  const all = Jobs.listJobs(200)
  for (const j of all) {
    if (j.status === 'processing') {
      Jobs.complete(j.id, { successful: j.successful || 0, failed: j.failed || 0, error: 'Server restarted while job was processing' })
      Contacts.deleteByJob(j.id)
    }
  }
}
