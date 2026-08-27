// 桌面离线版：无 PWA / Service Worker，注册函数为空实现。
// 由 vite.desktop.config.js 通过 alias 把 'virtual:pwa-register' 指向本文件，
// 使共享的 main.js 在桌面构建中不注册任何 Service Worker（无网络依赖）。
export const registerSW = () => {}
