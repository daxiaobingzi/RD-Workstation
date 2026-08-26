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
  _adapter: new LocalAdapter(),
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
  async remove (k) { await this._adapter.remove(k) }
}

export { CloudAdapter }

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