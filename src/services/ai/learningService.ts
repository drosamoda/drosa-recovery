import { prisma } from '../../config/prisma'
import { env } from '../../config/env'

// Sem MessageLog.campaignDraftId (não existe ainda — adicioná-lo exigiria
// alterar uma tabela real em produção, fora do escopo desta fase), não há
// como atribuir sent/delivered/read/replies/pedidos a uma campanha
// específica. E como REAL_SEND_ENABLED=false nesta fase, nenhuma campanha
// gerada aqui jamais dispara envio real — então essas métricas são
// genuinamente inexistentes ainda, não "zero por falta de tracking".
export async function getLearningSummary() {
  const [byStatus] = await Promise.all([
    prisma.campaignDraft.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  return {
    metricsAvailable: false,
    whatsappDryRun: env.WHATSAPP_DRY_RUN,
    reason: env.WHATSAPP_DRY_RUN
      ? 'WHATSAPP_DRY_RUN=true nesta fase — nenhuma campanha executa envio real, então sent/delivered/read/replies/pedidos após exposição ainda não existem para medir.'
      : 'Envio real habilitado, mas sem MessageLog.campaignDraftId ainda não é possível atribuir métricas a uma campanha específica.',
    campaignsByStatus: Object.fromEntries(byStatus.map(row => [row.status, row._count._all])),
    note: 'Quando o envio real for habilitado em uma fase futura, cada MessageLog precisará referenciar o campaignDraft de origem para permitir "pedidos após exposição" — nunca "receita gerada pela campanha" sem um modelo de atribuição explícito.',
  }
}
