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
import { nowISO } from './format'

// 允许云同步的集合（与 cloudSync.js 的 SYNC_KEYS 保持一致）
export const OSS_SYNC_KEYS = ['projects', 'points', 'devices', 'settings', 'meta', 'bills', 'devSort', 'devBrands']

// 本机私有配置键（localStorage；仅几百字节，不占 IndexedDB 业务空间）
export const OSS_CFG_KEY = 'wb_elv_oss_cfg'

// 本地缓存适配器：云模式读取失败时的回退源，也是每次读写的本地副本（IndexedDB）
const localCache = new IndexedDBAdapter()

// ---------- 版本感知同步（参照 Notion：云端为主、本地仅缓存）----------
// 云端版本清单：{prefix}/_versions.json = { key: { ver, updatedAt, deviceId } }
// 本地同步状态：IndexedDB __syncstate  = { key: { baseVer, updatedAt, dirty } }
// 冲突留档：{prefix}/_conflicts/{key}-{ts}.json（保存败者完整数据，可人工恢复）
const MANIFEST_OBJ = '_versions'
const CONFLICT_DIR = '_conflicts'
const SYNC_STATE_KEY = '__syncstate'
const DEVICE_KEY = 'wb_elv_device'

/** 设备标识：本地生成并持久化，用于时间戳打平时的确定性决胜 */
function deviceId () {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch (e) { return 'dev-anon' }
}

function readLocalState () { return localCache.load(SYNC_STATE_KEY, {}).then(v => v || {}) }
function writeLocalState (s) { return localCache.save(SYNC_STATE_KEY, s) }

/** 时间裁决：updatedAt 较新者胜；同一毫秒按 deviceId 字典序（大者胜），结果确定可复现 */
function newerThan (tA, tB, devA, devB) {
  const a = new Date(tA).getTime()
  const b = new Date(tB).getTime()
  if (a !== b) return a > b
  return devA === devB ? false : devA > devB
}

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

