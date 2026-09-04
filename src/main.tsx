import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setupMonaco } from './lib/monacoSetup'
import App from './App'
import './styles/global.css'

setupMonaco()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
