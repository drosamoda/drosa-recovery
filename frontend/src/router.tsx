import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { LoadingState } from './components/feedback/LoadingState'
import { RouteError } from './components/feedback/RouteError'

// Code splitting por rota (medido: bundle único passava de 800 kB com os
// gráficos). Cada página baixa só quando visitada.
// Após um deploy, uma aba aberta pede chunks com hash antigo (404). Recarrega
// UMA vez para pegar o index novo; se falhar de novo, cai no RouteError.
const RELOAD_KEY = 'central.chunkReloadAt'
function page<K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() =>
    loader()
      .then((m) => ({ default: m[name] }))
      .catch((err: unknown) => {
        let last = 0
        try {
          last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
          if (Date.now() - last > 30_000) {
            sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
            window.location.reload()
            return new Promise<never>(() => undefined)
          }
        } catch {
          // sem sessionStorage: segue para o RouteError
        }
        throw err
      }),
  )
}

const DashboardPage = page(() => import('./routes/dashboard/DashboardPage'), 'DashboardPage')
const CustomersPage = page(() => import('./routes/customers/CustomersPage'), 'CustomersPage')
const CustomerDetailPage = page(() => import('./routes/customers/CustomerDetailPage'), 'CustomerDetailPage')
const MessagesPage = page(() => import('./routes/messages/MessagesPage'), 'MessagesPage')
const ConversationsPage = page(() => import('./routes/conversations/ConversationsPage'), 'ConversationsPage')
const RecoveryPage = page(() => import('./routes/recovery/RecoveryPage'), 'RecoveryPage')
const CampaignsPage = page(() => import('./routes/campaigns/CampaignsPage'), 'CampaignsPage')
const HealthPage = page(() => import('./routes/health/HealthPage'), 'HealthPage')
const BiPage = page(() => import('./routes/bi/BiPage'), 'BiPage')

// Toda rota é somente leitura.
const pages: { path: string; element: ReactNode }[] = [
  { path: '/', element: <DashboardPage /> },
  { path: '/customers', element: <CustomersPage /> },
  { path: '/customers/:id', element: <CustomerDetailPage /> },
  { path: '/messages', element: <MessagesPage /> },
  { path: '/conversations', element: <ConversationsPage /> },
  { path: '/recovery', element: <RecoveryPage /> },
  { path: '/campaigns', element: <CampaignsPage /> },
  { path: '/health', element: <HealthPage /> },
  { path: '/bi', element: <BiPage /> },
]

export const router = createBrowserRouter(
  pages.map(({ path, element }) => ({
    path,
    errorElement: <RouteError />,
    element: (
      <AppShell>
        <Suspense fallback={<LoadingState variant="kpis" />}>{element}</Suspense>
      </AppShell>
    ),
  })),
  { basename: '/crm-next' },
)
