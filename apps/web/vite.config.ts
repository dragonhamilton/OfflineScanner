import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The Fastify server handles the API and the stored images.
    proxy: {
      '/api': server,
      '/files': server,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
