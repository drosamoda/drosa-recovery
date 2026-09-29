import { describe, expect, it } from 'vitest'
import { transactionalPaymentReason, PAYMENT_PENDING_TEMPLATES } from '../../services/transactionalMessageValidity'

const order = (o: Partial<{ status: string; paymentStatus: string; paymentMethod: string | null }>) => ({ status: 'open', paymentStatus: 'pending', paymentMethod: 'pix', ...o })

describe('transactionalPaymentReason', () => {
  it('só se aplica a templates de pagamento pendente', () => {
    expect(PAYMENT_PENDING_TEMPLATES).toEqual(['_pix_pendente', 'pedido_boleto_drosa_01', 'boleto_vencendo_drosa_v2'])
    expect(transactionalPaymentReason('confirmacao_pedido_drosa', order({ paymentStatus: 'paid' }))).toBeNull()
  })
  it('pendente e não cancelado → envia', () => {
    expect(transactionalPaymentReason('_pix_pendente', order({}))).toBeNull()
    expect(transactionalPaymentReason('pedido_boleto_drosa_01', order({ paymentMethod: 'boleto' }))).toBeNull()
  })
  it('pago → payment_already_completed', () => {
    expect(transactionalPaymentReason('_pix_pendente', order({ paymentStatus: 'paid' }))).toBe('payment_already_completed')
  })
  it('cancelado/estornado → order_cancelled', () => {
    for (const status of ['cancelled', 'canceled', 'refunded']) expect(transactionalPaymentReason('boleto_vencendo_drosa_v2', order({ status }))).toBe('order_cancelled')
  })
})
