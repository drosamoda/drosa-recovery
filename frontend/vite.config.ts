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
      '/crm-api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
