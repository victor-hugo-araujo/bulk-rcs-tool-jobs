// Client for the local senders persistence API.
//
// Credentials are intentionally NOT persisted by this project — they must be
// entered each session in the Settings page. Only sender shortcuts (phone,
// agent ID, Messaging Service SID) are saved.

const handle = async (response) => {
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${response.status}`)
  }
  return response.json()
}

export const listSenders = () =>
  fetch('/api/settings/senders').then(handle)

export const saveSender = (sender) =>
  fetch('/api/settings/senders', {
    method: sender.id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sender)
  }).then(handle)

export const updateSender = (id, sender) =>
  fetch(`/api/settings/senders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sender)
  }).then(handle)

export const deleteSender = (id) =>
  fetch(`/api/settings/senders/${id}`, { method: 'DELETE' }).then(handle)
