// Client for the local credentials + senders persistence API.
//
// ⚠️ The data managed by these endpoints lives in plaintext on the operator's
// machine. Never call these endpoints from a hosted version of this app.

const handle = async (response) => {
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${response.status}`)
  }
  return response.json()
}

export const listCredentials = () =>
  fetch('/api/settings/credentials').then(handle)

export const getCredential = (id) =>
  fetch(`/api/settings/credentials/${id}`).then(handle)

export const saveCredential = (credential) =>
  fetch('/api/settings/credentials', {
    method: credential.id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credential)
  }).then(handle)

export const updateCredential = (id, credential) =>
  fetch(`/api/settings/credentials/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credential)
  }).then(handle)

export const deleteCredential = (id) =>
  fetch(`/api/settings/credentials/${id}`, { method: 'DELETE' }).then(handle)

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
