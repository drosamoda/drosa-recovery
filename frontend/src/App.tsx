import { RouterProvider } from 'react-router-dom'
import { ConnectGate } from './components/shell/ConnectGate'
import { PeriodProvider } from './components/navigation/PeriodProvider'
import { router } from './router'

export default function App() {
  return (
    <ConnectGate>
      <PeriodProvider>
        <RouterProvider router={router} />
      </PeriodProvider>
    </ConnectGate>
  )
}
