import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// App version shown on the login screen: bump "version" in package.json with every update (0.x until production).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// `npm run dev` serves the app on :5173 and proxies /api and /media to `wrangler dev` on :8787.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { outDir: 'dist', sourcemap: true },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/media': 'http://localhost:8787',
    },
  },
});
