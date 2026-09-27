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
      // Porta real do backend local (mesma variavel PORT do .env do backend,
      // default 3000 conforme package.json/env.ts). Sobrescreva com
      // VITE_BACKEND_PORT quando o backend estiver rodando em outra porta
      // (ex.: para evitar conflito com outro projeto na mesma maquina).
      '/crm-api': `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
