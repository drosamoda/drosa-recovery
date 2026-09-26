import { RouterProvider } from 'react-router-dom'
import { ConnectGate } from './components/shell/ConnectGate'
import { router } from './router'

export default function App() {
  return (
    <ConnectGate>
      <RouterProvider router={router} />
    </ConnectGate>
  )
}
