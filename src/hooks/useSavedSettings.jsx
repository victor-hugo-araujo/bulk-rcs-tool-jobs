import { useState, useCallback, useEffect } from 'react'
import * as svc from '../services/settingsService'

// Hook for the saved senders persistence layer.
// Credentials are intentionally NOT persisted by this project — they must be
// entered each session in the Settings page.
export function useSavedSettings() {
  const [senders, setSenders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { senders } = await svc.listSenders()
      setSenders(senders || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const addSender = useCallback(async (sender) => {
    await svc.saveSender(sender)
    await refresh()
  }, [refresh])

  const removeSender = useCallback(async (id) => {
    await svc.deleteSender(id)
    await refresh()
  }, [refresh])

  return {
    senders,
    loading,
    error,
    refresh,
    addSender,
    removeSender
  }
}
