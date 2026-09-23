import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Sub-path support (GitHub Pages, a NAS sub-folder, …).
 *
 * `BASE_PATH=/possessions/` (or `possessions`) rebases every asset, the service
 * worker scope and the PWA `start_url`/`scope`. It can be passed on the command
 * line, exported in the CI job, or put into a `.env` file. Unset, everything
 * stays at the domain root, so local dev and `npm run preview` behave exactly
 * as before.
 */
function normalizeBase(value: string | undefined): string {
  if (!value || value === '/') return '/';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'BASE_PATH');
  const base = normalizeBase(env.BASE_PATH);

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
        manifest: {
          name: 'Possessions Tracker',
          short_name: 'Possessions',
          description:
            'Offline-first inventory of your household possessions, with AI photo analysis.',
          theme_color: '#0b1120',
          background_color: '#0b1120',
          display: 'standalone',
          orientation: 'portrait',
          // Both must follow the base path, otherwise an installed app would
          // open the domain root instead of the deployed sub-folder.
          start_url: base,
          scope: base,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // The app shell is precached so it works fully offline.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: 'index.html',
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          // Photos live in IndexedDB and API/WebDAV traffic must never be
          // cached, so no runtime caching rules are registered on purpose.
          runtimeCaching: [],
        },
      }),
    ],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
