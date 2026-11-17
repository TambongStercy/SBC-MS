import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit tests (lib, navigation, small components) in a simulated browser.
export default defineConfig({
  plugins: [react()],
  define: { __APP_BUILD__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
