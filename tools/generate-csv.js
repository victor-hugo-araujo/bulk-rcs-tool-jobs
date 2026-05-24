#!/usr/bin/env node
// Generate a fake-but-realistic CSV for load testing.
//
// Usage:
//   node tools/generate-csv.js <rows> <output.csv> [--magic]
//
// Examples:
//   node tools/generate-csv.js 1000  /tmp/test-1k.csv
//   node tools/generate-csv.js 10000 /tmp/test-10k.csv
//   node tools/generate-csv.js 100000 /tmp/test-100k.csv --magic
//
// --magic   Uses Twilio Magic Number +15005550006 for every row (safe with
//           regular credentials; Twilio simulates success without delivery).
//           Otherwise, generates random-but-plausible BR mobile numbers
//           (+55 11 9 xxxx-xxxx). Pair these with Twilio Test Credentials.

import { createWriteStream } from 'node:fs'

const [, , rowsArg = '1000', outPath = './load-test.csv', flag] = process.argv
const useMagic = flag === '--magic'
const rows = Math.max(1, parseInt(rowsArg, 10) || 0)

const firstNames = ['Alice', 'Bruno', 'Carla', 'Diego', 'Eva', 'Felipe', 'Giovana', 'Hugo', 'Iara', 'João',
                    'Karla', 'Lucas', 'Marina', 'Nuno', 'Olivia', 'Pedro', 'Quésia', 'Rafael', 'Sofia', 'Thiago']
const cities = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Salvador',
                'Brasília', 'Fortaleza', 'Recife', 'Manaus']

const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)]
const padDigits = (n, len) => String(n).padStart(len, '0')

const generatePhone = (i) => {
  if (useMagic) return '+15005550006'
  // Random BR mobile: +55 11 9 XXXX-XXXX (deterministic from index for reproducibility)
  const ddd = 11 + (i % 89) // 11..99
  const block1 = padDigits((i * 7919) % 10000, 4)
  const block2 = padDigits((i * 6151) % 10000, 4)
  return `+55${padDigits(ddd, 2)}9${block1}${block2}`
}

const out = createWriteStream(outPath, { encoding: 'utf8' })
out.write('phone,name,city\n')

const start = Date.now()
for (let i = 1; i <= rows; i++) {
  const phone = generatePhone(i)
  const name = `${randomItem(firstNames)} ${i}`
  const city = randomItem(cities)
  // Backpressure: stop writing if buffer fills, resume on 'drain'
  if (!out.write(`${phone},${name},${city}\n`)) {
    await new Promise((resolve) => out.once('drain', resolve))
  }
  if (i % 50000 === 0) {
    console.log(`  ...${i.toLocaleString()} rows`)
  }
}
out.end()
await new Promise((resolve) => out.on('finish', resolve))

const elapsed = ((Date.now() - start) / 1000).toFixed(2)
console.log(`✓ Wrote ${rows.toLocaleString()} rows to ${outPath} in ${elapsed}s`)
console.log(`  Mode: ${useMagic ? 'Magic Number (+15005550006)' : 'Random BR mobile (use Test Credentials)'}`)
