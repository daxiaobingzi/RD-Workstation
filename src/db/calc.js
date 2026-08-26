// ===== 领域计算层：数量推算 / 清单生成 / 报价 / 项目进度 =====
// 全部为纯函数，入参为应用状态（store 的响应式 state 或局部快照），不直接触碰 DOM。
import { uid, ceil2, round2, tierName, todayStr, stamp2 } from './format'

// ---------- 设计定额 ----------
export function ensureDesignQuotas (settings) {
  if (!settings.designQuotas) settings.designQuotas = []
  settings.designQuotas.forEach(r => {
    r.id = r.id || uid('dqrule')
    r.min = Number(r.min) || 0
    r.max = Number(r.max) || 0
    r.per = Number(r.per) || 1
    r.method = r.method || 'area'
    r.buildingType = r.buildingType || '全部业态'
  })
  return settings.designQuotas
}

export function quotaRuleFor (settings, sub, deviceId, buildingType) {
  ensureDesignQuotas(settings)
  const rs = settings.designQuotas.filter(r => r.subsystem === sub && r.deviceId === deviceId)
  const exact = rs.find(r => r.buildingType === buildingType)
  return exact || rs.find(r => r.buildingType === '全部业态') || rs[0] || null
}

/** 定额推算：按面积 / 楼层 / 房间 / 固定 四种方法，含 min/max 约束 */
export function calcRuleQty (rule, p) {
  if (!rule || !p) return null
  const area = Number(p.建筑面积) || 0
  const floors = Number(p.建筑楼层数) || 0
  const rooms = Number(p.房间数) || 0
  const per = Math.max(0.0001, Number(rule.per) || 1)
  let q = 0
  if (rule.method === 'area') q = area ? Math.ceil(area / per) : 0
  else if (rule.method === 'floor') q = floors ? Math.ceil(floors * per) : 0
  else if (rule.method === 'room') q = rooms ? Math.ceil(rooms / per) : 0
  else q = Math.ceil(per)
  if (rule.min > 0) q = Math.max(q, Number(rule.min))
  if (rule.max > 0) q = Math.min(q, Number(rule.max))
  return q > 0 ? q : 0
}

/** 配比推算：ratio 类型设备按目标设备数量 / 子系统前端总量推算 */
export function ratioSuggestedQty (points, device, p, subTotalFront) {
  if (!device || !device.ratio) return null
  const r = device.ratio
  const per = Number(r.per) || 0
  if (per <= 0) return null
  if (r.type === 'ratio') {
    let targetQty = 0
    if (r.targetDeviceId) {
      const pt = points.find(x => x.项目ID === p.id && x['设备ID'] === r.targetDeviceId)
      targetQty = pt ? Number(pt.数量) || 0 : 0
    } else {
      targetQty = subTotalFront
    }
    return targetQty ? Math.ceil(targetQty / per) : 0
  }
  return null
}

/** 子系统前端设备总量 */
export function subTotalFront (points, devices, p, sub) {
  return points
    .filter(x => x.项目ID === p.id && x.子系统 === sub && (resolveDevice(devices, sub, x.设备类型, x['设备ID']) || {}).category === '前端设备')
    .reduce((a, x) => a + (Number(x.数量) || 0), 0)
}

export function suggestQtyForDevice (state, p, device, sub) {
  const rule = quotaRuleFor(state.settings, sub, device.id, p.建筑类型)
  let q = rule ? calcRuleQty(rule, p) : null
  if (q == null) {
    q = ratioSuggestedQty(state.points, device, p, subTotalFront(state.points, state.devices, p, sub))
  }
  return { qty: q == null ? null : q, rule }
}

// ---------- 查询 ----------
export function resolveDevice (devices, sub, name, devId) {
  if (devId) {
    const byId = devices.find(d => d.id === devId)
    if (byId) return byId
  }
  return devices.find(d => d.subsystem === sub && d.name === name) || null
}

