import { beforeEach, describe, expect, it, vi } from 'vitest'

const envMock = vi.hoisted(() => ({
  JOBS_SECRET: 'segredo-jobs',
  JOBS_OIDC_AUDIENCE: 'https://svc.example/jobs',
  JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS: ['sched@proj.iam.gserviceaccount.com'],
}))
vi.mock('../../config/env', () => ({ env: envMock }))

const verifyMock = vi.hoisted(() => vi.fn())
vi.mock('../../services/jobsOidc', async () => {
  const actual = await vi.importActual<typeof import('../../services/jobsOidc')>('../../services/jobsOidc')
  return { ...actual, verifyGoogleIdToken: verifyMock }
})

import { jobsAuth } from '../../middlewares/jobsAuth'

const GOOD = {
  iss: 'https://accounts.google.com',
  aud: 'https://svc.example/jobs',
  email: 'sched@proj.iam.gserviceaccount.com',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 300,
}

async function run(headers: Record<string, string>) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  const next = vi.fn()
  await jobsAuth({ headers } as never, res as never, next)
  return { res, next }
}

describe('jobsAuth', () => {
  beforeEach(() => {
    verifyMock.mockReset()
    envMock.JOBS_OIDC_AUDIENCE = 'https://svc.example/jobs'
    envMock.JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS = ['sched@proj.iam.gserviceaccount.com']
  })

  it('sem credencial → 401', async () => {
    const { res, next } = await run({})
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('x-jobs-secret válido continua funcionando', async () => {
    expect((await run({ 'x-jobs-secret': 'segredo-jobs' })).next).toHaveBeenCalled()
  })

  it('x-jobs-secret inválido → 401 (sem cair no OIDC)', async () => {
    const { res } = await run({ 'x-jobs-secret': 'errado' })
    expect(res.status).toHaveBeenCalledWith(401)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('OIDC válido (issuer, audience e service account corretos) → autorizado', async () => {
    verifyMock.mockResolvedValue(GOOD)
    expect((await run({ authorization: 'Bearer tok' })).next).toHaveBeenCalled()
    expect(verifyMock).toHaveBeenCalledWith('tok', 'https://svc.example/jobs')
  })

  it.each([
    ['audience errada', { ...GOOD, aud: 'https://outro' }],
    ['issuer errado', { ...GOOD, iss: 'https://evil.example' }],
    ['outra service account', { ...GOOD, email: 'outra@proj.iam.gserviceaccount.com' }],
    ['e-mail não verificado', { ...GOOD, email_verified: false }],
    ['token expirado', { ...GOOD, exp: Math.floor(Date.now() / 1000) - 10 }],
  ])('OIDC com %s → 401', async (_label, payload) => {
    verifyMock.mockResolvedValue(payload)
    const { res, next } = await run({ authorization: 'Bearer tok' })
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('token malformado (verificação lança) → 401', async () => {
    verifyMock.mockRejectedValue(new Error('Wrong number of segments'))
    expect((await run({ authorization: 'Bearer lixo' })).res.status).toHaveBeenCalledWith(401)
  })

  it('cabeçalho Authorization que não é Bearer → 401 sem verificar', async () => {
    const { res } = await run({ authorization: 'Basic abc' })
    expect(res.status).toHaveBeenCalledWith(401)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('OIDC desligado (sem audience ou sem service accounts) falha fechado', async () => {
    verifyMock.mockResolvedValue(GOOD)
    envMock.JOBS_OIDC_AUDIENCE = ''
    expect((await run({ authorization: 'Bearer tok' })).res.status).toHaveBeenCalledWith(401)
    envMock.JOBS_OIDC_AUDIENCE = 'https://svc.example/jobs'
    envMock.JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS = []
    expect((await run({ authorization: 'Bearer tok' })).res.status).toHaveBeenCalledWith(401)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('não registra o bearer token em log', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    verifyMock.mockRejectedValue(new Error('boom'))
    await run({ authorization: 'Bearer SEGREDO-TOKEN-123' })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SEGREDO-TOKEN-123')
    spy.mockRestore()
  })
})
