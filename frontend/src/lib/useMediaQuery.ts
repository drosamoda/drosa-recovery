import { useEffect, useState } from 'react'

// Sem matchMedia (jsdom/testes) assume desktop: a tabela completa é a
// renderização canônica e a versão em cards é só adaptação de layout.
export function useMediaQuery(query: string, fallback = false): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export const useIsMobile = (): boolean => useMediaQuery('(max-width: 767px)')
