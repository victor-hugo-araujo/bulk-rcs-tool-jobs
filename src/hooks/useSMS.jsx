import { useState, useCallback, useRef, useEffect } from 'react'
import { createBulkJob, getJob, cancelJob } from '../services/smsService'
import { SMS_LIMITS, CONTACT_STATUS } from '../utils/constants'

const POLL_INTERVAL_MS = 2500

export const useSMS = () => {
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState({ success: 0, failed: 0, errors: [] })
  const [currentJobId, setCurrentJobId] = useState(null)
  const [jobStatus, setJobStatus] = useState(null) // mirrors backend status: pending|processing|cancelling|cancelled|completed|failed
  const pollTimer = useRef(null)

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const pollUntilDone = useCallback((jobId, onDone) => {
    const tick = async () => {
      try {
        const job = await getJob(jobId)
        if (!job) {
          stopPolling()
          setSending(false)
          return
        }

        setProgress(job.progress || 0)
        setJobStatus(job.status)
        setResults({
          success: job.successful || 0,
          failed: job.failed || 0,
          errors: job.error ? [job.error] : []
        })

        // Terminal states — stop polling, release the UI, and notify caller.
        // 'cancelled' was missing before, which caused the UI to hang on "Sending..."
        // after the user pressed Cancel.
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          stopPolling()
          setSending(false)
          if (onDone) onDone(job)
          return
        }

        pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS)
      } catch (err) {
        stopPolling()
        setSending(false)
        setResults((prev) => ({ ...prev, errors: [err.message, ...(prev.errors || [])] }))
      }
    }
    tick()
  }, [stopPolling])

  const sendBulkMessages = useCallback(async ({ file, contacts, message, contentTemplate = null, mediaUrl = '', twilioConfig, senderConfig, onContactUpdate, scheduledAt = null }) => {
    if (!file) {
      throw new Error('CSV file is required — re-upload the contacts to send')
    }

    setSending(true)
    setProgress(0)
    setResults({ success: 0, failed: 0, errors: [] })

    try {
      const { jobId, invalid } = await createBulkJob({
        file,
        channel: senderConfig?.channel || 'sms',
        message,
        mediaUrl,
        contentTemplate,
        senderConfig,
        twilioConfig,
        scheduledAt
      })

      setCurrentJobId(jobId)

      return await new Promise((resolve, reject) => {
        pollUntilDone(jobId, (job) => {
          // Per-contact status updates were removed. With the Bulk Messaging
          // API we only get aggregate counts (sent/failed/total). The previous
          // implementation iterated every contact calling onContactUpdate,
          // which for 300k contacts triggered O(N²) work on the React state
          // and froze the browser (~90 billion ops).
          //
          // The aggregate totals are surfaced via `progress` / `results`
          // already, which is what the UI shows during/after the job.
          if (job.error) reject(new Error(job.error))
          else resolve({ success: job.successful, failed: job.failed, errors: job.error ? [job.error] : [], invalid })
        })
      })
    } catch (error) {
      setSending(false)
      setResults({ success: 0, failed: 0, errors: [error.message] })
      throw error
    }
  }, [pollUntilDone])

  const validateMessage = useCallback((message) => {
    if (!message || !message.trim()) {
      throw new Error('Please enter a message')
    }
    if (message.length > SMS_LIMITS.MAX_MESSAGE_LENGTH) {
      throw new Error(`Message is too long. Maximum ${SMS_LIMITS.MAX_MESSAGE_LENGTH} characters allowed`)
    }
    return true
  }, [])

  const resetSendingState = useCallback(() => {
    stopPolling()
    setSending(false)
    setProgress(0)
    setResults({ success: 0, failed: 0, errors: [] })
    setCurrentJobId(null)
    setJobStatus(null)
  }, [stopPolling])

  const cancelCurrentJob = useCallback(async () => {
    if (!currentJobId) return null
    try {
      const result = await cancelJob(currentJobId)
      return result
    } catch (err) {
      console.error('Failed to cancel job:', err)
      throw err
    }
  }, [currentJobId])

  const getMessageAnalytics = useCallback((message) => {
    if (!message) return null
    const hasUnicode = /[^\x00-\x7F]/.test(message)
    const encoding = hasUnicode ? 'Unicode' : 'GSM 7-bit'
    const maxLength = hasUnicode ? 70 : 160
    const segments = Math.ceil(message.length / maxLength)

    const warnings = []
    if (hasUnicode) warnings.push('Message contains special characters (Unicode encoding)')
    if (segments > 1) warnings.push(`Message will be split into ${segments} segments`)
    if (message.length > SMS_LIMITS.MAX_MESSAGE_LENGTH) warnings.push('Message exceeds maximum length')

    return {
      length: message.length,
      segments,
      encoding,
      maxLength: SMS_LIMITS.MAX_MESSAGE_LENGTH,
      warnings,
      estimatedCost: segments * 0.0075
    }
  }, [])

  return {
    sending,
    progress,
    results,
    currentJobId,
    jobStatus,
    sendBulkMessages,
    cancelCurrentJob,
    validateMessage,
    resetSendingState,
    getMessageAnalytics
  }
}
