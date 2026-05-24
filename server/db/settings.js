// Local JSON persistence for saved senders only.
//
// We intentionally do NOT persist Twilio credentials in this project — the
// reputational and security risk of someone leaking a tokenized file (via a
// shared folder, a compromised machine, or a fork uploaded to GitHub) is
// higher than the convenience of skipping a copy/paste each session.
//
// If a previous version of this app saved credentials in this file, those
// entries are STRIPPED on the next read and the file is rewritten without
// them. Any sender data is preserved.
//
// The file lives outside the project tree (under the user's home directory)
// and is chmod 0600 so other OS users on the same machine can't read it.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import crypto from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOME_DATA_DIR = join(homedir(), '.bulk-rcs-tool')
const LEGACY_PATH = resolve(__dirname, '..', 'data', 'settings.json')
const SETTINGS_PATH = process.env.BULK_RCS_SETTINGS_PATH || join(HOME_DATA_DIR, 'settings.json')

mkdirSync(dirname(SETTINGS_PATH), { recursive: true })

const empty = () => ({ senders: [] })

// One-time migration: move legacy in-project file out to ~/.bulk-rcs-tool/.
// We also wipe any 'credentials' array as part of the move.
try {
  if (existsSync(LEGACY_PATH) && !existsSync(SETTINGS_PATH)) {
    let migrated = false
    try {
      const parsed = JSON.parse(readFileSync(LEGACY_PATH, 'utf8'))
      const sendersOnly = { senders: Array.isArray(parsed?.senders) ? parsed.senders : [] }
      writeFileSync(SETTINGS_PATH, JSON.stringify(sendersOnly, null, 2), 'utf8')
      chmodSync(SETTINGS_PATH, 0o600)
      unlinkSync(LEGACY_PATH)
      migrated = true
      const hadCreds = (parsed?.credentials?.length || 0) > 0
      console.log(`[settings] Migrated to ${SETTINGS_PATH}${hadCreds ? ' (dropped saved credentials — feature removed)' : ''}`)
    } catch {
      // unparseable legacy file — leave it alone
    }
    if (!migrated) {
      // best-effort cleanup of empty stub
      try { renameSync(LEGACY_PATH, LEGACY_PATH + '.bak') } catch {}
    }
  }
} catch (err) {
  console.warn('[settings] Legacy migration check failed:', err.message)
}

function readAll() {
  if (!existsSync(SETTINGS_PATH)) return empty()
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    const senders = Array.isArray(parsed?.senders) ? parsed.senders : []

    // ACTIVE CLEANUP: if a previous app version persisted credentials in this
    // file, drop them now and rewrite the file. The credentials feature is
    // removed and we don't want stale tokens lingering on disk.
    if (Array.isArray(parsed?.credentials) && parsed.credentials.length > 0) {
      console.log('[settings] Removing previously saved credentials from on-disk file (feature was removed).')
      writeFileSync(SETTINGS_PATH, JSON.stringify({ senders }, null, 2), 'utf8')
      try { chmodSync(SETTINGS_PATH, 0o600) } catch {}
    }

    return { senders }
  } catch (err) {
    console.warn('[settings] Failed to read', SETTINGS_PATH, '— starting empty:', err.message)
    return empty()
  }
}

function writeAll(data) {
  writeFileSync(SETTINGS_PATH, JSON.stringify({ senders: data.senders || [] }, null, 2), 'utf8')
  try { chmodSync(SETTINGS_PATH, 0o600) } catch { /* best effort */ }
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
