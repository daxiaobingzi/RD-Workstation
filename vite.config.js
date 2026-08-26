import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 完整版（含模板编译器）：支持字符串 template 的内联组件（确认框/输入框/菜单等）
      vue: 'vue/dist/vue.esm-bundler.js'
    }
  },
  server: {
    host: true,
    port: 5173
  }
})