// Centralized, env-driven runtime configuration for the worker / sender.
//
// Defaults are conservative on purpose. To use higher values, set the env
// variables below at boot — don't edit this file directly.

const num = (envValue, fallback, { min = 0, max = Infinity } = {}) => {
  const v = Number(envValue)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

const bool = (envValue, fallback) => {
  if (envValue == null) return fallback
  const s = String(envValue).toLowerCase().trim()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

export const SAFE_TEST_MODE = bool(process.env.SAFE_TEST_MODE, false)

// Defaults are sized so the Bulk API is actually used as a batch API (it's
// the point of using it) while keeping concurrency and pacing modest. Override
// per environment via env vars when capacity has been coordinated upstream.
//
//   BULK_API_CHUNK_SIZE             recipients per Bulk API request
//   BULK_API_MAX_CONCURRENCY        parallel Bulk API requests per job
//   BULK_API_DELAY_BETWEEN_BATCHES_MS  pause between batches (per worker tick)
//   BULK_API_MAX_RETRIES_429        max retries on 429
//   BULK_API_MAX_RETRIES_5XX        max retries on 5xx
//   BULK_API_MAX_RECIPIENTS_PER_JOB optional hard cap; reject jobs above this
const baseDefaults = {
  // 30% of the Bulk API per-request capacity (max is 10,000). Large enough to
  // actually batch, small enough to keep cancel-latency and blast radius
  // reasonable. Dedup defenses upstream guarantee that no chunk contains
  // duplicate recipients regardless of size.
  chunkSize: 3000,
  maxConcurrency: 1,
  delayBetweenBatchesMs: 500,
  maxRetries429: 3,
  maxRetries5xx: 2,
  maxRecipientsPerJob: 0 // 0 = no cap (the SQLite schema is fine up to ~10M)
}

const safeTestOverrides = {
  chunkSize: 100,
  maxConcurrency: 1,
  delayBetweenBatchesMs: 1000,
  maxRetries429: 5,
  maxRetries5xx: 3,
  maxRecipientsPerJob: 100
}

const startingDefaults = SAFE_TEST_MODE
  ? { ...baseDefaults, ...safeTestOverrides }
  : baseDefaults

export const runtimeConfig = {
  chunkSize:              num(process.env.BULK_API_CHUNK_SIZE,             startingDefaults.chunkSize,           { min: 1, max: 10000 }),
  maxConcurrency:         num(process.env.BULK_API_MAX_CONCURRENCY,        startingDefaults.maxConcurrency,      { min: 1, max: 32 }),
  delayBetweenBatchesMs:  num(process.env.BULK_API_DELAY_BETWEEN_BATCHES_MS, startingDefaults.delayBetweenBatchesMs, { min: 0, max: 60000 }),
  maxRetries429:          num(process.env.BULK_API_MAX_RETRIES_429,        startingDefaults.maxRetries429,       { min: 0, max: 10 }),
  maxRetries5xx:          num(process.env.BULK_API_MAX_RETRIES_5XX,        startingDefaults.maxRetries5xx,       { min: 0, max: 10 }),
  maxRecipientsPerJob:    num(process.env.BULK_API_MAX_RECIPIENTS_PER_JOB, startingDefaults.maxRecipientsPerJob, { min: 0, max: 10_000_000 })
}

export function logConfigOnBoot() {
  console.log('[runtimeConfig] effective configuration:')
  console.log(`  SAFE_TEST_MODE              ${SAFE_TEST_MODE}`)
  console.log(`  chunkSize                   ${runtimeConfig.chunkSize}`)
  console.log(`  maxConcurrency              ${runtimeConfig.maxConcurrency}`)
  console.log(`  delayBetweenBatchesMs       ${runtimeConfig.delayBetweenBatchesMs}`)
  console.log(`  maxRetries429               ${runtimeConfig.maxRetries429}`)
  console.log(`  maxRetries5xx               ${runtimeConfig.maxRetries5xx}`)
  console.log(`  maxRecipientsPerJob         ${runtimeConfig.maxRecipientsPerJob || '∞'}`)
}

