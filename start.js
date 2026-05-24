#!/usr/bin/env node
// One-command launcher: builds the frontend (if needed) and starts the backend
// which serves both the API and the static UI on a single port.

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = resolve(__dirname, 'dist')

// On Windows, `npm` is `npm.cmd` (a batch file). On POSIX it's a plain exe.
// We avoid `shell: true` because Node 26+ warns (DEP0190) about combining it
// with array args — even when, like here, the args are static.
const isWindows = process.platform === 'win32'
const npmBin = isWindows ? 'npm.cmd' : 'npm'

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function main() {
  if (!existsSync(distPath)) {
    console.log('▶  Building UI (first run)...')
    await run(npmBin, ['run', 'build'])
  }

  console.log('▶  Starting server...')
  // Hand off to the backend; it serves the built UI from /dist and the API under /api.
  await run(process.execPath, ['server.js'], { cwd: resolve(__dirname, 'server') })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
