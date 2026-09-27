import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Sem isso, componentes de um teste (inclusive promises pendentes de
// react-query) vazam para o proximo teste no mesmo worker — foi a causa raiz
// de um crash real do worker do Vitest nesta rodada (nao um simples timeout).
afterEach(() => {
  cleanup()
})

// ESTRATEGIA DE MOCKS (obrigatoria para todo teste novo):
// - clearMocks: true (vite.config.ts) limpa apenas chamadas/resultados entre
//   testes; NAO use beforeEach(mockReset) nem mockReset global — combinado com
//   um mockImplementation que rejeita, foi a causa raiz de falso-negativo e
//   crash do worker nesta base.
// - Cada teste configura o proprio mockResolvedValue/mockRejectedValue DENTRO
//   do it(), nunca em beforeEach compartilhado.
// - Nao aumentar timeout para esconder worker travado: promise pendente deve
//   ter resolve acessivel e o teste deve dar unmount().
