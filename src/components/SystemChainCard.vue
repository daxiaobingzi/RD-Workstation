<script setup>
// 系统卡 · 推导链：展示当前子系统从"点位 → 前端 → 传输/存储 → 固定件"的整条推导链。
// 链上每一环都是可编辑的：
//  - 点位数可模拟（不落库，仅预览重算）
//  - 承载设备的 承载能力/系数/预留 可就地改（落库）
//  - 金额随点位实时联动
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { openDialog, confirmBox } from '../composables/ui'
import { ensureDeviceChain, chainFormulaText, chainSourceIds } from '../db/calc'
import VIcon from './ui/VIcon.vue'
import ChainRuleDialog from './dialogs/ChainRuleDialog.vue'

const props = defineProps({
  project: { type: Object, default: null },
  sub: { type: String, default: '' }
})
const emit = defineEmits(['goBill', 'editPoint', 'addPoint'])

const store = useAppStore()
const { devices, devBrands, points, settings } = storeToRefs(store)

// ---- 点位编辑（本地草稿，不影响点表，仅用于模拟/推算）----
const draftQty = ref({}) // deviceId -> qty 草稿

const frontDevs = computed(() =>
  devices.value.filter(d => d.subsystem === props.sub && d.status !== '归档' && d.category === '前端设备'))
const backDevs = computed(() =>
  devices.value.filter(d => d.subsystem === props.sub && d.status !== '归档' && d.category === '后端设备'))

// ---- 以本项目点表为准的前端设备行（含未匹配字典告警）----
const projPointRows = computed(() => points.value.filter(x => x.项目ID === props.project?.id && x.子系统 === props.sub))

const frontRowList = computed(() => {
  const m = {} // devId 或 raw key -> { device, rawName, qty, missing }
  projPointRows.value.forEach(x => {
    const q = Number(x.数量) || 0
    const dv = store.resolveDevice(devices.value, props.sub, x.设备类型, x['设备ID'])
    if (dv && dv.category === '前端设备') {
      if (!m[dv.id]) m[dv.id] = { device: dv, rawName: '', qty: 0, missing: false, stillInDict: true }
      m[dv.id].qty += q
    } else if (!dv) {
      const k = 'raw|' + x['设备类型'] + '|' + (x['设备ID'] || '')
      if (!m[k]) m[k] = { device: null, rawName: x.设备类型, qty: 0, missing: true, stillInDict: false }
      m[k].qty += q
    }
  })
  return Object.values(m)
})

const hasFrontPoints = computed(() => frontRowList.value.some(r => r.qty > 0) || Object.keys(draftQty.value).length > 0)

// 前端合计（草稿优先，其次点表实值）
function frontQtyOf (id) {
  return draftQty.value[id] !== undefined ? Number(draftQty.value[id]) || 0 : ((frontRowList.value.find(r => r.device && r.device.id === id) || {}).qty || 0)
}
function frontTotalDraft () {
  // 以字典前端设备为口径求和（前端行均来自点表或草稿）
  let tot = 0
  const seen = {}
  frontDevs.value.forEach(d => { seen[d.id] = frontQtyOf(d.id) })
  Object.keys(seen).forEach(k => { tot += seen[k] })
  // 未匹配字典的原始行也计入合计
  frontRowList.value.forEach(r => { if (r.missing) tot += r.qty })
  return tot
}

