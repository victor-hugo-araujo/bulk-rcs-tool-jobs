import busboy from 'busboy'
import Papa from 'papaparse'

const PHONE_FIELDS = ['phone', 'number', 'mobile', 'cell', 'telephone', 'tel']

const normalizePhone = (raw) => {
  const cleaned = String(raw || '').trim().replace(/\s+/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('+')) return cleaned
  if (/^[1-9]\d{10,14}$/.test(cleaned)) return '+' + cleaned
  return null
}

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
// `onBatch` is invoked synchronously (SQLite writes are sync). Returns totals
// once the file finishes uploading: { total, valid, invalid }.
export function streamCsvFromRequest(req, { batchSize = 5000, onBatch, onFields } = {}) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: 200 * 1024 * 1024 } })

    let total = 0
    let valid = 0
    let invalid = 0
    let buffer = []
    let phoneField = null
    let headers = null
    const extraFields = {}

    const flush = () => {
      if (buffer.length === 0) return
      const out = buffer
      buffer = []
      if (onBatch) onBatch(out)
    }

    bb.on('field', (name, value) => {
      extraFields[name] = value
    })

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

            const variables = {}
            for (const [k, v] of Object.entries(row)) {
              if (k && v !== undefined && v !== null && String(v).length > 0) {
                variables[k] = String(v)
              }
            }
            variables.phone = phone

            buffer.push({ phone, variablesJson: JSON.stringify(variables) })
            valid++

            if (buffer.length >= batchSize) flush()
          }
        },
        complete: () => {
          try {
            flush()
            if (onFields) onFields(extraFields)
            resolve({ total, valid, invalid, fields: extraFields })
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
