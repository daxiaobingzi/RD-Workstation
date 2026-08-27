// ===== Pinia Store：弱电工作台中央状态 =====
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { LS, LS_NOTES, APP_VER, defaultSettings, BUDGET_TIERS } from '../db/constants'
import { storage, COLLECTIONS, migrateLegacyData } from '../db/storage'
import { seedProjects, seedPoints, seedDevices, seedNotes, seedMeta, seedAllSettings, seedQuotas, seedMaterialPrices, patchTemplatesAuto } from '../db/seeds'
import { uid, todayStr, nowISO, tierName, stamp2 } from '../db/format'
import {
  ensureDesignQuotas, quotaRuleFor, calcRuleQty, ratioSuggestedQty, subTotalFront,
  suggestQtyForDevice, resolveDevice, selectionOf, getProjectSelection, computeBill,
  diffBill, normalizeBillList, newBillEntry, calcProgress,
  buildBillRows, rowsToCSV, rowsToTSV,
  ensureDeviceChain, deriveChain, chainFormulaText, chainSourceLabel, isChainDevice,
  normalizeMaterialPrices, findMaterialPrice
} from '../db/calc'
import { buildXlsx, buildCsvBlob, buildTxtBlob, downloadBlob, copyText, buildBillSheetsBySub } from '../db/export'

function lsSet (k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }

function ensureBusinessMeta (meta) {
  meta = meta || {}
  meta.billAt = meta.billAt || {}
  meta.projectSelections = meta.projectSelections || {}
  meta.projectBudget = meta.projectBudget || {}
  meta.projectSchemes = meta.projectSchemes || {}
  meta.stageLog = meta.stageLog || {}
  return meta
}

