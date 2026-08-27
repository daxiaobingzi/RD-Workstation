// ===== 桌面离线版构建配置 =====
// 与 Web 版（vite.config.js）的区别：
//   - base: './'：产物用相对路径，Electron 以 file:// 直接加载即可
//   - 不引入 vite-plugin-pwa：无 Service Worker / manifest / 任何网络依赖
//   - 把 'virtual:pwa-register' 指向空实现，保证共享 main.js 能正常构建
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      // 完整版（含模板编译器）：支持字符串 template 的内联组件（确认框/输入框/菜单等）
      vue: 'vue/dist/vue.esm-bundler.js',
      // 桌面离线版没有 PWA 插件，把虚拟模块指向空实现
      'virtual:pwa-register': fileURLToPath(new URL('./src/pwa-stub.js', import.meta.url))
    }
  },
  build: {
    outDir: 'dist-desktop',
    emptyOutDir: true,
    // 纯本地应用，无外部 CDN 依赖；保留按需动态 chunk（export.js 等）
    chunkSizeWarningLimit: 1000
  }
})
