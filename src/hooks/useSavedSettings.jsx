import { useState, useCallback, useEffect } from 'react'
import * as svc from '../services/settingsService'

// Shared hook for the saved credentials + senders. Stores only the masked
// credential list in memory; the full token is fetched on demand when the
// user explicitly picks one.
export function useSavedSettings() {
  const [credentials, setCredentials] = useState([])
  const [senders, setSenders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [creds, sends] = await Promise.all([svc.listCredentials(), svc.listSenders()])
      setCredentials(creds.credentials || [])
      setSenders(sends.senders || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // --- credentials --------------------------------------------------------

  const addCredential = useCallback(async (credential) => {
    await svc.saveCredential(credential)
    await refresh()
  }, [refresh])

  const removeCredential = useCallback(async (id) => {
    await svc.deleteCredential(id)
    await refresh()
  }, [refresh])

  // Returns the full credential (with token/secret) so the caller can hand it
  // to updateTwilioConfig. Never cached in state.
  const loadCredential = useCallback((id) => svc.getCredential(id), [])

  // --- senders ------------------------------------------------------------

  const addSender = useCallback(async (sender) => {
    await svc.saveSender(sender)
    await refresh()
  }, [refresh])

  const removeSender = useCallback(async (id) => {
    await svc.deleteSender(id)
    await refresh()
  }, [refresh])

  return {
    credentials,
    senders,
    loading,
    error,
    refresh,
    addCredential,
    removeCredential,
    loadCredential,
    addSender,
    removeSender
  }
}
