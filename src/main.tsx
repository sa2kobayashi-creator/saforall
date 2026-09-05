import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setupMonaco } from './lib/monacoSetup'
import { LocaleProvider } from './i18n'
import App from './App'
import './styles/global.css'

setupMonaco()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>
)
