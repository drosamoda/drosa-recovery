import { render, screen } from '@testing-library/react'
import { Timeline } from '../Timeline'
import type { JourneyEvent } from '../../../lib/types'

describe('Timeline', () => {
  it('mostra empty state quando nao ha eventos', () => {
    render(<Timeline events={[]} />)
    expect(screen.getByText('Nenhum evento com fonte disponivel.')).toBeInTheDocument()
  })

  it('renderiza cada evento so com dados que a API forneceu, sem inventar causa', () => {
    const events: JourneyEvent[] = [
      { type: 'ORDER_CREATED', at: '2026-01-01T10:00:00Z', source: 'nuvemshop', reference: '1001', status: 'confirmed' },
      { type: 'WHATSAPP_FAILED', at: null, source: 'message_logs', reference: 'log-1', status: 'failed' },
    ]
    render(<Timeline events={events} />)
    expect(screen.getByText('Pedido criado')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp falhou')).toBeInTheDocument()
    // Sem horario comprovado deve aparecer como tal, nunca uma data inventada.
    expect(screen.getByText('Sem horario comprovado')).toBeInTheDocument()
  })

  it('tipo de evento desconhecido cai no fallback (mostra o valor cru) em vez de quebrar', () => {
    const events: JourneyEvent[] = [{ type: 'NOVO_TIPO_FUTURO', at: null, source: 'x', reference: null, status: null }]
    render(<Timeline events={events} />)
    expect(screen.getByText('NOVO_TIPO_FUTURO')).toBeInTheDocument()
  })
})
