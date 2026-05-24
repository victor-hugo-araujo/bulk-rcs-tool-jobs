import { useState, useEffect } from 'react'
import { getRuntimeConfig } from '../services/smsService'

// Fetches the server's effective runtime config once on mount.
// Used by the UI to:
//   - show a yellow banner when SAFE_TEST_MODE is active
//   - inform pre-send summaries with chunk size / concurrency
export function useRuntimeConfig() {
  const [config, setConfig] = useState(null)
  useEffect(() => {
    let cancelled = false
    getRuntimeConfig().then((c) => { if (!cancelled) setConfig(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return config
}
