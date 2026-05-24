// Local JSON persistence for saved credentials and senders.
//
// ⚠️ Stored in plaintext on disk for simplicity. This is a deliberate
// trade-off: the project is meant to run locally, on the operator's own
// machine, and the operator already has access to the same Twilio token via
// the live Console. We chmod the file to 0600 so other OS users can't read
// it, but anyone with shell access to the same user can.
//
// Do NOT add this file to git, ship it in Docker images, or sync it to cloud
// storage. The UI displays a prominent warning.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import crypto from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '..', 'data')
const SETTINGS_PATH = process.env.BULK_RCS_SETTINGS_PATH || resolve(DATA_DIR, 'settings.json')

mkdirSync(DATA_DIR, { recursive: true })

const empty = () => ({ credentials: [], senders: [] })

function readAll() {
  if (!existsSync(SETTINGS_PATH)) return empty()
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
      senders: Array.isArray(parsed.senders) ? parsed.senders : []
    }
  } catch (err) {
    console.warn('[settings] Failed to read', SETTINGS_PATH, '— starting empty:', err.message)
    return empty()
  }
}

function writeAll(data) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8')
  try { chmodSync(SETTINGS_PATH, 0o600) } catch { /* best effort */ }
}

// --- credentials -----------------------------------------------------------

const sanitizeCredential = (raw) => {
  const out = {
    id: raw.id || crypto.randomUUID(),
    name: String(raw.name || '').trim().slice(0, 80) || 'Untitled',
    accountSid: String(raw.accountSid || '').trim(),
    createdAt: raw.createdAt || new Date().toISOString()
  }
  if (raw.authToken) out.authToken = String(raw.authToken).trim()
  if (raw.apiKeySid) out.apiKeySid = String(raw.apiKeySid).trim()
  if (raw.apiKeySecret) out.apiKeySecret = String(raw.apiKeySecret).trim()
  if (raw.conversationServiceSid) out.conversationServiceSid = String(raw.conversationServiceSid).trim()
  return out
}

// What we return to the UI: SID is shown only as last 4 chars, token never
// echoes back unless the UI asks for the full record via a separate endpoint.
const maskCredential = (c) => ({
  id: c.id,
  name: c.name,
  accountSidMasked: c.accountSid ? `AC••••${c.accountSid.slice(-4)}` : '',
  hasAuthToken: !!c.authToken,
  hasApiKey: !!(c.apiKeySid && c.apiKeySecret),
  hasConversationServiceSid: !!c.conversationServiceSid,
  createdAt: c.createdAt
})

export function listCredentials() {
  return readAll().credentials.map(maskCredential)
}

export function getCredential(id) {
  return readAll().credentials.find(c => c.id === id) || null
}

export function upsertCredential(input) {
  const data = readAll()
  const sanitized = sanitizeCredential(input)
  const idx = data.credentials.findIndex(c => c.id === sanitized.id)
  if (idx >= 0) data.credentials[idx] = { ...data.credentials[idx], ...sanitized }
  else data.credentials.push(sanitized)
  writeAll(data)
  return maskCredential(sanitized)
}

export function deleteCredential(id) {
  const data = readAll()
  const before = data.credentials.length
  data.credentials = data.credentials.filter(c => c.id !== id)
  writeAll(data)
  return data.credentials.length < before
}

// --- senders ---------------------------------------------------------------

const SUPPORTED_CHANNELS = ['sms', 'whatsapp', 'rcs']
const SUPPORTED_TYPES = ['phone', 'messaging-service']

const sanitizeSender = (raw) => {
  const channel = SUPPORTED_CHANNELS.includes(String(raw.channel || '').toLowerCase())
    ? raw.channel.toLowerCase()
    : 'sms'
  const type = SUPPORTED_TYPES.includes(String(raw.type || '').toLowerCase())
    ? raw.type.toLowerCase()
    : 'phone'
  return {
    id: raw.id || crypto.randomUUID(),
    name: String(raw.name || '').trim().slice(0, 80) || 'Untitled',
    channel,
    type,
    value: String(raw.value || '').trim(),
    createdAt: raw.createdAt || new Date().toISOString()
  }
}

export function listSenders() {
  return readAll().senders
}

export function upsertSender(input) {
  const data = readAll()
  const sanitized = sanitizeSender(input)
  const idx = data.senders.findIndex(s => s.id === sanitized.id)
  if (idx >= 0) data.senders[idx] = { ...data.senders[idx], ...sanitized }
  else data.senders.push(sanitized)
  writeAll(data)
  return sanitized
}

export function deleteSender(id) {
  const data = readAll()
  const before = data.senders.length
  data.senders = data.senders.filter(s => s.id !== id)
  writeAll(data)
  return data.senders.length < before
}

export { SETTINGS_PATH }
