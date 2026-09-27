import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { DashboardPage } from './routes/dashboard/DashboardPage'
import { CustomersPage } from './routes/customers/CustomersPage'
import { CustomerDetailPage } from './routes/customers/CustomerDetailPage'
import { MessagesPage } from './routes/messages/MessagesPage'
import { ConversationsPage } from './routes/conversations/ConversationsPage'

// Base '/crm-next' enquanto o piloto nao substitui '/crm-v2' (ver
// REACT_MIGRATION_BLUEPRINT secao 4). Toda rota e somente leitura.
const pages: { path: string; element: ReactNode }[] = [
  { path: '/', element: <DashboardPage /> },
  { path: '/customers', element: <CustomersPage /> },
  { path: '/customers/:id', element: <CustomerDetailPage /> },
  { path: '/messages', element: <MessagesPage /> },
  { path: '/conversations', element: <ConversationsPage /> },
]

export const router = createBrowserRouter(
  pages.map(({ path, element }) => ({ path, element: <AppShell>{element}</AppShell> })),
  { basename: '/crm-next' },
)