export const useAppStore = defineStore('app', () => {
  // ---------- 业务数据 ----------
  const projects = ref([])
  const points = ref([])
  const devices = ref([])
  const settings = ref(defaultSettings())
  const meta = ref({})
  const notes = ref({})
  const bills = ref({})
  const devSort = ref({})
  const devBrands = ref({})

  // ---------- UI 状态 ----------
  const ready = ref(false)
  const loading = ref(true)
  const curTab = ref('projects') // projects | database | search | settings
  const curView = ref('list') // list | board | detail | bill
  const curProjId = ref(null)
  const curSub = ref(null)
  const projFilterVal = ref('__all')
  const toastMsg = ref('')
  const toastVisible = ref(false)
  let toastTimer = null

  // ---------- 进度/数量 ----------
  const projectById = id => projects.value.find(x => x.id === id)
  const pointsOfProject = id => points.value.filter(x => x.项目ID === id)
  const pointsOfSub = (pid, sub) => points.value.filter(x => x.项目ID === pid && x.子系统 === sub)
  const devicesOfSub = sub => devices.value.filter(d => d.subsystem === sub && d.status !== '归档')
  const devById = id => devices.value.find(d => d.id === id)

  // ---------- 初始化 ----------
  function normalizePointDeviceIds () {
    points.value.forEach(x => {
      if (!x['设备ID']) {
        const d = resolveDevice(devices.value, x.子系统, x.设备类型, null)
        if (d) x['设备ID'] = d.id
      }
    })
  }

  function normalizeLegacyRatioTargets () {
    devices.value.forEach(d => {
      if (!d.ratio || !d.ratio.target || d.ratio.target === '*' || d.ratio.targetDeviceId) return
      const td = devices.value.find(x => x.name === d.ratio.target && x.subsystem === d.subsystem) ||
        devices.value.find(x => x.name === d.ratio.target)
      if (td) d.ratio.targetDeviceId = td.id
    })
  }

  async function init () {
    // 存储迁移：localStorage → IndexedDB（幂等；旧数据搬入 IndexedDB 并释放 localStorage）
    try { await migrateLegacyData() } catch (e) { console.warn('[store] 数据迁移异常', e && e.message) }
    // 首次启动判定：从未初始化过（无版本标记）。注意 localStorage 与 IndexedDB 相互独立、
    // 版本标记可能被单独清除，因此绝不再用「版本过低」触发重建数据（防刷新丢数据）
    const firstLaunch = !lsHas(LS.VER)
    projects.value = (await storage.load(COLLECTIONS.projects, [])) || []
    points.value = (await storage.load(COLLECTIONS.points, [])) || []
    devices.value = (await storage.load(COLLECTIONS.devices, [])) || []
    settings.value = (await storage.load(COLLECTIONS.settings, null)) || defaultSettings()
    meta.value = (await storage.load(COLLECTIONS.meta, {})) || {}
    notes.value = (await storage.load(COLLECTIONS.notes, {})) || {}
    bills.value = (await storage.load(COLLECTIONS.bills, {})) || {}
    devSort.value = (await storage.load(COLLECTIONS.devSort, {})) || {}
    devBrands.value = (await storage.load(COLLECTIONS.devBrands, {})) || {}

    // 记录加载完成后、归一化前的快照：仅当归一化/播种确实产生变更时才落库，
    // 避免云模式下把空数据或旧缓存回写覆盖云端（P0 防数据丢失）
    const before = snapshotJSON()

    // 归一化与兜底
    if (!settings.value.subsystems || !settings.value.subsystems.length) {
      settings.value = seedAllSettings()
    }
    settings.value.subCategories = settings.value.subCategories && settings.value.subCategories.length
      ? settings.value.subCategories : ['安防', '网络通信', '音视频', '机房管路']
    if (!settings.value.materialPrices) settings.value.materialPrices = []
    // 材料价格结构迁移：旧 {名称: 单价} → [{name,spec,unit,cat,brand,model,price}]（默认品牌国产/型号国产优质）
    settings.value.materialPrices = normalizeMaterialPrices(settings.value.materialPrices)
    // 材料价格为空时补默认（与示例设备定额对应，保证「定额材料」立即联动有价；可在系统配置删除/修改）
    if (!settings.value.materialPrices.length) settings.value.materialPrices = seedMaterialPrices()
    if (!settings.value.templates) settings.value.templates = []
    if (!settings.value.designStages) settings.value.designStages = ['方案设计', '初步设计', '施工图设计', '技术交底', '竣工']
    ensureDesignQuotas(settings.value)
    // 旧数据兼容：定额库为空时补齐默认定额；旧模板设备缺 auto 密度时从种子同名模板合并
    if (!settings.value.designQuotas || !settings.value.designQuotas.length) {
      settings.value.designQuotas = seedQuotas()
    }
    patchTemplatesAuto(settings.value.templates)

    normalizeLegacyRatioTargets()
    normalizePointDeviceIds()
    devices.value.forEach(d => ensureDeviceChain(d))
    meta.value = ensureBusinessMeta(meta.value)

    // 仅「从未初始化」且「无任何业务数据」时播种示例（非破坏性：用户主动清空后不再恢复）
    if (firstLaunch && isEmptyData()) {
      seedDemo()
    }

    ready.value = true
    loading.value = false
    // 归一化/播种若产生变更则落库（无变更不写），确保下次启动读到已回填状态
    if (snapshotJSON() !== before) {
      await persistAll()
    }
    lsSet(LS.VER, APP_VER)
  }

  function lsGet (k, fb) {
    try {
      const v = localStorage.getItem(k)
      return v ? JSON.parse(v) : fb
    } catch (e) { return fb }
  }

  /** 键是否存在（区别于取默认值，用于首启判定） */
  function lsHas (k) {
    try { return localStorage.getItem(k) !== null } catch (e) { return false }
  }

  /** 业务数据是否全空（用于判断是否需要播种示例数据） */
  function isEmptyData () {
    return !(projects.value.length || points.value.length || devices.value.length ||
      Object.keys(notes.value).length || Object.keys(bills.value).length ||
      Object.keys(devSort.value).length || Object.keys(devBrands.value).length)
  }

  /** 全量数据快照（JSON 序列化后比较是否变更） */
  function snapshotJSON () {
    return JSON.stringify([
      projects.value, points.value, devices.value, settings.value,
      meta.value, notes.value, bills.value, devSort.value, devBrands.value
    ])
  }

  // ---------- 持久化 ----------
  async function persistAll () {
    await storage.save(COLLECTIONS.projects, projects.value)
    await storage.save(COLLECTIONS.points, points.value)
    await storage.save(COLLECTIONS.devices, devices.value)
    await storage.save(COLLECTIONS.settings, settings.value)
    await persistMeta()
    await storage.save(COLLECTIONS.bills, bills.value)
    await storage.save(COLLECTIONS.devSort, devSort.value)
    await storage.save(COLLECTIONS.devBrands, devBrands.value)
  }

  async function persistMeta () {
    meta.value = ensureBusinessMeta(meta.value)
    await storage.save(COLLECTIONS.meta, meta.value)
    await storage.save(COLLECTIONS.notes, notes.value)
  }

  async function saveAll () {
    await persistAll()
    lsSet(LS.VER, APP_VER)
  }

  // ---------- Toast ----------
  function toast (msg) {
    toastMsg.value = msg
    toastVisible.value = true
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastVisible.value = false }, 2600)
  }

  // ---------- 推导链 ----------
  /** 当前子系统的推导链（前端 → 传输/存储/固定 全部设备，含每环数量与公式） */
  function chainOf (pid, sub) {
    return deriveChain(devices.value, points.value, projectById(pid), sub)
  }
  /** 链上某设备单价（项目选型 > 默认型号） */
  function chainUnitPrice (pid, device) {
    if (!device) return null
    const sel = selectionOf({ meta: meta.value, devBrands: devBrands.value }, projectById(pid), device)
    return sel && sel.unitPrice != null ? Number(sel.unitPrice) : null
  }
  /** 将推导数量写入点表（后端设备行若无则新建，有则覆盖数量） */
  function applyChainToPoints (pid, sub, rows, onlyIds) {
    const picked = rows.filter(r => !onlyIds || onlyIds.indexOf(r.device.id) >= 0)
    let changed = 0
    let added = 0
    picked.forEach(r => {
      if (r.device.category === '前端设备' || r.qty == null) return
      const pt = points.value.find(x => x.项目ID === pid && (x['设备ID'] === r.device.id || (x.子系统 === sub && x.设备类型 === r.device.name)))
      if (pt) {
        if (Number(pt.数量) !== Number(r.qty)) {
          pt.数量 = Number(r.qty)
          pt.备注 = (pt.备注 || '').replace(/；?链式推导[^；]*/g, '').replace(/^；|；$/g, '') + (pt.备注 ? '；' : '') + '链式推导'
          pt.updatedAt = nowISO()
          changed++
        }
      } else {
        points.value.push({ id: uid('dq'), 项目ID: pid, 子系统: sub, 点位名称: '', 安装位置: '', 设备类型: r.device.name, 设备ID: r.device.id, 数量: Number(r.qty), 备注: '链式推导', updatedAt: nowISO() })
        added++
      }
    })
    return { changed, added }
  }
  /** 就地改承载参数并落库（卡片编辑调用） */
  async function saveChain (device, chain) {
    if (!device) return
    device.chain = chain || null
    await saveAll()
  }

  // ---------- 价格治理 ----------
  /** 全库缺价体检：返回 [ { device, brand, model, unitPrice, sub, msg } ]；msg = 未配价 | 空品牌 | 无单价 */
  function priceAudit () {
    const out = []
    devices.value.filter(d => d.status !== '归档').forEach(d => {
      const bs = devBrands.value[d.id] || []
      if (!bs.length) {
        out.push({ device: d, brand: '', model: '', unitPrice: null, sub: d.subsystem, msg: '未配品牌价格' })
        return
      }
      bs.forEach(b => {
        if (!b.brand) out.push({ device: d, brand: '', model: b.model || '', unitPrice: b.unitPrice != null ? Number(b.unitPrice) : null, sub: d.subsystem, msg: '空品牌' })
        else if (b.unitPrice == null || b.unitPrice === '') out.push({ device: d, brand: b.brand, model: b.model || '', unitPrice: null, sub: d.subsystem, msg: '有品牌无单价' })
      })
    })
    return out
  }

  /** 批量调价：对指定品牌（或全部）的单价统一调整；pct = 百分比（10 为 +10%，-5 为 -5%），round 取值 */
  function bulkAdjustPrice (brand, pct, roundTo = 10) {
    const pctN = Number(pct) || 0
    if (!pctN) return { devices: 0, variants: 0 }
    let devCount = 0
    let varCount = 0
    Object.keys(devBrands.value).forEach(did => {
      const list = devBrands.value[did]
      if (!list || !list.length) return
      let touched = false
      list.forEach(v => {
        if (brand && v.brand !== brand) return
        if (v.unitPrice == null || v.unitPrice === '') return
        const cur = Number(v.unitPrice)
        let nv = cur * (1 + pctN / 100)
        if (roundTo > 0) nv = Math.round(nv / roundTo) * roundTo
        // 防归零/负价：极端下调后保留不小于 1 的有效单价
        if (!(nv > 0)) nv = 1
        v.unitPrice = nv
        varCount++
        touched = true
      })
      if (touched) devCount++
    })
    return { devices: devCount, variants: varCount }
  }

  /** 品牌替换：把 oldBrand 所有型号改为 newBrand；targetOldPrice 若提供则同步替换为对应新价（近似） */
  function replaceBrand (oldBrand, newBrand) {
    let moved = 0
    Object.keys(devBrands.value).forEach(did => {
      const list = devBrands.value[did]
      if (!list || !list.length) return
      list.forEach(v => {
        if (v.brand === oldBrand) {
          v.brand = newBrand
          moved++
        }
      })
    })
    return { moved }
  }

  // ---------- 项目 CRUD ----------
  function newProject (data) {
    const p = {
      id: uid('prj'),
      项目名称: '', 项目编号: '', 建筑类型: settings.value.buildingTypes[0] || '', 客户: '',
      项目地址: '', 建筑面积: '', 设计阶段: settings.value.globalParams.defaultStage || '施工图设计',
      状态: '设计中', 开始日期: todayStr(), 预计结束日期: '', 备注: '',
      ...data
    }
    projects.value.push(p)
    return p
  }

  function updateProject (p, data) {
    // 阶段流转日志：先记录旧阶段再赋值，避免比较恒等导致日志永不触发
    const from = p.设计阶段
    Object.assign(p, data)
    if (from && data && data.设计阶段 && data.设计阶段 !== from) {
      const log = meta.value.stageLog || (meta.value.stageLog = {})
      log[p.id] = log[p.id] || []
      log[p.id].push({ at: nowISO(), from, to: data.设计阶段 })
    }
    return p
  }

  function deleteProject (id) {
    const p = projectById(id)
    if (!p) return
    projects.value = projects.value.filter(x => x.id !== id)
    points.value = points.value.filter(x => x.项目ID !== id)
    if (bills.value[id]) delete bills.value[id]
    Object.keys(notes.value).forEach(k => { if (k.indexOf(id + '|') === 0) delete notes.value[k] })
    if (meta.value.stageLog && meta.value.stageLog[id]) delete meta.value.stageLog[id]
    if (meta.value.billAt && meta.value.billAt[id]) delete meta.value.billAt[id]
    if (meta.value.projectSelections && meta.value.projectSelections[id]) delete meta.value.projectSelections[id]
    if (meta.value.projectSchemes && meta.value.projectSchemes[id]) delete meta.value.projectSchemes[id]
    if (meta.value.projectBudget && meta.value.projectBudget[id]) delete meta.value.projectBudget[id]
  }

  function copyProject (pid) {
    const src = projectById(pid)
    if (!src) return null
    const np = {}
    Object.keys(src).forEach(k => { np[k] = Array.isArray(src[k]) ? src[k].slice() : src[k] })
    np.id = uid('prj')
    const baseName = src.项目名称.replace(/（副本\d*）$/, '').replace(/\(副本\d*\)$/, '')
    let name = baseName + '（副本）'
    let n = 2
    while (projects.value.some(x => x.项目名称 === name)) name = baseName + '（副本' + (n++) + '）'
    np.项目名称 = name
    if (np.项目编号 && projects.value.some(x => x.项目编号 === np.项目编号)) {
      const bc = src.项目编号.replace(/-\d+$/, '')
      let m = 2
      let nc = bc + '-2'
      while (projects.value.some(x => x.项目编号 === nc)) nc = bc + '-' + (m++)
      np.项目编号 = nc
    }
    np.状态 = '设计中'
    np.开始日期 = todayStr()
    projects.value.push(np)
    points.value.filter(x => x.项目ID === pid).forEach(pt => {
      const npt = {}
      Object.keys(pt).forEach(k => { npt[k] = Array.isArray(pt[k]) ? pt[k].slice() : pt[k] })
      npt.id = uid('dq')
      npt.项目ID = np.id
      npt.updatedAt = nowISO()
      points.value.push(npt)
    })
    Object.keys(notes.value).forEach(k => {
      if (k.indexOf(pid + '|') === 0) notes.value[np.id + k.slice(pid.length)] = notes.value[k]
    })
    if (bills.value[pid]) bills.value[np.id] = bills.value[pid].slice()
    if (meta.value.billAt[pid]) meta.value.billAt[np.id] = meta.value.billAt[pid]
    if (meta.value.projectSelections[pid]) meta.value.projectSelections[np.id] = JSON.parse(JSON.stringify(meta.value.projectSelections[pid]))
    if (meta.value.projectBudget[pid]) meta.value.projectBudget[np.id] = JSON.parse(JSON.stringify(meta.value.projectBudget[pid]))
    if (meta.value.projectSchemes && meta.value.projectSchemes[pid]) meta.value.projectSchemes[np.id] = JSON.parse(JSON.stringify(meta.value.projectSchemes[pid]))
    return np
  }

  function setProjectStatus (id, status) {
    const p = projectById(id)
    if (!p) return
    p.状态 = status
  }

  function setProjectBudget (p) {
    const cfg = meta.value.projectBudget[p.id] || (meta.value.projectBudget[p.id] = {})
    cfg.defaultTier = tierName(cfg.defaultTier)
    cfg.budget = Number(cfg.budget) || 0
    cfg.budgetMode = cfg.budgetMode || 'strict'
    cfg.budgetTolerance = Number(cfg.budgetTolerance) || 5
    cfg.subsystemTiers = cfg.subsystemTiers || {}
    cfg.deviceOverrides = cfg.deviceOverrides || {}
    cfg.subsystemBrands = cfg.subsystemBrands || {}
    cfg.deviceBrandOverrides = cfg.deviceBrandOverrides || {}
    cfg.deviceModelOverrides = cfg.deviceModelOverrides || {}
    return cfg
  }

  function projectBudget (pid) {
    if (!meta.value.projectBudget) meta.value.projectBudget = {}
    return meta.value.projectBudget[pid] || {}
  }

  /** 批量增减点数量：ids 为空则作用于子系统全部点位；op = '+'|'-'|'*'，val 为数值 */
  function bulkAdjustPoints (pid, sub, op, val) {
    const n = Number(val) || 0
    if (!n) return { changed: 0 }
    let changed = 0
    points.value.filter(x => x.项目ID === pid && x.子系统 === sub).forEach(x => {
      const cur = Number(x.数量) || 0
      let nxt = cur
      if (op === '+') nxt = cur + n
      else if (op === '-') nxt = Math.max(0, cur - n)
      else if (op === '*') nxt = Math.round(cur * n)
      if (nxt !== cur && nxt > 0) {
        x.数量 = nxt
        x.备注 = (x.备注 || '') + '；批量' + (op === '*' ? '×' + n : (op === '-' ? '-' + n : '+' + n))
        x.updatedAt = nowISO()
        changed++
      } else if (nxt === 0 && cur !== 0) {
        x.数量 = 0
        x.updatedAt = nowISO()
        changed++
      }
    })
    return { changed }
  }

  // ---------- 项目选型 ----------
  /** 指定某设备在当前项目的品牌型号（存 meta.projectSelections）；overrides 为 null 表示清除选型回默认 */
  function setProjectSelection (pid, deviceId, sel) {
    meta.value.projectSelections = meta.value.projectSelections || {}
    const m = meta.value.projectSelections[pid] || (meta.value.projectSelections[pid] = {})
    if (sel && sel.brand) m[deviceId] = { brand: sel.brand, model: sel.model || '', tier: sel.tier || '标准型', param: sel.param || '', unitPrice: Number(sel.unitPrice) || null, source: '人工指定' }
    else delete m[deviceId]
  }

  /** 按配置档次批量选型：把该项目所有设备统一选到某档（tierName），无该档型号的设备跳过 */
  function bulkSelectionByTier (pid, sub, tierName) {
    let applied = 0
    devices.value.filter(d => d.subsystem === sub && d.status !== '归档').forEach(d => {
      const variants = devBrands.value[d.id] || []
      const hit = variants.find(v => v.tier === tierName && v.brand) || variants[0]
      if (!hit || !hit.brand) return
      const cur = getProjectSelection(meta.value, projectById(pid), d.id)
      if (cur && cur.brand === hit.brand && Number(cur.unitPrice) === Number(hit.unitPrice)) return
      setProjectSelection(pid, d.id, { brand: hit.brand, model: hit.model, tier: hit.tier, param: hit.param, unitPrice: hit.unitPrice })
      applied++
    })
    return applied
  }

  // ---------- 模板 ----------
  /** 应用模板：生成设备字典（不重复）+ 点表骨架，幂等 */
  function applyTemplate (tpl, p) {
    let addDev = 0
    let addPt = 0
    let skipPt = 0
    tpl.subsystems.forEach(s => {
      if (!settings.value.subsystems.some(x => x.name === s.name)) {
        settings.value.subsystems.push({ id: uid('sp'), name: s.name, category: '未分类', fields: [] })
      }
      s.devices.forEach(d => {
        let exDev = devices.value.find(x => x.subsystem === s.name && x.name === d.name)
        if (!exDev) {
          exDev = { id: uid('dv'), subsystem: s.name, name: d.name, spec: d.spec || '', unit: d.unit || '台', category: d.category || '前端设备', quota: d.quota || [], ratio: d.ratio || null, chain: d.chain || null }
          if (d.auto) exDev.auto = d.auto
          devices.value.push(exDev)
          addDev++
        }
        if (d.category === '前端设备') {
          const dup = points.value.some(x => x.项目ID === p.id && (x['设备ID'] === exDev.id || (x.子系统 === s.name && x.设备类型 === d.name)))
          if (!dup) {
            points.value.push({ id: uid('dq'), 项目ID: p.id, 子系统: s.name, 点位名称: '', 安装位置: '', 设备类型: d.name, 设备ID: exDev.id, 数量: 0, 备注: '模板生成', updatedAt: todayStr() })
            addPt++
          } else skipPt++
        }
      })
    })
    return { addDev, addPt, skipPt }
  }

  /** 存为模板：只提取当前项目实际使用的子系统与设备 */
  function saveProjectAsTemplate (p, name) {
    if (!name) return null
    const used = {}
    points.value.filter(x => x.项目ID === p.id).forEach(x => {
      if (!used[x.子系统]) used[x.子系统] = {}
      used[x.子系统][x.设备类型] = 1
    })
    const subNames = Object.keys(used)
    if (!subNames.length) return null
    const tpl = {
      id: uid('tpl'), name, 建筑类型: p.建筑类型 || '',
      subsystems: subNames.map(sn => ({
        name: sn,
        devices: devices.value.filter(d => d.subsystem === sn && used[sn][d.name]).map(d => {
          const dd = {
            name: d.name, spec: d.spec || '', unit: d.unit || '', category: d.category || '前端设备',
            quota: d.quota || [], ratio: d.ratio || null
          }
          if (d.auto) dd.auto = d.auto
          if (d.chain) dd.chain = d.chain
          return dd
        })
      })).filter(s => s.devices.length)
    }
    if (!tpl.subsystems.length) return null
    settings.value.templates = settings.value.templates || []
    settings.value.templates.push(tpl)
    return tpl
  }

  /** 模板起盘：按模板生成完整项目骨架（子系统+设备+点表），并按建筑指标自动推算各前端设备的建议数量 */
  function bootstrapFromTemplate (tpl, data) {
    if (!tpl) return null
    const p = newProject({
      项目名称: data && data.项目名称 ? data.项目名称.trim() : (tpl.name ? tpl.name + '项目' : '未命名项目'),
      项目编号: (data && data.项目编号) || '',
      建筑类型: (data && data.建筑类型) || tpl.建筑类型 || '',
      客户: (data && data.客户) || '',
      项目地址: (data && data.项目地址) || '',
      建筑面积: parseFloat((data && data.建筑面积)) || 0,
      建筑楼层数: parseInt((data && data.建筑楼层数)) || 0,
      房间数: parseInt((data && data.房间数)) || 0,
      备注: '由模板「' + tpl.name + '」起盘' + ((data && data.备注) ? '；' + data.备注 : '')
    })
    const tr = applyTemplate(tpl, p)
    // 按建筑指标自动推算前端设备数量：优先模板自带密度 auto（area/floor/room），其次全局设计定额
    let autoQty = 0
    const auto = []
    tpl.subsystems.forEach(s => {
      const tplDevBy = {}
      ;(s.devices || []).forEach(td => { tplDevBy[td.name] = td })
      points.value.filter(x => x.项目ID === p.id && x.子系统 === s.name).forEach(pt => {
        const d = resolveDevice(devices.value, s.name, pt.设备类型, pt['设备ID'])
        if (!d || d.category !== '前端设备') return
        const td = tplDevBy[pt.设备类型]
        const autoHint = td && td.auto
        let q = 0
        let method = ''
        if (autoHint) {
          const per = Number(autoHint.per) || 1
          if (autoHint.method === 'room') { q = (parseInt(p.房间数) || 0) ? Math.ceil((parseInt(p.房间数) || 0) / per) : 0 }
          else if (autoHint.method === 'floor') { q = (parseInt(p.建筑楼层数) || 0) ? Math.ceil((parseInt(p.建筑楼层数) || 0) * per) : 0 }
          else { q = p.建筑面积 ? Math.ceil(p.建筑面积 / per) : 0 }
          method = autoHint.method || 'area'
        } else {
          const rule = quotaRuleFor(settings.value, s.name, d.id, p.建筑类型)
          if (rule) {
            q = calcRuleQty(rule, p)
            method = rule.method || 'area'
          }
        }
        if (q > 0) {
          pt.数量 = q
          pt.备注 = (pt.备注 || '模板起盘') + '；定额推算·' + method
          pt.updatedAt = nowISO()
          autoQty += q
          auto.push(d.name + '×' + q)
        }
      })
    })
    return { p, tr, autoQty, auto, subCount: tpl.subsystems.length }
  }

  /** 克隆项目并按比例缩放点位（面积法：新面积/旧面积；也可按楼层倍数） */
  function cloneScaledProject (srcId, data) {
    const np = copyProject(srcId)
    const src = projectById(srcId)
    if (!np || !src) return np
    const newArea = parseFloat(data && data.建筑面积)
    const oldArea = parseFloat(src.建筑面积) || 0
    const newFloors = parseInt(data && data.建筑楼层数)
    const oldFloors = parseInt(src.建筑楼层数) || 0
    let scale = 1
    if (newArea > 0 && oldArea > 0 && data && data.scaleBy === 'floor') {
      scale = oldFloors > 0 ? newFloors / oldFloors : 1
    } else if (newArea > 0 && oldArea > 0) {
      scale = newArea / oldArea
    }
    if (scale > 0 && Math.abs(scale - 1) > 0.001) {
      points.value.filter(x => x.项目ID === np.id).forEach(x => {
        const n = Math.round((Number(x.数量) || 0) * scale)
        x.数量 = Math.max(1, n)
        x.备注 = (x.备注 || '') + '；面积缩放×' + scale.toFixed(2)
        x.updatedAt = nowISO()
      })
    }
    if (data && data.项目名称) {
      const bn = data.项目名称.trim()
      let name = bn; let i2 = 2
      while (projects.value.some(x => x.项目名称 === name)) name = bn + '（' + (i2++) + '）'
      np.项目名称 = name
    }
    return np
  }

  function deleteTemplate (id) {
    settings.value.templates = (settings.value.templates || []).filter(t => t.id !== id)
  }

  // ---------- 点位（设备点表） ----------
  function addPoint (data) {
    const pt = {
      id: uid('dq'), 项目ID: '', 子系统: '', 点位名称: '', 安装位置: '', 设备类型: '',
      设备ID: '', 数量: 1, 备注: '', updatedAt: nowISO(),
      ...data
    }
    points.value.push(pt)
    return pt
  }

  function savePoint (pt, data) {
    Object.assign(pt, data, { updatedAt: nowISO() })
    return pt
  }

  function deletePoint (id) {
    points.value = points.value.filter(x => x.id !== id)
  }

  /** 一键带出：字典前端设备 → 点表（已存在跳过） */
  function buildBringOut (p, sub) {
    const has = {}
    pointsOfSub(p.id, sub).forEach(x => { has[x['设备ID'] || x.设备类型] = 1 })
    return devices.value
      .filter(d => d.subsystem === sub && d.status !== '归档' && d.category === '前端设备' && !has[d.id] && !has[d.name])
      .map(d => ({ id: uid('dq'), 项目ID: p.id, 子系统: sub, 点位名称: '', 安装位置: '', 设备类型: d.name, 设备ID: d.id, 数量: 1, 备注: '一键带出', updatedAt: todayStr() }))
  }

  /** 批量保存点表：name→{qty,note} 列表 */
  function batchSavePoints (p, sub, entries) {
    const has = {}
    pointsOfSub(p.id, sub).forEach(x => { has[x['设备ID'] || x.设备类型] = x })
    let added = 0
    let upd = 0
    entries.forEach(e => {
      if (!(Number(e.qty) > 0)) return
      const dv = resolveDevice(devices.value, sub, e.name, null)
      const cur = has[dv ? dv.id : e.name]
      if (cur) {
        Object.assign(cur, { 数量: Number(e.qty), 备注: e.note || '', updatedAt: nowISO() })
        if (dv) cur['设备ID'] = dv.id
        upd++
      } else {
        points.value.push({ id: uid('dq'), 项目ID: p.id, 子系统: sub, 点位名称: '', 安装位置: '', 设备类型: dv ? dv.name : e.name, 设备ID: dv ? dv.id : '', 数量: Number(e.qty), 备注: e.note || '', updatedAt: nowISO() })
        added++
      }
    })
    return { added, upd }
  }

  /** 按设备批量删除点表行（批量添加弹窗内的批量删除） */
  function deletePointsOfDevices (pid, sub, devIds) {
    const set = new Set(devIds)
    const names = new Set()
    devices.value.filter(d => set.has(d.id)).forEach(d => names.add(d.name))
    const before = points.value.length
    points.value = points.value.filter(x =>
      !(x.项目ID === pid && x.子系统 === sub && (set.has(x['设备ID']) || names.has(x.设备类型))))
    return before - points.value.length
  }

  function parsePointCSV (text) {
    const rows = []
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return
      if (i === 0 && line.indexOf('设备类型') >= 0) return
      const parts = line.split(/[,，\t]/).map(s => s.trim())
      const type = parts[0]
      if (!type) return
      const qRaw = parseInt(parts[1], 10)
      // 保留用户填写的 0（表示清除数量），仅当数量缺失/非法时默认 1
      rows.push({ 设备类型: type, 数量: Number.isNaN(qRaw) ? 1 : qRaw, 备注: parts[2] || '' })
    })
    return rows
  }

  function importPointsCSV (p, sub, text) {
    const rows = parsePointCSV(text)
    if (!rows.length) return { ok: false, msg: '未解析到有效数据（格式：设备类型,数量,备注）' }
    const has = {}
    pointsOfSub(p.id, sub).forEach(x => { has[x.设备类型] = x })
    let add = 0
    let upd = 0
    let skip = 0
    rows.forEach(r => {
      // 数量 <= 0 的行视为无效（CSV 里显式填 0 也跳过，避免污染点表）
      if (!(Number(r.数量) > 0)) { skip++; return }
      const dv = resolveDevice(devices.value, sub, r.设备类型, null)
      if (!dv) { skip++; return }
      const cur = has[r.设备类型]
      if (cur) {
        Object.assign(cur, { 数量: r.数量, 备注: r.备注, updatedAt: nowISO(), 设备ID: dv.id })
        upd++
      } else {
        points.value.push({ id: uid('dq'), 项目ID: p.id, 子系统: sub, 点位名称: '', 安装位置: '', 设备类型: r.设备类型, 设备ID: dv.id, 数量: r.数量, 备注: r.备注, updatedAt: nowISO() })
        add++
      }
    })
    return { ok: true, add, upd, skip }
  }

  /** 数量推算：返回行列数据；应用后返回变更统计 */
  function autoQtyImpact (p, sub) {
    const existing = {}
    pointsOfSub(p.id, sub).forEach(x => { existing[x['设备ID'] || x.设备类型] = x })
    const devs = devicesOfSub(sub).filter(d => d.category === '前端设备' || d.category === '后端设备')
    const rows = devs.map(d => {
      const s = suggestQtyForDevice({
        settings: settings.value, points: points.value, devices: devices.value
      }, p, d, sub)
      const cur = existing[d.id] ? Number(existing[d.id].数量) || 0 : 0
      if (s.qty != null) return { device: d, current: cur, suggested: s.qty, rule: s.rule }
      return null
    }).filter(Boolean)
    return rows
  }

  function applyAutoQty (p, sub, picked) {
    let changed = 0
    let added = 0
    picked.forEach(r => {
      const pt = points.value.find(x => x.项目ID === p.id && (x['设备ID'] === r.device.id || (x.子系统 === sub && x.设备类型 === r.device.name)))
      if (pt) {
        if (Number(pt.数量) !== Number(r.suggested)) {
          pt.数量 = Number(r.suggested)
          pt.备注 = (pt.备注 || '').replace(/；?数量推算[^；]*/g, '').replace(/^；|；$/g, '') + (pt.备注 ? '；' : '') + '数量推算·' + (r.rule ? r.rule.method : '配比')
          pt.updatedAt = nowISO()
          changed++
        }
      } else {
        points.value.push({
          id: uid('dq'), 项目ID: p.id, 子系统: sub, 点位名称: '', 安装位置: '',
          设备类型: r.device.name, 设备ID: r.device.id, 数量: Number(r.suggested),
          备注: '数量推算·' + (r.rule ? r.rule.method : '配比'), updatedAt: nowISO()
        })
        added++
      }
    })
    return { changed, added }
  }

  // ---------- 设计说明 ----------
  function saveNote (pid, sub, text) {
    const k = pid + '|' + sub
    if (text) notes.value[k] = text
    else delete notes.value[k]
  }

  // ---------- 清单生成 ----------
  let billCache = null
  let billOf = null

  /** computeBill 需要的纯状态快照 */
  function stateRef () {
    return {
      settings: settings.value,
      meta: meta.value,
      devices: devices.value,
      devBrands: devBrands.value,
      points: points.value,
      bills: bills.value,
      notes: notes.value
    }
  }

  /** 生成施工清单：与缓存对比，若一致直接保存；不一致返回 diff 供确认 */
  function prepareBill (p) {
    const bill = computeBill(stateRef(), p)
    let diff = null
    if (billCache && billCache.length && billOf === p.id) {
      diff = diffBill(billCache, bill)
    }
    return { bill, diff }
  }

  function commitBill (p, bill) {
    const histList = normalizeBillList(bills.value[p.id])
    const entry = newBillEntry('施工清单-' + stamp2(), bill, settings.value, meta.value, meta.value.projectSelections[p.id] || {})
    histList.push(entry)
    bills.value[p.id] = histList
    billCache = bill.slice()
    billOf = p.id
    meta.value.billAt[p.id] = nowISO()
    p.清单状态 = '已生成'
    saveAll().then(() => toast('施工清单已生成，价格与选型已冻结'))
  }

  function setBillViewCache (p, rows) {
    billCache = rows.slice()
    billOf = p.id
  }

  // ---------- 设备字典 ----------
  function addDevice (data) {
    const d = { id: uid('dv'), subsystem: '', name: '', spec: '', unit: '台', category: '前端设备', quota: [], ratio: null, ...data }
    devices.value.push(d)
    return d
  }
  function saveDevice (d, data) { Object.assign(d, data); return d }
  /** 清理某设备被删后的全部悬空引用（品牌价格/选型/方案/推导链/排序/点表设备ID） */
  function purgeDeviceRefs (id, name, sub) {
    // 1) 品牌型号价格
    if (devBrands.value[id]) delete devBrands.value[id]
    // 2) 排序
    if (devSort.value[id]) delete devSort.value[id]
    // 3) 项目选型 / 方案（按设备 id 清除）
    Object.keys(meta.value.projectSelections || {}).forEach(pid => {
      const sel = meta.value.projectSelections[pid] || {}
      if (sel[id]) delete sel[id]
    })
    Object.keys(meta.value.projectSchemes || {}).forEach(pid => {
      const sch = meta.value.projectSchemes[pid] || {}
      if (sch[id]) delete sch[id]
    })
    // 4) 其他设备推导链 / 配比规则中的引用（多来源、单来源）
    devices.value.forEach(d => {
      if (d.id === id) return
      if (d.chain) {
        if (d.chain.source === id) { d.chain.source = 'front'; d.chain.sources = (d.chain.sources || []).filter(s => s !== id) }
        if (d.chain.sources) d.chain.sources = d.chain.sources.filter(s => s !== id)
      }
      if (d.ratio && d.ratio.targetDeviceId === id) d.ratio.targetDeviceId = null
    })
    // 5) 点表：清除指向已删设备的 设备ID（保留设备类型字符串，供按名称解析回退）
    points.value.forEach(x => { if (x['设备ID'] === id) delete x['设备ID'] })
  }
  function deleteDevice (id) {
    const d = devById(id)
    if (!d) return
    const { name, subsystem } = d
    // 保留点表里的历史值（设备类型字符串），但清理所有悬空引用
    purgeDeviceRefs(id, name, subsystem)
    devices.value = devices.value.filter(x => x.id !== id)
  }
  function copyDevice (id) {
    const d = devById(id)
    if (!d) return null
    // chain/ratio 均深拷贝，避免副本与源共享引用造成串扰
    const nd = {
      ...d,
      id: uid('dv'),
      name: d.name + '（副本）',
      quota: JSON.parse(JSON.stringify(d.quota || [])),
      ratio: d.ratio ? JSON.parse(JSON.stringify(d.ratio)) : null,
      chain: d.chain ? JSON.parse(JSON.stringify(d.chain)) : null
    }
    devices.value.push(nd)
    return nd
  }
  function moveDevice (id, dir) {
    // 在当前子系统、非归档的设备视图定位相邻位，并交换全量数组中的实际位置。
    // 两个 splice(替换) 每次使用真实下标 indexOf 定位，数组长度保持不变，
    // 因此无论视图中是否夹带归档设备，交换都自校正为正确结果。
    const list = devicesOfSub(devById(id)?.subsystem)
    const idx = list.findIndex(d => d.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= list.length) return
    const a = list[idx]
    const b = list[target]
    const ia = devices.value.indexOf(a)
    const ib = devices.value.indexOf(b)
    if (ia < 0 || ib < 0 || ia === ib) return
    devices.value.splice(ia, 1, b)
    devices.value.splice(ib, 1, a)
  }

  // ---------- 子系统 / 品牌 / 分类（设置） ----------
  function addSubsystem (s) { const x = { id: uid('sp'), fields: [], ...s }; settings.value.subsystems.push(x); return x }
  function saveSubsystem (s, data) { Object.assign(s, data); return s }
  function deleteSubsystem (id) {
    const x = settings.value.subsystems.find(s => s.id === id)
    if (!x) return
    settings.value.subsystems = settings.value.subsystems.filter(s => s.id !== id)
    // 级联清理：该子系统的设备、设备价格、点表行
    devices.value.filter(d => d.subsystem === x.name).forEach(d => { purgeDeviceRefs(d.id, d.name, d.subsystem) })
    devices.value = devices.value.filter(d => d.subsystem !== x.name)
    points.value = points.value.filter(pt => pt.子系统 !== x.name)
  }

  function addBrand (b) { settings.value.brands = settings.value.brands || []; const x = { id: uid('br'), status: '启用', ...b }; settings.value.brands.push(x); return x }
  function saveBrand (b, data) { Object.assign(b, data); return b }
  function deleteBrand (id) { settings.value.brands = (settings.value.brands || []).filter(b => b.id !== id) }

  function addSubCategory (c) { if (!settings.value.subCategories.includes(c)) settings.value.subCategories.push(c) }
  function removeSubCategory (c) { settings.value.subCategories = settings.value.subCategories.filter(x => x !== c) }
  function addBuildingType (b) { if (!settings.value.buildingTypes.includes(b)) settings.value.buildingTypes.push(b) }
  function removeBuildingType (b) { settings.value.buildingTypes = settings.value.buildingTypes.filter(x => x !== b) }

  // 材料价格（数组结构：按 名称+规格+单位 匹配更新；品牌默认国产/型号国产优质）
  function setMaterialPrice (name, spec, unit, price) {
    settings.value.materialPrices = settings.value.materialPrices || []
    const hit = settings.value.materialPrices.find(m => m && m.name === name && (m.spec || '') === (spec || '') && (m.unit || '') === (unit || ''))
    if (price === '' || price == null) {
      if (hit) settings.value.materialPrices = settings.value.materialPrices.filter(m => m !== hit)
      return
    }
    if (hit) hit.price = Number(price)
    else settings.value.materialPrices.push({ id: 'mp_' + Date.now().toString(36), name, spec: spec || '', unit: unit || 'm', cat: '管材线缆', brand: '国产', model: '国产优质', price: Number(price) })
  }

  // 设计定额
  function addQuota (q) {
    settings.value.designQuotas = settings.value.designQuotas || []
    const r = { id: uid('dqrule'), min: Number(q.min) || 0, max: Number(q.max) || 0, per: Number(q.per) || 1, method: q.method || 'area', buildingType: q.buildingType || '全部业态', ...q }
    settings.value.designQuotas.push(r)
    return r
  }
  function saveQuota (q, data) { ensureDesignQuotas(settings.value); Object.assign(q, data); return q }
  function deleteQuota (id) { settings.value.designQuotas = (settings.value.designQuotas || []).filter(q => q.id !== id) }

  // 全局参数
  function setGlobalParam (k, v) { settings.value.globalParams[k] = v }

  // 演示数据：清空/恢复时同步清理设备字典与设备级数据（保留子系统/参数等基础配置）
  function clearDemo () {
    projects.value = []
    points.value = []
    notes.value = {}
    bills.value = {}
    devices.value = []
    devSort.value = {}
    devBrands.value = {}
    meta.value = ensureBusinessMeta({ ...meta.value, stageLog: {}, billAt: {}, projectSelections: {}, projectSchemes: {}, projectBudget: {} })
  }
  function seedDemo () {
    projects.value = seedProjects()
    points.value = seedPoints()
    devices.value = seedDevices()
    notes.value = seedNotes()
    bills.value = {}
    devSort.value = {}
    devBrands.value = {}
    meta.value = seedMeta()
  }

  // ---------- 备份 ----------
  function exportJSON () {
    const payload = {
      app: 'rw-station', ver: APP_VER, exportedAt: nowISO(),
      projects: projects.value, points: points.value, devices: devices.value,
      settings: settings.value, meta: meta.value, notes: notes.value,
      bills: bills.value, devSort: devSort.value, devBrands: devBrands.value
    }
    downloadBlob('弱电工作台备份-' + todayStr() + '.json', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  }

  async function importJSON (text) {
    try {
      const d = JSON.parse(text)
      projects.value = d.projects || []
      points.value = d.points || []
      devices.value = d.devices || []
      settings.value = { ...defaultSettings(), ...(d.settings || {}) }
      meta.value = ensureBusinessMeta(d.meta || {})
      notes.value = d.notes || {}
      bills.value = d.bills || {}
      devSort.value = d.devSort || {}
      devBrands.value = d.devBrands || {}
      normalizeLegacyRatioTargets()
      normalizePointDeviceIds()
      ensureDesignQuotas(settings.value)
      patchTemplatesAuto(settings.value.templates)
      devices.value.forEach(d => ensureDeviceChain(d))
      await saveAll()
      return true
    } catch (e) {
      return false
    }
  }

  // ---------- 导出（清单 / 点表） ----------
  /** 删除某项目的一条历史清单 */
  function deleteBill (pid, billId) {
    const list = normalizeBillList(bills.value[pid])
    const idx = list.findIndex(b => b.id === billId)
    if (idx < 0) return false
    list.splice(idx, 1)
    if (list.length) bills.value[pid] = list
    else delete bills.value[pid]
    return true
  }

  async function exportBillXlsx (p, bill) {
    const sheets = buildBillSheetsBySub(bill, subRows => buildBillRows(stateRef(), p, subRows), quoteOfBill(p, bill).rows)
    const blob = buildXlsx(sheets)
    await downloadBlob(`施工清单-${p.项目编号 || p.项目名称}-${todayStr()}.xlsx`, blob)
  }

  /** 由指定清单行计算报价汇总：统一返回 { quote: {order, devAmt, matAmt, total}, markup, tax, finalAmt, rows } */
  function quoteOfBill (p, bill) {
    const bySub = {}
    const order = []
    let devAmt = 0
    let matAmt = 0
    bill.forEach(r => {
      if (!bySub[r.sub]) { bySub[r.sub] = { dev: 0, mat: 0 }; order.push(r.sub) }
      if (r.cat === '前端设备' || r.cat === '后端设备') {
        const price = r.unitPrice != null && r.unitPrice !== '' ? Number(r.unitPrice) : null
        if (price != null) {
          const amt = Math.round(price * r.qty * 100) / 100
          bySub[r.sub].dev += amt
          devAmt += amt
        }
      } else {
        const pr = r.materialUnitPrice != null && r.materialUnitPrice !== '' ? Number(r.materialUnitPrice) : null
        if (pr != null) {
          const amt2 = Math.round(pr * r.qty * 100) / 100
          bySub[r.sub].mat += amt2
          matAmt += amt2
        }
      }
    })
    const gp = settings.value.globalParams || {}
    const markup = gp.markup || 1
    const tax = gp.tax || 0
    const total = Math.round((devAmt + matAmt) * 100) / 100
    const finalAmt = Math.round(total * markup * (1 + tax / 100) * 100) / 100
    const rows = [['弱电智能化设计工作台 · 报价汇总', p.项目名称], ['系统', '设备金额(元)', '材料金额(元)', '小计(元)']]
    order.forEach(s => rows.push([s, bySub[s].dev, bySub[s].mat, Math.round((bySub[s].dev + bySub[s].mat) * 100) / 100]))
    rows.push(['合计', devAmt, matAmt, total])
    rows.push(['调价系数', markup, '', ''])
    rows.push(['税率', tax + '%', '', ''])
    rows.push(['含税总价', finalAmt, '', ''])
    return {
      quote: {
        order: order.map(s => ({ sub: s, dev: bySub[s].dev, mat: bySub[s].mat })),
        devAmt, matAmt, total
      },
      markup, tax, finalAmt, rows
    }
  }

  /** 按当前点表实时推算的报价 */
  function quoteRowsFor (p) {
    return quoteOfBill(p, computeBill(stateRef(), p))
  }

  // ---------- 导出为 Vue 组件可用 API ----------
  return {
    // 数据
    projects, points, devices, settings, meta, notes, bills, devSort, devBrands,
    // UI 状态
    ready, loading, curTab, curView, curProjId, curSub, projFilterVal,
    toastMsg, toastVisible,
    // 查询
    projectById, pointsOfProject, pointsOfSub, devicesOfSub, devById, calcProgress,
    billOfProject: (id) => normalizeBillList(bills.value[id]),
    billQuote: (id) => {
      const p = projectById(id)
      if (!p) return null
      return quoteRowsFor(p)
    },
    quoteOfBill,
    // 初始化 / 持久化
    init, saveAll, toast,
    // 项目
    newProject, updateProject, deleteProject, copyProject, setProjectStatus,
    setProjectBudget, projectBudget, setProjectSelection, bulkSelectionByTier, selectionOf, getProjectSelection,
    // 模板
    applyTemplate, saveProjectAsTemplate, deleteTemplate, bootstrapFromTemplate, cloneScaledProject,
    bulkAdjustPoints,
    // 点位
    addPoint, savePoint, deletePoint, buildBringOut, batchSavePoints, deletePointsOfDevices,
    importPointsCSV, autoQtyImpact, applyAutoQty,
    // 说明
    saveNote,
    // 清单
    prepareBill, commitBill, setBillViewCache, computeBill, deleteBill,
    // 设备
    addDevice, saveDevice, deleteDevice, copyDevice, moveDevice, resolveDevice,
    // 推导链
    chainOf, chainUnitPrice, applyChainToPoints, saveChain, deriveChain, ensureDeviceChain, isChainDevice,
    // 价格治理
    priceAudit, bulkAdjustPrice, replaceBrand,
    // 设置
    addSubsystem, saveSubsystem, deleteSubsystem,
    addBrand, saveBrand, deleteBrand,
    addSubCategory, removeSubCategory, addBuildingType, removeBuildingType,
    setMaterialPrice, addQuota, saveQuota, deleteQuota, setGlobalParam,
    clearDemo, seedDemo,
    // 备份
    exportJSON, importJSON,
    // 导出
    exportBillXlsx, buildBillRows, rowsToCSV, rowsToTSV, downloadBlob, buildCsvBlob, copyText, buildXlsx, buildTxtBlob,
    quoteRowsFor
  }
})