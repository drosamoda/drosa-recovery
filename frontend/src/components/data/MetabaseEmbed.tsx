import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../../lib/api'
import { Notice } from '../feedback/Notice'
import { LoadingState } from '../feedback/LoadingState'

// Embed assinado do Metabase. O browser pede só o MÓDULO; o servidor decide o
// dashboard (allowlist) e assina a URL (a chave nunca chega aqui). A URL
// expira em 10 min e é renovada a cada 9. Metabase frio/indisponível ou não
// configurado vira aviso neutro — os indicadores nativos continuam na tela.
const COLD_TIMEOUT_MS = 20000

export function MetabaseEmbed({ module, title }: { module: string; title: string }) {
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const query = useQuery({
    queryKey: ['bi-embed', module],
    queryFn: ({ signal }) => apiGet<{ url: string; expiresAt: string }>(`bi/embed/${module}`, signal),
    refetchInterval: 9 * 60 * 1000,
    retry: false,
  })

  useEffect(() => {
    setLoaded(false)
    setSlow(false)
    if (!query.data) return
    const timer = setTimeout(() => setSlow(true), COLD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [query.data])

  if (query.isPending) return <LoadingState />
  if (query.isError) {
    const code = query.error instanceof ApiError ? query.error.code : null
    return (
      <Notice>
        Painel Metabase “{title}” indisponível neste ambiente{code ? <span className="text-ink-faint"> ({code})</span> : null}. Os indicadores acima vêm direto das views de BI.
      </Notice>
    )
  }
  return (
    <div className="rounded-card border border-ink-faint/15 bg-surface-raised">
      {!loaded && slow && <Notice>O Metabase pode estar iniciando (cold start). O painel aparece assim que responder.</Notice>}
      <iframe title={`Metabase — ${title}`} src={query.data.url} onLoad={() => setLoaded(true)} className="h-[70vh] w-full rounded-card" />
    </div>
  )
}
