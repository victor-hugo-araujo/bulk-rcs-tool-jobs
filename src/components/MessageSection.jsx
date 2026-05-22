import MessageComposer from './MessageComposer'
import AccordionSection from './AccordionSection'

const MessageSection = ({
  isExpanded,
  onToggle,
  message,
  onMessageChange,
  contacts,
  twilioConfig,
  senderConfig,
  contentTemplate,
  onContentTemplateChange,
  mediaUrl,
  onMediaUrlChange
}) => {
  const isWhatsAppChannel = senderConfig?.channel === 'whatsapp'
  const isRcsChannel = senderConfig?.channel === 'rcs'
  const isTemplateMode = (isWhatsAppChannel || isRcsChannel) && !!contentTemplate?.contentSid
  const isTemplateConfigured = isTemplateMode && Object.values(contentTemplate?.variables || {}).every(value => String(value).trim().length > 0)
  // For WhatsApp a template is required; for RCS either a configured template OR a non-empty message is acceptable.
  const hasMessageContent = isWhatsAppChannel
    ? isTemplateConfigured
    : isRcsChannel
      ? (isTemplateConfigured || !!message.trim())
      : !!message.trim()

  const readyLabel = isTemplateMode
    ? 'Template selected'
    : `${message.length} chars${mediaUrl ? ' + media' : ''}`

  const missingLabel = isWhatsAppChannel
    ? 'Template required'
    : isRcsChannel
      ? 'Template or message required'
      : 'No message'

  const messageStatus = hasMessageContent
    ? <span className="text-green-600 text-sm font-medium">✓ Ready ({readyLabel})</span>
    : <span className="text-red-600 text-sm font-medium">✗ {missingLabel}</span>

  return (
    <AccordionSection
      id="message"
      title="Compose Message"
      status={messageStatus}
      isExpanded={isExpanded}
      onToggle={onToggle}
      animationDelay="0.3s"
    >
      <MessageComposer
        message={message}
        onMessageChange={onMessageChange}
        contacts={contacts}
        twilioConfig={twilioConfig}
        senderConfig={senderConfig}
        contentTemplate={contentTemplate}
        onContentTemplateChange={onContentTemplateChange}
        mediaUrl={mediaUrl}
        onMediaUrlChange={onMediaUrlChange}
      />
    </AccordionSection>
  )
}

export default MessageSection
