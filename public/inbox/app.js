const state = {
  secret: localStorage.getItem('drosa_inbox_secret') || '',
  conversations: [],
  selectedConversationId: null,
  messages: [],
  filter: 'all',
  search: '',
  mediaUrls: new Map(),
  loadingConversationId: null,
  messagesRequestToken: 0,
  mediaRenderToken: 0,
  selectedImage: null,
  replyTarget: null,
}

const els = {
  connectionStatus: document.getElementById('connectionStatus'),
  secretInput: document.getElementById('secretInput'),
  saveSecretButton: document.getElementById('saveSecretButton'),
  refreshButton: document.getElementById('refreshButton'),
  conversationSearch: document.getElementById('conversationSearch'),
  conversationList: document.getElementById('conversationList'),
  filterButtons: document.querySelectorAll('.filter-chip'),
  emptyState: document.getElementById('emptyState'),
  chatView: document.getElementById('chatView'),
  chatAvatar: document.getElementById('chatAvatar'),
  chatContactName: document.getElementById('chatContactName'),
  chatContactPhone: document.getElementById('chatContactPhone'),
  chatStatusBadge: document.getElementById('chatStatusBadge'),
  statusSelect: document.getElementById('statusSelect'),
  saveStatusButton: document.getElementById('saveStatusButton'),
  messageList: document.getElementById('messageList'),
  latestMessageButton: document.getElementById('latestMessageButton'),
  replyForm: document.getElementById('replyForm'),
  replyTargetBox: document.getElementById('replyTargetBox'),
  replyTargetTitle: document.getElementById('replyTargetTitle'),
  replyTargetBody: document.getElementById('replyTargetBody'),
  clearReplyButton: document.getElementById('clearReplyButton'),
  imagePreviewBox: document.getElementById('imagePreviewBox'),
  selectedImagePreview: document.getElementById('selectedImagePreview'),
  selectedImageName: document.getElementById('selectedImageName'),
  selectedImageInfo: document.getElementById('selectedImageInfo'),
  clearImageButton: document.getElementById('clearImageButton'),
  attachButton: document.getElementById('attachButton'),
  imageInput: document.getElementById('imageInput'),
  replyText: document.getElementById('replyText'),
  sendButton: document.getElementById('sendButton'),
  toast: document.getElementById('toast'),
  panelContactName: document.getElementById('panelContactName'),
  panelContactPhone: document.getElementById('panelContactPhone'),
  panelConversationStatus: document.getElementById('panelConversationStatus'),
  panelAssignedTo: document.getElementById('panelAssignedTo'),
  panelTags: document.getElementById('panelTags'),
  panelLastOrder: document.getElementById('panelLastOrder'),
}

const MAX_MANUAL_IMAGE_BYTES = 5 * 1024 * 1024
const SUPPORTED_MANUAL_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

els.secretInput.value = state.secret

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

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

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric =
    typeof value === 'number'
      ? value
      : Number(String(typeof value === 'object' ? value.toString?.() ?? value : value).replace(',', '.'))

  if (!Number.isFinite(numeric)) return null

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numeric)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo selecionado.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

