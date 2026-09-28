import { Activity, BarChart3, HeartPulse, LayoutDashboard, MessageSquareText, MessagesSquare, RefreshCcw, Sparkles, Users, type LucideIcon } from 'lucide-react'

export interface NavItem {
  key: string
  label: string
  to: string
  icon: LucideIcon
  description: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      { key: 'dashboard', label: 'Command Center', to: '/', icon: LayoutDashboard, description: 'Visão geral da operação' },
      { key: 'messages', label: 'Mensagens', to: '/messages', icon: MessageSquareText, description: 'Disparos, entregas e falhas' },
      { key: 'conversations', label: 'Conversas', to: '/conversations', icon: MessagesSquare, description: 'Inbox operacional' },
      { key: 'recovery', label: 'Recovery', to: '/recovery', icon: RefreshCcw, description: 'Carrinho, PIX, boleto e remarketing' },
    ],
  },
  {
    label: 'Clientes',
    items: [{ key: 'customers', label: 'Cliente 360', to: '/customers', icon: Users, description: 'Perfil, jornada e privacidade' }],
  },
  {
    label: 'Inteligência',
    items: [
      { key: 'campaigns', label: 'Campanhas & IA', to: '/campaigns', icon: Sparkles, description: 'Oportunidades, e-mail e automações' },
      { key: 'bi', label: 'BI & Inteligência', to: '/bi', icon: BarChart3, description: 'Analytics nativo + Metabase' },
    ],
  },
  {
    label: 'Sistema',
    items: [{ key: 'health', label: 'Saúde', to: '/health', icon: HeartPulse, description: 'Integrações, filas e auditoria' }],
  },
]

export const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

export function navForPath(pathname: string): NavItem | undefined {
  if (pathname === '/' || pathname === '') return ALL_NAV[0]
  return ALL_NAV.filter((i) => i.to !== '/').find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
}

export const PULSE_ICON = Activity
