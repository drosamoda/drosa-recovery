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
      // Sessão única da Central (cookie httpOnly) — mesmo alvo do /crm-api.
      '/central-auth': {
        target: process.env.VITE_BACKEND_URL || `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // vendors estáveis em chunks próprios: cache do navegador sobrevive a deploys de UI
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/lib/__tests__/setup.ts'],
    globals: true,
    // pool 'forks' em vez do default 'threads': um teste com uma promise
    // verdadeiramente eterna (sem nenhuma forma de settle) derrubou um
    // worker de threads nesta rodada; processos separados isolam melhor
    // esse tipo de falha. A causa raiz de fundo foi outra e ja corrigida
    // nos proprios arquivos de teste (beforeEach(mockReset) + mock que
    // rejeita — ver CLIENTE_360_JOURNEY_MIGRATION_REPORT), entao nao foi
    // necessario nenhuma flag que desligue deteccao de erro do Vitest.
    pool: 'forks',
    // Estrategia de mocks: ver src/lib/__tests__/setup.ts.
    clearMocks: true,
  },
})
