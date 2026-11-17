import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Changes every build; versions the service worker URL (see src/pwa/serviceWorker.ts).
  define: { __APP_BUILD__: JSON.stringify(Date.now().toString(36)) },
  server: {
    port: 3030,
  },
  // base: '/admin/',
})
