import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base 写成绝对子路径：线上是 https://qqtang-code.github.io/cute-ledger/
export default defineConfig({
  base: '/cute-ledger/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '可爱记账本',
        short_name: '记账本',
        description: '自用的可爱风记账本：记一笔、看历史、存照片',
        lang: 'zh-CN',
        start_url: '/cute-ledger/',
        scope: '/cute-ledger/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFF6F8',
        theme_color: '#FF9BB3',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // 附件是用户数据，存在 IndexedDB 里，不进缓存
        navigateFallback: '/cute-ledger/index.html',
      },
    }),
  ],
})