export function runtimeDatabaseUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return value

  const sessionPoolerPattern = /(\.pooler\.supabase\.com):5432\//
  if (!sessionPoolerPattern.test(value)) return value

  const transformed = value.replace(sessionPoolerPattern, '$1:6543/')
  const separatorIndex = transformed.indexOf('?')
  const base = separatorIndex >= 0 ? transformed.slice(0, separatorIndex) : transformed
  const query = separatorIndex >= 0 ? transformed.slice(separatorIndex + 1) : ''
  const params = new URLSearchParams(query)

  if (!params.has('pgbouncer')) params.set('pgbouncer', 'true')
  if (!params.has('connection_limit')) params.set('connection_limit', '1')

  return `${base}?${params.toString()}`
}