function showToast(message, type = 'info') {
  els.toast.textContent = message
  els.toast.className = `toast ${type === 'error' ? 'error' : 'success'}`
  els.toast.classList.remove('hidden')
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
  } catch {
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

function formatStatusLabel(status) {
  const labels = {
    open: 'Aberta',
    pending: 'Pendente',
    closed: 'Fechada',
  }

  return labels[status] || status || '-'
}

function formatPaymentLabel(status) {
  const labels = {
    pending: 'Pagamento pendente',
    paid: 'Pago',
    rejected: 'Rejeitado',
    refunded: 'Reembolsado',
    processing: 'Processando',
  }

  return labels[status] || status || '-'
}

function formatMessageType(type) {
  const labels = {
    text: 'Texto',
    image: 'Imagem',
    audio: 'Áudio',
    document: 'Documento',
    sticker: 'Figurinha',
    interactive: 'Interativo',
    template: 'Template',
    other: 'Outro',
  }

  return labels[type] || type || 'Mensagem'
}

function getSelectedConversation() {
  return state.conversations.find((conversation) => conversation.id === state.selectedConversationId) || null
}

function getMessagesContainer() {
  return document.querySelector('[data-messages-list]') || els.messageList
}

function isNearMessagesBottom() {
  const container = getMessagesContainer()
  if (!container) return false
  return container.scrollHeight - container.scrollTop - container.clientHeight < 120
}

function updateLatestMessageButton() {
  if (!els.latestMessageButton) return
  const conversation = getSelectedConversation()
  const showButton = Boolean(conversation && state.messages.length > 0 && !isNearMessagesBottom())
  els.latestMessageButton.classList.toggle('hidden', !showButton)
}

function scrollMessagesToBottom(force = false) {
  const el = getMessagesContainer()
  if (!el) return
  if (!force && !isNearMessagesBottom()) return

  window.requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight
    console.log('[inbox scroll]', {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    })
    if (el.scrollHeight <= el.clientHeight) {
      console.warn('[inbox scroll] messageList is not overflowing; check parent min-height/flex sizing.')
    }
    updateLatestMessageButton()
  })
}

function resetMessagesViewport() {
  const container = getMessagesContainer()
  if (!container) return
  container.scrollTop = 0
  updateLatestMessageButton()
}

