import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@finledger/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  plugins: [react(), tailwind()],
  server: {
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000' },
  },
});
