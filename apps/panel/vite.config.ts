import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * The panel is an ordinary Vite app. In the container it is built and served by
 * the server on one port; in development it runs here and proxies `/api` to the
 * server, so the code the panel runs is the same in both -- it always calls
 * relative `/api` URLs and never knows where the server is.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['INGOT_SERVER_URL'] ?? 'http://localhost:4310',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
