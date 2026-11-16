import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter as Router } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'
import { ThemedToaster } from './components/ThemedToaster.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import { queryClient } from './lib/queryClient.ts'
import { registerAppServiceWorker } from './pwa/serviceWorker.ts'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* framer-motion animations follow the device's "reduce motion" setting */}
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <QueryClientProvider client={queryClient}>
            <Router>
              <AuthProvider>
                <App />
              </AuthProvider>
            </Router>
            <ThemedToaster />
          </QueryClientProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MotionConfig>
  </React.StrictMode>,
)

// After load, so it never competes with the first render.
window.addEventListener('load', () => { void registerAppServiceWorker(); })
