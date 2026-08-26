<script setup>
// 价格工作台 · v2：设备 → 品牌型号 两级折叠分组
// 每款设备一个折叠组，组内维护该设备的品牌型号表（品牌/型号/档次/参数/单价）
//  - 新增品牌型号：插入到所属设备组内（不再落到表尾）
//  - 品牌列：从品牌池(settings.brands)联想选择，可一键把新品牌存入品牌池
//  - 组头显示缺价/缺参数状态，支持批量粘贴导入（按设备名归位）
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { BUDGET_TIERS } from '../db/constants'
import { openDialog } from '../composables/ui'
import { rowsToCSV } from '../db/calc'
import { buildCsvBlob, downloadBlob, copyText } from '../db/export'
import ModalBase from './ui/ModalBase.vue'
import VIcon from './ui/VIcon.vue'

const props = defineProps({
  dbSub: { type: String, default: '' }
})

const store = useAppStore()
const { devices, devBrands, settings } = storeToRefs(store)

const expanded = ref({}) // deviceId -> bool
const filterTxt = ref('')

// ---- 数据层：设备 + 其型号行 ----
const groups = computed(() => {
  const kw = filterTxt.value.trim().toLowerCase()
  return devices.value
    .filter(d => d.subsystem === props.dbSub && d.status !== '归档')
    .filter(d => !kw || d.name.toLowerCase().includes(kw) || (d.spec || '').toLowerCase().includes(kw))
    .map(d => {
      const variants = (store.devBrands[d.id] || []).map(v => ({
        key: v.id || mkKey(), brand: v.brand || '', model: v.model || '', tier: v.tier || '标准型',
        param: v.param || '', unitPrice: v.unitPrice != null ? v.unitPrice : ''
      }))
      if (!variants.length) variants.push(emptyRow(d))
      const priced = variants.filter(v => v.brand && v.unitPrice !== '' && v.unitPrice != null).length
      const badParam = variants.filter(v => v.brand && !v.param.trim()).length
      const missingBrand = variants.filter(v => !v.brand.trim()).length
      return { device: d, variants, priced, total: variants.length, badParam, missingBrand }
    })
})
const allExpanded = computed(() => groups.value.every(g => expanded.value[g.device.id]))
function toggle (id) { expanded.value[id] = !expanded.value[id] }
function expandAll (v) { groups.value.forEach(g => { expanded.value[g.device.id] = v }) }

