// ===== 生产静态服务器（弱电智能化设计工作台 · 部署入口）=====
// 用途：托管 dist/ 生产构建产物，替代 vite preview，更稳定且对部署网关友好。
// 特性：
//   - 根路径 302 → /RD-Workstation/（便于探活/直达）
//   - /RD-Workstation/* 静态资源 + SPA fallback（无 404 刷新问题）
//   - /health 探活端点返回 200（满足网关健康检查）
//   - 支持 gzip 输出（常见静态资源压缩传输）
// 启动：node server.mjs   （默认 5555，可用 PORT 环境变量覆盖）
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { gzipSync } from 'node:zlib'

const PORT = Number(process.env.PORT || 5555)
const ROOT = join(process.cwd(), 'dist')
const BASE = '/RD-Workstation'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

// 安全化路径：禁止越出 dist
function safePath (url) {
  const p = normalize(decodeURIComponent(url)).replace(/^([a-zA-Z]:)?[\\/]+/, '/')
  let abs
  if (p.startsWith(BASE)) abs = join(ROOT, p.slice(BASE.length))
  else if (p === '/') abs = join(ROOT, 'index.html')
  else return null
  if (!abs.startsWith(ROOT)) return null
  return abs
}

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]

  // 探活端点
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, name: 'rd-workstation', time: Date.now() }))
    return
  }

  // 根路径 → 重定向到应用基路径（网关探活 / 直达友好）
  if (url === '/') {
    res.writeHead(302, { Location: BASE + '/' })
    res.end()
    return
  }

  const abs = safePath(url)
  if (!abs) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }

  serve(abs, url, res)
})

async function serve (abs, url, res) {
  try {
    let st = await stat(abs)
    // SPA fallback：非资源但真实存在的文件优先；不存在时退回 index.html
    let filePath = abs
    if (st.isDirectory()) {
      filePath = join(abs, 'index.html')
      st = await stat(filePath)
    }
    await send(filePath, res)
  } catch (e) {
    // 前端路由 fallback：任何未知路径都返回应用入口
    const fallback = join(ROOT, 'index.html')
    try {
      await send(fallback, res)
    } catch (e2) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
    }
  }
}

async function send (filePath, res) {
  const buf = await readFile(filePath)
  const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  const headers = { 'Content-Type': mime, 'Cache-Control': 'no-cache' }
  // 常见文本资源 gzip 压缩
  if (mime.startsWith('text/') || extname(filePath) === '.json' || extname(filePath) === '.svg') {
    headers['Content-Encoding'] = 'gzip'
    res.writeHead(200, headers)
    res.end(gzipSync(buf))
  } else {
    res.writeHead(200, headers)
    res.end(buf)
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[RD-Workstation] 静态服务器已启动`)
  console.log(`  Local:   http://localhost:${PORT}${BASE}/`)
  console.log(`  Network: http://0.0.0.0:${PORT}${BASE}/  (局域网 IP 也可以)`)
  console.log(`  Health:  http://localhost:${PORT}/health`)
})