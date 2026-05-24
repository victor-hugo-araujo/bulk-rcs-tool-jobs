// Wrapper around Twilio's Bulk Messaging API (open beta, May 2026).
// Reference: https://www.twilio.com/docs/bulk-messaging/api/message-resource
//
// Endpoint:   POST https://comms.twilio.com/v1/Messages
// Limits:     up to 10,000 recipients per request
// Returns:    202 Accepted + operationId header (async — actual delivery state
//             is tracked via Twilio Operations resource / Console logs)
//
// IMPORTANT: this endpoint does NOT support `contentSid` / Twilio Content
// templates. Only inline `text` and `media` are accepted. If a job tries to
// use a Content template we fail fast with a clear error so the user knows
// they have to switch to free-text mode for bulk sends.
//
// Personalization uses Liquid syntax: {{ variable }}. We auto-convert the
// project's existing `{name}` placeholders to `{{name}}` so the UI experience
// stays the same.

const BULK_ENDPOINT = 'https://comms.twilio.com/v1/Messages'
export const BATCH_SIZE = 5000 // well under the 10k Twilio limit; keeps payloads reasonable

// Convert app-style `{name}` placeholders to Liquid `{{ name | default: '' }}`.
//
// Twilio's Bulk Messaging API rejects (HTTP 400) any Liquid variable that
// doesn't carry an explicit `| default:` filter — this protects against
// missing-variable scenarios for individual recipients.
//
// Conversions:
//   {name}                          → {{ name | default: '' }}
//   {{name}}                        → {{ name | default: '' }}
//   {{ name }}                      → {{ name | default: '' }}
//   {{ name | default: 'amigo' }}   → unchanged (already has default)
const toLiquid = (template) => {
  if (typeof template !== 'string') return template

  // 1. Single-brace `{var}` → Liquid with default (skip `{{var}}` runs).
  let out = template.replace(
    /(^|[^{])\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g,
    "$1{{ $2 | default: '' }}"
  )

  // 2. Bare Liquid `{{var}}` (no filter) → add `| default: ''`.
  //    Matches only when the variable is followed by whitespace then `}}`,
  //    so anything piping through filters is left untouched.
  out = out.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    "{{ $1 | default: '' }}"
  )

  return out
}

const normalizePhone = (phone) =>
  String(phone || '').replace(/^whatsapp:/i, '').trim()

// Strip ALL known channel prefixes from a sender address.
// Twilio's Bulk API expects `from.address` without prefix; the channel is
// declared separately in `from.channel`.
//   "rcs:my_agent"          → "my_agent"
//   "whatsapp:+15551234"    → "+15551234"
//   "+15551234"             → "+15551234"
//   "MyBrand"               → "MyBrand"
//   "12345"                 → "12345"
const normalizeSenderAddress = (raw) =>
  String(raw || '').replace(/^(whatsapp:|rcs:|sms:)/i, '').trim()

const channelMap = {
  sms: { from: 'SMS', to: 'PHONE' },
  rcs: { from: 'RCS', to: 'PHONE' },
  whatsapp: { from: 'WHATSAPP', to: 'WHATSAPP' }
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

  if (contentTemplate?.contentSid) {
    return {
      successful: [],
      failed: contacts.map((c) => ({
        contactId: c.id,
        error: 'Twilio Bulk Messaging API does not support Content templates (contentSid). Use the free-text composer with Liquid placeholders for bulk sends.'
      }))
    }
  }

  const channelCfg = channelMap[channel] || channelMap.sms

  const recipients = contacts.map((contact) => {
    const variables = contact.variables || {}
    const address = normalizePhone(contact.phone)
    return {
      address,
      channel: channelCfg.to,
      variables
    }
  })

  const body = {
    to: recipients,
    content: {}
  }

  if (message) {
    body.content.text = toLiquid(message)
  }

  if (mediaUrl) {
    body.content.media = [{ url: toLiquid(String(mediaUrl)) }]
  }

  // Sender: the Bulk Messaging API only accepts {address, channel} in `from`.
  // It does NOT accept messagingServiceSid here. When the user picked a Messaging
  // Service we omit `from` entirely and let Twilio route the batch using the
  // default sender configured for that channel on the account / Messaging Service.
  if (senderConfig.type === 'phone' && senderConfig.phoneNumber) {
    body.from = {
      address: normalizeSenderAddress(senderConfig.phoneNumber),
      channel: channelCfg.from
    }
  } else if (senderConfig.type === 'messaging-service' && senderConfig.messagingServiceSid) {
    // No `from` — Twilio picks the channel-appropriate sender automatically.
    // If multiple Messaging Services exist on the account, Twilio may not pick
    // the one you expect. Use a phone sender if you need explicit routing.
    console.log(`[twilioBulkSender] Using Messaging Service routing (sid=${senderConfig.messagingServiceSid}); omitting 'from' from request as Bulk API does not accept messagingServiceSid.`)
  }

  if (scheduledAt) {
    body.schedule = { sendAt: [new Date(scheduledAt).toISOString()] }
  }

  let response, text, parsed
  try {
    response = await fetch(BULK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': authHeader(twilioConfig),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    })
    text = await response.text()
    try { parsed = JSON.parse(text) } catch { /* leave raw */ }
  } catch (networkErr) {
    console.error('[twilioBulkSender] Network error calling Bulk API:', networkErr.message)
    return {
      successful: [],
      failed: contacts.map((c) => ({ contactId: c.id, error: `Network error: ${networkErr.message}` }))
    }
  }

  if (!response.ok) {
    const errMsg = parsed?.message || parsed?.error_message || parsed?.error || text || `HTTP ${response.status}`
    // Verbose log for debugging — easy to remove once stable.
    console.error('[twilioBulkSender] Twilio Bulk API error:')
    console.error('  status :', response.status, response.statusText)
    console.error('  url    :', BULK_ENDPOINT)
    console.error('  body   :', JSON.stringify(body))
    console.error('  resp   :', text?.slice(0, 1500))

    return {
      successful: [],
      failed: contacts.map((c) => ({ contactId: c.id, error: `Bulk send failed (HTTP ${response.status}): ${errMsg}` }))
    }
  }

  // 202 Accepted — Twilio took the batch and will process asynchronously.
  // We don't get per-recipient SIDs here; track delivery via Twilio Operations / Console logs.
  const operationId = response.headers?.get?.('operation-id') || response.headers?.get?.('operationid') || null
  console.log(`[twilioBulkSender] Batch accepted — recipients=${contacts.length} operationId=${operationId || 'n/a'}`)

  return {
    successful: contacts.map((c) => ({ contactId: c.id, messageSid: operationId })),
    failed: [],
    operationId
  }
}
