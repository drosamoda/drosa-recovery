import { createContext, useContext } from 'react'
import type { SessionInfo } from '../../lib/session'

export type Access = { kind: 'checking' } | { kind: 'legacy' } | { kind: 'session'; me: SessionInfo } | { kind: 'login'; allowLegacy: true } | { kind: 'legacy-form' }

export interface AuthContextValue {
  access: Access
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({ access: { kind: 'checking' }, signOut: async () => undefined })

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

