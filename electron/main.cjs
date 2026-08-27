// ===== 弱电工作台 · 桌面离线版主进程 =====
// 纯本地应用：加载 dist-desktop 构建产物，完全离线、无 PWA/Service Worker/网络依赖。
const { app, BrowserWindow, shell } = require('electron')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ENTRY = path.join(ROOT, 'dist-desktop', 'index.html')

function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '弱电智能化设计工作台',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'dist-desktop', 'app-icons', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // 应用内数据全部本机存储，不发起任何外部请求：拦截并取消所有 http/https，确保完全离线
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => callback({ cancel: true })
  )

  // 若页面中出现外链，交给系统浏览器打开（不放进应用内）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.loadFile(ENTRY)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
