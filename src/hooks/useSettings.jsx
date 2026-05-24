import { useState, useCallback } from 'react'
import { SMS_SETTINGS_DEFAULTS, DELAY_SETTINGS } from '../utils/constants'

export const useSettings = () => {
  const [smsSettings, setSmsSettings] = useState(SMS_SETTINGS_DEFAULTS)

  const [twilioConfig, setTwilioConfig] = useState({
    accountSid: '',
    authToken: '',
    apiKeySid: '',
    apiKeySecret: '',
    conversationServiceSid: ''
  })

  const [senderConfig, setSenderConfig] = useState({
    channel: 'sms',
    type: 'phone',
    phoneNumber: '',
    messagingServiceSid: ''
  })
  
  const [showSettings, setShowSettings] = useState(false)
  const [selectedCountry, setSelectedCountry] = useState('US')
  const [replyHandlingEnabled, setReplyHandlingEnabled] = useState(false)

  const updateSmsSettings = useCallback((newSettings) => {
    setSmsSettings(prev => ({ ...prev, ...newSettings }))
  }, [])

  const updateSenderConfig = useCallback((newConfig) => {
    setSenderConfig(prev => ({ ...prev, ...newConfig }))
  }, [])

  const updateMessageDelay = useCallback((delay) => {
    // Allow 0 for no delay, otherwise clamp to min/max range
    const clampedDelay = delay === 0 ? 0 : Math.max(DELAY_SETTINGS.MIN_DELAY, Math.min(DELAY_SETTINGS.MAX_DELAY, delay))
    setSmsSettings(prev => ({ ...prev, messageDelay: clampedDelay }))
  }, [])

  const updateTwilioConfig = useCallback((newConfig) => {
    setTwilioConfig(prev => ({ ...prev, ...newConfig }))
  }, [])

  const updateReplyHandlingEnabled = useCallback((enabled) => {
    setReplyHandlingEnabled(Boolean(enabled))
  }, [])

  const validateTwilioConfig = useCallback(() => {
    const { accountSid, authToken } = twilioConfig
    
    if (!accountSid || !authToken) {
      throw new Error('Please configure all Twilio credentials (Account SID and Auth Token)')
    }

    // Basic format validation
    if (!accountSid.startsWith('AC') || accountSid.length !== 34) {
      throw new Error('Invalid Account SID format. Should start with "AC" and be 34 characters long')
    }

    if (authToken.length < 20) {
      throw new Error('Invalid Auth Token format. Token appears too short')
    }

    return true
  }, [twilioConfig])

  const validateSenderConfig = useCallback(() => {
    if (!['sms', 'whatsapp', 'rcs'].includes(senderConfig.channel)) {
      throw new Error('Please choose a valid channel (SMS, WhatsApp or RCS)')
    }

    if (senderConfig.type === 'phone') {
      if (!senderConfig.phoneNumber) {
        throw new Error('Please enter a sender address')
      }

      const raw = String(senderConfig.phoneNumber).trim()
      const channel = senderConfig.channel

      // Strip any channel prefix the user may have typed.
      const stripped = raw.replace(/^(whatsapp:|rcs:)/i, '')

      const isE164 = /^\+[1-9]\d{1,14}$/.test(stripped)
      const isShortCode = /^\d{3,8}$/.test(stripped)
      const isAlphaSender = /^[A-Za-z][A-Za-z0-9 ]{2,10}$/.test(stripped)
      const isRcsAgent = /^[A-Za-z][A-Za-z0-9_-]*$/.test(stripped) && stripped.length >= 3

      if (channel === 'sms') {
        if (!(isE164 || isShortCode || isAlphaSender)) {
          throw new Error('SMS sender must be a phone number in E.164 (+1234567890), a 3–8 digit short code, or an alphanumeric sender (3–11 chars)')
        }
      } else if (channel === 'whatsapp') {
        if (!isE164) {
          throw new Error('WhatsApp sender must be a phone number in E.164 format (e.g., +14155238886). The "whatsapp:" prefix is optional.')
        }
      } else if (channel === 'rcs') {
        // RCS accepts an agent ID (e.g., "my_agent" or "rcs:my_agent") OR an RBM-enabled phone (E.164).
        if (!(isE164 || isRcsAgent)) {
          throw new Error('RCS sender must be an agent ID (e.g., rcs:my_agent) or a phone number in E.164 format')
        }
      }
    } else if (senderConfig.type === 'messaging-service') {
      if (!senderConfig.messagingServiceSid) {
        throw new Error('Please select a messaging service')
      }
    }

    return true
  }, [senderConfig])

  const toggleSettings = useCallback(() => {
    setShowSettings(prev => !prev)
  }, [])

  const closeSettings = useCallback(() => {
    setShowSettings(false)
  }, [])

  const resetSettings = useCallback(() => {
    setSmsSettings(SMS_SETTINGS_DEFAULTS)
  }, [])

  const clearTwilioConfig = useCallback(() => {
    setTwilioConfig({
      accountSid: '',
      authToken: '',
      apiKeySid: '',
      apiKeySecret: '',
      conversationServiceSid: ''
    })

    setSenderConfig({
      channel: 'sms',
      type: 'phone',
      phoneNumber: '',
      messagingServiceSid: ''
    })

    setReplyHandlingEnabled(false)
  }, [])

  const handleCountryChange = useCallback((countryCode) => {
    setSelectedCountry(countryCode)
  }, [])

  const getEstimatedCost = useCallback((message, contactCount) => {
    if (!message || contactCount === 0) return 0
    
    // Calculate segments (160 chars per segment for GSM, 70 for Unicode)
    const hasUnicode = /[^\x00-\x7F]/.test(message)
    const segmentLength = hasUnicode ? 70 : 160
    const segments = Math.ceil(message.length / segmentLength)
    
    return segments * contactCount * smsSettings.estimatedCostPerSegment
  }, [smsSettings.estimatedCostPerSegment])

  const getEstimatedCompletionTime = useCallback((contactCount) => {
    if (!contactCount || contactCount === 0) return 0
    
    // Calculate total time: (contacts - 1) * delay (no delay after last message)
    // Return time in seconds, not milliseconds
    const totalDelayMs = Math.max(0, contactCount - 1) * smsSettings.messageDelay
    const totalDelaySeconds = totalDelayMs / 1000 // Convert to seconds
    
    return totalDelaySeconds
  }, [smsSettings.messageDelay])

  const formatEstimatedTime = useCallback((timeSeconds) => {
    if (timeSeconds === 0) return '0s'
    if (timeSeconds < 0.1) return `${Math.round(timeSeconds * 1000)}ms`
    if (timeSeconds < 1) return `${(timeSeconds).toFixed(1)}s`
    if (timeSeconds < 60) return `${timeSeconds.toFixed(1)}s`
    
    const minutes = Math.floor(timeSeconds / 60)
    const seconds = Math.round(timeSeconds % 60)
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }, [])

  return {
    smsSettings,
    twilioConfig,
    senderConfig,
    showSettings,
    replyHandlingEnabled,
    selectedCountry,
    updateSmsSettings,
    updateTwilioConfig,
    updateReplyHandlingEnabled,
    updateSenderConfig,
    updateMessageDelay,
    validateTwilioConfig,
    validateSenderConfig,
    toggleSettings,
    closeSettings,
    resetSettings,
    clearTwilioConfig,
    handleCountryChange,
    getEstimatedCost,
    getEstimatedCompletionTime,
    formatEstimatedTime
  }
}
