import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { DashboardPage } from './routes/dashboard/DashboardPage'
import { CustomersPage } from './routes/customers/CustomersPage'
import { CustomerDetailPage } from './routes/customers/CustomerDetailPage'

// Base '/crm-next' enquanto o piloto nao substitui '/crm-v2' (ver
// REACT_MIGRATION_BLUEPRINT secao 4). Dashboard e Cliente 360 (+ Jornada)
// sao funcionais nesta rodada — as demais entram conforme o plano por tela
// (REACT_MIGRATION_BLUEPRINT secao 7).
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
    {
      path: '/customers',
      element: (
        <AppShell>
          <CustomersPage />
        </AppShell>
      ),
    },
    {
      path: '/customers/:id',
      element: (
        <AppShell>
          <CustomerDetailPage />
        </AppShell>
      ),
    },
  ],
  { basename: '/crm-next' },
)
