import http from 'node:http';
import https from 'node:https';
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
/** Optional remote API for preview. Default: local NRP_CAD API on API_PORT. */
const previewApiUrl = (process.env.PREVIEW_API_URL ?? '').trim().replace(/\/$/, '');
const localApiUrl = `http://127.0.0.1:${apiPort}`;
const apiTarget = previewApiUrl || localApiUrl;

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');

/** Forward the browser host to the API so Discord OAuth uses the Vite port (5173/4173), not 8080. */
function apiProxyOptions(target = apiTarget) {
  const remote = target.startsWith('https://');
  return {
    target,
    changeOrigin: true,
    secure: remote,
    timeout: 120_000,
    proxyTimeout: 120_000,
    // nginx on the VPS drops idle keep-alive sockets sooner than Node's default
    // agent expects, so a reused socket fails with ECONNREFUSED on the next poll.
    agent: remote
      ? new https.Agent({ keepAlive: false })
      : new http.Agent({ keepAlive: false }),
    configure: (proxy: { on: (event: string, fn: (...args: unknown[]) => void) => void }) => {
      proxy.on('proxyReq', (proxyReq: { setHeader: (name: string, value: string) => void; setTimeout?: (ms: number) => void }, req: { headers: { host?: string }; method?: string }) => {
        const browserHost = req.headers.host;
        if (browserHost) {
          proxyReq.setHeader('x-forwarded-host', browserHost);
          proxyReq.setHeader('x-forwarded-proto', 'http');
        }
        // Hung VPS sockets were blocking roster ranks for 20s+ and freezing the page.
        if (remote && (req.method === 'GET' || req.method === 'HEAD') && typeof proxyReq.setTimeout === 'function') {
          proxyReq.setTimeout(12_000);
        }
      });
      proxy.on(
        'error',
        (
          _err: unknown,
          _req: unknown,
          res: { headersSent?: boolean; writeHead?: (status: number, headers: Record<string, string>) => void; end?: (body: string) => void },
        ) => {
          if (!res?.headersSent && typeof res?.writeHead === 'function' && typeof res.end === 'function') {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              error: remote
                ? 'Could not reach the live VPS API. Try again in a moment.'
                : 'The local API is not running. Restart preview with bun run preview.',
            }));
          }
        },
      );
    },
  };
}

/** Unpublished Google Doc routes are not on the VPS yet — always hit this checkout's API. */
function unpublishedApiProxy() {
  return apiProxyOptions(localApiUrl);
}

const apiProxy = {
  '/api/google': unpublishedApiProxy(),
  '/api/resources/google': unpublishedApiProxy(),
  '/api/dph/resources/google': unpublishedApiProxy(),
  '/api/staff/resources/google': unpublishedApiProxy(),
  '/api/public/discord-presence': unpublishedApiProxy(),
  '/api': apiProxyOptions(),
};

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist') || id.includes('pdf.worker')) return 'pdfjs';
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'tiptap';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react-vendor';
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: apiProxy,
  },
  preview: {
    // Keep preview off the Vite dev port so `bun run preview` works while `dev` is up.
    port: Number(process.env.PREVIEW_PORT ?? '4173'),
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: apiProxy,
  },
});