// ---- 承载链：手写推导（支持任意承接来源 + 草稿模拟点位），顺序按依赖拓扑 ---- 
const chainRows = computed(() => {
  const frontTotal = frontTotalDraft()
  const qtyById = {}
  const rows = []
  // 前端：点表驱动（含未匹配字典告警与草稿）
  frontRowList.value.forEach(r => {
    if (r.device) {
      const q = frontQtyOf(r.device.id)
      qtyById[r.device.id] = q
      rows.push({ device: r.device, qty: q, base: '#', label: '点位', price: priceOf(r.device), missing: false, rawName: '' })
    } else {
      rows.push({ device: null, rawName: r.rawName, qty: r.qty, label: '点位', price: null, missing: true })
    }
  })

  // 后端仅在"有规则"或"点表已填数量"时展示（避免空项目列出一堆字典设备）
  const shownBack = backDevs.value.filter(d => {
    const c = ensureDeviceChain(d)
    if (c) return true
    return projPointRows.value.some(x => x['设备ID'] === d.id || x.设备类型 === d.name)
  })

  // 按依赖顺序解析后端链（硬盘承接 NVR → NVR 先算；循环兜底按原序）
  const backOrder = []
  const done = {}
  const pend = shownBack.slice()
  let guard = 0
  while (pend.length && guard++ < 60) {
    let progressed = false
    for (let i = pend.length - 1; i >= 0; i--) {
      const dv = pend[i]
      const c = ensureDeviceChain(dv)
      const needs = c ? chainSourceIds(c) : []
      const unready = needs.filter(nid => qtyById[nid] === undefined)
      if (unready.length) continue // 依赖未就绪
      pend.splice(i, 1)
      backOrder.push(dv)
      done[dv.id] = true
      progressed = true
    }
    if (!progressed) { backOrder.push(...pend); pend.length = 0 }
  }

  backOrder.forEach(d => {
    const c = ensureDeviceChain(d) || null
    if (!c) {
      // 无规则：若点表有手填数量则展示，否则跳过后端循环里仍可见
      const manualQty = projPointRows.value.filter(x => x['设备ID'] === d.id || x.设备类型 === d.name).reduce((a, x) => a + (Number(x.数量) || 0), 0)
      qtyById[d.id] = manualQty
      rows.push({ device: d, qty: manualQty || null, base: 0, label: manualQty ? '数量手填' : '数量手填（无规则）', formula: '', srcName: '', price: priceOf(d) })
      return
    }
    if (c.mode === 'fixed') {
      const q = c.capacity
      qtyById[d.id] = q
      rows.push({ device: d, qty: q, base: q, label: '固定值', formula: '固定 ' + q, srcName: '固定值', price: priceOf(d) })
      return
    }
    // 多来源求和 / 前端合计 / 单设备
    const ids = chainSourceIds(c)
    let base = 0
    let srcName = ''
    if (!ids.length) { base = frontTotal; srcName = '承接 前端合计' }
    else {
      ids.forEach(id => { base += qtyById[id] || 0 })
      const names = ids.map(id => { const s = devices.value.find(x => x.id === id); return s ? s.name : '?' })
      srcName = '承接 ' + names.join('+')
    }
    let q = 0
    if (c.mode === 'mul') q = Math.round(base * c.capacity * (c.factor || 1))
    else {
      let raw = base / c.capacity * (c.factor || 1)
      q = c.round === 'floor' ? Math.floor(raw) : Math.ceil(raw)
      q += c.reserve
    }
    q = Math.max(0, q)
    qtyById[d.id] = q
    rows.push({ device: d, qty: q, base, label: srcName, formula: chainFormulaText(d, base, q), srcName, price: priceOf(d) })
  })
  return rows
})

function priceOf (d) {
  if (!d) return null
  const bs = devBrands.value[d.id] || []
  if (!bs.length) return null
  const sel = bs[0]
  return sel.unitPrice != null ? Number(sel.unitPrice) : null
}

// 总金额（设备 × 数量，草稿联动）
const total = computed(() => {
  let s = 0
  chainRows.value.forEach(r => {
    if (r.qty == null || r.price == null) return
    s += r.qty * r.price
  })
  return s
})
const missingPrice = computed(() => chainRows.value.filter(r => r.qty != null && r.qty > 0 && r.price == null).length)

// 前端合计展示数
const frontTotalShow = computed(() => frontTotalDraft())

