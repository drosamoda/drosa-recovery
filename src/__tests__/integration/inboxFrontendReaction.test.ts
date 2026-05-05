import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import vm from 'vm'

function createStubElement() {
  return {
    value: '',
    textContent: '',
    className: '',
    innerHTML: '',
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    classList: {
      add: () => undefined,
      remove: () => undefined,
    },
    addEventListener: () => undefined,
    querySelector: () => null,
    querySelectorAll: () => [],
  }
}

function loadInboxScript() {
  const script = fs.readFileSync(path.join(process.cwd(), 'public/inbox/app.js'), 'utf8')
  const elements = new Map<string, ReturnType<typeof createStubElement>>()

  const document = {
    getElementById(id: string) {
      if (!elements.has(id)) {
        elements.set(id, createStubElement())
      }
      return elements.get(id)
    },
    querySelectorAll: () => [],
  }

  const context = {
    location: { origin: 'http://localhost:3000' },
    clearTimeout,
    setTimeout,
    document,
    localStorage: {
      getItem: () => '',
      setItem: () => undefined,
    },
    URL,
    console,
    fetch: async () => ({ ok: true, headers: { get: () => null }, json: async () => ({}) }),
  } as Record<string, unknown>

  context.window = context
  vm.runInNewContext(script, context)
  return context
}

describe('public/inbox/app.js reaction rendering', () => {
  it('mostra emoji de reaction em vez de [other] quando body existe', () => {
    const context = loadInboxScript()
    const html = (context.renderMessageContent as (message: Record<string, unknown>) => string)({
      id: 'message-1',
      type: 'other',
      body: '👍',
      rawPayload: {
        reaction: {
          emoji: '👍',
          message_id: 'wamid.target.1',
        },
      },
    })

    expect(html).toContain('👍')
    expect(html).not.toContain('[other]')
  })
})
