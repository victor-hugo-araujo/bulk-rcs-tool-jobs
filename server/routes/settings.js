import * as Settings from '../db/settings.js'

export function registerSettingsRoutes(app) {
  // --- Credentials ---------------------------------------------------------

  // List credentials (masked: no token/secret leaves the server).
  app.get('/api/settings/credentials', (_req, res) => {
    res.json({ credentials: Settings.listCredentials() })
  })

  // Fetch a single credential with the FULL secret. This is what the UI calls
  // when the user picks one from the dropdown and the Settings form needs to
  // be populated.
  app.get('/api/settings/credentials/:id', (req, res) => {
    const c = Settings.getCredential(req.params.id)
    if (!c) return res.status(404).json({ error: 'Credential not found' })
    res.json(c)
  })

  app.post('/api/settings/credentials', (req, res) => {
    const body = req.body || {}
    if (!body.accountSid) {
      return res.status(400).json({ error: 'accountSid is required' })
    }
    if (!body.authToken && !(body.apiKeySid && body.apiKeySecret)) {
      return res.status(400).json({ error: 'Provide authToken OR (apiKeySid + apiKeySecret)' })
    }
    res.json(Settings.upsertCredential(body))
  })

  app.put('/api/settings/credentials/:id', (req, res) => {
    const existing = Settings.getCredential(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Credential not found' })
    res.json(Settings.upsertCredential({ ...existing, ...(req.body || {}), id: req.params.id }))
  })

  app.delete('/api/settings/credentials/:id', (req, res) => {
    const removed = Settings.deleteCredential(req.params.id)
    if (!removed) return res.status(404).json({ error: 'Credential not found' })
    res.json({ success: true })
  })

  // --- Senders -------------------------------------------------------------

  app.get('/api/settings/senders', (_req, res) => {
    res.json({ senders: Settings.listSenders() })
  })

  app.post('/api/settings/senders', (req, res) => {
    const body = req.body || {}
    if (!body.value) return res.status(400).json({ error: 'value is required (phone, agent ID or Messaging Service SID)' })
    res.json(Settings.upsertSender(body))
  })

  app.put('/api/settings/senders/:id', (req, res) => {
    const existing = Settings.listSenders().find(s => s.id === req.params.id)
    if (!existing) return res.status(404).json({ error: 'Sender not found' })
    res.json(Settings.upsertSender({ ...existing, ...(req.body || {}), id: req.params.id }))
  })

  app.delete('/api/settings/senders/:id', (req, res) => {
    const removed = Settings.deleteSender(req.params.id)
    if (!removed) return res.status(404).json({ error: 'Sender not found' })
    res.json({ success: true })
  })
}
