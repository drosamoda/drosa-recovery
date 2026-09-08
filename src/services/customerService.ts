import { prisma } from '../config/prisma'
import { Customer } from '@prisma/client'

type UpsertParams = {
  name: string
  email?: string | null
  phone?: string | null
  normalizedPhone: string
  source?: string
}

export const customerService = {
  async upsertCustomer(params: UpsertParams): Promise<Customer> {
    const existing = await customerService.findByPhoneOrEmail({
      normalizedPhone: params.normalizedPhone,
      email: params.email ?? undefined,
    })

    if (existing) {
      return prisma.customer.update({
        where: { id: existing.id },
        data: {
          // Atualiza nome apenas se o novo for mais completo
          name: params.name.trim().length > existing.name.trim().length
            ? params.name
            : existing.name,
          email: params.email ?? existing.email,
          phone: params.phone ?? existing.phone,
          normalizedPhone: params.normalizedPhone,
          // Nunca sobrescreve opt_out=true automaticamente
        },
      })
    }

    return prisma.customer.create({
      data: {
        name: params.name,
        email: params.email ?? null,
        phone: params.phone ?? null,
        normalizedPhone: params.normalizedPhone,
        optOut: false,
        source: params.source ?? null,
      },
    })
  },

  async applyOptOutByPhone(normalizedPhone: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.suppression.upsert({
        where: { normalizedPhone },
        update: { reason: 'inbound_keyword', source: 'meta_webhook', suppressedAt: new Date() },
        create: { normalizedPhone, reason: 'inbound_keyword', source: 'meta_webhook' },
      })
      await tx.customer.updateMany({ where: { normalizedPhone }, data: { optOut: true } })
    })
  },

  async findByPhoneOrEmail(params: {
    normalizedPhone: string
    email?: string
  }): Promise<Customer | null> {
    // Prioridade: telefone normalizado
    const byPhone = await prisma.customer.findFirst({
      where: { normalizedPhone: params.normalizedPhone },
    })
    if (byPhone) return byPhone

    // Fallback: e-mail
    if (params.email) {
      return prisma.customer.findFirst({
        where: { email: params.email },
      })
    }

    return null
  },

  async isOptOut(normalizedPhone: string): Promise<boolean> {
    const [suppression, customer] = await Promise.all([
      prisma.suppression.findUnique({ where: { normalizedPhone }, select: { id: true } }),
      prisma.customer.findFirst({ where: { normalizedPhone }, select: { optOut: true } }),
    ])
    return Boolean(suppression || customer?.optOut)
  },
}
