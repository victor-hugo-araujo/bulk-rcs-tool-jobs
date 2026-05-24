import { useState } from 'react'
import { Phone, Trash2, Plus, Loader2, Info } from 'lucide-react'

const CHANNELS = [
  { value: 'sms', label: 'SMS' },
  { value: 'rcs', label: 'RCS' },
  { value: 'whatsapp', label: 'WhatsApp' }
]
const SENDER_TYPES = [
  { value: 'phone', label: 'Phone / agent / sender ID' },
  { value: 'messaging-service', label: 'Messaging Service (MG...)' }
]

const SavedSendersSection = ({ saved }) => {
  const { senders, loading, error, addSender, removeSender } = saved

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

  const handleDeleteSender = async (id, name) => {
    if (!window.confirm(`Delete sender "${name}"?`)) return
    try { await removeSender(id) }
    catch (err) { alert(`Failed to delete: ${err.message}`) }
  }

  return (
    <div className="space-y-6">
      <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
        <div className="flex items-start">
          <Info className="h-5 w-5 text-blue-700 mr-3 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-1">Save senders, not credentials.</p>
            <p>
              Twilio credentials (Account SID, Auth Token, API Key) are
              <strong> not persisted</strong> by this app. You enter them once per
              session in the <strong>Settings</strong> page. Only sender shortcuts
              (phone numbers, RCS agent IDs, Messaging Service SIDs) are saved
              here so you don't have to retype them every time.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

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

export default SavedSendersSection
