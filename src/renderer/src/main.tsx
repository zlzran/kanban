import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App, { QuickInboxWindow } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('mode') === 'quick-inbox' ? <QuickInboxWindow /> : <App />}
  </StrictMode>
)
