#!/usr/bin/env node
// One-command launcher: builds the frontend (if needed) and starts the backend
// which serves both the API and the static UI on a single port.

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = resolve(__dirname, 'dist')

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts })
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function main() {
  if (!existsSync(distPath)) {
    console.log('▶  Building UI (first run)...')
    await run('npm', ['run', 'build'])
  }

  console.log('▶  Starting server...')
  // Hand off to the backend; it serves the built UI from /dist and the API under /api.
  await run('node', ['server.js'], { cwd: resolve(__dirname, 'server') })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
