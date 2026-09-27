import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base '/crm-next/' porque o Express serve o build estático nesse prefixo
// até o cutover (troca para '/crm-v2/' só acontece na hora do cutover, ver
// docs/handoff/REACT_MIGRATION_BLUEPRINT_2026-09-26.md secao 4).
export default defineConfig({
  plugins: [react()],
  base: '/crm-next/',
  server: {
    proxy: {
      // Alvo do proxy de /crm-api. VITE_BACKEND_URL (URL completa) tem
      // prioridade — usado para REAL_DATA_READONLY_VALIDATION apontando
      // direto para a API de producao ja protegida por x-crm-read-secret,
      // sem subir nenhum backend local (evita qualquer risco de cron/worker/
      // envio, ja que nenhum processo do drosa-recovery roda sob controle
      // deste dev server). Sem essa var, cai no default de dev local.
      '/crm-api': {
        target: process.env.VITE_BACKEND_URL || `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
