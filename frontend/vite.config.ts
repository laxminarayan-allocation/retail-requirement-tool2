import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    // Escape non-ASCII chars to \uXXXX so charset doesn't affect rendering
    modulePreload: false,
    rollupOptions: {
      output: {
        generatedCode: { symbols: false },
      },
    },
    minify: 'esbuild',
  },
  esbuild: {
    charset: 'ascii',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api/pipeline/stream': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache'
            proxyRes.headers['x-accel-buffering'] = 'no'
          })
        },
      },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
    },
  },
})
