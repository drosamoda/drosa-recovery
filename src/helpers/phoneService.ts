const VALID_LENGTHS = [12, 13] // 55 + 10 ou 55 + 11 dígitos
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74,
  75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94,
  95, 96, 97, 98, 99,
])

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
    if (!isValidBrazilianPhone(cleaned)) return null
    return cleaned
  }

  // Se tem 10 ou 11 dígitos nacionais, adiciona 55
  if (cleaned.length === 10 || cleaned.length === 11) {
    const withCode = `55${cleaned}`
    if (!isValidBrazilianPhone(withCode)) return null
    return withCode
  }

  return null
}

export function isValidBrazilianPhone(phone: string): boolean {
  if (!/^55\d{10,11}$/.test(phone)) return false
  // Deve ter 12 ou 13 dígitos totais (55 + DDD + número)
  if (!VALID_LENGTHS.includes(phone.length)) return false

  // Deve começar com 55
  if (!phone.startsWith('55')) return false

  const ddd = phone.slice(2, 4)
  const number = phone.slice(4)

  // DDD deve ser numérico e entre 11 e 99
  const dddNum = parseInt(ddd, 10)
  if (isNaN(dddNum) || !VALID_DDDS.has(dddNum)) return false

  // Celulares com 9 dígitos devem começar com 9
  if (number.length === 9 && !number.startsWith('9')) return false

  if (/^(\d)\1+$/.test(number)) return false

  return true
}
