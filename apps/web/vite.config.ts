import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // SSE stream is a long-lived HTTP connection; prevent proxy timeout churn.
      '/api/v1/events/stream': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: false,
        timeout: 0,
        proxyTimeout: 0,
      },
      // Proxy API requests to the backend — same origin = no CORS/cookie issues
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ready': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Zitavi EMR Gateway (patient mobile app data)
      '/emr': {
        target: 'http://localhost:4002',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
});
