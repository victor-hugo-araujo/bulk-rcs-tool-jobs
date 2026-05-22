import * as Jobs from '../db/jobs.js'
import * as Contacts from '../db/contacts.js'
import { streamCsvFromRequest } from '../lib/csvStream.js'
import { enqueueJob } from '../worker.js'

const SUPPORTED_CHANNELS = ['sms', 'whatsapp', 'rcs']

const safeJSONParse = (raw, fallback = null) => {
  if (raw == null || raw === '') return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

// Registers all job endpoints directly on the provided Express app.
// Express 5 has been finicky with mounting sub-routers in ESM, so we define
// the full path here and call it a day.
export function registerJobRoutes(app) {
  // POST /api/jobs — multipart streaming upload
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
      if (!SUPPORTED_CHANNELS.includes(channel)) {
        return res.status(400).json({ error: `Invalid channel. Use one of: ${SUPPORTED_CHANNELS.join(', ')}` })
      }

      const senderConfig = safeJSONParse(fields.senderConfig)
      const twilioConfig = safeJSONParse(fields.twilioConfig)
      const contentTemplate = safeJSONParse(fields.contentTemplate, null)
      const message = fields.message || ''
      const mediaUrl = fields.mediaUrl || ''
      const scheduledAt = fields.scheduledAt || null

      if (!senderConfig || !twilioConfig) {
        return res.status(400).json({ error: 'Missing senderConfig or twilioConfig' })
      }

      if (!twilioConfig.accountSid || !(twilioConfig.authToken || (twilioConfig.apiKeySid && twilioConfig.apiKeySecret))) {
        return res.status(400).json({ error: 'Twilio credentials are required (accountSid + authToken, or accountSid + API Key SID/Secret)' })
      }

      if (!contentTemplate?.contentSid && !String(message).trim()) {
        return res.status(400).json({ error: 'Either a content template or a message body is required' })
      }

      if (result.valid === 0) {
        return res.status(400).json({ error: 'No valid phone numbers found in the CSV' })
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
      Jobs.setTotal(jobId, result.valid)
      jobCreated = true

      for (const batch of queuedBatches) {
        Contacts.insertContacts(jobId, batch)
      }
      queuedBatches = []

      enqueueJob(jobId)

      res.status(202).json({
        jobId,
        total: result.valid,
        invalid: result.invalid,
        rowsParsed: result.total
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
    res.json({ jobs: Jobs.listJobs(50) })
  })

  app.delete('/api/jobs/:id', (req, res) => {
    const job = Jobs.getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'Job not found' })
    Contacts.deleteByJob(req.params.id)
    Jobs.remove(req.params.id)
    res.json({ success: true })
  })
}
