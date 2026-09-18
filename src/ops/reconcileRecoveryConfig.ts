import { Prisma, PrismaClient } from '@prisma/client'
import {
  canonicalAutomationRules,
  canonicalWhatsappTemplates,
  legacyBlockedTemplateNames,
} from '../config/recoveryCanonicalConfig'

const prisma = new PrismaClient()

type DriftItem = {
  kind: 'template' | 'rule' | 'legacy'
  id: string
  fields: string[]
}

function normalizeJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function templateDrift(
  current: {
    name: string
    eventType: string
    metaTemplateName: string
    languageCode: string
    category: string
    messagePreview: string
    variables: Prisma.JsonValue
    active: boolean
  } | null,
  expected: (typeof canonicalWhatsappTemplates)[number],
): string[] {
  if (!current) return ['missing']

  const fields: string[] = []
  if (current.name !== expected.name) fields.push('name')
  if (current.eventType !== expected.eventType) fields.push('eventType')
  if (current.metaTemplateName !== expected.metaTemplateName) fields.push('metaTemplateName')
  if (current.languageCode !== expected.languageCode) fields.push('languageCode')
  if (current.category !== expected.category) fields.push('category')
  if (current.messagePreview !== expected.messagePreview) fields.push('messagePreview')
  if (normalizeJson(current.variables) !== normalizeJson(expected.variables)) fields.push('variables')
  if (current.active !== expected.active) fields.push('active')
  return fields
}

function ruleDrift(
  current: {
    name: string
    eventType: string
    templateName: string
    delayMinutes: number
    active: boolean
    maxSendsPerEntity: number
    stopIfOrderExists: boolean
  } | null,
  expected: (typeof canonicalAutomationRules)[number],
): string[] {
  if (!current) return ['missing']

  const fields: string[] = []
  if (current.name !== expected.name) fields.push('name')
  if (current.eventType !== expected.eventType) fields.push('eventType')
  if (current.templateName !== expected.templateName) fields.push('templateName')
  if (current.delayMinutes !== expected.delayMinutes) fields.push('delayMinutes')
  if (current.active !== expected.active) fields.push('active')
  if (current.maxSendsPerEntity !== expected.maxSendsPerEntity) fields.push('maxSendsPerEntity')
  if (current.stopIfOrderExists !== expected.stopIfOrderExists) fields.push('stopIfOrderExists')
  return fields
}

export async function auditRecoveryConfig(client: PrismaClient = prisma): Promise<DriftItem[]> {
  const drift: DriftItem[] = []

  for (const expected of canonicalWhatsappTemplates) {
    const current = await client.whatsappTemplate.findUnique({
      where: { id: expected.id },
      select: {
        name: true,
        eventType: true,
        metaTemplateName: true,
        languageCode: true,
        category: true,
        messagePreview: true,
        variables: true,
        active: true,
      },
    })
    const fields = templateDrift(current, expected)
    if (fields.length > 0) drift.push({ kind: 'template', id: expected.id, fields })
  }

  for (const expected of canonicalAutomationRules) {
    const current = await client.automationRule.findUnique({
      where: { id: expected.id },
      select: {
        name: true,
        eventType: true,
        templateName: true,
        delayMinutes: true,
        active: true,
        maxSendsPerEntity: true,
        stopIfOrderExists: true,
      },
    })
    const fields = ruleDrift(current, expected)
    if (fields.length > 0) drift.push({ kind: 'rule', id: expected.id, fields })
  }

  for (const legacyName of legacyBlockedTemplateNames) {
    const [legacyTemplates, legacyRules] = await Promise.all([
      client.whatsappTemplate.count({
        where: { metaTemplateName: legacyName, active: true },
      }),
      client.automationRule.count({
        where: { templateName: legacyName, active: true },
      }),
    ])
    if (legacyTemplates > 0 || legacyRules > 0) {
      drift.push({
        kind: 'legacy',
        id: legacyName,
        fields: [
          ...(legacyTemplates > 0 ? ['activeTemplate'] : []),
          ...(legacyRules > 0 ? ['activeRule'] : []),
        ],
      })
    }
  }

  return drift
}

export async function applyRecoveryConfig(client: PrismaClient = prisma): Promise<void> {
  await client.$transaction(async (tx) => {
    for (const expected of canonicalWhatsappTemplates) {
      const data = {
        name: expected.name,
        eventType: expected.eventType,
        metaTemplateName: expected.metaTemplateName,
        languageCode: expected.languageCode,
        category: expected.category,
        messagePreview: expected.messagePreview,
        variables: expected.variables,
        active: expected.active,
      }

      await tx.whatsappTemplate.upsert({
        where: { id: expected.id },
        update: data,
        create: { id: expected.id, ...data },
      })
    }

    for (const expected of canonicalAutomationRules) {
      const data = {
        name: expected.name,
        eventType: expected.eventType,
        templateName: expected.templateName,
        delayMinutes: expected.delayMinutes,
        active: expected.active,
        maxSendsPerEntity: expected.maxSendsPerEntity,
        stopIfOrderExists: expected.stopIfOrderExists,
      }

      await tx.automationRule.upsert({
        where: { id: expected.id },
        update: data,
        create: { id: expected.id, ...data },
      })
    }

    for (const legacyName of legacyBlockedTemplateNames) {
      await tx.whatsappTemplate.updateMany({
        where: { metaTemplateName: legacyName },
        data: { active: false },
      })
      await tx.automationRule.updateMany({
        where: { templateName: legacyName },
        data: { active: false },
      })
    }
  })
}

async function main() {
  const apply = process.argv.includes('--apply')
  const before = await auditRecoveryConfig()

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'verify',
    driftCount: before.length,
    drift: before,
  }, null, 2))

  if (!apply) {
    if (before.length > 0) process.exitCode = 2
    return
  }

  await applyRecoveryConfig()
  const after = await auditRecoveryConfig()
  console.log(JSON.stringify({
    mode: 'post_apply_verify',
    driftCount: after.length,
    drift: after,
  }, null, 2))

  if (after.length > 0) process.exitCode = 2
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[reconcileRecoveryConfig] failed', error instanceof Error ? error.message : 'unknown_error')
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
