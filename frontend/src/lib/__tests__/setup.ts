import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Sem isso, componentes de um teste (inclusive promises pendentes de
// react-query) vazam para o proximo teste no mesmo worker — foi a causa raiz
// de um crash real do worker do Vitest nesta rodada (nao um simples timeout).
afterEach(() => {
  cleanup()
})
