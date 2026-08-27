// ===== 领域计算层：数量推算 / 清单生成 / 报价 / 项目进度 =====
// 全部为纯函数，入参为应用状态（store 的响应式 state 或局部快照），不直接触碰 DOM。
import { uid, ceil2, round2, tierName, todayStr, stamp2 } from './format'

// ---------- 材料价格（品牌/型号结构） ----------
/** 规范材料价格：兼容旧 {名称: 单价} 对象格式 → 数组 [{id,name,spec,unit,cat,brand,model,price}] */
export function normalizeMaterialPrices (mp) {
  if (Array.isArray(mp)) {
    return mp.filter(m => m && m.name)
  }
  if (mp && typeof mp === 'object') {
    return Object.keys(mp)
      .filter(k => mp[k] != null && mp[k] !== '')
      .map(k => ({
        id: 'mp_' + k + '_' + Date.now().toString(36),
        name: k, spec: '', unit: 'm', cat: '管材线缆',
        brand: '国产', model: '国产优质', price: Number(mp[k])
      }))
  }
  return []
}

/** 按名称 + 规格 + 单位 匹配材料价格条目（定额材料与材料价格链接的匹配键） */
export function findMaterialPrice (settings, name, spec, unit) {
  const list = settings && settings.materialPrices
  if (!Array.isArray(list)) return null
  return list.find(m => m && m.name === name &&
    (spec == null || (m.spec || '') === (spec || '')) &&
    (unit == null || (m.unit || '') === (unit || ''))) || null
}

/** 定额材料行 → 对应材料价格条目（优先 mpId 显式链接，其次按名称+规格+单位自动匹配） */
export function materialPriceOf (settings, quotaRow) {
  if (!quotaRow) return null
  const list = settings && settings.materialPrices
  if (!Array.isArray(list)) return null
  if (quotaRow.mpId) {
    const hit = list.find(m => m && m.id === quotaRow.mpId)
    if (hit) return hit
  }
  return findMaterialPrice(settings, quotaRow.name, quotaRow.spec, quotaRow.unit) || null
}

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
    // 来源统一归一化为单一形态：sources 数组 + source='multi'（兼容旧 source:'<id>' 冗余写法）
    if (c.source && c.source !== 'front' && c.source !== 'multi' && !(c.sources && c.sources.length)) c.sources = [c.source]
    if (c.sources && c.sources.length) { c.sources = c.sources.filter(Boolean); c.source = 'multi' }
    else { c.sources = []; c.source = 'front' }
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

/** 解析链来源形态：fixed=固定 | front=全部前端合计 | custom=用户显式指定的具体设备 */
function chainSourceInfo (c) {
  if (!c) return { mode: 'none', ids: [] }
  if (c.mode === 'fixed') return { mode: 'fixed', ids: [] }
  if (c.source === 'front' || !c.sources || !c.sources.length) return { mode: 'front', ids: [] }
  return { mode: 'custom', ids: c.sources.filter(Boolean) }
}

/** 由规则参数构建统一链配置（DeviceFormDialog / ChainRuleDialog 共用，杜绝 source/sources 不一致） */
export function buildChainObj ({ mode, capacity, srcKind, sources, factor, reserve, round }) {
  if (mode === 'fixed') return { mode: 'fixed', capacity: Math.max(1, parseInt(capacity) || 1) }
  const ids = srcKind === 'multi' && sources && sources.length ? sources.filter(Boolean) : []
  return {
    mode: mode === 'mul' ? 'mul' : 'carry',
    capacity: Math.max(1, parseInt(capacity) || 1),
    source: ids.length ? 'multi' : 'front',
    sources: ids,
    factor: parseFloat(factor) || 1,
    reserve: parseInt(reserve) || 0,
    round: round || 'ceil'
  }
}

/**
 * 统一推导引擎：子系统内全部设备，按依赖拓扑序计算数量（顺序无关）。
 * 产出每设备 { device, qty, base, formula, sourceLabel, warn }：
 *  - 前端设备数量 = 点表合计（手填，支持草稿覆盖）
 *  - 后端设备按 chain 逐环推导；依赖未就绪自动等待（先算被依赖者）
 *  - 自定义来源为空 / 来源设备缺失归档时给出 warn，不再静默回退前端合计
 *  - 未配置 chain 的后端设备：有点表手填数量则带出，否则 qty=null
 */