/** 项目选型或设备默认第一条型号价格 */
export function selectionOf (store, p, device) {
  if (!device) return null
  const sel = getProjectSelection(store.meta, p, device.id)
  if (sel) {
    return {
      deviceId: device.id, brand: sel.brand || '', model: sel.model || '',
      tier: tierName(sel.tier), param: sel.param || '',
      unitPrice: Number(sel.unitPrice) || 0, source: sel.source || '人工指定'
    }
  }
  const q = (store.devBrands[device.id] || [])[0]
  return q
    ? { deviceId: device.id, brand: q.brand || '', model: q.model || '', param: q.param || '', unitPrice: Number(q.unitPrice) || 0, source: '默认型号' }
    : null
}

export function getProjectSelection (meta, p, deviceId) {
  if (!meta.projectSelections) meta.projectSelections = {}
  const m = meta.projectSelections[p.id]
  return (m && m[deviceId]) || null
}

// ===== 推导链引擎（承载能力可自定义） =====
// 每个后端/承载类设备声明"承接什么 + 每台承载多少 + 冗余/取整"，由引擎按依赖顺序
// 从"前端点位合计"开始逐环推导，形成整条链条：前端 → 传输 → 存储 → 固定件。
// 承接来源支持三种：front（全部前端合计）| source（单个设备）| sources（多设备组合求和）
// 兼容旧 ratio 字段：ratio {type:'ratio',per,target} ≈ chain {mode:'carry',capacity:per,source}
//                ratio {type:'fixed',qty}     ≈ chain {mode:'fixed',caps:qty}

/** 归一化设备链配置（幂等，兼容旧 ratio） */
export function ensureDeviceChain (d) {
  if (!d.chain) {
    // 从旧 ratio 迁移
    const r = d.ratio
    if (r && r.type === 'ratio') {
      d.chain = { mode: 'carry', capacity: Number(r.per) || 1, source: r.targetDeviceId || 'front', factor: 1, reserve: 0, round: 'ceil' }
    } else if (r && r.type === 'fixed') {
      d.chain = { mode: 'fixed', capacity: Number(r.qty) || 1 }
    } else {
      d.chain = null
    }
  }
  const c = d.chain
  if (c) {
    c.mode = c.mode || 'carry'
    c.capacity = Math.max(1, Number(c.capacity) || 1)
    c.factor = c.factor == null || c.factor === '' ? 1 : Number(c.factor) || 1
    c.reserve = Number(c.reserve) || 0
    c.round = c.round || 'ceil'
    if (c.source && c.source !== 'front' && !c.sources) c.sources = [c.source]
    if (c.sources && !c.sources.length) delete c.sources
    c.source = c.source || (c.sources && c.sources.length ? 'multi' : 'front')
  }
  return c
}

/** 承接来源的设备 id 数组（含 front 语义时返回空数组） */
export function chainSourceIds (c) {
  if (!c) return []
  if (c.source === 'front' || c.source === 'multi' || !c.source) return (c.sources || []).filter(Boolean)
  return [c.source]
}

/** 链上公式文本（供系统卡片展示推导依据） */
export function chainFormulaText (d, base, qty) {
  const c = ensureDeviceChain(d)
  if (!c) return '未配置'
  if (c.mode === 'fixed') return '固定 ' + qty
  if (c.mode === 'mul') {
    let s = base + ' × ' + c.capacity
    if (c.factor !== 1) s += ' × ' + c.factor
    return s
  }
  let s = (c.round === 'floor' ? '↓' : '↑') + '(' + base + ' ÷ ' + c.capacity
  if (c.factor !== 1) s += ' × ' + c.factor
  s += ')'
  if (c.reserve) s += ' + ' + c.reserve
  return s + ' = ' + qty
}

/** 链接收关系展示（如 "承接 前端合计" / "承接 枪机+半球"） */
export function chainSourceLabel (devices, d) {
  const c = ensureDeviceChain(d)
  if (!c || c.mode === 'fixed' || c.mode === 'mul') return c && c.mode === 'mul' ? '按倍数' : ''
  const ids = chainSourceIds(c)
  if (!ids.length) return '承接 前端合计'
  const names = ids.map(id => (devices.find(x => x.id === id) || {}).name || '?')
  return '承接 ' + names.join('+')
}

