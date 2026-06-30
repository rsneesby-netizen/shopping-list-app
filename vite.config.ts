import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Dev-only: fetch arbitrary recipe URLs server-side (avoids browser CORS). */
function recipeHtmlProxy(): Plugin {
  return {
    name: 'recipe-html-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/recipe-proxy')) {
          next()
          return
        }
        try {
          const u = new URL(url, 'http://localhost')
          const target = u.searchParams.get('url')
          if (!target || !/^https?:\/\//i.test(target)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing or invalid url query parameter.' }))
            return
          }
          const r = await fetch(target, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (compatible; GroceryListRecipeImport/1.0; +https://github.com/)',
              Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'follow',
          })
          const html = await r.text()
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, status: r.status, html }))
        } catch (e: unknown) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    recipeHtmlProxy(),
    VitePWA({
      registerType: 'autoUpdate',
      /** Do not generate/register a dev service worker — it can mask latest UI on localhost. */
      devOptions: { enabled: false },
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Grocery List',
        short_name: 'Groceries',
        description: 'Collaborative grocery lists with smart suggestions',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        // Deep links like /lists/:id must serve the SPA shell (avoids SW 404 on navigation).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
