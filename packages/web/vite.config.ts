import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/draw/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ['agent.br-ndt.dev'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Proxy Yjs WebSocket connections through the Vite dev server so the
      // client can use a relative-host URL (ws://<same-host>:<same-port>/r/...)
      // instead of hardcoded ws://localhost:1234.  Without this proxy, any user
      // accessing the app from a host other than localhost would have their
      // browser attempt to connect to *their own* localhost:1234, which has no
      // YWS server, silently killing all cross-client drawing sync.
      //
      // bypass: plain HTTP GETs to /r/<slug> are browser navigations — serve
      // the SPA's index.html so React Router can render RoomPage.  Only actual
      // WebSocket upgrades should reach the yws service.
      '/r': {
        target: 'ws://localhost:1234',
        ws: true,
        changeOrigin: true,
        bypass(req) {
          if (req.headers['upgrade']?.toLowerCase() !== 'websocket') {
            // Return the SPA shell; React Router picks up /r/:slug from the
            // browser's URL and renders the correct page.
            return '/draw/index.html';
          }
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
});