/** 承接来源的值：qtyById（已解析设备量）与 frontTotal 缺一的提供者 */
function sourceBaseValue (c, qtyById, frontTotal, devs) {
  const ids = chainSourceIds(c)
  if (!ids.length) return { base: frontTotal, lbl: '承接 前端合计' }
  let base = 0
  ids.forEach(id => { const d = devs.find(x => x.id === id); base += qtyById[id] != null ? qtyById[id] : (d && d.category === '前端设备' ? (qtyById[id] || 0) : 0) })
  const names = ids.map(id => (devs.find(x => x.id === id) || {}).name || '?')
  return { base, lbl: '承接 ' + names.join('+') }
}

/**
 * 推导链：子系统内全部设备，按依赖顺序生成 👉 [{ device, qty, base, formula, sourceLabel }]
 * - 前端设备数量 = 点表合计（手填）
 * - 后端设备按 chain 逐环推导（承载 = 上取整(承接量 ÷ 承载能力 × 系数) + 预留）
 * - 未配置 chain 的后端设备返回 qty=null（不参与自动推算）
 */
export function deriveChain (devices, points, p, sub) {
  const devs = devices.filter(d => d.subsystem === sub && d.status !== '归档')
  // 前端合计（按设备聚合）
  const frontQty = {}
  points.filter(x => x.项目ID === p.id && x.子系统 === sub).forEach(x => {
    const dv = resolveDevice(devices, sub, x.设备类型, x['设备ID'])
    if (!dv || dv.category !== '前端设备') return
    frontQty[dv.id] = (frontQty[dv.id] || 0) + (Number(x.数量) || 0)
  })
  const frontTotal = Object.values(frontQty).reduce((a, b) => a + b, 0)
  const qtyById = {}
  // 预填前端数量（供后端依赖解析使用）
  devs.filter(d => d.category === '前端设备').forEach(d => { qtyById[d.id] = frontQty[d.id] || 0 })
  const order = []
  const visited = {}
  const pend = new Set(devs.filter(d => d.category !== '前端设备').map(d => d.id))

  // 轮询解析：优先解析依赖已就绪的设备；无依赖者后解析（可承接任意）
  let guard = 0
  while (pend.size && guard++ < 50) {
    let progressed = false
    pend.forEach(id => {
      const d = devs.find(x => x.id === id)
      if (!d) { pend.delete(id); return }
      const c = ensureDeviceChain(d)
      const needs = chainSourceIds(c)
      const unready = needs.filter(nid => nid !== 'front' && qtyById[nid] === undefined)
      if (unready.length) return // 依赖未就绪
      if (!visited[id]) { order.push(id); visited[id] = true }
      pend.delete(id); progressed = true
    })
    if (!progressed) { // 剩余循环依赖，兜底按顺序收录
      pend.forEach(id => { if (!visited[id]) { order.push(id); visited[id] = true } })
      pend.clear()
    }
  }

  const rows = []
  devs.forEach(d => {
    if (d.category === '前端设备') {
      const q = frontQty[d.id] || 0
      qtyById[d.id] = q
      rows.push({ device: d, qty: q, base: q, formula: q ? '点表手填' : '未填', sourceLabel: '点位' })
      return
    }
    const c = ensureDeviceChain(d)
    if (!c) { rows.push({ device: d, qty: null, base: 0, formula: '未配置', sourceLabel: '' }); return }
    if (c.mode === 'fixed') {
      const q = c.capacity
      qtyById[d.id] = q
      rows.push({ device: d, qty: q, base: q, formula: '固定 ' + q, sourceLabel: '' })
      return
    }
    const { base, lbl } = sourceBaseValue(c, qtyById, frontTotal, devs)
    let q = 0
    if (c.mode === 'mul') {
      q = Math.round(base * c.capacity * (c.factor || 1))
    } else {
      let raw = base / c.capacity * (c.factor || 1)
      q = c.round === 'floor' ? Math.floor(raw) : Math.ceil(raw)
      q += c.reserve
    }
    q = Math.max(0, q)
    qtyById[d.id] = q
    rows.push({ device: d, qty: q, base, formula: chainFormulaText(d, base, q), sourceLabel: lbl })
  })

  // 按解析顺序排序（前端在前，后端按依赖）
  const idxOf = {}
  rows.forEach((r, i) => { idxOf[r.device.id] = i })
  rows.sort((a, b) => {
    const ac = ensureDeviceChain(a.device)
    const bc = ensureDeviceChain(b.device)
    if ((a.device.category === '前端设备') !== (b.device.category === '前端设备')) {
      return a.device.category === '前端设备' ? -1 : 1
    }
    return (idxOf[a.device.id] || 0) - (idxOf[b.device.id] || 0)
  })
  return { rows, frontTotal }
}

