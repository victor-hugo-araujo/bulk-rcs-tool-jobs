// Wrapper around Twilio's Bulk Messaging API (open beta, May 2026).
// Reference: https://www.twilio.com/docs/bulk-messaging
//
// One request enqueues up to BATCH_SIZE recipients. The endpoint returns a Bulk
// resource SID and the per-recipient messages are created asynchronously by
// Twilio. We treat every recipient in a successful batch response as 'queued'
// because that's the strongest guarantee we get back synchronously; actual
// delivery state can be tracked via Twilio Console / Insights (Twilio keeps
// message logs for up to 400 days).

const BULK_ENDPOINT = 'https://messaging.twilio.com/v2/Bulk/Messages'
export const BATCH_SIZE = 1000

const personalize = (template, variables) => {
  if (typeof template !== 'string' || !template) return template
  let out = template
  if (variables && typeof variables === 'object') {
    for (const [key, value] of Object.entries(variables)) {
      out = out.replace(new RegExp(`\\{${key}\\}`, 'gi'), value ?? '')
    }
  }
  return out
}

const toDestination = (phone, channel) => {
  const normalized = String(phone || '').replace(/^whatsapp:/i, '').trim()
  if (channel === 'whatsapp') return `whatsapp:${normalized}`
  return normalized
}

const buildRecipient = ({ contact, message, mediaUrl, contentTemplate, channel }) => {
  const to = toDestination(contact.phone, channel)
  const variables = contact.variables || {}

  if (contentTemplate?.contentSid) {
    // Per-recipient content variables go through Twilio's ContentVariables.
    const resolved = {}
    for (const [k, v] of Object.entries(contentTemplate.variables || {})) {
      resolved[k] = personalize(String(v ?? ''), variables)
    }
    const recipient = { To: to }
    if (Object.keys(resolved).length > 0) {
      recipient.ContentVariables = JSON.stringify(resolved)
    }
    return recipient
  }

  const recipient = { To: to, Body: personalize(message || '', variables) }
  if (mediaUrl) {
    const personalizedMedia = personalize(String(mediaUrl), variables).trim()
    if (/^https?:\/\//i.test(personalizedMedia)) {
      recipient.MediaUrl = [personalizedMedia]
    }
  }
  return recipient
}

const authHeader = (twilioConfig) => {
  const sid = twilioConfig.apiKeySid && twilioConfig.apiKeySecret ? twilioConfig.apiKeySid : twilioConfig.accountSid
  const token = twilioConfig.apiKeySid && twilioConfig.apiKeySecret ? twilioConfig.apiKeySecret : twilioConfig.authToken
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
}

export async function sendBulkBatch({ contacts, message, mediaUrl, contentTemplate, channel, senderConfig, twilioConfig, scheduledAt }) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return { successful: [], failed: [] }
  }
  if (contacts.length > BATCH_SIZE) {
    throw new Error(`Bulk batch size must be <= ${BATCH_SIZE}`)
  }

  const recipients = contacts.map((contact) =>
    buildRecipient({ contact, message, mediaUrl, contentTemplate, channel })
  )

  const body = {
    Recipients: recipients
  }

  if (senderConfig.type === 'messaging-service') {
    body.MessagingServiceSid = senderConfig.messagingServiceSid
  } else {
    body.From = toDestination(senderConfig.phoneNumber, channel)
  }

  if (contentTemplate?.contentSid) {
    body.ContentSid = contentTemplate.contentSid
  } else {
    body.Body = message || ''
  }

  if (scheduledAt) {
    body.SendAt = new Date(scheduledAt).toISOString()
    body.ScheduleType = 'fixed'
  }

  const response = await fetch(BULK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(twilioConfig),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const text = await response.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* leave as raw text */ }

  if (!response.ok) {
    const errMsg = parsed?.message || parsed?.error || text || `HTTP ${response.status}`
    // Whole batch failed: mark every contact as failed with the same reason.
    return {
      successful: [],
      failed: contacts.map((c) => ({ contactId: c.id, error: `Bulk send failed: ${errMsg}` }))
    }
  }

  // Twilio Bulk responses are evolving; treat the batch as queued.
  const bulkSid = parsed?.bulk_send_sid || parsed?.bulkSendSid || parsed?.sid || null
  return {
    successful: contacts.map((c) => ({ contactId: c.id, messageSid: bulkSid })),
    failed: [],
    bulkSid
  }
}
