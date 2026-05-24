import * as Settings from '../db/settings.js'

// Local persistence is limited to SENDERS only. Twilio credentials are NOT
// saved by this project — the operator must enter them each session via the
// Settings page. This is a deliberate decision: persisting tokens locally is
// a leak vector that's hard to make safe against folder sharing, backups and
// shoulder-surfing.

export function registerSettingsRoutes(app) {
  app.get('/api/settings/senders', (_req, res) => {
    res.json({ senders: Settings.listSenders() })
  })

  app.post('/api/settings/senders', (req, res) => {
    const body = req.body || {}
    if (!body.value) {
      return res.status(400).json({ error: 'value is required (phone, agent ID or Messaging Service SID)' })
    }
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
