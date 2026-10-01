import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // In development the API is reached same-origin through this proxy, so no CORS is involved.
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000' },
  },
});
