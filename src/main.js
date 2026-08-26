import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { registerSW } from 'virtual:pwa-register'
import './styles/main.css'

// PWA：自动更新 + 注册 Service Worker（离线可用 / 可安装到桌面与移动主屏）
registerSW({ immediate: true })

const app = createApp(App)
app.use(createPinia())
app.mount('#app')