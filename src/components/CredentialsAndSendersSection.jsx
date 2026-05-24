import { useState } from 'react'
import { AlertTriangle, KeyRound, Phone, Trash2, Plus, Loader2 } from 'lucide-react'

const SECURITY_NOTICE = `Saving credentials and senders locally is convenient but risky.
Anyone with access to this folder, this machine or its backups can read your
Twilio token in PLAIN TEXT (server/data/settings.json). Do NOT share this
project folder, do NOT sync server/data to cloud drives, and do NOT use these
credentials on a shared computer.`

const CHANNELS = [
  { value: 'sms', label: 'SMS' },
  { value: 'rcs', label: 'RCS' },
  { value: 'whatsapp', label: 'WhatsApp' }
]
const SENDER_TYPES = [
  { value: 'phone', label: 'Phone / agent / sender ID' },
  { value: 'messaging-service', label: 'Messaging Service (MG...)' }
]

const CredentialsAndSendersSection = ({ saved }) => {
  const {
    credentials,
    senders,
    loading,
    error,
    addCredential,
    removeCredential,
    addSender,
    removeSender
  } = saved

  // --- New credential form --------------------------------------------------
  const [credName, setCredName] = useState('')
  const [credAccountSid, setCredAccountSid] = useState('')
  const [credAuthType, setCredAuthType] = useState('auth-token') // or 'api-key'
  const [credAuthToken, setCredAuthToken] = useState('')
  const [credApiKeySid, setCredApiKeySid] = useState('')
  const [credApiKeySecret, setCredApiKeySecret] = useState('')
  const [credConvSvcSid, setCredConvSvcSid] = useState('')
  const [credSaving, setCredSaving] = useState(false)

  const handleAddCredential = async (e) => {
    e.preventDefault()
    if (credSaving) return
    if (!credAccountSid.trim()) {
      alert('Account SID is required')
      return
    }
    if (credAuthType === 'auth-token' && !credAuthToken.trim()) {
      alert('Auth Token is required')
      return
    }
    if (credAuthType === 'api-key' && (!credApiKeySid.trim() || !credApiKeySecret.trim())) {
      alert('API Key SID and Secret are both required')
      return
    }

    setCredSaving(true)
    try {
      await addCredential({
        name: credName.trim() || 'Untitled',
        accountSid: credAccountSid.trim(),
        authToken: credAuthType === 'auth-token' ? credAuthToken.trim() : undefined,
        apiKeySid: credAuthType === 'api-key' ? credApiKeySid.trim() : undefined,
        apiKeySecret: credAuthType === 'api-key' ? credApiKeySecret.trim() : undefined,
        conversationServiceSid: credConvSvcSid.trim() || undefined
      })
      setCredName('')
      setCredAccountSid('')
      setCredAuthToken('')
      setCredApiKeySid('')
      setCredApiKeySecret('')
      setCredConvSvcSid('')
    } catch (err) {
      alert(`Failed to save credential: ${err.message}`)
    } finally {
      setCredSaving(false)
    }
  }

  // --- New sender form ------------------------------------------------------
  const [senderName, setSenderName] = useState('')
  const [senderChannel, setSenderChannel] = useState('sms')
  const [senderType, setSenderType] = useState('phone')
  const [senderValue, setSenderValue] = useState('')
  const [senderSaving, setSenderSaving] = useState(false)

  const handleAddSender = async (e) => {
    e.preventDefault()
    if (senderSaving) return
    if (!senderValue.trim()) {
      alert('Sender value is required (phone, agent ID or Messaging Service SID)')
      return
    }
    setSenderSaving(true)
    try {
      await addSender({
        name: senderName.trim() || 'Untitled',
        channel: senderChannel,
        type: senderType,
        value: senderValue.trim()
      })
      setSenderName('')
      setSenderValue('')
    } catch (err) {
      alert(`Failed to save sender: ${err.message}`)
    } finally {
      setSenderSaving(false)
    }
  }

  const handleDeleteCredential = async (id, name) => {
    if (!window.confirm(`Delete credential "${name}"? This removes it from the local file permanently.`)) return
    try { await removeCredential(id) }
    catch (err) { alert(`Failed to delete: ${err.message}`) }
  }

  const handleDeleteSender = async (id, name) => {
    if (!window.confirm(`Delete sender "${name}"?`)) return
    try { await removeSender(id) }
    catch (err) { alert(`Failed to delete: ${err.message}`) }
  }

  return (
    <div className="space-y-6">
      {/* SECURITY BANNER — large, persistent */}
      <div className="border-2 border-red-400 bg-red-50 rounded-lg p-5">
        <div className="flex items-start">
          <AlertTriangle className="h-6 w-6 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-red-900 mb-1">
              We do NOT recommend saving credentials locally
            </h2>
            <p className="text-sm text-red-800 whitespace-pre-line">{SECURITY_NOTICE}</p>
            <p className="text-sm text-red-800 mt-3">
              If you must use this feature, treat <code className="bg-red-100 px-1 rounded">server/data/settings.json</code> as sensitive
              and never share this project folder with anyone.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* --- CREDENTIALS -------------------------------------------------- */}
      <div className="border border-gray-200 rounded-lg p-5">
        <div className="flex items-center mb-4">
          <KeyRound className="h-5 w-5 text-red-700 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Saved Credentials</h3>
        </div>

        <form onSubmit={handleAddCredential} className="space-y-3 mb-6 border-b border-gray-200 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Friendly name</label>
              <input
                type="text"
                value={credName}
                onChange={(e) => setCredName(e.target.value)}
                placeholder="e.g. Production"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Account SID</label>
              <input
                type="text"
                value={credAccountSid}
                onChange={(e) => setCredAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Authentication method</label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setCredAuthType('auth-token')}
                className={`px-3 py-1 text-xs rounded-md border ${credAuthType === 'auth-token' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300'}`}
              >
                Auth Token
              </button>
              <button
                type="button"
                onClick={() => setCredAuthType('api-key')}
                className={`px-3 py-1 text-xs rounded-md border ${credAuthType === 'api-key' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300'}`}
              >
                API Key SID + Secret
              </button>
            </div>

            {credAuthType === 'auth-token' ? (
              <input
                type="password"
                value={credAuthToken}
                onChange={(e) => setCredAuthToken(e.target.value)}
                placeholder="Auth Token"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg font-mono text-sm"
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={credApiKeySid}
                  onChange={(e) => setCredApiKeySid(e.target.value)}
                  placeholder="API Key SID (SKxxxx...)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg font-mono text-sm"
                />
                <input
                  type="password"
                  value={credApiKeySecret}
                  onChange={(e) => setCredApiKeySecret(e.target.value)}
                  placeholder="API Key Secret"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg font-mono text-sm"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Conversation Service SID <span className="text-gray-400">(optional, for Replies)</span>
            </label>
            <input
              type="text"
              value={credConvSvcSid}
              onChange={(e) => setCredConvSvcSid(e.target.value)}
              placeholder="ISxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg font-mono text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={credSaving}
            className="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {credSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Save credential
          </button>
        </form>

        {loading ? (
          <div className="text-sm text-gray-500 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</div>
        ) : credentials.length === 0 ? (
          <p className="text-sm text-gray-500">No saved credentials yet.</p>
        ) : (
          <div className="space-y-2">
            {credentials.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{c.name}</div>
                  <div className="text-xs text-gray-600 font-mono">{c.accountSidMasked}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {c.hasAuthToken && <span className="mr-2">• Auth Token</span>}
                    {c.hasApiKey && <span className="mr-2">• API Key</span>}
                    {c.hasConversationServiceSid && <span>• Conversations</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteCredential(c.id, c.name)}
                  className="text-red-600 hover:text-red-800 p-2"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- SENDERS ----------------------------------------------------- */}
      <div className="border border-gray-200 rounded-lg p-5">
        <div className="flex items-center mb-4">
          <Phone className="h-5 w-5 text-red-700 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Saved Senders</h3>
        </div>

        <form onSubmit={handleAddSender} className="space-y-3 mb-6 border-b border-gray-200 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Friendly name</label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="e.g. Marketing alpha"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Channel</label>
              <select
                value={senderChannel}
                onChange={(e) => setSenderChannel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg"
              >
                {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sender type</label>
              <select
                value={senderType}
                onChange={(e) => setSenderType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg"
              >
                {SENDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {senderType === 'messaging-service' ? 'Messaging Service SID' : 'Sender value'}
              </label>
              <input
                type="text"
                value={senderValue}
                onChange={(e) => setSenderValue(e.target.value)}
                placeholder={
                  senderType === 'messaging-service'
                    ? 'MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
                    : senderChannel === 'rcs' ? 'rcs:my_agent or +E.164'
                    : senderChannel === 'whatsapp' ? '+14155238886'
                    : '+1234567890, 12345, or MyBrand'
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:shadow-lg font-mono text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={senderSaving}
            className="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {senderSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Save sender
          </button>
        </form>

        {loading ? (
          <div className="text-sm text-gray-500 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</div>
        ) : senders.length === 0 ? (
          <p className="text-sm text-gray-500">No saved senders yet. After saving, they'll appear in the "From Number" dropdown on the Settings page.</p>
        ) : (
          <div className="space-y-2">
            {senders.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{s.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      s.channel === 'whatsapp' ? 'bg-green-100 text-green-800'
                      : s.channel === 'rcs' ? 'bg-indigo-100 text-indigo-800'
                      : 'bg-blue-100 text-blue-800'
                    }`}>{s.channel.toUpperCase()}</span>
                    <span className="text-xs text-gray-500">
                      {s.type === 'messaging-service' ? 'MG' : 'direct'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 font-mono mt-1">{s.value}</div>
                </div>
                <button
                  onClick={() => handleDeleteSender(s.id, s.name)}
                  className="text-red-600 hover:text-red-800 p-2"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default CredentialsAndSendersSection
