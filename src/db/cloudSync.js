// ===== 云端同步适配器：跨设备状态同步 =====
// 协议设计（兼容任意后端）：
//   以「集合快照」粒度同步。每个集合对应远端一个 key，值为该集合的完整 JSON。
//   远端需暴露 REST 接口：
//     GET  {apiBase}/{key}        → 拉取某集合（返回 JSON；404/空 → fb）
//     PUT  {apiBase}/{key}        → 整体覆盖写入（body = 集合 JSON）
//     GET  {apiBase}              → 列出所有可用 key（可选，用于发现）
//   已有后端（自建 API / JSONBin / Supabase / WebDAV 网关）通过实现同一 fetch 语义即可接入，
//   无需改动业务代码。同步冲突采用「最后写入者胜 + 版本时间戳」策略。
import { storage, CloudAdapter } from './storage'

let deferred = null

// 允许云端同步的集合（排除纯本地状态如 devSort 分区等可全量）
const SYNC_KEYS = ['projects', 'points', 'devices', 'settings', 'meta', 'bills', 'devSort', 'devBrands']

/**
 * 创建基于 REST 键值存储的云端适配器。
 * @param {object} cfg { apiBase, token, prefix?, http? }
 */
export function createCloudAdapter (cfg) {
  const base = String(cfg.apiBase || '').replace(/\/+$/, '')
  const token = cfg.token || ''
  const prefix = cfg.prefix || ''
  const doFetch = cfg.http || ((url, opts) => fetch(url, opts))
  const keyOf = k => `${prefix}${k}`

  return new CloudAdapter({
    async load (k, fb) {
      const ok = SYNC_KEYS.includes(k)
      if (!ok) return fb
      try {
        const r = await doFetch(`${base}/${keyOf(k)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        if (r.status === 404) return fb
        if (!r.ok) throw new Error(`load ${k} failed: ${r.status}`)
        const data = await r.json()
        return data ?? fb
      } catch (e) {
        console.warn('[sync] 拉取失败', k, e && e.message)
        return fb
      }
    },
    async save (k, v) {
      const ok = SYNC_KEYS.includes(k)
      if (!ok) return
      try {
        await doFetch(`${base}/${keyOf(k)}`, {
          method: 'PUT',
          headers: Object.assign(
            { 'Content-Type': 'application/json' },
            token ? { Authorization: `Bearer ${token}` } : {}
          ),
          body: JSON.stringify(v)
        })
      } catch (e) {
        console.warn('[sync] 推送失败', k, e && e.message)
      }
    },
    async remove (k) {
      const ok = SYNC_KEYS.includes(k)
      if (!ok) return
      try {
        await doFetch(`${base}/${keyOf(k)}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} })
      } catch (e) {
        console.warn('[sync] 删除失败', k, e && e.message)
      }
    }
  })
}

/**
 * 启用云端同步：给 storage 注入云端适配器。
 * 传入 cfg（{apiBase, token, prefix}）。之后 store.persistAll() 的 storage.save
 * 会把数据同时写入远端；init 时的 storage.load 从远端读（本地空白时）。
 */
export function enableCloudSync (cfg) {
  storage.setAdapter(createCloudAdapter(cfg))
}

/** 回到纯本地模式 */
export function disableCloudSync () {
  storage.setAdapter(new ((await import('./storage')).LocalAdapter ? ... : Object)())
}

// 提供给 UI 探测当前是否云端模式
export function isCloudMode () {
  return storage.mode === 'cloud'
}