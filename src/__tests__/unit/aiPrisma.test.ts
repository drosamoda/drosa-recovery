import { beforeEach, describe, expect, it, vi } from 'vitest'

// Activation Wiring v2, seção 5: getAiPrisma() NUNCA cai de volta para o
// banco compartilhado. Testado contra a implementação REAL de
// config/aiPrisma.ts (não mockada) — só env e o construtor do PrismaClient
// são substituídos, para não abrir conexão nenhuma de verdade.
const mocks = vi.hoisted(() => ({
  env: { AI_DATABASE_URL: '' },
  PrismaClientCtor: vi.fn(),
}))

vi.mock('../../config/env', () => ({ env: mocks.env }))
vi.mock('@prisma/client', () => ({ PrismaClient: mocks.PrismaClientCtor }))

describe('config/aiPrisma — sem fallback para o banco compartilhado (Activation Wiring v2, seção 5)', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.env.AI_DATABASE_URL = ''
    mocks.PrismaClientCtor.mockReset()
    mocks.PrismaClientCtor.mockImplementation(() => ({ campaignDraft: {}, aiRun: {} }))
  })

  // H) AI_DATABASE_URL ausente => zero fallback para primary prisma
  it('H) AI_DATABASE_URL ausente: getAiPrisma() lança AiDatabaseNotConfiguredError, nunca instancia nenhum client nem devolve o banco compartilhado', async () => {
    const { getAiPrisma, AiDatabaseNotConfiguredError } = await import('../../config/aiPrisma')
    expect(() => getAiPrisma()).toThrow(AiDatabaseNotConfiguredError)
    expect(mocks.PrismaClientCtor).not.toHaveBeenCalled()
  })

  it('com AI_DATABASE_URL configurada, getAiPrisma() instancia um PrismaClient dedicado apontando para essa URL', async () => {
    mocks.env.AI_DATABASE_URL = 'postgres://crm_ai_preview_writer:x@host:5432/db'
    const { getAiPrisma } = await import('../../config/aiPrisma')

    getAiPrisma()

    expect(mocks.PrismaClientCtor).toHaveBeenCalledTimes(1)
    expect(mocks.PrismaClientCtor).toHaveBeenCalledWith(expect.objectContaining({
      datasources: { db: { url: 'postgres://crm_ai_preview_writer:x@host:5432/db' } },
    }))
  })

  it('reusa a mesma instância entre chamadas (não abre uma conexão nova por chamada)', async () => {
    mocks.env.AI_DATABASE_URL = 'postgres://crm_ai_preview_writer:x@host:5432/db'
    const { getAiPrisma } = await import('../../config/aiPrisma')

    const first = getAiPrisma()
    const second = getAiPrisma()

    expect(first).toBe(second)
    expect(mocks.PrismaClientCtor).toHaveBeenCalledTimes(1)
  })

  it('isAiDatabaseConfigured() reflete exatamente a presença de AI_DATABASE_URL', async () => {
    const { isAiDatabaseConfigured } = await import('../../config/aiPrisma')
    expect(isAiDatabaseConfigured()).toBe(false)

    mocks.env.AI_DATABASE_URL = 'postgres://x'
    vi.resetModules()
    const reloaded = await import('../../config/aiPrisma')
    expect(reloaded.isAiDatabaseConfigured()).toBe(true)
  })

  // Prova estrutural complementar: o próprio código-fonte nunca importa o
  // client compartilhado — não existe NENHUM caminho de fallback para
  // remover acidentalmente no futuro sem que isto quebre.
  it('o código-fonte de aiPrisma.ts nunca importa config/prisma (nenhum caminho de fallback existe)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const text = fs.readFileSync(path.join(process.cwd(), 'src/config/aiPrisma.ts'), 'utf8')
    expect(text).not.toMatch(/from ['"]\.\/prisma['"]/)
  })
})
