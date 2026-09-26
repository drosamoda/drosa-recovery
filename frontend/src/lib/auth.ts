// Mesmo esquema de hoje (public/crm-v2/app.js): segredo de leitura digitado
// uma vez, guardado so em sessionStorage (nunca localStorage, nunca cookie
// nesta fase). Consolidacao de auth de verdade e trabalho de outra fase —
// ver secao 6 (AUTH_TARGET_STATE) do REACT_MIGRATION_BLUEPRINT.
const STORAGE_KEY = 'crmNextSecret'

export function getStoredSecret(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setStoredSecret(secret: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, secret)
  } catch {
    // sessionStorage indisponivel (modo privado, etc.) — sessao so dura o load atual
  }
}

export function clearStoredSecret(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // idem
  }
}
