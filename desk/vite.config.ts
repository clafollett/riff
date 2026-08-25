import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // The gateway is a sibling container in the dev overlay, and localhost on
    // the host otherwise.
    proxy: { '/api': process.env['HELMSTED_API'] ?? 'http://localhost:4173' },
    // The container mounts the working tree from the host, where inotify does
    // not always cross the boundary. Polling is slower but it actually fires.
    watch: process.env['NODE_ENV'] === 'development' ? { usePolling: true, interval: 300 } : undefined,
  },
});
