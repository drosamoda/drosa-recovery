import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { DashboardPage } from './routes/dashboard/DashboardPage'

// Base '/crm-next' enquanto o piloto nao substitui '/crm-v2' (ver
// REACT_MIGRATION_BLUEPRINT secao 4). So a rota de Dashboard e funcional
// nesta rodada — as demais entram conforme o plano por tela (secao 7).
export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: (
        <AppShell>
          <DashboardPage />
        </AppShell>
      ),
    },
  ],
  { basename: '/crm-next' },
)
