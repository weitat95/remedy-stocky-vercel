import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      // Installable "Tasks" app (iPad: Share, then Add to Home Screen). The service worker only precaches
      // the app shell. API calls go to another origin (the backend), which Workbox never touches, so
      // nothing authenticated is ever cached or served stale. Offline, the shell loads and the app says so.
      VitePWA({
        registerType: 'autoUpdate', // a new deploy's worker takes over by itself (registered from src/main.jsx)
        injectRegister: false,
        includeAssets: ['apple-touch-icon.png', 'favicon.png'],
        manifest: {
          id: '/',
          name: 'Stocky Tasks',
          short_name: 'Tasks',
          description: 'Daily tasks for the retail team',
          start_url: '/tasks',
          scope: '/',
          display: 'standalone',
          theme_color: '#1a1a1a',
          background_color: '#f1f1f1',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        strategies: 'injectManifest', // our own worker: src/sw.js
        srcDir: 'src',
        filename: 'sw.js',
        injectManifest: {
          globPatterns: ['**/*.{html,css,js,png,svg,ico,webmanifest,woff2}'],
          globIgnores: ['**/exceljs*'], // big, lazy-loaded for one export, not needed to start the app
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
      }),
    ],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL || 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
