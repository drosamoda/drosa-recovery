const state = {
  secret: localStorage.getItem('drosa_inbox_secret') || '',
  conversations: [],
  selectedConversation: null,
  messages: [],
  mediaUrls: new Map(),
}

const els = {
  connectionStatus: document.getElementById('connectionStatus'),
  secretInput: document.getElementById('secretInput'),
  saveSecretButton: document.getElementById('saveSecretButton'),
  refreshButton: document.getElementById('refreshButton'),
  conversationList: document.getElementById('conversationList'),
  emptyState: document.getElementById('emptyState'),
  chatView: document.getElementById('chatView'),
  chatContactName: document.getElementById('chatContactName'),
  chatContactPhone: document.getElementById('chatContactPhone'),
  statusSelect: document.getElementById('statusSelect'),
  saveStatusButton: document.getElementById('saveStatusButton'),
  messageList: document.getElementById('messageList'),
  replyForm: document.getElementById('replyForm'),
  replyText: document.getElementById('replyText'),
  sendButton: document.getElementById('sendButton'),
  toast: document.getElementById('toast'),
}

els.secretInput.value = state.secret

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function showToast(message, type = 'info') {
  els.toast.textContent = message
  els.toast.className = `toast ${type === 'error' ? 'error' : 'success'}`
  window.clearTimeout(showToast.timeout)
  showToast.timeout = window.setTimeout(() => {
    els.toast.classList.add('hidden')
  }, 4200)
}

function getSecretHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-inbox-admin-secret': state.secret,
  }
}

function buildApiUrl(path) {
  return new URL(path, window.location.origin).toString()
}

function formatApiError(status, payload, fallbackMessage) {
  const apiMessage = payload?.error || payload?.message || payload?.detail
  const details = [
    status ? `HTTP ${status}` : null,
    apiMessage || fallbackMessage || 'Falha na requisicao.',
  ].filter(Boolean)

  return details.join(' - ')
}

async function api(path, options = {}) {
  if (!state.secret) {
    throw new Error('Informe o INBOX_ADMIN_SECRET para acessar a inbox.')
  }

  let response
  try {
    response = await fetch(buildApiUrl(path), {
      ...options,
      headers: {
        ...getSecretHeaders(),
        ...(options.headers || {}),
      },
    })
  } catch (err) {
    throw new Error(
      'Nao foi possivel conectar na API da inbox. Confirme que o servidor esta rodando e que a tela foi aberta por http://localhost:3000/inbox.'
    )
  }

  const contentType = response.headers.get('content-type') || ''
  let payload = {}

  if (contentType.includes('application/json')) {
    try {
      payload = await response.json()
    } catch {
      payload = {}
    }
  } else {
    const text = await response.text()
    payload = text ? { message: text } : {}
  }

  if (!response.ok) {
    throw new Error(formatApiError(response.status, payload, 'Falha na requisicao da inbox.'))
  }

  return payload
}

function renderConversations() {
  if (state.conversations.length === 0) {
    els.conversationList.innerHTML = '<div class="empty-state"><p>Nenhuma conversa encontrada.</p></div>'
    return
  }

  els.conversationList.innerHTML = state.conversations.map((conversation) => {
    const selected = state.selectedConversation?.id === conversation.id
    const name = conversation.contactName || 'Sem nome'
    const preview = conversation.lastMessage?.body || '[mensagem sem texto]'
    const count = Number(conversation.unansweredCount || 0)

    return `
      <button class="conversation-item ${selected ? 'active' : ''}" type="button" data-id="${conversation.id}">
        <span class="conversation-main">
          <span class="conversation-name">${escapeHtml(name)}</span>
          <span class="conversation-time">${formatTime(conversation.lastMessageAt)}</span>
        </span>
        <span class="conversation-phone">${escapeHtml(conversation.phone || '')}</span>
        <span class="conversation-preview">${escapeHtml(preview)}</span>
        <span class="conversation-meta">
          <span class="conversation-status">${labelStatus(conversation.status)}</span>
          ${count > 0 ? `<span class="unanswered">${count}</span>` : ''}
        </span>
      </button>
    `
  }).join('')

  document.querySelectorAll('.conversation-item').forEach((button) => {
    button.addEventListener('click', () => openConversation(button.dataset.id))
  })
}

function renderMessages() {
  if (!state.selectedConversation) {
    els.emptyState.classList.remove('hidden')
    els.chatView.classList.add('hidden')
    return
  }

  els.emptyState.classList.add('hidden')
  els.chatView.classList.remove('hidden')
  els.chatContactName.textContent = state.selectedConversation.contactName || 'Sem nome'
  els.chatContactPhone.textContent = state.selectedConversation.phone || ''
  els.statusSelect.value = state.selectedConversation.status

  if (state.messages.length === 0) {
    els.messageList.innerHTML = '<div class="empty-state"><p>Sem mensagens nesta conversa.</p></div>'
    return
  }

  els.messageList.innerHTML = state.messages.map((message) => `
    <div class="message-row ${message.direction}">
      <div class="bubble">
        ${renderMessageContent(message)}
        <div class="bubble-time">${formatTime(message.timestamp || message.createdAt)}</div>
      </div>
    </div>
  `).join('')

  els.messageList.scrollTop = els.messageList.scrollHeight
  loadImagePreviews()
}