function getMessageSortTime(message) {
  const value = message.timestamp || message.createdAt
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function normalizeMessages(messages) {
  return [...(messages || [])].sort((a, b) => {
    const byTime = getMessageSortTime(a) - getMessageSortTime(b)
    if (byTime !== 0) return byTime
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
}

function getMessageFallbackBody(message) {
  if (message.body) return message.body
  if (message.type === 'image') return '[imagem]'
  if (message.type === 'audio') return '[áudio]'
  if (message.type === 'document') return '[documento]'
  if (message.type === 'sticker') return '[figurinha]'
  if (message.type === 'video') return '[vídeo]'
  if (message.type === 'other') return '[other]'
  return `[${message.type}]`
}

function getReplyBody(message) {
  const rawPayload = message.rawPayload || {}
  return rawPayload.replyToBody || rawPayload.reply_to_body || getMessageFallbackBody(message)
}

function getReplyContextLabel(type) {
  switch (type) {
    case 'image':
      return 'Respondendo à imagem'
    case 'audio':
      return 'Respondendo ao áudio'
    case 'document':
      return 'Respondendo ao documento'
    case 'sticker':
      return 'Respondendo à figurinha'
    case 'video':
      return 'Respondendo ao vídeo'
    case 'reaction':
      return 'Respondendo à reação'
    case 'other':
      return 'Respondendo à mensagem'
    default:
      return 'Respondendo à mensagem'
  }
}

function renderReplyTargetBox() {
  if (!els.replyTargetBox || !els.replyTargetTitle || !els.replyTargetBody || !els.clearReplyButton) return

  if (!state.replyTarget) {
    els.replyTargetBox.classList.add('hidden')
    els.replyTargetTitle.textContent = ''
    els.replyTargetBody.textContent = ''
    return
  }

  els.replyTargetBox.classList.remove('hidden')
  els.replyTargetTitle.textContent = getReplyContextLabel(state.replyTarget.type)
  els.replyTargetBody.textContent = state.replyTarget.body || ''
  els.clearReplyButton.onclick = () => {
    state.replyTarget = null
    renderReplyTargetBox()
  }
}

function renderSelectedImagePreview() {
  if (!els.imagePreviewBox || !els.selectedImagePreview || !els.selectedImageName || !els.selectedImageInfo || !els.clearImageButton) return

  if (!state.selectedImage) {
    els.imagePreviewBox.classList.add('hidden')
    els.selectedImagePreview.removeAttribute('src')
    els.selectedImageName.textContent = ''
    els.selectedImageInfo.textContent = ''
    if (els.imageInput) els.imageInput.value = ''
    return
  }

  els.imagePreviewBox.classList.remove('hidden')
  els.selectedImagePreview.src = state.selectedImage.dataUrl
  els.selectedImagePreview.alt = state.selectedImage.fileName
  els.selectedImageName.textContent = state.selectedImage.fileName
  els.selectedImageInfo.textContent = `${state.selectedImage.mimeType} • ${formatBytes(state.selectedImage.size)}`
  els.clearImageButton.onclick = () => {
    state.selectedImage = null
    renderSelectedImagePreview()
    updateComposerPlaceholder()
  }
}

function updateComposerPlaceholder() {
  if (!els.replyText) return
  els.replyText.placeholder = state.selectedImage ? 'Legenda opcional' : 'Digite a mensagem'
}

function clearReplyTarget() {
  state.replyTarget = null
  renderReplyTargetBox()
}

function clearSelectedImage() {
  state.selectedImage = null
  renderSelectedImagePreview()
  updateComposerPlaceholder()
}

function resetComposerState() {
  clearReplyTarget()
  clearSelectedImage()
  if (els.replyText) els.replyText.value = ''
}

function setReplyTarget(message) {
  state.replyTarget = {
    id: message.id,
    body: getReplyBody(message),
    type: message.type,
  }
  renderReplyTargetBox()
}

function isSupportedManualImageMimeType(mimeType) {
  return SUPPORTED_MANUAL_IMAGE_MIME_TYPES.has(String(mimeType || '').trim().toLowerCase())
}

function getConversationAvatar(conversation) {
  const name = (conversation.contactName || conversation.phone || 'DR').trim()
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')

  return initials || 'DR'
}

function buildConversationTags(conversation) {
  const tags = []

  if (conversation.status) tags.push(formatStatusLabel(conversation.status))
  if (conversation.unansweredCount > 0) tags.push(`${conversation.unansweredCount} não lidas`)
  if (conversation.assignedTo) tags.push(`@${conversation.assignedTo}`)
  if (conversation.lastOrder?.orderNumber) tags.push(`Pedido #${conversation.lastOrder.orderNumber}`)
  if (conversation.lastOrder?.paymentStatus) tags.push(formatPaymentLabel(conversation.lastOrder.paymentStatus))
  if (conversation.lastMessage?.type && conversation.lastMessage.type !== 'text') {
    tags.push(formatMessageType(conversation.lastMessage.type))
  }

  return [...new Set(tags)].slice(0, 4)
}

function buildSearchText(conversation) {
  const lastMessage = conversation.lastMessage?.body || ''
  const orderNumber = conversation.lastOrder?.orderNumber || ''
  const paymentStatus = conversation.lastOrder?.paymentStatus || ''
  return [
    conversation.contactName,
    conversation.phone,
    conversation.status,
    conversation.assignedTo,
    lastMessage,
    orderNumber,
    paymentStatus,
    ...buildConversationTags(conversation),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function getFilteredConversations() {
  const term = state.search.trim().toLowerCase()

  return state.conversations.filter((conversation) => {
    const matchesFilter =
      state.filter === 'all' ||
      (state.filter === 'unread' && conversation.unansweredCount > 0) ||
      (state.filter === 'open' && conversation.status === 'open') ||
      (state.filter === 'closed' && conversation.status === 'closed')

    if (!matchesFilter) return false
    if (!term) return true

    return buildSearchText(conversation).includes(term)
  })
}

function renderConversationList() {
  const conversations = getFilteredConversations()

  if (conversations.length === 0) {
    els.conversationList.innerHTML = `
      <div class="empty-state">
        <div class="empty-card">
          <h2>Nenhuma conversa encontrada</h2>
          <p>Altere o filtro ou a busca para localizar outra conversa.</p>
        </div>
      </div>
    `
    return
  }

  els.conversationList.innerHTML = conversations
    .map((conversation) => {
      const selected = state.selectedConversationId === conversation.id
      const name = conversation.contactName || 'Sem nome'
      const preview = conversation.lastMessage?.body || '[mensagem sem texto]'
      const tags = buildConversationTags(conversation)
      const unread = Number(conversation.unansweredCount || 0)

      return `
        <button class="conversation-item ${selected ? 'active' : ''}" type="button" data-id="${escapeHtml(conversation.id)}">
          <span class="conversation-avatar">${escapeHtml(getConversationAvatar(conversation))}</span>
          <span class="conversation-body">
            <span class="conversation-top">
              <span class="conversation-name">${escapeHtml(name)}</span>
              <span class="conversation-time">${escapeHtml(formatTime(conversation.lastMessageAt))}</span>
            </span>
            <span class="conversation-phone">${escapeHtml(conversation.phone || '')}</span>
            <span class="conversation-preview">${escapeHtml(preview)}</span>
            <span class="conversation-tags">
              ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
            </span>
            <span class="conversation-meta">
              <span class="conversation-status tag">${escapeHtml(formatStatusLabel(conversation.status))}</span>
              ${unread > 0 ? `<span class="unanswered-badge">${unread}</span>` : ''}
            </span>
          </span>
        </button>
      `
    })
    .join('')

  document.querySelectorAll('.conversation-item').forEach((button) => {
    button.addEventListener('click', () => openConversation(button.dataset.id))
  })
}

function renderConversationDetails(conversation) {
  if (!conversation) {
    els.emptyState.classList.remove('hidden')
    els.chatView.classList.add('hidden')
    els.panelContactName.textContent = '-'
    els.panelContactPhone.textContent = '-'
    els.panelConversationStatus.textContent = '-'
    els.panelAssignedTo.textContent = '-'
    els.panelTags.innerHTML = ''
    els.panelLastOrder.innerHTML = 'Nenhum pedido encontrado.'
    updateLatestMessageButton()
    return
  }

  els.emptyState.classList.add('hidden')
  els.chatView.classList.remove('hidden')

  const name = conversation.contactName || 'Sem nome'
  const statusLabel = formatStatusLabel(conversation.status)
  const tags = buildConversationTags(conversation)

  els.chatAvatar.textContent = getConversationAvatar(conversation)
  els.chatContactName.textContent = name
  els.chatContactPhone.textContent = conversation.phone || ''
  els.chatStatusBadge.textContent = statusLabel
  els.statusSelect.value = conversation.status

  els.panelContactName.textContent = name
  els.panelContactPhone.textContent = conversation.phone || '-'
  els.panelConversationStatus.textContent = statusLabel
  els.panelAssignedTo.textContent = conversation.assignedTo || '-'
  els.panelTags.innerHTML = tags.length
    ? tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
    : '<span class="detail-summary">Sem etiquetas.</span>'

  const lastOrder = conversation.lastOrder
  if (lastOrder) {
    const amount = formatMoney(lastOrder.total)
    const orderParts = [
      lastOrder.orderNumber ? `Pedido #${lastOrder.orderNumber}` : null,
      lastOrder.paymentStatus ? formatPaymentLabel(lastOrder.paymentStatus) : null,
      lastOrder.status ? `Status: ${lastOrder.status}` : null,
      amount ? `Total: ${amount}` : null,
      lastOrder.orderUrl ? `<a class="detail-link" href="${escapeHtml(lastOrder.orderUrl)}" target="_blank" rel="noopener noreferrer">Abrir pedido</a>` : null,
    ].filter(Boolean)

    els.panelLastOrder.innerHTML = orderParts.join('<br>')
  } else {
    els.panelLastOrder.textContent = 'Nenhum pedido encontrado.'
  }
}

function getMessageMediaKind(message) {
  const rawPayload = message.rawPayload || {}

  if (rawPayload.image?.id || message.type === 'image') return 'image'
  if (rawPayload.sticker?.id || message.type === 'sticker') return 'sticker'
  if (rawPayload.audio?.id || message.type === 'audio') return 'audio'
  if (rawPayload.document?.id || message.type === 'document') return 'document'
  if (rawPayload.video?.id || message.type === 'video') return 'video'
  return null
}

function getMediaCaption(message, kind) {
  const rawPayload = message.rawPayload || {}

  if (kind === 'document') {
    return rawPayload.document?.filename || (message.body && message.body !== '[documento]' ? message.body : '')
  }

  if (kind === 'image' || kind === 'video') {
    return message.body && !['[imagem]', '[vídeo]'].includes(message.body) ? message.body : ''
  }

  if (kind === 'audio' || kind === 'sticker') {
    return message.body && !['[áudio]', '[figurinha]'].includes(message.body) ? message.body : ''
  }

  return message.body || ''
}

function getMediaLabel(message, kind) {
  const rawPayload = message.rawPayload || {}

  if (kind === 'document') {
    return rawPayload.document?.filename || message.body || '[documento]'
  }

  if (kind === 'image') return message.body || '[imagem]'
  if (kind === 'sticker') return message.body || '[figurinha]'
  if (kind === 'audio') return message.body || '[áudio]'
  if (kind === 'video') return message.body || '[vídeo]'
  return message.body || `[${kind}]`
}

function getLoadingLabel(kind) {
  const labels = {
    image: 'Carregando imagem...',
    sticker: 'Carregando figurinha...',
    audio: 'Carregando áudio...',
    video: 'Carregando vídeo...',
    document: 'Carregando documento...',
  }

  return labels[kind] || 'Carregando mídia...'
}

function renderReplyQuoteMarkup(message) {
  const rawPayload = message.rawPayload || {}
  const replyQuoteBody = rawPayload.replyToBody || rawPayload.reply_to_body
  const replyQuoteType = rawPayload.replyToType || rawPayload.reply_to_type
  if (!replyQuoteBody) return ''

  return `
    <div class="reply-quote">
      <span class="reply-quote-label">${escapeHtml(getReplyContextLabel(replyQuoteType))}</span>
      <div class="reply-quote-body">${escapeHtml(replyQuoteBody)}</div>
    </div>
  `
}

function renderMessageContent(message) {
  const mediaKind = getMessageMediaKind(message)

  if (mediaKind) {
    const caption = getMediaCaption(message, mediaKind)
    const label = getMediaLabel(message, mediaKind)

    return `
      <div
        class="media-preview media-${escapeHtml(mediaKind)}"
        data-message-id="${escapeHtml(message.id)}"
        data-kind="${escapeHtml(mediaKind)}"
        data-label="${escapeHtml(label)}"
      >
        <div class="media-loading">Carregando mídia...</div>
      </div>
      ${caption ? `<div class="bubble-text media-caption">${escapeHtml(caption)}</div>` : ''}
    `
  }

  const body = message.body || (message.type === 'other' ? '[other]' : `[${message.type}]`)
  return `<div class="bubble-text">${escapeHtml(body)}</div>`
}

function renderMessages({ forceScroll = false } = {}) {
  const conversation = getSelectedConversation()
  const conversationId = conversation?.id || null
  const renderToken = state.mediaRenderToken + 1
  state.mediaRenderToken = renderToken
  renderConversationDetails(conversation)

  if (!conversation) return

  if (state.loadingConversationId === conversation.id && state.messages.length === 0) {
    els.messageList.innerHTML = `
      <div class="empty-state">
        <div class="empty-card">
          <h2>Carregando mensagens</h2>
          <p>Aguarde enquanto a conversa é carregada.</p>
        </div>
      </div>
    `
    updateLatestMessageButton()
    return
  }

  if (state.messages.length === 0) {
    els.messageList.innerHTML = `
      <div class="empty-state">
        <div class="empty-card">
          <h2>Sem mensagens nesta conversa</h2>
          <p>Quando houver novas mensagens, elas aparecem aqui.</p>
        </div>
      </div>
    `
    updateLatestMessageButton()
    return
  }

  els.messageList.innerHTML = state.messages
    .map((message) => {
      const directionClass = message.direction === 'outbound' ? 'outbound' : 'inbound'
      const replyBody = getReplyBody(message)
      return `
        <div class="message-row ${directionClass}" data-message-id="${escapeHtml(message.id)}">
          <div class="bubble">
            <div class="message-actions">
              <button
                type="button"
                class="reply-message-button"
                data-reply-message-id="${escapeHtml(message.id)}"
                data-reply-message-body="${escapeHtml(replyBody)}"
                data-reply-message-type="${escapeHtml(message.type || 'text')}"
              >
                Responder
              </button>
            </div>
            ${renderReplyQuoteMarkup(message)}
            ${renderMessageContent(message)}
            <div class="bubble-time">${escapeHtml(formatTime(message.timestamp || message.createdAt))}</div>
          </div>
        </div>
      `
    })
    .join('')

  scrollMessagesToBottom(forceScroll)
  updateLatestMessageButton()
  loadMediaPreviews({ keepBottom: forceScroll, conversationId, renderToken })
}

async function loadMediaPreviews({ keepBottom = false } = {}) {
  const containers = document.querySelectorAll('.media-preview[data-message-id]')
  const shouldKeepBottom = keepBottom || isNearMessagesBottom()

  for (const container of containers) {
    const messageId = container.dataset.messageId
    if (!messageId) continue

    const kind = container.dataset.kind || 'image'

    if (state.mediaUrls.has(messageId)) {
      renderMediaPreview(container, state.mediaUrls.get(messageId), kind, shouldKeepBottom)
      if (shouldKeepBottom) scrollMessagesToBottom(true)
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
      renderMediaPreview(container, url, kind, shouldKeepBottom)
      if (shouldKeepBottom) scrollMessagesToBottom(true)
    } catch {
      renderMediaError(container, messageId, kind)
      if (shouldKeepBottom) scrollMessagesToBottom(true)
    }
  }
}

function renderMediaPreview(container, url, kind, keepBottom = false) {
  if (kind === 'document') {
    const label = container.dataset.label || 'Documento'
    container.innerHTML = `
      <div class="document-preview">
        <a class="document-link" href="${url}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(label)}">
          Baixar arquivo
        </a>
        <span class="document-name">${escapeHtml(label)}</span>
      </div>
    `
    return
  }

  if (kind === 'audio') {
    container.innerHTML = `<audio class="media-audio" controls src="${url}"></audio>`
    const audio = container.querySelector('audio')
    audio?.addEventListener('loadedmetadata', () => scrollMessagesToBottom(true), { once: true })
    return
  }

  if (kind === 'video') {
    container.innerHTML = `<video class="media-video" controls playsinline src="${url}"></video>`
    const video = container.querySelector('video')
    video?.addEventListener('loadedmetadata', () => scrollMessagesToBottom(true), { once: true })
    return
  }

  const alt = kind === 'sticker' ? 'Figurinha recebida' : 'Imagem recebida'
  container.innerHTML = `
    <a href="${url}" target="_blank" rel="noopener noreferrer" title="Abrir ${escapeHtml(kind)}">
      <img class="message-image" src="${url}" alt="${alt}">
    </a>
  `
  const image = container.querySelector('img')
  image?.addEventListener('load', () => scrollMessagesToBottom(true), { once: true })
}

function renderMediaError(container, messageId, kind) {
  const fallbackLabels = {
    image: '[imagem não carregada]',
    sticker: '[figurinha não carregada]',
    audio: '[áudio não carregado]',
    video: '[vídeo não carregado]',
    document: '[documento não carregado]',
  }

  container.innerHTML = `
    <div class="media-error">
      <span>${escapeHtml(fallbackLabels[kind] || '[mídia não carregada]')}</span>
      <button type="button" class="retry-media" data-message-id="${escapeHtml(messageId)}" data-kind="${escapeHtml(kind)}">Tentar novamente</button>
    </div>
  `

  const button = container.querySelector('.retry-media')
  button?.addEventListener('click', () => {
    state.mediaUrls.delete(messageId)
    container.innerHTML = `<div class="media-loading">${escapeHtml(getLoadingLabel(kind))}</div>`
    loadMediaPreviews({ keepBottom: true })
  })
}

function setActiveFilter(filter) {
  state.filter = filter
  els.filterButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter)
  })
  renderConversationList()
}

async function loadConversations({ keepSelection = true } = {}) {
  const selectedBeforeLoad = state.selectedConversationId
  const shouldKeepBottom = Boolean(selectedBeforeLoad) && isNearMessagesBottom()

  try {
    els.connectionStatus.textContent = 'Carregando conversas...'
    const payload = await api('/inbox/conversations')
    state.conversations = payload.data || []

    if (!keepSelection) {
      state.selectedConversationId = null
      state.messages = []
    } else if (
      state.selectedConversationId &&
      !state.conversations.some((conversation) => conversation.id === state.selectedConversationId)
    ) {
      state.selectedConversationId = null
      state.messages = []
    }

    renderConversationList()
    renderMessages()
    if (keepSelection && state.selectedConversationId && shouldKeepBottom) {
      scrollMessagesToBottom(true)
    }
    els.connectionStatus.textContent = `${state.conversations.length} conversa(s) carregada(s).`
  } catch (err) {
    els.connectionStatus.textContent = 'Nao foi possivel carregar a inbox.'
    showToast(err.message, 'error')
  }
}

async function openConversation(id) {
  const conversation = state.conversations.find((item) => item.id === id)
  if (!conversation) return

  if (state.selectedConversationId !== id) {
    resetComposerState()
  }

  state.selectedConversationId = id
  state.loadingConversationId = id
  const requestToken = state.messagesRequestToken + 1
  state.messagesRequestToken = requestToken
  state.messages = []
  renderConversationList()
  renderMessages()

  try {
    const payload = await api(`/inbox/conversations/${id}/messages`)
    if (state.messagesRequestToken !== requestToken || state.selectedConversationId !== id) return

    state.messages = normalizeMessages(payload.data || [])
    state.loadingConversationId = null
    renderConversationList()
    renderMessages({ forceScroll: true })
  } catch (err) {
    if (state.messagesRequestToken !== requestToken || state.selectedConversationId !== id) return

    state.loadingConversationId = null
    state.messages = []
    renderConversationList()
    renderMessages()
    els.messageList.innerHTML = `
      <div class="empty-state">
        <div class="empty-card">
          <h2>Erro ao carregar mensagens</h2>
          <p>${escapeHtml(err.message)}</p>
        </div>
      </div>
    `
    showToast(err.message, 'error')
  }
}

async function refreshSelectedConversationMessages({ forceScroll = false } = {}) {
  const id = state.selectedConversationId
  if (!id) return

  const requestToken = state.messagesRequestToken + 1
  state.messagesRequestToken = requestToken

  try {
    const payload = await api(`/inbox/conversations/${id}/messages`)
    if (state.messagesRequestToken !== requestToken || state.selectedConversationId !== id) return

    state.messages = normalizeMessages(payload.data || [])
    state.loadingConversationId = null
    renderMessages({ forceScroll })
  } catch (err) {
    if (state.messagesRequestToken !== requestToken || state.selectedConversationId !== id) return
    showToast(err.message, 'error')
  }
}

function submitReply(event) {
  if (event?.preventDefault) event.preventDefault()
  return sendReply()
}

async function sendReply() {
  const conversation = getSelectedConversation()
  if (!conversation) return

  const caption = els.replyText.value.trim()
  const hasImage = Boolean(state.selectedImage)
  if (!hasImage && !caption) return

  try {
    els.sendButton.disabled = true
    els.sendButton.textContent = 'Enviando...'

    const payload = hasImage
      ? await api(`/inbox/conversations/${conversation.id}/media`, {
          method: 'POST',
          body: JSON.stringify({
            fileBase64: state.selectedImage.base64,
            fileName: state.selectedImage.fileName,
            mimeType: state.selectedImage.mimeType,
            caption,
            replyToMessageId: state.replyTarget?.id || undefined,
          }),
        })
      : await api(`/inbox/conversations/${conversation.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ text: caption }),
        })

    if (!payload.success) {
      throw new Error(payload.error || 'A API respondeu sem confirmar o envio.')
    }

    els.replyText.value = ''
    clearSelectedImage()
    clearReplyTarget()
    await loadConversations()
    await openConversation(conversation.id)
    scrollMessagesToBottom(true)
    showToast(hasImage ? 'Imagem enviada.' : payload.dryRun ? 'Mensagem salva em modo dry-run.' : 'Mensagem enviada.')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    els.sendButton.disabled = false
    els.sendButton.textContent = 'Enviar'
  }
}

async function handleImageSelection(event) {
  const file = event.target.files?.[0]
  if (!file) return

  const mimeType = String(file.type || '').trim().toLowerCase()
  if (!isSupportedManualImageMimeType(mimeType)) {
    event.target.value = ''
    showToast('Selecione uma imagem jpg, jpeg, png ou webp.', 'error')
    return
  }

  if (file.size > MAX_MANUAL_IMAGE_BYTES) {
    event.target.value = ''
    showToast('Imagem muito grande. Limite maximo de 5 MB.', 'error')
    return
  }

  try {
    const dataUrl = await readFileAsDataUrl(file)
    state.selectedImage = {
      fileName: file.name,
      mimeType,
      size: file.size,
      dataUrl,
      base64: dataUrl.includes(',') ? dataUrl.split(',').pop() || '' : dataUrl,
    }
    renderSelectedImagePreview()
    updateComposerPlaceholder()
  } catch (err) {
    event.target.value = ''
    showToast(err.message, 'error')
  }
}

function handleMessageListClick(event) {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest('.reply-message-button')
  if (!button) return

  state.replyTarget = {
    id: button.dataset.replyMessageId,
    body: button.dataset.replyMessageBody || '',
    type: button.dataset.replyMessageType || 'text',
  }
  renderReplyTargetBox()
}

async function saveStatus() {
  const conversation = getSelectedConversation()
  if (!conversation) return

  try {
    await api(`/inbox/conversations/${conversation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: els.statusSelect.value }),
    })

    await loadConversations()
    await openConversation(conversation.id)
    showToast('Status atualizado.')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

els.secretInput.value = state.secret
els.secretInput.addEventListener('input', () => {
  state.secret = els.secretInput.value.trim()
})

els.saveSecretButton.addEventListener('click', () => {
  state.secret = els.secretInput.value.trim()
  localStorage.setItem('drosa_inbox_secret', state.secret)
  loadConversations({ keepSelection: false })
})

els.refreshButton.addEventListener('click', async () => {
  const shouldKeepBottom = isNearMessagesBottom()
  await loadConversations()
  if (state.selectedConversationId) {
    await refreshSelectedConversationMessages({ forceScroll: shouldKeepBottom })
  }
})
els.replyForm.addEventListener('submit', submitReply)
els.saveStatusButton.addEventListener('click', saveStatus)
els.attachButton.addEventListener('click', () => els.imageInput.click())
els.imageInput.addEventListener('change', handleImageSelection)
els.messageList.addEventListener('click', handleMessageListClick)
els.messageList.addEventListener('scroll', updateLatestMessageButton, { passive: true })
els.latestMessageButton?.addEventListener('click', () => scrollMessagesToBottom(true))

els.conversationSearch.addEventListener('input', () => {
  state.search = els.conversationSearch.value
  renderConversationList()
})

els.filterButtons.forEach((button) => {
  button.addEventListener('click', () => setActiveFilter(button.dataset.filter || 'all'))
})

els.replyText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submitReply(event)
  }
})

updateComposerPlaceholder()
renderReplyTargetBox()
renderSelectedImagePreview()

if (state.secret) {
  loadConversations({ keepSelection: false })
}
