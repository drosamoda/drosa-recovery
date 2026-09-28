import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PeriodProvider } from '../../components/navigation/PeriodProvider'

// retry:false em todo teste — sem isso, um teste de erro (401/500) ficaria
// preso tentando de novo antes do assert rodar.
export function renderWithProviders(ui: ReactElement, { route = '/', path = '/' }: { route?: string; path?: string } = {}) {
  // QueryCache com onError no-op: sem isso, uma query que falha em teste
  // (401/500) deixa uma rejeicao sem handler observada a tempo pelo Node,
  // que o Vitest reporta como falha do teste (nao um assertion real) — foi a
  // causa de um crash de worker nesta rodada. onError aqui so evita o barulho
  // de log/telemetria do react-query em teste, nao afeta isError/error do
  // componente, que continuam normais.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    queryCache: new QueryCache({ onError: () => undefined }),
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PeriodProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        </MemoryRouter>
      </PeriodProvider>
    </QueryClientProvider>,
  )
}