function renderMessageContent(message) {
  if (message.type === 'image') {
    const caption = message.body && message.body !== '[imagem]' ? message.body : ''
    return `
      <div class="image-preview" data-message-id="${escapeHtml(message.id)}">
        <div class="image-loading">Carregando imagem...</div>
      </div>
      ${caption ? `<div class="bubble-text image-caption">${escapeHtml(caption)}</div>` : ''}
    `
  }

  return `<div class="bubble-text">${escapeHtml(message.body || `[${message.type}]`)}</div>`
}

async function loadImagePreviews() {
  const containers = document.querySelectorAll('.image-preview[data-message-id]')

  for (const container of containers) {
    const messageId = container.dataset.messageId
    if (!messageId) continue

    if (state.mediaUrls.has(messageId)) {
      renderImagePreview(container, state.mediaUrls.get(messageId))
      continue
    }

    try {
      const response = await fetch(buildApiUrl(`/inbox/messages/${messageId}/media`), {
        headers: {
          'x-inbox-admin-secret': state.secret,
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      state.mediaUrls.set(messageId, url)
      renderImagePreview(container, url)
    } catch {
      renderImageError(container, messageId)
    }
  }
}

function renderImagePreview(container, url) {
  container.innerHTML = `
    <a href="${url}" target="_blank" rel="noopener noreferrer" title="Abrir imagem">
      <img class="message-image" src="${url}" alt="Imagem recebida">
    </a>
  `
}

function renderImageError(container, messageId) {
  container.innerHTML = `
    <div class="image-error">
      <span>[imagem nao carregada]</span>
      <button type="button" class="retry-image" data-message-id="${escapeHtml(messageId)}">Tentar novamente</button>
    </div>
  `

  const button = container.querySelector('.retry-image')
  button?.addEventListener('click', () => {
    state.mediaUrls.delete(messageId)
    container.innerHTML = '<div class="image-loading">Carregando imagem...</div>'
    loadImagePreviews()
  })
}

function labelStatus(status) {
  const labels = {
    open: 'Aberta',
    pending: 'Pendente',
    closed: 'Fechada',
  }
  return labels[status] || status
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function loadConversations({ keepSelection = true } = {}) {
  try {
    els.connectionStatus.textContent = 'Carregando conversas...'
    const payload = await api('/inbox/conversations')
    state.conversations = payload.data || []

    if (keepSelection && state.selectedConversation) {
      state.selectedConversation = state.conversations.find((item) => item.id === state.selectedConversation.id) || null
    }

    renderConversations()
    renderMessages()
    els.connectionStatus.textContent = `${state.conversations.length} conversa(s) carregada(s).`
  } catch (err) {
    els.connectionStatus.textContent = 'Nao foi possivel carregar a inbox.'
    showToast(err.message, 'error')
  }
}

async function openConversation(id) {
  const conversation = state.conversations.find((item) => item.id === id)
  if (!conversation) return

  state.selectedConversation = conversation
  renderConversations()

  try {
    const payload = await api(`/inbox/conversations/${id}/messages`)
    state.messages = payload.data || []
    renderMessages()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function sendReply(event) {
  event.preventDefault()
  if (!state.selectedConversation) return

  const text = els.replyText.value.trim()
  if (!text) return

  try {
    els.sendButton.disabled = true
    els.sendButton.textContent = 'Enviando...'
    const payload = await api(`/inbox/conversations/${state.selectedConversation.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })

    if (!payload.success) {
      throw new Error(payload.error || 'A API respondeu sem confirmar o envio.')
    }

    els.replyText.value = ''
    await openConversation(state.selectedConversation.id)
    await loadConversations()
    showToast(payload.dryRun ? 'Mensagem salva em modo dry-run.' : 'Mensagem enviada.')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    els.sendButton.disabled = false
    els.sendButton.textContent = 'Enviar'
  }
}

async function saveStatus() {
  if (!state.selectedConversation) return

  try {
    await api(`/inbox/conversations/${state.selectedConversation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: els.statusSelect.value }),
    })
    await loadConversations()
    if (state.selectedConversation) {
      await openConversation(state.selectedConversation.id)
    }
    showToast('Status atualizado.')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

els.saveSecretButton.addEventListener('click', () => {
  state.secret = els.secretInput.value.trim()
  localStorage.setItem('drosa_inbox_secret', state.secret)
  loadConversations({ keepSelection: false })
})

els.refreshButton.addEventListener('click', () => loadConversations())
els.replyForm.addEventListener('submit', sendReply)
els.saveStatusButton.addEventListener('click', saveStatus)

if (state.secret) {
  loadConversations({ keepSelection: false })
}
