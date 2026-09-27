import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './design-tokens.css'

// retry:false (em vez do default de 1 retry): durante o smoke test, o retry
// automatico do TanStack Query v5 ficou preso em fetchStatus='paused'
// indefinidamente entre a 1a falha e a tentativa seguinte, mesmo com
// networkMode:'always' (nao foi possivel confirmar a causa exata sem
// devtools — ver FOUNDATION_INTEGRATION_REPORT). Cada tela ja tem um botao
// manual "Tentar de novo" (refetch()), que e mais previsivel que confiar em
// retry automatico contra um backend que pode estar genuinamente fora do ar.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
