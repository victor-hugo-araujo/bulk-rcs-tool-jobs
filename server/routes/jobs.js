import * as Jobs from '../db/jobs.js'
import * as Contacts from '../db/contacts.js'
import { streamCsvFromRequest } from '../lib/csvStream.js'
import { enqueueJob, queueSnapshot } from '../worker.js'
import { runtimeConfig, SAFE_TEST_MODE } from '../lib/runtimeConfig.js'

const SUPPORTED_CHANNELS = ['sms', 'whatsapp', 'rcs']

const safeJSONParse = (raw, fallback = null) => {
  if (raw == null || raw === '') return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

// Registers all job endpoints directly on the provided Express app.
// Express 5 has been finicky with mounting sub-routers in ESM, so we define
// the full path here and call it a day.
export function registerJobRoutes(app) {
  // Expose effective runtime configuration so the UI can show a banner when
  // SAFE_TEST_MODE is active.
  app.get('/api/runtime-config', (_req, res) => {
    res.json({
      safeTestMode: SAFE_TEST_MODE,
      chunkSize: runtimeConfig.chunkSize,
      maxConcurrency: runtimeConfig.maxConcurrency,
      delayBetweenBatchesMs: runtimeConfig.delayBetweenBatchesMs,
      maxRecipientsPerJob: runtimeConfig.maxRecipientsPerJob,
      maxRetries429: runtimeConfig.maxRetries429,
      maxRetries5xx: runtimeConfig.maxRetries5xx
    })
  })

  // POST /api/jobs — multipart streaming upload
  //
  // The CSV parser always drops duplicate recipients before they reach the
  // queued batches. The dedupMode field on the upload controls policy:
  //   'block' (default) — refuse the job with HTTP 422 if any duplicates were
  //                       detected; return the summary so the UI can offer a
  //                       retry with deduplication.
  //   'auto'            — accept the deduplicated set (first occurrence wins).
  app.post('/api/jobs', async (req, res) => {
    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data upload' })
    }

    let jobId = null
    let jobCreated = false
    let queuedBatches = []

    try {
      const result = await streamCsvFromRequest(req, {
        batchSize: 5000,
        // Always dedup at parse time; the request-level policy decides whether
        // to accept the deduplicated set or refuse the upload entirely.
        dedupMode: 'auto',
        onBatch: (contacts) => {
          if (!jobCreated) {
            queuedBatches.push(contacts)
          } else {
            Contacts.insertContacts(jobId, contacts)
          }
        }
      })

      const fields = result.fields || {}
      const channel = String(fields.channel || 'sms').toLowerCase().trim()
      const dedupMode = ['block', 'auto'].includes(String(fields.dedupMode || '').toLowerCase())
        ? fields.dedupMode.toLowerCase()
        : 'block' // safe default

      const summary = {
        rowsParsed: result.total,
        valid: result.valid,
        invalid: result.invalid,
        duplicates: result.duplicates,
        finalImported: result.finalImported
      }

      if (!SUPPORTED_CHANNELS.includes(channel)) {
        return res.status(400).json({ error: `Invalid channel. Use one of: ${SUPPORTED_CHANNELS.join(', ')}`, summary })
      }

      const senderConfig = safeJSONParse(fields.senderConfig)
      const twilioConfig = safeJSONParse(fields.twilioConfig)
      const contentTemplate = safeJSONParse(fields.contentTemplate, null)
      const message = fields.message || ''
      const mediaUrl = fields.mediaUrl || ''
      const scheduledAt = fields.scheduledAt || null

      if (!senderConfig || !twilioConfig) {
        return res.status(400).json({ error: 'Missing senderConfig or twilioConfig', summary })
      }

      if (!twilioConfig.accountSid || !(twilioConfig.authToken || (twilioConfig.apiKeySid && twilioConfig.apiKeySecret))) {
        return res.status(400).json({ error: 'Twilio credentials are required (accountSid + authToken, or accountSid + API Key SID/Secret)', summary })
      }

      if (!contentTemplate?.contentSid && !String(message).trim()) {
        return res.status(400).json({ error: 'Either a content template or a message body is required', summary })
      }

      if (result.valid === 0) {
        return res.status(400).json({ error: 'No valid phone numbers found in the CSV', summary })
      }

      // POLICY: enforce per-job ceiling (e.g. SAFE_TEST_MODE caps at 100).
      if (runtimeConfig.maxRecipientsPerJob > 0 && result.finalImported > runtimeConfig.maxRecipientsPerJob) {
        return res.status(422).json({
          error: `Job exceeds the configured ceiling of ${runtimeConfig.maxRecipientsPerJob} recipients${SAFE_TEST_MODE ? ' (SAFE_TEST_MODE active)' : ''}.`,
          code: 'RECIPIENTS_OVER_LIMIT',
          summary,
          hint: 'Reduce the CSV size, raise BULK_API_MAX_RECIPIENTS_PER_JOB, or disable SAFE_TEST_MODE.'
        })
      }

      // POLICY: if the CSV had duplicates and the caller did not opt into
      // automatic deduplication, refuse the upload. No job is created.
      if (dedupMode === 'block' && result.duplicates > 0) {
        return res.status(422).json({
          error: 'CSV contains duplicate recipients. Please remove duplicates or enable deduplication before creating the job.',
          code: 'DUPLICATES_DETECTED',
          summary,
          hint: "Re-submit with dedupMode='auto' to deduplicate automatically (keeps the first occurrence)."
        })
      }

      jobId = Jobs.createJob({
        channel,
        message,
        mediaUrl,
        contentTemplate,
        senderConfig,
        twilioConfig,
        scheduledAt
      })
      Jobs.setTotal(jobId, result.finalImported)
      jobCreated = true

      for (const batch of queuedBatches) {
        Contacts.insertContacts(jobId, batch)
      }
      queuedBatches = []

      enqueueJob(jobId)

      res.status(202).json({
        jobId,
        total: result.finalImported,
        summary,
        dedupMode
      })
    } catch (err) {
      console.error('POST /api/jobs failed:', err)
      if (jobId) {
        try {
          Jobs.complete(jobId, { successful: 0, failed: 0, error: err.message })
          Contacts.deleteByJob(jobId)
        } catch { /* ignore */ }
      }
      res.status(500).json({ error: err.message || 'Failed to create job' })
    }
  })

  app.get('/api/jobs/:id', (req, res) => {
    const job = Jobs.getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'Job not found' })

    const { twilioConfig, ...safe } = job
    res.json({
      ...safe,
      progress: job.total > 0 ? Math.round(((job.successful + job.failed) / job.total) * 100) : 0
    })
  })

  app.get('/api/jobs', (_req, res) => {
    const snapshot = queueSnapshot()
    res.json({
      jobs: Jobs.listJobs(50),
      queue: {
        pending: snapshot.pending,
        depth: snapshot.pending.length,
        draining: snapshot.isDraining
      }
    })
  })

  // DELETE behaves differently depending on the job's current status:
  //   - pending or processing → flag as 'cancelling'; worker stops after next batch
  //   - cancelling             → idempotent (already cancelling)
  //   - completed/failed/cancelled → physically remove from DB
  app.delete('/api/jobs/:id', (req, res) => {
    const job = Jobs.getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'Job not found' })

    if (job.status === 'pending' || job.status === 'processing') {
      Jobs.requestCancel(req.params.id)
      return res.json({ success: true, action: 'cancelling', message: 'Cancellation requested — worker will stop after the next batch.' })
    }

    if (job.status === 'cancelling') {
      return res.json({ success: true, action: 'cancelling', message: 'Cancellation already in progress.' })
    }

    // Terminal state — remove the row + any leftover contacts.
    Contacts.deleteByJob(req.params.id)
    Jobs.remove(req.params.id)
    res.json({ success: true, action: 'removed' })
  })
}
