// Retorna uma data no futuro com base em minutos de delay
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

// Retorna uma data no passado com base em horas
export function subtractHours(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 60 * 60 * 1000)
}

// Verifica se uma data já passou
export function isPast(date: Date): boolean {
  return date.getTime() <= Date.now()
}

// Formata data para log (ISO sem milissegundos)
export function formatForLog(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}
