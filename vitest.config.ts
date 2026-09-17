import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15000,
    // whatsapp-consent-checkout/ é um subprojeto independente (NubeSDK, seu
    // próprio vitest/tsconfig) — não faz parte do app Express principal.
    exclude: ['**/node_modules/**', 'whatsapp-consent-checkout/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'prisma', 'src/__tests__'],
    },
  },
})