/** 判灯设备是否对当前子系统"承载链条"有贡献（有 chain 或为前端） */
export function isChainDevice (d) {
  if (d.category === '前端设备') return true
  return !!(d.chain && d.chain.mode)
}

// ---------- 清单生成 ----------
/** 由项目点位 + 设备字典 + 定额/材料 + 选型价格，生成施工清单行 */
export function computeBill (store, p) {
  const rows = store.points.filter(x => x.项目ID === p.id)
  const fac = Number(store.settings.globalParams.cableFactor) || 1
  const loss = (Number(store.settings.globalParams.lossRate) || 0) / 100
  const backQty = {}
  const frontQty = {}
  const mats = {}

  rows.forEach(r => {
    const dv = resolveDevice(store.devices, r.子系统, r.设备类型, r['设备ID'])
    const qty = Number(r.数量) || 0
    if (qty <= 0) return
    const key = r['设备ID'] || (r.子系统 + '|' + r.设备类型)
    const cat = dv ? dv.category : '前端设备'
    if (cat === '后端设备') {
      backQty[key] = backQty[key] || { qty: 0, dv, r }
      backQty[key].qty += qty
      return
    }
    frontQty[key] = frontQty[key] || { qty: 0, dv, r }
    frontQty[key].qty += qty
    if (dv && dv.quota) {
      dv.quota.forEach(m => {
        const mk = r.子系统 + '|' + m.name + '|' + (m.spec || '') + '|' + m.unit
        if (!mats[mk]) mats[mk] = { sub: r.子系统, name: m.name, spec: m.spec || '', unit: m.unit, cat: m.cat || '管材线缆', qty: 0, src: [] }
        let base = qty * (m.per || 0)
        if (m.cat === '管材线缆') base *= fac
        base *= 1 + loss
        mats[mk].qty += base
        mats[mk].src.push(r.设备类型 + '×' + qty)
      })
    }
  })

  const bill = []
  Object.keys(frontQty).forEach(k => {
    const x = frontQty[k]; const d = x.dv; const r = x.r
    const z = d ? selectionOf(store, p, d) : null
    bill.push({
      cat: '前端设备', sub: r.子系统, deviceId: d ? d.id : (r['设备ID'] || ''),
      name: r.设备类型, spec: d ? d.spec : '', unit: d ? d.unit : '台', qty: x.qty,
      src: '设备点表', brand: z ? z.brand : '', model: z ? z.model : '', tier: z ? tierName(z.tier) : '',
      param: z ? z.param : '', unitPrice: z ? z.unitPrice : null,
      source: z ? (z.source || '项目选型') : '未匹配'
    })
  })
  Object.keys(backQty).forEach(k => {
    const x = backQty[k]; const d = x.dv; const r = x.r
    const z = d ? selectionOf(store, p, d) : null
    bill.push({
      cat: '后端设备', sub: r.子系统, deviceId: d ? d.id : (r['设备ID'] || ''),
      name: r.设备类型, spec: d ? d.spec : '', unit: d ? d.unit : '台', qty: x.qty,
      src: '设备点表', brand: z ? z.brand : '', model: z ? z.model : '', tier: z ? tierName(z.tier) : '',
      param: z ? z.param : '', unitPrice: z ? z.unitPrice : null,
      source: z ? (z.source || '项目选型') : '未匹配'
    })
  })
  const mp = store.settings.materialPrices || {}
  Object.keys(mats).forEach(k => {
    const m = mats[k]
    const pr = mp[m.name] != null ? Number(mp[m.name]) : (mp[m.spec] != null ? Number(mp[m.spec]) : null)
    bill.push({
      cat: m.cat, sub: m.sub, name: m.name, spec: m.spec, unit: m.unit,
      qty: Math.ceil(m.qty), src: m.src.slice(0, 3).join('，') + (m.src.length > 3 ? ' 等' : ''),
      materialUnitPrice: pr
    })
  })
  return bill
}

