import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.WEB_PORT ?? process.env.VITE_PORT ?? '5173';
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';
const apiPort = process.env.API_PORT ?? '8080';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');

/** Forward the browser host to the API so Discord OAuth uses the Vite port (5173/4173), not 8080. */
function apiProxyOptions() {
  return {
    target: `http://127.0.0.1:${apiPort}`,
    changeOrigin: true,
    timeout: 120_000,
    proxyTimeout: 120_000,
    configure: (proxy: { on: (event: string, fn: (...args: unknown[]) => void) => void }) => {
      proxy.on('proxyReq', (proxyReq: { setHeader: (name: string, value: string) => void }, req: { headers: { host?: string } }) => {
        const browserHost = req.headers.host;
        if (browserHost) {
          proxyReq.setHeader('x-forwarded-host', browserHost);
          proxyReq.setHeader('x-forwarded-proto', 'http');
        }
      });
    },
  };
}

export default defineConfig({
  envDir: workspaceRoot,
  base: basePath,
  define: {
    __APP_LAST_UPDATED__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      '/api': apiProxyOptions(),
    },
  },
  preview: {
    // Keep preview off the Vite dev port so `bun run preview` works while `dev` is up.
    port: Number(process.env.PREVIEW_PORT ?? '4173'),
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': apiProxyOptions(),
    },
  },
});
