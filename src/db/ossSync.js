// ===== 阿里云 OSS 云同步适配器（方案A：浏览器直连 AK/SK）=====
// 与 cloudSync.js 保持同一「集合快照」同步模型：
//   每个业务集合 → OSS 上一个对象文件  {prefix}{key}.json
//   拉取 = GetObject，推送 = PutObject，删除 = DeleteObject。
// 认证用官方 ali-oss SDK（浏览器版），配置（Bucket/Region/AK/SK）为本机浏览器私有设置，
// 不落入业务集合，避免「同步配置自身被同步」的自举问题。
// 安全须知：
//   - 本机存储的 AK/SK 仅做轻量混淆（防明文直读），非加密；
//     生产环境建议改用后端签发 STS 临时凭证，或用仅授权本 Bucket 前缀的受限 RAM 子账号。
//   - 浏览器直连必须在 Bucket 的 CORS 规则里放行当前站点来源（否则 GetObject/PutObject 会被浏览器拦截）。
// 健壮性：云模式读写均同步维护一份 IndexedDB 本地副本；云端读取失败/无对象时回退本地，
//         避免「读失败→空数据→回写覆盖云端」的数据丢失。
// ali-oss 采用动态导入：独立 chunk 按需加载，避免拖慢首屏。
import { storage, IndexedDBAdapter } from './storage'
import { enableCloudSync, disableCloudSync } from './cloudSync'

// 允许云同步的集合（与 cloudSync.js 的 SYNC_KEYS 保持一致）
export const OSS_SYNC_KEYS = ['projects', 'points', 'devices', 'settings', 'meta', 'bills', 'devSort', 'devBrands']

// 本机私有配置键（localStorage；仅几百字节，不占 IndexedDB 业务空间）
export const OSS_CFG_KEY = 'wb_elv_oss_cfg'

// 本地缓存适配器：云模式读取失败时的回退源，也是每次读写的本地副本（IndexedDB）
const localCache = new IndexedDBAdapter()

// ---------- 配置读写 ----------
// AK/SK 属敏感凭证：本机存储仅做轻量混淆（防明文直读，非加密）。
// 真正的安全边界依赖：① 后端签发 STS 临时凭证；② RAM 子账号仅授予该 Bucket 前缀的最小权限。
// 旧版本地明文配置仍可读取（无 o1: 前缀按明文处理），再次保存后自动转为混淆存储。
const OSS_CFG_MASK = 'wb-elv-oss'
function _xorText (s) {
  return s.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ OSS_CFG_MASK.charCodeAt(i % OSS_CFG_MASK.length))).join('')
}
function obfuscate (s) {
  if (s == null || s === '') return s
  try {
    const str = String(s)
    if (/[^\x00-\xff]/.test(str)) return str // 非 Latin1 字符不混淆，保持兼容
    return 'o1:' + btoa(_xorText(str))
  } catch (e) { return s }
}
function deobfuscate (s) {
  if (s == null || String(s).indexOf('o1:') !== 0) return s
  try { return _xorText(atob(String(s).slice(3))) } catch (e) { return s }
}
export function loadOssConfig () {
  try {
    const raw = localStorage.getItem(OSS_CFG_KEY)
    if (!raw) return {}
    const cfg = JSON.parse(raw)
    if (cfg.accessKeyId) cfg.accessKeyId = deobfuscate(cfg.accessKeyId)
    if (cfg.accessKeySecret) cfg.accessKeySecret = deobfuscate(cfg.accessKeySecret)
    return cfg
  } catch (e) { return {} }
}
export function saveOssConfig (cfg) {
  try {
    const out = { ...cfg }
    if (out.accessKeyId) out.accessKeyId = obfuscate(out.accessKeyId)
    if (out.accessKeySecret) out.accessKeySecret = obfuscate(out.accessKeySecret)
    localStorage.setItem(OSS_CFG_KEY, JSON.stringify(out))
  } catch (e) {}
}
export function clearOssConfig () {
  try { localStorage.removeItem(OSS_CFG_KEY) } catch (e) {}
}

export function isOssConfigValid (cfg) {
  cfg = cfg || {}
  return !!(cfg.region && cfg.bucket && cfg.accessKeyId && cfg.accessKeySecret)
}

// ---------- 客户端构建 ----------
let _OSS = null
async function ossMod () {
  if (!_OSS) _OSS = await import('ali-oss')
  return _OSS.default
}
export async function buildOssClient (cfg) {
  cfg = cfg || {}
  const OSS = await ossMod()
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
    const client = await buildOssClient(cfg)
    const t0 = Date.now()
    // 列出 1 个对象即可验证 AK/权限/网络/CORS
    await client.list({ 'max-keys': 1 })
    return { ok: true, message: `连接成功（${Date.now() - t0}ms），权限与 CORS 配置正确` }
  } catch (e) {
    const status = (e && e.status) || (e && e.code && e.code)
    const msg = (e && e.message) || (e && e.name) || String(e)
    const hint = /cors|access.?control|network|failed to fetch|load failed|timeout/i.test(msg)
      ? '；请检查 Bucket 的 CORS 规则是否放行当前站点来源，或 AK 权限/网络是否可达'
      : ''
    return { ok: false, message: `连接失败（${status || '未知错误'}）：${msg}${hint}` }
  }
}

// ---------- 云同步适配器（与 storage 的 CloudAdapter 接口形状一致）----------
export function createOSSAdapter (cfg) {
  // 懒加载构造：首次读写/删除时才真正加载 ali-oss 并创建客户端
  let _client = null
  const getClient = async () => {
    if (!_client) _client = await buildOssClient(cfg)
    return _client
  }
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
      if (!OSS_SYNC_KEYS.includes(k)) return fb
      // 云端读取失败/无对象时回退本地缓存，避免空数据回写覆盖云端
      const fromLocal = async () => {
        try {
          const cached = await localCache.load(k, undefined)
          return cached !== undefined ? cached : fb
        } catch (e) { return fb }
      }
      try {
        const client = await getClient()
        const r = await client.get(keyOf(k))
        if (!r || r.status === 404 || r.content === undefined || r.content === null) return fromLocal()
        const text = decode(r.content)
        const data = text ? JSON.parse(text) : null
        if (data == null) return fromLocal()
        // 云为权威：读成功后把本地缓存刷新为同份数据，作为断网/降级回退源
        try { await localCache.save(k, data) } catch (e) {}
        return data
      } catch (e) {
        // NoSuchKey → 远端无此对象，回退本地（与 REST 版 404 语义一致）
        if (e && (e.status === 404 || e.code === 'NoSuchKey' || e.name === 'NoSuchKey')) return fromLocal()
        console.warn('[oss-sync] 拉取失败，回退本地缓存', k, e && e.message)
        return fromLocal()
      }
    },
    async save (k, v) {
      if (!OSS_SYNC_KEYS.includes(k)) return
      // 先写本地缓存，云端推送失败时数据仍安全留存（可作为离线回退源）
      try { await localCache.save(k, v) } catch (e) {}
      try {
        const client = await getClient()
        await client.put(keyOf(k), JSON.stringify(v), { contentType: 'application/json; charset=utf-8' })
      } catch (e) {
        console.warn('[oss-sync] 推送失败，数据已保留在本地缓存', k, e && e.message)
      }
    },
    async remove (k) {
      if (!OSS_SYNC_KEYS.includes(k)) return
      try {
        const client = await getClient()
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