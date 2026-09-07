import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyStoredTheme } from './lib/theme'
import './styles.css'

// Before the first paint, so the panel never flashes the wrong theme.
applyStoredTheme()

const root = document.getElementById('root')
if (root === null) throw new Error('index.html is missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
