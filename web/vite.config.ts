import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';

/* UI build number = server.py BUILD, so /api/version update checks line up. */
let BUILD = 0;
try { BUILD = Number((fs.readFileSync(path.resolve(__dirname, '../server.py'), 'utf8').match(/^BUILD\s*=\s*(\d+)/m) || [])[1] || 0); } catch {}

const backend = process.env.MUSE_BACKEND || 'http://127.0.0.1:8090';
const proxied = ['/api', '/covers', '/ytplayer.js', '/icons', '/sw.js', '/manifest.webmanifest',
  '/muselogo.png', '/favicon.png', '/favicon.ico', '/silence.wav', '/desktop', '/android', '/linux',
  '/privacy', '/gdpr', '/terms', '/cookies', '/dpa', '/subprocessors', '/sla', '/credits', '/dmca', '/badges'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __MUSE_BUILD__: JSON.stringify(BUILD) },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // Long-lived vendor chunk so app deploys keep the library cache (splitting React-dependent libs apart creates init-order cycles).
        manualChunks(id) { if (id.includes('node_modules')) return 'vendor'; }
      },
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: backend, changeOrigin: false }])),
  },
});
