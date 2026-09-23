import { prisma } from '../config/prisma'
import { Customer, Prisma } from '@prisma/client'

type UpsertParams = {
  name: string
  email?: string | null
  phone?: string | null
  normalizedPhone: string
  source?: string
}

// This removes duplicate work in one process. PostgreSQL keeps the same
// guarantee across concurrent Cloud Run instances.
const inFlightUpserts = new Map<string, Promise<Customer>>()

function customerLockKey(params: UpsertParams): string {
  return params.normalizedPhone || `email:${params.email?.trim().toLowerCase() ?? 'unknown'}`
}

async function persistCustomer(params: UpsertParams): Promise<Customer> {
  const lockKey = customerLockKey(params)

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`)

    const byPhone = params.normalizedPhone
      ? await tx.customer.findFirst({ where: { normalizedPhone: params.normalizedPhone } })
      : null
    const existing = byPhone ?? (params.email
      ? await tx.customer.findFirst({ where: { email: params.email } })
      : null)

    if (existing) {
      return tx.customer.update({
        where: { id: existing.id },
        data: {
          name: params.name.trim().length > existing.name.trim().length
            ? params.name
            : existing.name,
          email: params.email ?? existing.email,
          phone: params.phone ?? existing.phone,
          normalizedPhone: params.normalizedPhone,
        },
      })
    }

    return tx.customer.create({
      data: {
        name: params.name,
        email: params.email ?? null,
        phone: params.phone ?? null,
        normalizedPhone: params.normalizedPhone,
        optOut: false,
        source: params.source ?? null,
      },
    })
  }, { maxWait: 10_000, timeout: 15_000 })
}

export const customerService = {
  async upsertCustomer(params: UpsertParams): Promise<Customer> {
    const lockKey = customerLockKey(params)
    const inFlight = inFlightUpserts.get(lockKey)
    if (inFlight) return inFlight

    const work = persistCustomer(params)
    inFlightUpserts.set(lockKey, work)
    try {
      return await work
    } finally {
      if (inFlightUpserts.get(lockKey) === work) inFlightUpserts.delete(lockKey)
    }
  },

  async applyOptOutByPhone(normalizedPhone: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.suppression.upsert({
        where: { normalizedPhone },
        update: { reason: 'inbound_keyword', source: 'meta_webhook', suppressedAt: new Date() },
        create: { normalizedPhone, reason: 'inbound_keyword', source: 'meta_webhook' },
      })
      await tx.customer.updateMany({ where: { normalizedPhone }, data: { optOut: true } })
    }, { maxWait: 10_000, timeout: 15_000 })
  },

  async findByPhoneOrEmail(params: {
    normalizedPhone: string
    email?: string
  }): Promise<Customer | null> {
    const byPhone = await prisma.customer.findFirst({
      where: { normalizedPhone: params.normalizedPhone },
    })
    if (byPhone) return byPhone

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
