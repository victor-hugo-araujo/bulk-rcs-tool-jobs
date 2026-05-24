import busboy from 'busboy'
import Papa from 'papaparse'

const PHONE_FIELDS = ['phone', 'number', 'mobile', 'cell', 'telephone', 'tel']

// Normalize a phone for STORAGE (E.164-ish + leading +).
const normalizePhone = (raw) => {
  const cleaned = String(raw || '').trim().replace(/\s+/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('+')) return cleaned
  if (/^[1-9]\d{10,14}$/.test(cleaned)) return '+' + cleaned
  return null
}

// Normalize a phone for DEDUPLICATION key. Strips channel prefixes, all
// non-digit/+ characters, and lowercases. This way `whatsapp:+551199998888`,
// `+551199998888`, and `+55 11 99998888` all collapse to the same key.
const dedupKey = (phone) =>
  String(phone || '').toLowerCase().replace(/^(whatsapp:|rcs:|sms:)/, '').replace(/[^\d+]/g, '')

const detectPhoneField = (headers) => {
  const lowered = headers.map((h) => h.toLowerCase())
  for (const candidate of PHONE_FIELDS) {
    const idx = lowered.findIndex((h) => h.includes(candidate))
    if (idx >= 0) return headers[idx]
  }
  return headers[0] || null
}

// Streams a multipart upload, parses the CSV line-by-line, and invokes
// `onBatch(contacts)` whenever `batchSize` valid rows have been collected.
//
// dedupMode:
//   'auto'  — silently drop duplicates, keep only first occurrence
//   'block' — count duplicates but ALSO drop them (caller can refuse the job)
//   'allow' — keep duplicates as-is (NOT recommended; Twilio Bulk doesn't dedup)
//
// Resolves with:
//   { total, valid, invalid, duplicates, finalImported, fields }
export function streamCsvFromRequest(req, {
  batchSize = 5000,
  onBatch,
  onFields,
  dedupMode = 'auto'
} = {}) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: 200 * 1024 * 1024 } })

    let total = 0
    let valid = 0
    let invalid = 0
    let duplicates = 0
    let finalImported = 0
    let buffer = []
    let phoneField = null
    let headers = null
    const extraFields = {}
    // Set of dedupKey(phone) seen so far. Memory ~50 bytes per unique phone:
    // for 1M unique phones, ~50 MB — comfortable.
    const seen = new Set()

    const flush = () => {
      if (buffer.length === 0) return
      const out = buffer
      buffer = []
      if (onBatch) onBatch(out)
    }

    bb.on('field', (name, value) => { extraFields[name] = value })

    bb.on('file', (_name, file) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        chunk: (results) => {
          if (!headers && results.meta?.fields) {
            headers = results.meta.fields
            phoneField = detectPhoneField(headers)
          }

          for (const row of results.data) {
            total++
            const rawPhone = phoneField ? row[phoneField] : Object.values(row)[0]
            const phone = normalizePhone(rawPhone)
            if (!phone) {
              invalid++
              continue
            }
            valid++

            const key = dedupKey(phone)
            const isDuplicate = seen.has(key)
            if (isDuplicate) {
              duplicates++
              if (dedupMode !== 'allow') continue // drop
              // dedupMode === 'allow' falls through and stores the duplicate
            } else {
              seen.add(key)
            }

            const variables = {}
            for (const [k, v] of Object.entries(row)) {
              if (k && v !== undefined && v !== null && String(v).length > 0) {
                variables[k] = String(v)
              }
            }
            variables.phone = phone

            buffer.push({ phone, variablesJson: JSON.stringify(variables) })
            finalImported++

            if (buffer.length >= batchSize) flush()
          }
        },
        complete: () => {
          try {
            flush()
            if (onFields) onFields(extraFields)
            resolve({ total, valid, invalid, duplicates, finalImported, fields: extraFields })
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => reject(err)
      })
    })

    bb.on('error', reject)

    req.pipe(bb)
  })
}
