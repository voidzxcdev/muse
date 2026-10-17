import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

/* The UI is Riff's (web/public/riff, MIT) plus Muse's bridge/social scripts (web/public/muse).
   Vite only copies them and stamps the build number (= server.py BUILD) into index.html,
   so /api/version update checks and ?v= cache busting line up. */
let BUILD = 0;
try { BUILD = Number((fs.readFileSync(path.resolve(__dirname, '../server.py'), 'utf8').match(/^BUILD\s*=\s*(\d+)/m) || [])[1] || 0); } catch {}

const stamp = (): Plugin => ({
  name: 'muse-build-stamp',
  transformIndexHtml: (html) => html.split('__MUSE_BUILD__').join(String(BUILD)),
});

const backend = process.env.MUSE_BACKEND || 'http://127.0.0.1:8090';
const proxied = ['/api', '/covers', '/icons', '/sw.js', '/manifest.webmanifest', '/muselogo.png', '/favicon.png',
  '/favicon.ico', '/silence.wav', '/desktop', '/android', '/linux', '/privacy', '/gdpr', '/terms', '/cookies',
  '/dpa', '/subprocessors', '/sla', '/credits', '/dmca', '/badges'];

export default defineConfig({
  plugins: [stamp()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2020' },
  server: { port: 5173, proxy: Object.fromEntries(proxied.map((p) => [p, { target: backend, changeOrigin: false }])) },
});
