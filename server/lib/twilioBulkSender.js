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

import { runtimeConfig } from './runtimeConfig.js'

const BULK_ENDPOINT = 'https://comms.twilio.com/v1/Messages'
// Absolute upper bound for any batch sent. The runtime config can set a
// SMALLER chunk size via env, but never larger than this.
export const MAX_BATCH_SIZE = 10000

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
  if (contacts.length > MAX_BATCH_SIZE) {
    throw new Error(`Bulk batch size must be <= ${MAX_BATCH_SIZE}`)
  }

  const channelCfg = channelMap[channel] || channelMap.sms
  const useTemplate = !!contentTemplate?.contentSid

  // For template sends, the user-supplied template variable values may include
  // {column} placeholders that should be replaced with the contact's CSV
  // columns before being passed to Twilio. (Twilio substitutes the resolved
  // values into the stored template at send time.)
  const resolveTemplateVarsForContact = (contact) => {
    const out = {}
    const tplVars = contentTemplate?.variables || {}
    const ctxVars = contact.variables || {}
    for (const [key, rawValue] of Object.entries(tplVars)) {
      let v = String(rawValue ?? '')
      for (const [col, colVal] of Object.entries(ctxVars)) {
        v = v.replace(new RegExp(`\\{${col}\\}`, 'gi'), String(colVal ?? ''))
      }
      out[key] = v
    }
    return out
  }

  // Safety-net dedup. The CSV stream already drops duplicates; this is a
  // second line of defense in case a future code path bypasses it (manual
  // job creation, retry from a stale queue, etc.).
  const seenAddresses = new Set()
  const uniqueContacts = []
  const droppedAsFailed = []
  for (const contact of contacts) {
    const key = normalizePhone(contact.phone).toLowerCase()
    if (!key) {
      droppedAsFailed.push({ contactId: contact.id, error: 'Empty or invalid phone' })
      continue
    }
    if (seenAddresses.has(key)) {
      droppedAsFailed.push({ contactId: contact.id, error: 'Duplicate recipient dropped before send' })
      continue
    }
    seenAddresses.add(key)
    uniqueContacts.push(contact)
  }
  if (droppedAsFailed.length > 0) {
    console.warn(`[twilioBulkSender] Dropped ${droppedAsFailed.length} duplicate/empty recipient(s) before submitting batch of ${contacts.length}.`)
  }
  if (uniqueContacts.length === 0) {
    return { successful: [], failed: droppedAsFailed }
  }

  const recipients = uniqueContacts.map((contact) => {
    const address = normalizePhone(contact.phone)
    // When sending a template, the per-recipient `variables` are the values
    // that map to the template's placeholders (e.g. {"1": "Alice", "2": "$10"}).
    // For free-text sends, we pass all CSV columns so Liquid placeholders
    // anywhere in content.text / content.media can resolve.
    const variables = useTemplate
      ? resolveTemplateVarsForContact(contact)
      : (contact.variables || {})
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

  if (useTemplate) {
    // Reference a pre-stored Content template (from Content Template Builder).
    //
    // The Bulk Messaging API uses PascalCase for compound type wrappers
    // (`MessageContentTemplate`) even though primitive content keys
    // (`text`, `media`) are lowercase. The identifier property is `contentId`
    // (Bulk API rename of the regular `ContentSid` — same HX... identifier).
    //
    // Per-recipient values for the template's placeholders go in each
    // recipient's `variables` object.
    body.content.MessageContentTemplate = { contentId: contentTemplate.contentSid }
  } else {
    if (message) {
      body.content.text = toLiquid(message)
    }
    if (mediaUrl) {
      body.content.media = [{ url: toLiquid(String(mediaUrl)) }]
    }
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

  // Retry loop for transient failures (429 throttling + 5xx).
  // - Honors Retry-After if present.
  // - Otherwise uses exponential backoff with jitter.
  // - Max retries are configurable via env (runtimeConfig).
  let response, text, parsed
  let attempt = 0
  let consecutive429 = 0
  let consecutive5xx = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
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
      try { parsed = JSON.parse(text) } catch { parsed = null }
    } catch (networkErr) {
      console.error('[twilioBulkSender] Network error calling Bulk API:', networkErr.message)
      return {
        successful: [],
        failed: [
          ...droppedAsFailed,
          ...uniqueContacts.map((c) => ({ contactId: c.id, error: `Network error: ${networkErr.message}` }))
        ]
      }
    }

    if (response.ok) break

    const status = response.status
    const retryable429 = status === 429 && consecutive429 < runtimeConfig.maxRetries429
    const retryable5xx = status >= 500 && status < 600 && consecutive5xx < runtimeConfig.maxRetries5xx

    if (!retryable429 && !retryable5xx) break // give up — error returned below

    attempt++
    if (status === 429) consecutive429++
    if (status >= 500 && status < 600) consecutive5xx++

    // Wait time: Retry-After header if provided, otherwise exponential backoff
    // (1s, 2s, 4s, ...) with up to ±25% jitter to avoid synchronized retries.
    const explicit = parseRetryAfter(response.headers)
    const expoBase = Math.min(30000, 1000 * Math.pow(2, attempt - 1))
    const jitter = expoBase * (Math.random() * 0.5 - 0.25)
    const waitMs = explicit != null ? explicit : Math.max(250, Math.round(expoBase + jitter))

    console.warn(`[twilioBulkSender] HTTP ${status} — retrying attempt ${attempt} after ${waitMs}ms${explicit != null ? ' (Retry-After honored)' : ' (exp backoff)'}`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    // Loop continues
  }

  if (!response.ok) {
    const errMsg = parsed?.message || parsed?.error_message || parsed?.error || text || `HTTP ${response.status}`
    console.error('[twilioBulkSender] Twilio Bulk API error (final, after retries):')
    console.error('  status :', response.status, response.statusText)
    console.error('  url    :', BULK_ENDPOINT)
    console.error('  body   :', JSON.stringify(body))
    console.error('  resp   :', text?.slice(0, 1500))

    return {
      successful: [],
      failed: [
        ...droppedAsFailed,
        ...uniqueContacts.map((c) => ({ contactId: c.id, error: `Bulk send failed (HTTP ${response.status}): ${errMsg}` }))
      ],
      status: response.status,
      retries: attempt,
      retryAfter: parseRetryAfter(response.headers)
    }
  }

  // 202 Accepted — Twilio took the batch and will process asynchronously.
  // We don't get per-recipient SIDs here; track delivery via Twilio Operations / Console logs.
  const operationId = response.headers?.get?.('operation-id') || response.headers?.get?.('operationid') || null
  console.log(`[twilioBulkSender] Batch accepted — recipients=${uniqueContacts.length} operationId=${operationId || 'n/a'}${droppedAsFailed.length ? ` (+${droppedAsFailed.length} dropped)` : ''}`)

  return {
    successful: uniqueContacts.map((c) => ({ contactId: c.id, messageSid: operationId })),
    failed: droppedAsFailed,
    operationId
  }
}

// Read Retry-After header. Twilio may return seconds (integer) or an HTTP-date.
function parseRetryAfter(headers) {
  if (!headers || typeof headers.get !== 'function') return null
  const v = headers.get('retry-after')
  if (!v) return null
  const asInt = Number(v)
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000
  const asDate = Date.parse(v)
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now())
  }
  return null
}
