const VALID_LENGTHS = [12, 13] // 55 + 10 ou 55 + 11 dígitos

export function normalizePhoneBrazil(phone: string | null | undefined): string | null {
  if (!phone) return null

  // Remove todos os caracteres não numéricos exceto o +
  let cleaned = phone.replace(/[\s\(\)\-\.]/g, '')

  // Remove o + se existir
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1)
  }

  // Remove zeros à esquerda espúrios (ex: 0031...)
  cleaned = cleaned.replace(/^0+/, '')

  // Se já começa com 55 e tem comprimento válido, retorna direto
  if (cleaned.startsWith('55') && VALID_LENGTHS.includes(cleaned.length)) {
    if (!isValidBrazilianNumber(cleaned)) return null
    return cleaned
  }

  // Se tem 10 ou 11 dígitos nacionais, adiciona 55
  if (cleaned.length === 10 || cleaned.length === 11) {
    const withCode = `55${cleaned}`
    if (!isValidBrazilianNumber(withCode)) return null
    return withCode
  }

  return null
}

function isValidBrazilianNumber(phone: string): boolean {
  // Deve ter 12 ou 13 dígitos totais (55 + DDD + número)
  if (!VALID_LENGTHS.includes(phone.length)) return false

  // Deve começar com 55
  if (!phone.startsWith('55')) return false

  const ddd = phone.slice(2, 4)
  const number = phone.slice(4)

  // DDD deve ser numérico e entre 11 e 99
  const dddNum = parseInt(ddd, 10)
  if (isNaN(dddNum) || dddNum < 11 || dddNum > 99) return false

  // Celulares com 9 dígitos devem começar com 9
  if (number.length === 9 && !number.startsWith('9')) return false

  return true
}