/** 本机是否已保存过 OSS 配置（用于区分「全新配置」与「老配置」，决定是否套用默认前缀） */
export function hasOssConfig () {
  try { return localStorage.getItem(OSS_CFG_KEY) !== null } catch (e) { return false }
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

  // ---- 云端对象原语（供同步引擎使用）----
  const getObj = async key => {
    const r = await getClient().then(c => c.get(keyOf(key)))
    const text = decode(r.content)
    return text ? JSON.parse(text) : null
  }
  const putObj = (key, data) => getClient().then(c => c.put(keyOf(key), JSON.stringify(data), { contentType: 'application/json; charset=utf-8' }))
  const delObj = key => getClient().then(c => c.delete(keyOf(key)))
  const isNoKey = e => !!(e && (e.status === 404 || e.code === 'NoSuchKey' || e.name === 'NoSuchKey'))
  /** 读取云端对象；不存在/失败返回 null（不抛错） */
  async function getObjSafe (key) {
    try { return await getObj(key) } catch (e) {
      if (isNoKey(e)) return null
      console.warn('[oss-sync] 拉取对象失败', key, e && e.message)
      return null
    }
  }

  // ---------- 版本清单与本地状态 ----------
  /** 拉取云端版本清单；云端尚无清单（旧数据/首启）返回 null */
  async function fetchManifest () {
    try { return (await getObj(MANIFEST_OBJ)) || {} } catch (e) {
      if (isNoKey(e)) return null
      throw e
    }
  }
  async function fetchManifestSafe () {
    try {
      const m = await fetchManifest()
      return m == null ? {} : m
    } catch (e) { return {} }
  }
  async function putManifest (m) { await putObj(MANIFEST_OBJ, m) }

  // ---------- 冲突留档（败者完整数据，可人工恢复）----------
  async function writeConflict (key, loserData, meta) {
    const ts = nowISO().replace(/[:.]/g, '-')
    await putObj(`${CONFLICT_DIR}/${key}-${ts}`, { key, createdAt: nowISO(), conflict: meta, loser: loserData })
  }

  // ---------- 同步决策（参照方案 5.4：云端为主、本地缓存）----------
  /** 拉取云端为权威：覆盖本地缓存并刷新本地状态 */
  async function pullCollection (key, rv) {
    const data = await getObjSafe(key)
    if (data == null) return // 云端对象不存在，保留本地
    await localCache.save(key, data)
    const st = await readLocalState()
    st[key] = { baseVer: rv.ver, updatedAt: rv.updatedAt, dirty: false }
    await writeLocalState(st)
  }

  /** 推送单个集合：先写数据，再 bump 版本清单（乐观并发：写前重读清单） */
  async function pushOne (key, manifest) {
    const data = await localCache.load(key, undefined)
    if (data === undefined) return 'skip'
    const m = manifest || (await fetchManifestSafe())
    const cur = m[key]
    const entry = { ver: (cur ? cur.ver : 0) + 1, updatedAt: nowISO(), deviceId: deviceId() }
    await putObj(key, data) // 1) 写数据
    m[key] = entry
    await putManifest(m) // 2) bump 版本清单
    const st = await readLocalState() // 3) 清 dirty
    st[key] = { baseVer: entry.ver, updatedAt: entry.updatedAt, dirty: false }
    await writeLocalState(st)
    return 'push'
  }

  /** 冲突裁决：updatedAt 较新者胜，平局按 deviceId 决胜；败者留档 */
  async function resolveConflict (key, rv, lv) {
    const localWins = lv.dirty && newerThan(lv.updatedAt, rv.updatedAt, deviceId(), rv.deviceId)
    if (localWins) {
      // 本地胜：先把云端旧数据留档，再推送本地覆盖
      const remoteData = await getObjSafe(key)
      await writeConflict(key, remoteData, { winner: 'local', rv, lv, deviceId: deviceId() })
      await pushOne(key)
      return { action: 'push', conflict: true, winner: 'local' }
    }
    // 云端胜：把本地未推送修改留档，再拉取云端覆盖
    const localData = await localCache.load(key, undefined)
    if (localData !== undefined) await writeConflict(key, localData, { winner: 'remote', rv, lv, deviceId: deviceId() })
    await pullCollection(key, rv)
    return { action: 'pull', conflict: true, winner: 'remote' }
  }

  /** 单个集合的同步决策（判定矩阵见方案 5.3） */
  async function syncCollection (key, manifest) {
    const rv = manifest[key] || null
    const lv = (await readLocalState())[key] || null
    if (!rv && !lv) return { action: 'none' }
    if (!rv && lv.dirty) { await pushOne(key, manifest); return { action: 'push' } }
    if (!lv) { await pullCollection(key, rv); return { action: 'pull' } }
    if (rv.ver > lv.baseVer) {
      if (lv.dirty) return await resolveConflict(key, rv, lv)
      await pullCollection(key, rv)
      return { action: 'pull' }
    }
    if (lv.dirty) { await pushOne(key, manifest); return { action: 'push' } }
    return { action: 'none' }
  }

  // ---------- 全量同步（拉取 + 裁决 + 推送，防重入）----------
  let _syncing = false
  async function syncAll () {
    if (_syncing) return { skipped: true }
    _syncing = true
    const result = { pulled: [], pushed: [], conflicts: [], skipped: false }
    try {
      let manifest
      try { manifest = await fetchManifest() } catch (e) {
        console.warn('[oss-sync] 拉取版本清单失败，跳过本轮同步', e && e.message)
        return result
      }
      // 旧数据迁移：云端无版本清单 → 为已存在的对象初始化 ver=1（一次性，避免误判冲突）
      if (manifest == null) {
        manifest = {}
        for (const k of OSS_SYNC_KEYS) {
          const data = await getObjSafe(k)
          if (data != null) manifest[k] = { ver: 1, updatedAt: nowISO(), deviceId: deviceId() }
        }
        try { await putManifest(manifest) } catch (e) { console.warn('[oss-sync] 初始化版本清单失败', e && e.message) }
      }
      for (const k of OSS_SYNC_KEYS) {
        const r = await syncCollection(k, manifest)
        if (r.action === 'pull') result.pulled.push(k)
        else if (r.action === 'push') result.pushed.push(k)
        if (r.conflict) result.conflicts.push(k)
      }
      return result
    } finally {
      _syncing = false
    }
  }

  // ---------- 脏数据批量推送（编辑后防抖触发）----------
  async function pushDirty () {
    const st = await readLocalState()
    const dirty = OSS_SYNC_KEYS.filter(k => st[k] && st[k].dirty)
    if (!dirty.length) return { pushed: [] }
    const manifest = await fetchManifestSafe()
    const pushed = []
    for (const k of dirty) {
      const data = await localCache.load(k, undefined)
      if (data === undefined) continue
      await putObj(k, data) // 先全部写数据
      const cur = manifest[k]
      manifest[k] = { ver: (cur ? cur.ver : 0) + 1, updatedAt: nowISO(), deviceId: deviceId() }
      pushed.push(k)
    }
    if (pushed.length) {
      await putManifest(manifest) // 最后统一 bump 版本清单
      for (const k of pushed) st[k] = { baseVer: manifest[k].ver, updatedAt: manifest[k].updatedAt, dirty: false }
      await writeLocalState(st)
    }
    return { pushed }
  }
  let flushTimer = null
  function scheduleFlush () {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null
      pushDirty().catch(e => console.warn('[oss-sync] 推送失败', e && e.message))
    }, 800)
  }

  return {
    name: 'oss',
    async load (k, fb) {
      if (!OSS_SYNC_KEYS.includes(k)) return fb
      // 本地有未推送编辑（dirty）→ 直接用本地缓存，避免被云端旧数据覆盖（版本同步随后裁决）
      try {
        const st = await readLocalState()
        if (st[k] && st[k].dirty) {
          const local = await localCache.load(k, undefined)
          return local !== undefined ? local : fb
        }
      } catch (e) {}
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
        if (isNoKey(e)) return fromLocal()
        console.warn('[oss-sync] 拉取失败，回退本地缓存', k, e && e.message)
        return fromLocal()
      }
    },
    async save (k, v) {
      if (!OSS_SYNC_KEYS.includes(k)) return
      // 版本同步模型：先写本地缓存并标记 dirty，再防抖批量推送（避免每次编辑全量打爆请求）
      try { await localCache.save(k, v) } catch (e) {}
      try {
        const st = await readLocalState()
        const cur = st[k] || { baseVer: 0, dirty: false }
        st[k] = { baseVer: cur.baseVer || 0, updatedAt: nowISO(), dirty: true }
        await writeLocalState(st)
      } catch (e) {}
      scheduleFlush()
    },
    async remove (k) {
      if (!OSS_SYNC_KEYS.includes(k)) return
      try { await delObj(k) } catch (e) { console.warn('[oss-sync] 删除失败', k, e && e.message) }
    },
    // 版本感知同步对外接口（store 在 init / 前台 / 轮询 / 手动时调用）
    syncAll,
    flushNow: pushDirty
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