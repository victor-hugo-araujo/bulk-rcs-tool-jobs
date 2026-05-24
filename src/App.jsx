//Copyright 2025 Twilio Inc.

import { useState, useMemo, useCallback } from 'react'

// Custom Hooks
import { useContacts } from './hooks/useContacts'
import { useSettings } from './hooks/useSettings'
import { useScheduler } from './hooks/useScheduler'
import { useSMS } from './hooks/useSMS'
import { useSavedSettings } from './hooks/useSavedSettings'
import { useRuntimeConfig } from './hooks/useRuntimeConfig'

// Components - Reorganized
import AppHeader from './components/AppHeader'
import Navigation from './components/Navigation'
import SettingsSection from './components/SettingsSection'
import ContactsSection from './components/ContactsSection'
import MessageSection from './components/MessageSection'
import AnalyticsSection from './components/AnalyticsSection'
import SendingSection from './components/SendingSection'
import RepliesTabSection from './components/RepliesTabSection'
import SavedSendersSection from './components/SavedSendersSection'
import { MessageCircle, Send } from 'lucide-react'

function App() {
  // Local state
  const [activeTab, setActiveTab] = useState('bulk')
  const [message, setMessage] = useState('')
  const [contentTemplate, setContentTemplate] = useState(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [smsPricingCountry, setSmsPricingCountry] = useState('US')
  const [whatsAppPricingCountry, setWhatsAppPricingCountry] = useState('US')

  // Custom hooks
  const contactsHook = useContacts()
  const settingsHook = useSettings()
  const schedulerHook = useScheduler()
  const smsHook = useSMS()
  const savedSettings = useSavedSettings()
  const runtimeConfig = useRuntimeConfig()

  // Sidebar state - only one section can be active at a time
  const [activeSection, setActiveSection] = useState('settings') // Start with settings active
  
  // Helper function for sidebar navigation
  const handleSectionChange = (section) => {
    setActiveSection(section)
  }

  // Reset function - preserves Twilio and sender config, clears workflow data
  const handleReset = () => {
    // Clear contacts
    contactsHook.clearContacts()
    
    // Clear message
    setMessage('')
    setContentTemplate(null)
    setMediaUrl('')
    
    // Clear SMS results and reset sending state
    smsHook.resetSendingState()
    
    // Reset to settings section
    setActiveSection('settings')
    
    // Note: Twilio config and sender config are preserved as requested
  }

  // Computed values
  // Memoize on contacts identity — validateContacts iterates the whole array
  // (~300ms for 300k contacts) and was being called on every render of App,
  // burning ~40% of the main thread when the polling fired setStates.
  const validationSummary = useMemo(
    () => contactsHook.getValidationSummary(),
    [contactsHook.contacts]
  )
  const isWhatsAppChannel = settingsHook.senderConfig.channel === 'whatsapp'
  const isRcsChannel = settingsHook.senderConfig.channel === 'rcs'
  const isTemplateConfigured = !!contentTemplate?.contentSid && Object.values(contentTemplate?.variables || {}).every(value => String(value).trim().length > 0)
  // WhatsApp requires a template; RCS allows template OR free text; SMS allows only free text.
  const isMessageConfigured = isWhatsAppChannel
    ? isTemplateConfigured
    : isRcsChannel
      ? (isTemplateConfigured || !!message.trim())
      : !!message.trim()
  
  // Simple send handler
  const handleSendSMS = async () => {
    try {
      settingsHook.validateTwilioConfig()
      settingsHook.validateSenderConfig()
    } catch (error) {
      alert(`Configuration error: ${error.message}`)
      return
    }
    
    if (!isMessageConfigured || validationSummary.summary.valid === 0) {
      alert(isWhatsAppChannel
        ? 'Please select a valid WhatsApp template, complete all template variables, and upload valid contacts'
        : isRcsChannel
          ? 'Please select a template or type a message, and upload valid contacts'
          : 'Please enter a message and upload valid contacts')
      return
    }

    const attemptSend = async (dedupMode) => {
      await smsHook.sendBulkMessages({
        file: contactsHook.csvFile,
        contacts: contactsHook.contacts,
        message: message,
        contentTemplate,
        mediaUrl,
        twilioConfig: settingsHook.twilioConfig,
        senderConfig: settingsHook.senderConfig,
        dedupMode
      })
    }

    try {
      await attemptSend('block')
    } catch (error) {
      console.error('Send error:', error)

      // Duplicates detected — offer one-click retry with dedup.
      if (error.code === 'DUPLICATES_DETECTED' && error.summary) {
        const { rowsParsed, valid, invalid, duplicates, finalImported } = error.summary
        const proceed = window.confirm(
          `Your CSV contains duplicate recipients.\n\n` +
          `  Total rows:        ${rowsParsed}\n` +
          `  Valid:             ${valid}\n` +
          `  Invalid:           ${invalid}\n` +
          `  Duplicates:        ${duplicates}\n` +
          `  Final (deduped):   ${finalImported}\n\n` +
          `Sending the same person twice is rarely intentional. We recommend ` +
          `retrying with automatic deduplication (only the first occurrence of ` +
          `each number is kept).\n\n` +
          `Retry with deduplication?`
        )
        if (!proceed) return
        try {
          await attemptSend('auto')
        } catch (err) {
          alert(`Failed to send messages: ${err.message}`)
        }
        return
      }

      if (error.code === 'RECIPIENTS_OVER_LIMIT') {
        alert(`${error.message}\n\n${error.hint || ''}`)
        return
      }

      const isCancellation = /cancel/i.test(error.message)
      if (isCancellation) {
        alert(`Send cancelled — ${error.message}.`)
      } else {
        alert(`Failed to send messages: ${error.message}`)
      }
    }
  }

  // Handle scheduling messages with delay
  const handleScheduleMessages = useCallback(async (params) => {
    return await schedulerHook.scheduleMessage({
      ...params,
      file: contactsHook.csvFile,
      contentTemplate,
      mediaUrl
    })
  }, [schedulerHook.scheduleMessage, contactsHook.csvFile, contentTemplate, mediaUrl])

  // Check if configurations are complete
  const isConfigurationComplete = useMemo(() => {
    try {
      settingsHook.validateTwilioConfig()
      settingsHook.validateSenderConfig()
      return true
    } catch (error) {
      return false
    }
  }, [settingsHook.twilioConfig, settingsHook.senderConfig, settingsHook.validateTwilioConfig, settingsHook.validateSenderConfig])
  
  const canSend = isConfigurationComplete && isMessageConfigured && validationSummary.summary.valid > 0

  // Calculate section completion status
  const sectionStatus = useMemo(() => {
    return {
      settings: isConfigurationComplete,
      contacts: contactsHook.contacts.length > 0 && validationSummary.summary.valid > 0,
      message: isMessageConfigured,
      analytics: isMessageConfigured && contactsHook.contacts.length > 0,
      sending: canSend
    }
  }, [isConfigurationComplete, contactsHook.contacts.length, validationSummary.summary.valid, isMessageConfigured, canSend])

  const sectionEnabled = useMemo(() => {
    return {
      settings: true,
      contacts: true,
      message: true,
      analytics: true,
      sending: true
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        
        <AppHeader />

        {runtimeConfig?.safeTestMode && (
          <div className="bg-yellow-50 border-b-2 border-yellow-400 px-6 py-3 text-sm text-yellow-900">
            <strong>⚠️ SAFE_TEST_MODE active.</strong> Jobs are capped at {runtimeConfig.maxRecipientsPerJob} recipients, concurrency is forced to {runtimeConfig.maxConcurrency}, chunk size is {runtimeConfig.chunkSize}, and a {runtimeConfig.delayBetweenBatchesMs}ms delay is applied between batches. Unset <code className="bg-yellow-100 px-1 rounded">SAFE_TEST_MODE</code> to restore configured defaults.
          </div>
        )}

        <div className="w-full pt-4 border-b border-gray-200">
          <div className="px-6">
              <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('bulk')}
                role="tab"
                aria-selected={activeTab === 'bulk'}
                  className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
                  activeTab === 'bulk'
                      ? 'text-red-700'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  Bulk
                </span>
                  {activeTab === 'bulk' && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-red-600" />}
              </button>
              <button
                  onClick={() => setActiveTab('replies')}
                role="tab"
                aria-selected={activeTab === 'replies'}
                  className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
                    activeTab === 'replies'
                      ? 'text-red-700'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Replies
                  <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 bg-orange-100 border border-orange-200 rounded-full">
                    Beta
                  </span>
                </span>
                  {activeTab === 'replies' && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-red-600" />}
              </button>
              </div>
          </div>
        </div>

        {activeTab === 'bulk' && (
          <div className="flex h-[calc(100vh-theme(spacing.20)-theme(spacing.16))]">
            <Navigation 
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
              sectionStatus={sectionStatus}
              sectionEnabled={sectionEnabled}
              onReset={handleReset}
            />

            <div className="flex-1 overflow-y-auto">
              <div className="container mx-auto px-6 py-8 max-w-4xl">
                {activeSection === 'settings' && (
                <SettingsSection
                  isExpanded={true}
                  onToggle={() => {}}
                  twilioConfig={settingsHook.twilioConfig}
                  senderConfig={settingsHook.senderConfig}
                  updateTwilioConfig={settingsHook.updateTwilioConfig}
                  clearTwilioConfig={settingsHook.clearTwilioConfig}
                  updateSenderConfig={settingsHook.updateSenderConfig}
                  isConfigurationComplete={isConfigurationComplete}
                  savedSenders={savedSettings.senders}
                />
              )}

              {activeSection === 'contacts' && (
                <ContactsSection
                  isExpanded={true}
                  onToggle={() => {}}
                  contacts={contactsHook.contacts}
                  isUploading={contactsHook.isUploading}
                  uploadError={contactsHook.uploadError}
                  onFileUpload={contactsHook.handleFileUpload}
                  onClearContacts={contactsHook.clearContacts}
                  validationSummary={validationSummary}
                />
              )}

              {activeSection === 'message' && (
                <MessageSection
                  isExpanded={true}
                  onToggle={() => {}}
                  message={message}
                  onMessageChange={setMessage}
                  contacts={contactsHook.contacts}
                  validationSummary={validationSummary}
                  isConfigurationComplete={isConfigurationComplete}
                  twilioConfig={settingsHook.twilioConfig}
                  senderConfig={settingsHook.senderConfig}
                  contentTemplate={contentTemplate}
                  onContentTemplateChange={setContentTemplate}
                  mediaUrl={mediaUrl}
                  onMediaUrlChange={setMediaUrl}
                />
              )}

              {activeSection === 'analytics' && (
                <AnalyticsSection
                  isExpanded={true}
                  onToggle={() => {}}
                  message={message}
                  contentTemplate={contentTemplate}
                  smsPricingCountry={smsPricingCountry}
                  onSmsPricingCountryChange={setSmsPricingCountry}
                  whatsAppPricingCountry={whatsAppPricingCountry}
                  onWhatsAppPricingCountryChange={setWhatsAppPricingCountry}
                  contacts={contactsHook.contacts}
                  getMessageAnalytics={smsHook.getMessageAnalytics}
                  validationSummary={validationSummary}
                  estimatedCostPerSegment={settingsHook.smsSettings.estimatedCostPerSegment}
                  twilioConfig={settingsHook.twilioConfig}
                  senderConfig={settingsHook.senderConfig}
                />
              )}

              {activeSection === 'senders' && (
                <SavedSendersSection saved={savedSettings} />
              )}

              {activeSection === 'sending' && (
                <SendingSection
                  isExpanded={true}
                  onToggle={() => {}}
                  canSend={canSend}
                  isMessageConfigured={isMessageConfigured}
                  contentTemplate={contentTemplate}
                  message={message}
                  contacts={contactsHook.contacts}
                  getMessageAnalytics={smsHook.getMessageAnalytics}
                  smsPricingCountry={smsPricingCountry}
                  whatsAppPricingCountry={whatsAppPricingCountry}
                  twilioConfig={settingsHook.twilioConfig}
                  senderConfig={settingsHook.senderConfig}
                  onSendMessages={handleSendSMS}
                  onScheduleMessages={handleScheduleMessages}
                  sending={smsHook.sending}
                  progress={smsHook.progress}
                  results={smsHook.results}
                  currentJobId={smsHook.currentJobId}
                  jobStatus={smsHook.jobStatus}
                  onCancelJob={smsHook.cancelCurrentJob}
                  scheduledSending={schedulerHook.scheduledSending}
                  updateScheduling={schedulerHook.updateScheduling}
                  lastScheduledMessage={schedulerHook.lastScheduledMessage}
                  clearLastScheduledMessage={schedulerHook.clearLastScheduledMessage}
                  messageDelay={settingsHook.smsSettings.messageDelay}
                  onDelayChange={settingsHook.updateMessageDelay}
                  getEstimatedCompletionTime={settingsHook.getEstimatedCompletionTime}
                  formatEstimatedTime={settingsHook.formatEstimatedTime}
                />
              )}

              </div>
            </div>
          </div>
        )}

        {activeTab === 'replies' && (
          <div className="h-[calc(100vh-theme(spacing.20)-theme(spacing.16))] overflow-hidden">
            <RepliesTabSection
              twilioConfig={settingsHook.twilioConfig}
              senderConfig={settingsHook.senderConfig}
              replyHandlingEnabled={settingsHook.replyHandlingEnabled}
              updateReplyHandlingEnabled={settingsHook.updateReplyHandlingEnabled}
              updateTwilioConfig={settingsHook.updateTwilioConfig}
            />
          </div>
        )}
    </div>
  )
}

export default App
