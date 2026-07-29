import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { I18nProvider } from './i18n'
import './styles/tokens.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* reducedMotion="user" makes framer-motion honour the OS setting: transform
        and layout animations snap to their end state while opacity still fades,
        so the game stays readable without motion. CSS transitions are disabled
        alongside it in tokens.css. */}
    <MotionConfig reducedMotion="user">
      <I18nProvider>
        <App />
      </I18nProvider>
    </MotionConfig>
  </React.StrictMode>
)
