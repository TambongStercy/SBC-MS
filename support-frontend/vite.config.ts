import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server on 3040; /api goes to the local gateway so the app and the API
// share one origin, as in production (nginx proxies /api/ to the gateway).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3040,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: {
    // No inline scripts or data-URI module preloads: the page runs under a strict CSP.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
