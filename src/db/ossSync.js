// ===== 阿里云 OSS 云同步适配器（方案A：浏览器直连 AK/SK）=====
// 与 cloudSync.js 保持同一「集合快照」同步模型：
//   每个业务集合 → OSS 上一个对象文件  {prefix}{key}.json
//   拉取 = GetObject，推送 = PutObject，删除 = DeleteObject。
// 认证用官方 ali-oss SDK（浏览器版），配置（Bucket/Region/AK/SK）为本机浏览器私有设置，
// 不落入业务集合，避免「同步配置自身被同步」的自举问题。
import OSS from 'ali-oss'
import { storage } from './storage'
import { enableCloudSync, disableCloudSync } from './cloudSync'

// 允许云同步的集合（与 cloudSync.js 的 SYNC_KEYS 保持一致）
export const OSS_SYNC_KEYS = ['projects', 'points', 'devices', 'settings', 'meta', 'bills', 'devSort', 'devBrands']

// 本机私有配置键（localStorage；仅几百字节，不占 IndexedDB 业务空间）
export const OSS_CFG_KEY = 'wb_elv_oss_cfg'

// ---------- 配置读写 ----------
export function loadOssConfig () {
  try {
    const raw = localStorage.getItem(OSS_CFG_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (e) { return {} }
}
export function saveOssConfig (cfg) {
  try { localStorage.setItem(OSS_CFG_KEY, JSON.stringify(cfg)) } catch (e) {}
}
export function clearOssConfig () {
  try { localStorage.removeItem(OSS_CFG_KEY) } catch (e) {}
}

export function isOssConfigValid (cfg) {
  cfg = cfg || {}
  return !!(cfg.region && cfg.bucket && cfg.accessKeyId && cfg.accessKeySecret)
}

// ---------- 客户端构建 ----------
export function buildOssClient (cfg) {
  cfg = cfg || {}
  return new OSS({
    region: cfg.region,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    // 自定义 Endpoint（如已绑定自定义域名/内网 VPC 域名），与 secure 共同决定访问协议
    endpoint: cfg.endpoint || undefined,
    secure: true,
    timeout: cfg.timeout || 20000
  })
}

// ---------- 测试连接 ----------
export async function testOssConnection (cfg) {
  if (!isOssConfigValid(cfg)) return { ok: false, message: '请先填写 Region、Bucket 与 AccessKey' }
  try {
    const client = buildOssClient(cfg)
    const t0 = Date.now()
    // 列出 1 个对象即可验证 AK/权限/网络/CORS
    await client.list({ 'max-keys': 1 })
    return { ok: true, message: `连接成功（${Date.now() - t0}ms），权限与 CORS 配置正确` }
  } catch (e) {
    const status = (e && e.status) || (e && e.code && e.code)
    const msg = (e && e.message) || (e && e.name) || String(e)
    return { ok: false, message: `连接失败（${status || '未知错误'}）：${msg}` }
  }
}

// ---------- 云同步适配器（与 storage 的 CloudAdapter 接口形状一致）----------
export function createOSSAdapter (cfg) {
  const client = buildOssClient(cfg)
  const prefix = String(cfg.prefix || '').replace(/^\/+|\/+$/g, '')
  const keyOf = k => (prefix ? `${prefix}/${k}.json` : `${k}.json`)
  const decode = content => {
    if (typeof content === 'string') return content
    const u8 = content instanceof Uint8Array ? content : new Uint8Array(content)
    return new TextDecoder('utf-8').decode(u8)
  }

  return {
    name: 'oss',
    async load (k, fb) {
      if (!OSS_SYNC_KEYS.includes(k) || !client) return fb
      try {
        const r = await client.get(keyOf(k))
        if (!r || r.status === 404 || r.content === undefined || r.content === null) return fb
        const text = decode(r.content)
        return text ? JSON.parse(text) : fb
      } catch (e) {
        // NoSuchKey → 远端无此对象，返回默认值（与 REST 版 404 语义一致）
        if (e && (e.status === 404 || e.code === 'NoSuchKey' || e.name === 'NoSuchKey')) return fb
        console.warn('[oss-sync] 拉取失败', k, e && e.message)
        return fb
      }
    },
    async save (k, v) {
      if (!OSS_SYNC_KEYS.includes(k) || !client) return
      try {
        await client.put(keyOf(k), JSON.stringify(v), { contentType: 'application/json; charset=utf-8' })
      } catch (e) {
        console.warn('[oss-sync] 推送失败', k, e && e.message)
      }
    },
    async remove (k) {
      if (!OSS_SYNC_KEYS.includes(k) || !client) return
      try {
        await client.delete(keyOf(k))
      } catch (e) {
        console.warn('[oss-sync] 删除失败', k, e && e.message)
      }
    }
  }
}

// ---------- 启用 / 停用 ----------
/** 启用 OSS 同步：注入 storage 适配器；返回是否成功 */
export function enableOssSync (cfg) {
  if (!isOssConfigValid(cfg)) return false
  storage.setAdapter(createOSSAdapter(cfg))
  return true
}

/** 停用 OSS 同步：回退到纯本地 IndexedDB */
export async function disableOssSync () {
  await disableCloudSync()
}

/**
 * 启动期恢复：若之前启用了 OSS 同步且配置仍有效，则恢复云适配器（刷新后仍保持云模式）。
 * 由 store.init 在 storage.load 之前调用。
 */
export function restoreOssIfEnabled () {
  const cfg = loadOssConfig()
  if (cfg.enabled && isOssConfigValid(cfg)) {
    enableOssSync(cfg)
  }
}

// 复用 REST 云同步的启停入口（二者互斥，OSS 优先级更高）
export { enableCloudSync, disableCloudSync }