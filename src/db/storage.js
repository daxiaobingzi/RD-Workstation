// ===== 存储抽象层：本地优先，预留云端接口 =====
// 统一 get/set/remove 接口，本地实现为 localStorage；
// 后续接入云数据库/后端 API 时，实现同一接口的 CloudAdapter 并切换 storage.mode 即可，业务代码零改动。

import { LS, LS_NOTES } from './constants'

function lsGet (k, fb) {
  try {
    const v = localStorage.getItem(k)
    return v ? JSON.parse(v) : fb
  } catch (e) { return fb }
}
function lsSet (k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }
function lsRemove (k) { try { localStorage.removeItem(k) } catch (e) {} }

class LocalAdapter {
  name = 'local'
  async load (k, fb) { return lsGet(k, fb) }
  async save (k, v) { lsSet(k, v) }
  async remove (k) { lsRemove(k) }
}

/* ===== IndexedDB 适配器（默认本地存储）=====
   localStorage 约 5MB，IndexedDB 可达数百 MB+，适合点位表/历史清单等大数据集。
   - 数据集合（COLLECTIONS）走 IndexedDB；UI 小状态（主题/侧栏折叠等）仍留在 localStorage。
   - 首启时自动把 localStorage 中同键旧数据迁移进 IndexedDB，并清除旧键释放空间。 */
const IDB_NAME = 'rd-workstation'
const IDB_STORE = 'kv'
let _idb = null

function idbOpen () {
  if (_idb) return _idb
  _idb = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'))
  })
  return _idb
}
function idbTx (mode, fn) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode)
    const store = tx.objectStore(IDB_STORE)
    let result
    const req = fn(store)
    req.onsuccess = () => { result = req.result }
    req.onerror = () => reject(req.error || new Error('IndexedDB 操作失败'))
    // 写事务以 tx.oncomplete 为准，确保数据真正提交（避免请求成功后事务回滚）
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'))
  }))
}

class IndexedDBAdapter {
  name = 'idb'
  async load (k, fb) {
    try {
      const v = await idbTx('readonly', s => s.get(k))
      if (v !== undefined) {
        // IndexedDB 已有权威数据：顺带清除 localStorage 同键残留（释放空间，幂等）
        try { if (localStorage.getItem(k) !== null) lsRemove(k) } catch (e) {}
        return v
      }
      // 迁移首次：IndexedDB 无此键，但 localStorage 有旧数据 → 搬入并释放 localStorage
      const legacy = lsGet(k, undefined)
      if (legacy !== undefined) {
        try {
          await idbTx('readwrite', s => s.put(legacy, k))
          lsRemove(k)
        } catch (e) { /* 迁移失败仍返回旧值 */ }
        return legacy
      }
      return fb
    } catch (e) {
      console.warn('[storage] IndexedDB 读取失败，回退 localStorage', e && e.message)
      return lsGet(k, fb)
    }
  }
  async save (k, v) {
    try {
      // 关键：Vue reactive Proxy 无法被 IndexedDB 结构化克隆（localStorage 走 JSON 可绕过），
      // 统一先转纯 JSON 数据再落库，否则每次写入都会 DataCloneError 并回退 localStorage。
      const plain = JSON.parse(JSON.stringify(v))
      await idbTx('readwrite', s => s.put(plain, k))
    } catch (e) {
      console.warn('[storage] IndexedDB 写入失败，回退 localStorage', e && e.message)
      lsSet(k, v)
    }
  }
  async remove (k) {
    try {
      await idbTx('readwrite', s => s.delete(k))
    } catch (e) {
      console.warn('[storage] IndexedDB 删除失败', e && e.message)
      lsRemove(k)
    }
  }
}

/**
 * 云端适配器占位实现：保持接口形状，供后续接入。
 * 接入方式示例：
 *   storage.setAdapter(new CloudAdapter({ apiBase, token }))
 */
class CloudAdapter {
  name = 'cloud'
  constructor (config) { this.config = config || {} }
  async load (k, fb) {
    // TODO: 从云端拉取集合数据（如 GET /data?key=xxx）
    return fb
  }
  async save (k, v) {
    // TODO: 全量或增量推送至云端
  }
  async remove (k) {
    // TODO: 删除云端键
  }
}

export const storage = {
  mode: 'local',
  // 默认本地存储 = IndexedDB（容量远超 localStorage；旧数据自动迁移）
  _adapter: new IndexedDBAdapter(),
  setAdapter (adapter) {
    this._adapter = adapter
    this.mode = adapter.name
  },
  async load (k, fb) { return this._adapter.load(k, fb) },
  async loadAll (keys) {
    const out = {}
    for (const k of keys) out[k] = await this._adapter.load(k, null)
    return out
  },
  async save (k, v) { await this._adapter.save(k, v) },
  async remove (k) { await this._adapter.remove(k) },
  // 可选能力：版本感知同步（OSS 适配器实现；本地/其他适配器无此方法则返回 undefined）
  async syncAll () { return this._adapter.syncAll ? await this._adapter.syncAll() : undefined },
  async flushNow () { return this._adapter.flushNow ? await this._adapter.flushNow() : undefined },
  // 冲突记录与归档读取（P2）
  async listConflicts () { return this._adapter.listConflicts ? await this._adapter.listConflicts() : [] },
  async readArchive (name) { return this._adapter.readArchive ? await this._adapter.readArchive(name) : null }
}

export { LocalAdapter, IndexedDBAdapter, CloudAdapter }

// ===== 数据集合定义：哪个集合存哪个键 =====
export const COLLECTIONS = {
  projects: LS.P,
  points: LS.PT,
  devices: LS.DV,
  settings: LS.ST,
  meta: LS.MT,
  notes: LS_NOTES,
  bills: LS.BILL,
  devSort: LS.SORT,
  devBrands: LS.BRAND
}

/**
 * 启动期主动迁移清理（由 store.init 调用）：
 * 以 IndexedDB 为权威，把历史残留在 localStorage 的同键业务数据搬入 IndexedDB 后清除，
 * 保证旧版本（纯 localStorage）数据无缝升级，且释放 localStorage 空间。
 * 幂等：IndexedDB 无此键（或读失败）时不动 localStorage，避免误删。
 */
export async function migrateLegacyData () {
  if (!(storage._adapter instanceof IndexedDBAdapter)) return
  for (const k of Object.values(COLLECTIONS)) {
    try {
      const v = await idbTx('readonly', s => s.get(k))
      if (v === undefined) {
        // IndexedDB 无数据，而 localStorage 有旧数据 → 搬入并清除
        const legacy = lsGet(k, undefined)
        if (legacy !== undefined) {
          await idbTx('readwrite', s => s.put(legacy, k))
          lsRemove(k)
        }
      } else {
        // IndexedDB 已有权威数据 → 直接清掉 localStorage 残留
        try { if (localStorage.getItem(k) !== null) lsRemove(k) } catch (e) {}
      }
    } catch (e) {
      console.warn('[storage] 迁移清理失败，跳过', k, e && e.message)
    }
  }
}