export function deriveChainQty (devices, points, p, sub, opts = {}) {
  const devs = devices.filter(d => d.subsystem === sub && d.status !== '归档')
  const override = opts.frontQtyOverride || {}
  // 前端合计（按设备聚合，支持草稿覆盖）
  const frontQty = {}
  points.filter(x => x.项目ID === p.id && x.子系统 === sub).forEach(x => {
    const dv = resolveDevice(devices, sub, x.设备类型, x['设备ID'])
    if (!dv || dv.category !== '前端设备') return
    frontQty[dv.id] = (frontQty[dv.id] || 0) + (Number(x.数量) || 0)
  })
  // 后端手填数量（无 chain 时使用点表实值）
  const backManual = {}
  points.filter(x => x.项目ID === p.id && x.子系统 === sub).forEach(x => {
    const dv = resolveDevice(devices, sub, x.设备类型, x['设备ID'])
    if (!dv || dv.category !== '后端设备') return
    backManual[dv.id] = (backManual[dv.id] || 0) + (Number(x.数量) || 0)
  })

  const qtyById = {}
  const frontRows = []
  devs.filter(d => d.category === '前端设备').forEach(d => {
    const q = override[d.id] !== undefined ? (Number(override[d.id]) || 0) : (frontQty[d.id] || 0)
    qtyById[d.id] = q
    frontRows.push({ device: d, qty: q, base: q, formula: q ? '点表手填' : '未填', sourceLabel: '点位', warn: '' })
  })
  const frontTotal = opts.frontTotalOverride != null ? opts.frontTotalOverride : Object.values(qtyById).reduce((a, b) => a + b, 0)

  const backRows = []
  const pend = devs.filter(d => d.category !== '前端设备').slice()
  let guard = 0
  while (pend.length && guard++ < 60) {
    let progressed = false
    for (let i = pend.length - 1; i >= 0; i--) {
      const d = pend[i]
      const c = ensureDeviceChain(d)
      const info = chainSourceInfo(c)
      const unready = info.ids.filter(id => qtyById[id] === undefined)
      if (unready.length) continue // 依赖未就绪，等待
      pend.splice(i, 1); progressed = true
      backRows.push(computeBackRow(d, c, info, qtyById, devs, frontTotal, backManual))
    }
    if (!progressed) { // 循环依赖兜底：按原序收录
      pend.forEach(d => {
        const c = ensureDeviceChain(d); const info = chainSourceInfo(c)
        backRows.push(computeBackRow(d, c, info, qtyById, devs, frontTotal, backManual))
      })
      pend.length = 0
    }
  }
  return { rows: frontRows.concat(backRows), frontTotal }
}

function computeBackRow (d, c, info, qtyById, devs, frontTotal, backManual) {
  if (!c) {
    // 无规则：数量手填（点表实值）
    const q = backManual[d.id] || 0
    qtyById[d.id] = q
    return { device: d, qty: q || null, base: q, formula: q ? '数量手填' : '数量手填（无规则）', sourceLabel: '手填', warn: '' }
  }
  if (info.mode === 'fixed') {
    const q = c.capacity
    qtyById[d.id] = q
    return { device: d, qty: q, base: q, formula: '固定 ' + q, sourceLabel: '固定值', warn: '' }
  }
  let base = 0
  let label = ''
  let warn = ''
  if (info.mode === 'front') {
    base = frontTotal
    label = '承接 前端合计'
  } else if (!info.ids.length) {
    // 自定义来源为空：不再静默回退前端合计，标记异常
    qtyById[d.id] = 0
    return { device: d, qty: null, base: 0, formula: '', sourceLabel: '', warn: '自定义来源为空，未按前端合计计算（请重新选择来源）' }
  } else {
    const names = []
    let missing = false
    info.ids.forEach(id => {
      const s = devs.find(x => x.id === id)
      if (!s) { missing = true; names.push('?'); return }
      names.push(s.name)
      base += qtyById[id] != null ? qtyById[id] : 0
    })
    if (missing) warn = '来源设备不存在或已归档：' + names.join('+')
    label = '承接 ' + names.join('+')
  }
  let q = 0
  if (c.mode === 'mul') q = Math.round(base * c.capacity * (c.factor || 1))
  else {
    const raw = base / c.capacity * (c.factor || 1)
    q = c.round === 'floor' ? Math.floor(raw) : Math.ceil(raw)
    q += c.reserve
  }
  q = Math.max(0, q)
  qtyById[d.id] = q
  return { device: d, qty: q, base, formula: chainFormulaText(d, base, q), sourceLabel: label, warn }
}

/**
 * 推导链（兼容旧 API）：子系统内全部设备，按依赖顺序生成 [{ device, qty, base, formula, sourceLabel }]
 */
export function deriveChain (devices, points, p, sub) {
  return deriveChainQty(devices, points, p, sub)
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
      source: z ? (z.source || '项目选型') : '未匹配',
      dictMissing: !d // 点表有数量但设备不在字典中（被删/改名），清单降级为无价前端设备
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
      source: z ? (z.source || '项目选型') : '未匹配',
      dictMissing: !d
    })
  })
  Object.keys(mats).forEach(k => {
    const m = mats[k]
    const mpEntry = findMaterialPrice(store.settings, m.name, m.spec, m.unit)
    const pr = mpEntry && mpEntry.price != null && mpEntry.price !== '' ? Number(mpEntry.price) : null
    bill.push({
      cat: m.cat, sub: m.sub, name: m.name, spec: m.spec, unit: m.unit,
      qty: Math.ceil(m.qty), src: m.src.slice(0, 3).join('，') + (m.src.length > 3 ? ' 等' : ''),
      materialUnitPrice: pr,
      materialBrand: mpEntry ? (mpEntry.brand || '') : '',
      materialModel: mpEntry ? (mpEntry.model || '') : ''
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
        const mpEntry = findMaterialPrice(state.settings, r.name, r.spec, r.unit)
        pr = mpEntry && mpEntry.price != null && mpEntry.price !== '' ? Number(mpEntry.price) : null
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
    } else {
      // 材料行：品牌/型号来自链接的材料价格，价格取材料单价
      brand = r.materialBrand || ''; model = r.materialModel || ''
      price = r.materialUnitPrice != null && r.materialUnitPrice !== '' ? r.materialUnitPrice : ''
      total = price !== '' ? round2(Number(price) * r.qty) : ''
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