/** 清单差异（入参为两次生成的 bill 行） */
export function diffBill (prev, curr) {
  const key = r => (r.cat + '|' + r.sub + '|' + r.name + '|' + (r.spec || '') + '|' + (r.unit || ''))
  const prevMap = {};
  (prev || []).forEach(r => { prevMap[key(r)] = r })
  const currMap = {};
  (curr || []).forEach(r => { currMap[key(r)] = r })
  const added = []
  const removed = []
  const changed = []
  Object.keys(currMap).forEach(k => {
    if (!prevMap[k]) added.push(currMap[k])
    else if (Number(prevMap[k].qty) !== Number(currMap[k].qty)) changed.push({ name: currMap[k].name, old: prevMap[k].qty, nw: currMap[k].qty })
  })
  Object.keys(prevMap).forEach(k => {
    if (!currMap[k]) removed.push(prevMap[k])
  })
  return { added, removed, changed }
}

// ---------- 报价 ----------
export function calcQuote (state, p, bill) {
  const bySub = {}
  const order = []
  let devAmt = 0
  let matAmt = 0
  bill.forEach(r => {
    if (!bySub[r.sub]) { bySub[r.sub] = { dev: 0, mat: 0 }; order.push(r.sub) }
    if (r.cat === '前端设备' || r.cat === '后端设备') {
      let price = r.unitPrice != null && r.unitPrice !== '' ? Number(r.unitPrice) : null
      if (price == null) {
        const dv = resolveDevice(state.devices, r.sub, r.name, r.deviceId)
        const pp = dv && state.devBrands[dv.id] && state.devBrands[dv.id][0]
        price = pp && pp.unitPrice != null ? Number(pp.unitPrice) : null
      }
      if (price != null) {
        const amt = round2(price * r.qty)
        bySub[r.sub].dev += amt
        devAmt += amt
      }
    } else {
      let pr = r.materialUnitPrice != null && r.materialUnitPrice !== '' ? Number(r.materialUnitPrice) : null
      if (pr == null) {
        const mp = state.settings.materialPrices || {}
        pr = mp[r.name] != null ? Number(mp[r.name]) : (mp[r.spec] != null ? Number(mp[r.spec]) : null)
      }
      if (pr != null) {
        const amt2 = round2(pr * r.qty)
        bySub[r.sub].mat += amt2
        matAmt += amt2
      }
    }
  })
  return {
    order: order.map(s => ({ sub: s, dev: round2(bySub[s].dev), mat: round2(bySub[s].mat) })),
    devAmt: round2(devAmt), matAmt: round2(matAmt), total: round2(devAmt + matAmt)
  }
}

export function quoteRows (state, p) {
  const quote = calcQuote(state, p, computeBill(state, p))
  const gp = state.settings.globalParams || {}
  const markup = gp.markup || 1
  const tax = gp.tax || 0
  const finalAmt = round2(quote.total * markup * (1 + tax / 100))
  return {
    quote,
    markup, tax, finalAmt,
    rows: (() => {
      const out = [['弱电智能化设计工作台 · 报价汇总', p.项目名称], ['系统', '设备金额(元)', '材料金额(元)', '小计(元)']]
      quote.order.forEach(s => out.push([s.sub, s.dev, s.mat, round2(s.dev + s.mat)]))
      out.push(['合计', quote.devAmt, quote.matAmt, quote.total])
      out.push(['调价系数', markup, '', ''])
      out.push(['税率', tax + '%', '', ''])
      out.push(['含税总价', finalAmt, '', ''])
      return out
    })()
  }
}

