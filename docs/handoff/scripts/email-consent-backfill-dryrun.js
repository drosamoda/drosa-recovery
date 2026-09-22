'use strict'
// DRY-RUN READ ONLY do backfill de consentimento de e-mail. Nao grava nada.
// Requer autorizacao explicita do usuario para usar a role de leitura `crm_preview_reader`.
//
// - A URL do banco e lida de .env.preview.local SO EM MEMORIA (nunca impressa, nunca copiada).
// - O job roda em modo CRM_PREVIEW_READONLY (definido no processo) e toda leitura ocorre em
//   transacao `SET TRANSACTION READ ONLY`.
// - Saida: somente agregados.
//
// Uso (cwd = qualquer pasta SEM arquivo .env, para o dotenv nao carregar nada):
//   node <repo>/node_modules/ts-node/dist/bin.js --transpile-only --project <repo>/tsconfig.json <este arquivo>
const fs = require('fs')
const REPO = 'C:/Users/peter/OneDrive/Peter/particular/Documentos/desafio pai e filho/drosa-recovery-crm-ops'

function redact(msg) {
  return String(msg)
    .replace(/postgres(ql)?:\/\/\S+/gi, '<db-url>')
    .replace(/\S*(supabase|pooler)\S*/gi, '<host>')
    .split('\n').slice(-1)[0].slice(0, 200)
}

async function main() {
  const text = fs.readFileSync(`${REPO}/.env.preview.local`, 'utf8')
  const pick = (key) => {
    const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^"|"$/g, '') : null
  }
  const candidates = [pick('DIRECT_URL'), pick('DATABASE_URL')].filter(Boolean)
  if (candidates.length === 0) { console.log('DB_URL=AUSENTE'); process.exit(2) }

  process.env.CRM_PREVIEW_READONLY = 'true'
  process.env.CRM_READ_SECRET = 'dryrun-nao-e-segredo'

  let lastErr = 'sem_tentativa'
  for (const url of candidates) {
    process.env.DATABASE_URL = url
    process.env.DIRECT_URL = url
    // Cada tentativa precisa de um modulo novo (prisma/env sao singletons).
    for (const key of Object.keys(require.cache)) {
      if (key.replace(/\\/g, '/').startsWith(`${REPO}/src/`)) delete require.cache[key]
    }
    try {
      const { runBackfillEmailConsent } = require(`${REPO}/src/jobs/backfillEmailConsent`)
      const { prisma } = require(`${REPO}/src/config/prisma`)
      try {
        const result = await runBackfillEmailConsent({ dryRun: true })
        console.log('RESULT_JSON=' + JSON.stringify(result))
        await prisma.$disconnect()
        return
      } finally {
        await prisma.$disconnect().catch(() => undefined)
      }
    } catch (e) {
      lastErr = redact(e && e.message)
    }
  }
  console.log('DRYRUN_ERROR=' + lastErr)
  process.exit(1)
}

main().catch((e) => { console.log('ERRO_INESPERADO=' + redact(e && e.message)); process.exit(1) })
