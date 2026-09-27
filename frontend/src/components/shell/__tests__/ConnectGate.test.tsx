import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectGate } from '../ConnectGate'
import { Topbar } from '../Topbar'
import { setStoredSecret, clearStoredSecret } from '../../../lib/auth'

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const App = () => (
  <ConnectGate>
    <Topbar onMenuClick={() => undefined} />
    <p>conteudo protegido</p>
  </ConnectGate>
)

describe('ConnectGate — sessão única + legado', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearStoredSecret()
    localStorage.clear()
  })

  it('segredo legado já informado entra direto, sem consultar /central-auth (rollback intacto)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setStoredSecret('segredo-legado')
    render(<App />)
    expect(screen.getByText('conteudo protegido')).toBeInTheDocument()
    expect(screen.getByText('Segredo de leitura (legado)')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cookie de sessão válido entra e mostra e-mail/papel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { email: 'peter@example.test', role: 'admin', expiresAt: '' })))
    render(<App />)
    expect(await screen.findByText('conteudo protegido')).toBeInTheDocument()
    expect(screen.getByText('peter@example.test · admin')).toBeInTheDocument()
  })

  it('backend sem sessão (404) cai no formulário legado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404)))
    render(<App />)
    expect(await screen.findByLabelText('Segredo de leitura')).toBeInTheDocument()
  })

  it('sessão ligada sem cookie: login com JSON, sem gravar nada em localStorage', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/central-auth/me') return Promise.resolve(jsonResponse(401))
      if (url === '/central-auth/login') {
        expect(init?.method).toBe('POST')
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
        return Promise.resolve(jsonResponse(200, { email: 'leitor@example.test', role: 'read', expiresAt: '' }))
      }
      return Promise.resolve(jsonResponse(500))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await userEvent.type(await screen.findByLabelText('E-mail'), 'leitor@example.test')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('leitor@example.test · leitura')).toBeInTheDocument()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.getItem('crmNextSecret')).toBeNull()
  })

  it('login com 429 mostra mensagem de bloqueio', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url === '/central-auth/me' ? jsonResponse(401) : jsonResponse(429, { code: 'LOGIN_RATE_LIMITED' }))))
    render(<App />)
    await userEvent.type(await screen.findByLabelText('E-mail'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Senha'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Muitas tentativas/)
  })

  it('sair na sessão chama POST /central-auth/logout e volta ao login', async () => {
    let loggedIn = true
    const fetchMock = vi.fn((url: string) => {
      if (url === '/central-auth/me') return Promise.resolve(loggedIn ? jsonResponse(200, { email: 'p@x.test', role: 'read', expiresAt: '' }) : jsonResponse(401))
      if (url === '/central-auth/logout') {
        loggedIn = false
        return Promise.resolve(jsonResponse(200, { ok: true }))
      }
      return Promise.resolve(jsonResponse(500))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/central-auth/logout', expect.objectContaining({ method: 'POST' })))
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  })
})