/** 导出行（含品牌/型号/参数/单价/合价） */
export function buildBillRows (state, p, rows) {
  const out = [['类别', '材料名称', '规格型号', '单位', '数量', '品牌', '型号', '配置档次', '参数', '单价', '合价', '选型方式', '推算来源']]
  rows.forEach(r => {
    let brand = ''; let model = ''; let tier = ''; let param = ''; let price = ''; let total = ''; let source = ''
    if (r.cat === '前端设备' || r.cat === '后端设备') {
      brand = r.brand || ''; model = r.model || ''; tier = tierName(r.tier); param = r.param || ''
      price = r.unitPrice != null && r.unitPrice !== '' ? r.unitPrice : ''
      source = r.source || ''
      total = price !== '' ? round2(Number(price) * r.qty) : ''
      if (!brand && !model && !param && !price) {
        const dv = resolveDevice(state.devices, r.sub, r.name, r.deviceId)
        const bp = dv && state.devBrands[dv.id] && state.devBrands[dv.id][0]
        if (bp) {
          brand = bp.brand || ''; model = bp.model || ''; tier = tierName(bp.tier); param = bp.param || ''
          price = bp.unitPrice != null ? bp.unitPrice : ''; source = '默认型号'
          total = price !== '' ? round2(Number(price) * r.qty) : ''
        }
      }
    }
    out.push([r.cat, r.name, r.spec || '', r.unit, r.qty, brand, model, tier, param, price, total, source, r.src])
  })
  return out
}

export function rowsToCSV (rows) {
  return rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n')
}

export function rowsToTSV (rows) {
  return rows.map(r => r.map(c => String(c == null ? '' : c).replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ')).join('\t')).join('\r\n')
}

// ---------- 清单历史 ----------
export function normalizeBillList (arr) {
  if (!arr) return []
  if (arr.length && arr[0] && arr[0].rows && Array.isArray(arr[0].rows)) return arr
  if (arr.length === 0) return []
  return [{ id: 'bh_legacy_' + Date.now(), at: new Date().toISOString(), name: '历史清单（迁移）', rows: arr }]
}

export function newBillEntry (name, rows, settings, meta, selections) {
  return {
    id: 'bh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    name,
    rows: rows.slice(),
    calcVersion: 'v2',
    params: JSON.parse(JSON.stringify(settings.globalParams || {})),
    smartBudget: JSON.parse(JSON.stringify(meta.projectBudget || {})),
    selectionSnapshot: JSON.parse(JSON.stringify(selections || {})),
    snapshotAt: new Date().toISOString()
  }
}

// ---------- 项目进度（权重模型） ----------
export function calcProgress (state, p) {
  if (!p) return 0
  if (p.状态 === '已完成' || p.状态 === '已归档') return 100
  let s = 0
  // 基础资料 10%（名称/编号/客户/地址/面积 5 项）
  let base = 0
  ;['项目名称', '项目编号', '客户', '项目地址', '建筑面积'].forEach(k => { if (p[k]) base++ })
  s += base / 5 * 10
  // 设备点表 40%
  const pts = state.points.filter(x => x.项目ID === p.id)
  const filled = pts.filter(x => Number(x.数量) > 0).length
  if (pts.length) s += filled / pts.length * 40
  // 施工清单 20%
  const bl = normalizeBillList(state.bills[p.id])
  if (bl && bl.length) s += 20
  // 设计说明 20%
  let hasNote = false
  Object.keys(state.notes || {}).forEach(k => {
    if (k.indexOf(p.id + '|') === 0 && state.notes[k]) hasNote = true
  })
  if (hasNote) s += 20
  // 校核归档 10%
  if (p.状态 === '校核中') s += 5
  if (p.状态 === '已完成') s += 10
  else if (p.清单状态 === '已生成') s += 5
  return Math.min(99, Math.round(s))
}

export { ceil2, round2, todayStr, stamp2 }
export { uid }