// ---- 草稿同步：前端数量就地编辑 ----
function onFrontInput (id) {
  // 输入框直接绑定 draftQty，实时联动
}
function syncDraftToPoints () {
  const ps = props.project
  let add = 0
  frontDevs.value.forEach(d => {
    const v = draftQty.value[d.id]
    if (v === undefined || v === '') return
    const qty = Number(v) || 0
    const pt = points.value.find(x => x.项目ID === ps.id && (x['设备ID'] === d.id || (x.子系统 === props.sub && x.设备类型 === d.name)))
    if (pt) { if (Number(pt.数量) !== qty) { pt.数量 = qty; pt.updatedAt = new Date().toISOString() } }
    else if (qty > 0) {
      points.value.push({ id: 'dq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), 项目ID: ps.id, 子系统: props.sub, 点位名称: '', 安装位置: '', 设备类型: d.name, 设备ID: d.id, 数量: qty, 备注: '系统卡录入', updatedAt: new Date().toISOString() })
      add++
    }
  })
  return { add }
}

// ---- 就地改承载参数（落库）----
async function editCapacity (d) {
  await openDialog(ChainRuleDialog, { device: d })
}
async function removeFromChain (d) {
  const ok = await confirmBox(`将「${d.name}」从推导链移除？其数量将不再自动推算。`, '移出推导链')
  if (!ok) return
  d.chain = null
  d.ratio = null
  await store.saveAll()
  store.toast(`「${d.name}」已移出推导链`)
}

// 把推导数量写入点表（后端设备）
async function applyAll () {
  const ps = props.project
  const r = await store.applyChainToPoints(ps.id, props.sub, chainRows.value.filter(x => x.qty != null))
  if (!r.changed && !r.added) { store.toast('推导结果与点表一致，无需更新'); return }
  await store.saveAll()
  store.toast(`已写入点表：更新 ${r.changed} 行，新增 ${r.added} 行（后端设备数量按链式推导）`)
}
function clearDraft () {
  draftQty.value = {}
}

defineExpose({ applyAll, clearDraft })
</script>

<template>
  <div class="sys-card">
    <!-- 卡片头：系统名 + 点位合计 + 金额 + 缺价 -->
    <div class="sys-head">
      <div class="sys-title">
        <span class="sys-name">{{ sub }}</span>
        <span class="badge blue">{{ frontTotalShow }} 点位</span>
        <span class="badge" :class="missingPrice ? 'red' : 'green'">
          {{ missingPrice ? missingPrice + ' 项缺价' : '价目齐全' }}
        </span>
      </div>
      <div class="sys-total">
        <span class="t-lbl">系统参考金额</span>
        <span class="t-val">¥ {{ total.toLocaleString('zh-CN') }}</span>
      </div>
    </div>

    <div class="sys-ops">
      <button class="btn btn-ghost btn-sm" @click="emit('addPoint')"><VIcon name="plus" />添加点位</button>
      <button class="btn btn-ghost btn-sm" @click="emit('goBill')"><VIcon name="file" />查看清单</button>
      <span style="flex:1"></span>
      <button v-if="Object.keys(draftQty).length" class="btn btn-ghost btn-sm" @click="clearDraft"><VIcon name="x" />清空模拟</button>
      <button class="btn btn-primary btn-sm" @click="applyAll"><VIcon name="check" />推算写入点表</button>
    </div>

    <!-- 推导链 -->
    <div class="chain-wrap">
      <div class="chain-row" v-for="(r, i) in chainRows" :key="r.device ? r.device.id : ('raw' + i)">
        <!-- 前端：数量可编辑（模拟） -->
        <template v-if="r.device && r.device.category === '前端设备'">
          <div class="chain-node" :class="{ front: true }">
            <div class="node-body">
              <span class="node-idx">点{{ i + 1 }}</span>
              <div class="node-info">
                <div class="node-name">{{ r.device.name }}<span v-if="r.device.spec" class="src"> {{ r.device.spec }}</span></div>
                <div class="node-src">点位 · 前端</div>
              </div>
              <div class="node-ed"><input :value="draftQty[r.device.id] !== undefined ? draftQty[r.device.id] : (r.qty || 0)" type="number" min="0" @input="e => { draftQty[r.device.id] = e.target.value }"></div>
              <div class="node-price">
                <template v-if="r.price != null">¥ {{ r.price.toLocaleString('zh-CN') }}</template>
                <b v-else class="mprice">缺价</b>
              </div>
            </div>
          </div>
        </template>
        <!-- 前端 · 字典缺失告警 -->
        <template v-else-if="r.missing">
          <div class="chain-node" style="border-left:3px solid var(--red);opacity:.8">
            <div class="node-body">
              <span class="node-idx">点{{ i + 1 }}</span>
              <div class="node-info">
                <div class="node-name" style="color:var(--red-ink)">{{ r.rawName || '未知设备' }}</div>
                <div class="node-src">⚠ 设备字典缺失，无法参与数量推算与清单</div>
              </div>
              <div class="node-fml" style="border-color:var(--red-line)">{{ r.qty }} 台（点表手填）</div>
              <div class="node-price"><b class="mprice">未知单价</b></div>
            </div>
          </div>
        </template>
        <!-- 后端：公式 + 规则编辑（规则存于设备字典，全局生效） -->
        <template v-else>
          <div class="chain-node" :class="[r.qty == null ? 'off' : 'back']">
            <div class="node-body">
              <span class="node-idx">环{{ i + 1 }}</span>
              <div class="node-info">
                <div class="node-name">{{ r.device.name }}<span v-if="r.device.spec" class="src"> {{ r.device.spec }}</span></div>
                <div class="node-src">{{ r.label || '数量手填' }}</div>
              </div>
              <template v-if="r.qty != null">
                <div class="node-fml">{{ r.formula }}</div>
                <div class="node-price">
                  <span>{{ r.qty }} {{ r.device.unit || '台' }}</span>
                  <template v-if="r.price != null"> · ¥ {{ r.price.toLocaleString('zh-CN') }}</template>
                  <b v-else class="mprice"> · 缺价</b>
                </div>
              </template>
              <template v-else>
                <div class="node-unconf"><VIcon name="zap" :size="13" /> 未配置规则（手填）</div>
              </template>
            </div>
            <div class="node-op">
              <button class="btn btn-ghost btn-sm" :title="r.qty == null ? '配置数量来源规则（存于设备字典，全局生效）' : '编辑数量来源规则'" @click="editCapacity(r.device)">
                <VIcon :name="r.qty == null ? 'zap' : 'edit'" />{{ r.qty == null ? '配置规则' : '' }}
              </button>
              <button class="btn btn-icon btn-sm del" title="关闭自动推算（改为手填）" @click="removeFromChain(r.device)"><VIcon name="x" /></button>
            </div>
          </div>
        </template>
        <div v-if="i < chainRows.length - 1" class="chain-arrow"><span class="arr-ic">↓</span></div>
      </div>
    </div>

    <div v-if="!chainRows.length" class="empty">
      本系统尚未配置任何设备：先在「设备字典」为【{{ sub }}】添加设备，再回到本项目点击「添加点位」录入。
    </div>
  </div>
</template>