import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages 部署在 /RD-Workstation/ 子路径
  base: '/RD-Workstation/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['app-icons/icon-192.png', 'app-icons/icon-512.png'],
      manifest: {
        name: '我的工作台',
        short_name: '我的工作台',
        description: '弱电智能化设计统一工作台 · 纯本地离线 · 电脑/平板/手机自适应',
        theme_color: '#0b1220',
        background_color: '#f4f6fb',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        lang: 'zh-CN',
        icons: [
          { src: 'app-icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'app-icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      },
      devOptions: { enabled: false }
    })
  ],
  resolve: {
    alias: {
      // 完整版（含模板编译器）：支持字符串 template 的内联组件（确认框/输入框/菜单等）
      vue: 'vue/dist/vue.esm-bundler.js'
    }
  },
  server: {
    host: true,
    port: 5173,
    // 允许局域网 IP / 预览代理等非 localhost Host 访问（修复手机/平板通过内网IP打开时 403）
    allowedHosts: true
  },
  preview: {
    host: true,
    port: 5190,
    allowedHosts: true
  }
})