function emptyRow (d) {
  return { key: mkKey(), brand: '', model: '', tier: '标准型', param: '', unitPrice: '' }
}
function mkKey () { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

function addVariant (g) {
  g.variants.push(emptyRow(g.device))
  expanded.value[g.device.id] = true
}
function removeRow (g, i) {
  g.variants.splice(i, 1)
  if (!g.variants.length) g.variants.push(emptyRow(g.device))
}

// ---- 品牌池联动 ----
const brandPool = computed(() => (settings.value.brands || []).map(b => b.name).sort())
const unknownBrands = computed(() => {
  const pool = new Set(brandPool.value)
  const set = new Set()
  groups.value.forEach(g => g.variants.forEach(v => { if (v.brand && !pool.has(v.brand)) set.add(v.brand) }))
  return [...set]
})
function saveBrandToPool (name) {
  if (!name || brandPool.value.includes(name)) return
  store.addBrand({ name, shortName: name, category: '未分类', status: '启用' })
}
async function importAllToPool () {
  if (!unknownBrands.value.length) { store.toast('暂无散落品牌需要归库'); return }
  unknownBrands.value.forEach(n => saveBrandToPool(n))
  await store.saveAll()
  store.toast(`已将 ${unknownBrands.value.length} 个散落品牌加入品牌池`)
}
function onBrandInput (g, v, val) {
  v.brand = val
}

// ---- 统计数据 ----
const stats = computed(() => {
  let total = 0; let priced = 0; let missing = 0; let noParam = 0
  groups.value.forEach(g => {
    total += g.total
    priced += g.priced
    missing += g.total - g.priced
    noParam += g.badParam
  })
  return { total, priced, missing, noParam, devices: groups.value.length }
})

// ---- 保存 ----
async function save () {
  const map = {}
  groups.value.forEach(g => {
    const list = g.variants
      .filter(v => v.brand.trim() || v.model.trim())
      .map(v => ({ id: v.key.startsWith('r') ? undefined : v.key, brand: v.brand.trim(), model: v.model.trim(), tier: v.tier || '标准型', param: v.param.trim(), unitPrice: v.unitPrice !== '' && v.unitPrice != null ? Number(v.unitPrice) : null }))
    if (list.length) map[g.device.id] = list
  })
  // 品牌+型号唯一性（同设备下）
  for (const did of Object.keys(map)) {
    const seen = new Set()
    for (const v of map[did]) {
      if (!v.brand) continue
      const key = v.brand + '|' + v.model
      if (seen.has(key)) { store.toast(`品牌+型号重复：${nameOf(did)} → ${v.brand} ${v.model}`); return }
      seen.add(key)
    }
  }
  const next = { ...store.devBrands }
  const inSub = devices.value.filter(d => d.subsystem === props.dbSub)
  inSub.forEach(d => {
    if (map[d.id]) {
      next[d.id] = map[d.id].map(v => ({ ...v, id: v.id || 'bm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }))
    } else if (next[d.id] !== undefined) {
      delete next[d.id]
    }
  })
  store.devBrands = next
  await store.saveAll()
  store.toast(`价格已保存：${inSub.length} 台设备品牌价格已更新`)
}
function nameOf (id) {
  const d = devices.value.find(x => x.id === id)
  return d ? d.name : id
}

// ---- 批量粘贴导入（按设备名归位到组内，直接写入 devBrands）----
function openPaste () {
  openDialog(PasteDialog, { dbSub: props.dbSub, onDone: res => {
    if (!res) return
    const n = res.added + res.updated
    store.toast(n ? `粘贴导入完成：新增 ${res.added} 行，更新 ${res.updated} 行${res.skipped.length ? '，跳过 ' + res.skipped.length + ' 个未知设备' : ''}` : ('未导入任何行' + (res.skipped.length ? '：' + res.skipped.slice(0, 5).join('、') : '')))
  } })
}
const PasteDialog = {
  components: { ModalBase, VIcon },
  props: { dbSub: { type: String, default: '' }, onDone: Function },
  emits: ['close'],
  setup (props, { emit }) {
    const text = ref('')
    const apply = () => {
      const lines = String(text.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      let added = 0; const skipped = []
      const subDevs = devices.value.filter(d => d.subsystem === props.dbSub)
      lines.forEach((line, i) => {
        if (i === 0 && line.indexOf('设备') >= 0) return
        const parts = line.split(/[,，\t]/).map(s => s.trim())
        const dev = parts[0]
        const dv = subDevs.find(x => x.name === dev)
        if (!dv) { skipped.push(dev); return }
        const brand = parts[1] || ''
        const model = parts[2] || ''
        const price = parts[3] !== undefined && parts[3] !== '' ? Number(parts[3]) : null
        const tier = parts[4] || '标准型'
        // 同品牌同型号视为更新，否则新增（归入该设备组的型号表）
        const list = devBrands.value[dv.id] || []
        const dup = list.find(v => v.brand === brand && v.model === model)
        if (dup) { dup.unitPrice = price != null ? price : dup.unitPrice; dup.tier = tier }
        else list.push({ id: 'bm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), brand, model, tier, param: '', unitPrice: price })
        devBrands.value[dv.id] = list
        added++
      })
      emit('close')
      props.onDone({ added, updated: 0, skipped })
    }
    return { text, apply, cancel: () => emit('close') }
  },
  template: `
    <ModalBase title="批量粘贴品牌价格" @close="cancel">
      <p class="hint" style="margin-bottom:8px">从 Excel/表格复制后粘贴，每行：<b>设备名称, 品牌, 型号, 单价</b>（设备名须与当前子系统完全一致，将自动归入对应设备分组）。</p>
      <textarea v-model="text" rows="10" style="width:100%;font-family:var(--mono);font-size:13px"></textarea>
      <div class="dialog-foot">
        <button class="btn btn-ghost" @click="cancel">取消</button>
        <button class="btn btn-primary" @click="apply"><VIcon name="ul"/>导入</button>
      </div>
    </ModalBase>`
}

async function exportCSV () {
  const rows = [['设备', '品牌', '型号', '档次', '参数', '单价']]
  groups.value.forEach(g => g.variants.forEach(v => rows.push([g.device.name, v.brand, v.model, v.tier, v.param, v.unitPrice])))
  await downloadBlob(`价格表-${props.dbSub}.csv`, buildCsvBlob(rowsToCSV(rows)))
}

function onKey (e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault(); e.stopImmediatePropagation(); save()
  }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
watch(() => props.dbSub, () => { expanded.value = {} }, { immediate: true })
</script>

<template>
  <div>
    <!-- 工具条 -->
    <div class="kv-row" style="margin:0 0 10px;border:none;padding:0;align-items:flex-start">
      <div style="min-width:240px">
        <div class="k">{{ dbSub }} · 价格工作台</div>
        <div class="d">设备分组维护品牌型号；新增型号自动插入所属设备下</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input v-model="filterTxt" placeholder="筛选设备/规格" style="width:180px">
        <button class="btn btn-ghost" @click="openPaste"><VIcon name="ul" />粘贴导入</button>
        <button class="btn btn-ghost" @click="exportCSV"><VIcon name="dl" />导出CSV</button>
        <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
      </div>
    </div>

    <!-- 状态条 -->
    <div class="pw-stats">
      <span class="pstat">{{ stats.devices }} 款设备</span>
      <span class="pstat">{{ stats.total }} 型号行</span>
      <span class="pstat good">{{ stats.priced }} 已配价</span>
      <span v-if="stats.missing" class="pstat bad">{{ stats.missing }} 缺价</span>
      <span v-if="stats.noParam" class="pstat warn">{{ stats.noParam }} 缺参数</span>
      <span v-if="unknownBrands.length" class="pstat brand" style="cursor:pointer" @click="importAllToPool">散落品牌 {{ unknownBrands.length }} 个 · 一键归库</span>
    </div>

    <!-- 展开控制 -->
    <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
      <button class="btn btn-ghost btn-sm" @click="expandAll(!allExpanded)"><VIcon :name="allExpanded ? 'up' : 'down'" />{{ allExpanded ? '全部收起' : '全部展开' }}</button>
      <span class="hint">Ctrl+S 或「保存」提交</span>
    </div>

    <!-- 设备分组折叠卡片 -->
    <div v-for="g in groups" :key="g.device.id" class="pw-group" :class="{ open: expanded[g.device.id] }">
      <div class="pw-ghead" @click="toggle(g.device.id)">
        <span class="pwdot" :class="{ good: g.priced === g.total && !g.badParam, bad: g.priced < g.total }"></span>
        <div class="pwinfo">
          <div class="pwname">{{ g.device.name }} <span v-if="g.device.spec" class="src">{{ g.device.spec }}</span></div>
          <div class="pwdim">{{ g.device.unit }} · {{ g.device.category }}</div>
        </div>
        <div class="pwtag">
          <span v-if="g.priced === g.total && !g.badParam" class="gtag good">已配齐</span>
          <span v-else-if="g.priced < g.total" class="gtag bad">{{ g.total - g.priced }} 缺价</span>
          <span v-if="g.badParam" class="gtag warn">{{ g.badParam }} 缺参数</span>
          <span class="gtag plain">{{ g.total }} 型号</span>
        </div>
        <VIcon :name="expanded[g.device.id] ? 'up' : 'down'" :size="14" class="pwa" />
      </div>

      <div v-if="expanded[g.device.id]" class="pw-gbody">
        <div class="pw-cols">
          <span>品牌</span><span>型号</span><span>配置档次</span><span>参数（与型号对应）</span><span>单价(元)</span><span></span>
        </div>
        <div v-for="(v, i) in g.variants" :key="v.key" class="pw-row" :class="{ empty: !v.brand.trim() }">
          <input v-model.trim="v.brand" list="pw-brand-pool" :placeholder="unknownBrands.includes(v.brand) ? '停用品牌：' + v.brand : '品牌'" class="cell brand" @input="onBrandInput(g, v, $event.target.value)" @blur="saveBrandToPool(v.brand)">
          <input v-model.trim="v.model" placeholder="型号" class="cell">
          <select v-model="v.tier" class="cell tier"><option v-for="t in BUDGET_TIERS" :key="t.id" :value="t.name">{{ t.name }}</option></select>
          <input v-model.trim="v.param" :placeholder="v.brand ? '与型号对应' : '参数'" class="cell" :class="{ warn: v.brand && !v.param.trim() }">
          <input v-model.number="v.unitPrice" type="number" min="0" step="0.01" placeholder="单价" class="cell price">
          <div class="rop">
            <button class="del" title="删除该型号" @click="removeRow(g, i)"><VIcon name="x" /></button>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px" @click="addVariant(g)"><VIcon name="plus" />在本设备下添加型号</button>
      </div>
    </div>

    <div v-if="!groups.length" class="card" style="text-align:center;color:var(--text3);padding:30px">
      该子系统暂无设备，请先到「设备字典」添加，或调整筛选。
    </div>

    <!-- 品牌池 datalist（全局一个） -->
    <datalist id="pw-brand-pool">
      <option v-for="b in brandPool" :key="b" :value="b">{{ b }}</option>
    </datalist>
  </div>
</template>

<style scoped>
.pw-stats{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px}
.pstat{font-size:12px;color:var(--text2);background:var(--glass-1);border:1px solid var(--line);border-radius:999px;padding:4px 12px}
.pstat.good{color:var(--green);border-color:var(--green-line);background:var(--green-l)}
.pstat.bad{color:var(--red);border-color:var(--red-line);background:var(--red-l)}
.pstat.warn{color:var(--amber);border-color:var(--amber-line);background:var(--amber-l)}
.pstat.brand{color:var(--blue-ink);border-color:var(--blue-line);background:var(--blue-bg);cursor:pointer}
.pw-group{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
.pw-ghead{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;transition:background .15s}
.pw-ghead:hover{background:var(--glass-2)}
.pw-group.open .pw-ghead{border-bottom:1px solid var(--line)}
.pwdot{width:9px;height:9px;border-radius:50%;flex-shrink:0;background:var(--amber);box-shadow:0 0 8px var(--amber)}
.pwdot.good{background:var(--green);box-shadow:0 0 8px var(--green)}
.pwdot.bad{background:var(--red);box-shadow:0 0 8px var(--red)}
.pwinfo{flex:1;min-width:0}
.pwname{font-weight:600;font-size:14px;color:var(--text)}
.pwname .src{color:var(--text3);font-weight:400;font-size:12px;margin-left:6px}
.pwdim{font-size:11.5px;color:var(--text3)}
.pwtag{display:flex;gap:6px;flex-wrap:wrap}
.gtag{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:600}
.gtag.good{background:var(--green-l);color:var(--green);border:1px solid var(--green-line)}
.gtag.bad{background:var(--red-l);color:var(--red);border:1px solid var(--red-line)}
.gtag.warn{background:var(--amber-l);color:var(--amber);border:1px solid var(--amber-line)}
.gtag.plain{background:var(--gray-bg);color:var(--text3);border:1px solid var(--line)}
.pwa{color:var(--text3);flex-shrink:0}
.pw-gbody{padding:12px 16px 16px}
.pw-cols,.pw-row{display:grid;grid-template-columns:1.1fr 1.2fr 0.9fr 1.5fr 0.8fr 36px;gap:8px;align-items:center}
.pw-cols{padding:0 2px 6px}
.pw-cols span{font-size:11px;color:var(--text3);font-weight:600}
.pw-row{margin-bottom:6px}
.pw-row .cell{width:100%;font-size:13px}
.pw-row.empty{opacity:.7}
.pw-row.empty .cell{border-style:dashed}
.cell.brand{background:var(--blue-bg);border-color:var(--blue-line);color:var(--text)}
.cell.tier select{width:100%}
.cell.price{font-family:var(--mono)}
.cell.warn{border-color:var(--amber-line)}
.rop{display:flex;justify-content:center}
.rop .del{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--text3)}
.rop .del:hover{background:var(--red-l);color:var(--red)}
</style>