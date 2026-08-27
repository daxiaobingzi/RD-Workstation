<script setup>
// 统一「点位 × 选型」多维表格（Feishu Bitable 风格）
// 合并原「添加点位 / 点位明细 / 选型面板」三处功能：
//   - 行内新增/编辑点位（设备类型 / 数量 / 备注）
//   - 行内选型（品牌型号下拉 → 写入项目选型，决定清单与报价）
//   - 勾选批量删除 / 按档次批量选型 / 智能推算 / CSV 导入导出
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { BUDGET_TIERS } from '../db/constants'
import { tierName } from '../db/format'
import { openDialog, confirmBox } from '../composables/ui'
import VIcon from './ui/VIcon.vue'
import PointBatchAddDialog from './dialogs/PointBatchAddDialog.vue'
import AutoQtyDialog from './dialogs/AutoQtyDialog.vue'
import PointCsvDialog from './dialogs/PointCsvDialog.vue'
import PointFormDialog from './dialogs/PointFormDialog.vue'

const props = defineProps({
  project: { type: Object, default: null },
  sub: { type: String, default: '' }
})

const store = useAppStore()
const { devices, devBrands, meta, points } = storeToRefs(store)

const sel = ref(new Set())
const curTier = ref('')

// 本子系统可用设备（前端+后端，含当前行可能引用的历史设备）
const subDevs = computed(() => devices.value.filter(d => d.subsystem === props.sub && d.status !== '归档' && (d.category === '前端设备' || d.category === '后端设备')))
function devOf (id) { return devices.value.find(d => d.id === id) || null }

// 行数据：点表行 × 设备 × 品牌型号（含当前选型）
const rows = computed(() => {
  const pid = props.project?.id
  const selMap = (meta.value.projectSelections && meta.value.projectSelections[pid]) || {}
  return points.value
    .filter(x => x.项目ID === pid && x.子系统 === props.sub)
    .map(x => {
      const dv = store.resolveDevice(devices.value, x.子系统, x.设备类型, x['设备ID'])
      const variants = dv ? (devBrands.value[dv.id] || []).filter(v => v.brand) : []
      const s = dv ? selMap[dv.id] : null
      const current = s
        ? { brand: s.brand, model: s.model, tier: tierName(s.tier), param: s.param, unitPrice: Number(s.unitPrice) || null, source: '人工指定' }
        : (variants[0] ? { brand: variants[0].brand, model: variants[0].model, tier: tierName(variants[0].tier), param: variants[0].param, unitPrice: Number(variants[0].unitPrice) || null, source: '默认型号' } : null)
      return { x, dv, variants, current, explicit: !!s, missing: !dv }
    })
})

// 未显式选型（有型号但未人工指定）的设备行数
const selMissing = computed(() => rows.value.filter(r => !r.missing && r.variants.length && !r.explicit).length)

// ---------- 行内编辑 ----------
async function setQty (row, val) {
  const n = Number(val) || 0
  store.savePoint(row.x, { 数量: n })
  await store.saveAll()
}
async function setNote (row, val) {
  store.savePoint(row.x, { 备注: val })
  await store.saveAll()
}
async function changeDevice (row, deviceId) {
  const d = devOf(deviceId)
  if (!d) return
  store.savePoint(row.x, { 设备ID: d.id, 设备类型: d.name })
  await store.saveAll()
  store.toast('已改为「' + d.name + '」')
}

// ---------- 选型 ----------
async function pickVariant (row, v) {
  if (!v) {
    store.setProjectSelection(props.project.id, row.dv.id, null)
    await store.saveAll()
    store.toast('「' + row.dv.name + '」恢复默认第 1 个型号')
    return
  }
  store.setProjectSelection(props.project.id, row.dv.id, { brand: v.brand, model: v.model, tier: v.tier, param: v.param, unitPrice: v.unitPrice })
  await store.saveAll()
  store.toast('已选型：' + v.brand + ' ' + v.model + (v.unitPrice != null ? '（¥' + v.unitPrice + '）' : ''))
}
// 品牌下拉 change：key = '品牌|型号' 或 ''（恢复默认）
async function onPick (r, key) {
  if (!r.dv) return
  if (!key) { await pickVariant(r, null); return }
  const sep = key.indexOf('|')
  const brand = key.slice(0, sep)
  const model = key.slice(sep + 1)
  const v = r.variants.find(x => x.brand === brand && (x.model || '') === model)
  if (v) await pickVariant(r, v)
}
async function bulkByTier (t) {
  curTier.value = t.name
  const n = store.bulkSelectionByTier(props.project.id, props.sub, t.name)
  await store.saveAll()
  store.toast(n ? '已按「' + t.name + '」批量选型 ' + n + ' 台设备' : '该档次无匹配型号，已取各设备默认型号')
}

// ---------- 新增行 ----------
const addDevId = ref('')
const addQty = ref(1)
const addNote = ref('')
async function addRow () {
  const d = devOf(addDevId.value)
  if (!d) { store.toast('请选择设备类型'); return }
  store.addPoint({ 项目ID: props.project.id, 子系统: props.sub, 设备类型: d.name, 设备ID: d.id, 数量: Number(addQty.value) || 1, 备注: addNote.value.trim() })
  await store.saveAll()
  addDevId.value = ''; addQty.value = 1; addNote.value = ''
  store.toast('已添加「' + d.name + '」')
}

// ---------- 删除 / 批量删除 ----------
async function delRow (row) {
  const ok = await confirmBox('确定删除「' + row.x.设备类型 + '」这行点位（数量 ' + row.x.数量 + '）？', '删除点表行')
  if (!ok) return
  store.deletePoint(row.x.id)
  sel.value.delete(row.x.id)
  await store.saveAll()
}
const allChecked = computed(() => rows.value.length > 0 && rows.value.every(r => sel.value.has(r.x.id)))
function toggle (id) { const s = new Set(sel.value); s.has(id) ? s.delete(id) : s.add(id); sel.value = s }
function toggleAll () { sel.value = allChecked.value ? new Set() : new Set(rows.value.map(r => r.x.id)) }
async function batchDel () {
  if (!sel.value.size) { store.toast('请先勾选要删除的点位行'); return }
  const list = rows.value.filter(r => sel.value.has(r.x.id))
  const total = list.reduce((a, r) => a + (Number(r.x.数量) || 0), 0)
  const ok = await confirmBox('确定删除选中的 ' + list.length + ' 行点位（合计数量 ' + total + '）？', '批量删除点表行')
  if (!ok) return
  list.forEach(r => store.deletePoint(r.x.id))
  sel.value = new Set()
  await store.saveAll()
  store.toast('已删除 ' + list.length + ' 行点位')
}
watch(() => props.sub, () => { sel.value = new Set() })

// ---------- 工具入口 ----------
function openBatchAdd () { openDialog(PointBatchAddDialog, { project: props.project, sub: props.sub }) }
function openAuto () { openDialog(AutoQtyDialog, { project: props.project, sub: props.sub }) }
function openCsv () { openDialog(PointCsvDialog, { project: props.project, sub: props.sub }) }
// 行内高级编辑（子系统扩展字段等）
function openEdit (r) { openDialog(PointFormDialog, { project: props.project, point: r.x, sub: props.sub }) }
</script>

<template>
  <div class="ppg">
    <!-- 工具条 -->
    <div class="ppg-bar">
      <div class="ppg-tier">
        <span class="hint">按档次批量选型：</span>
        <button v-for="t in BUDGET_TIERS" :key="t.id" class="btn btn-ghost btn-sm" :class="{ on: curTier === t.name }" @click="bulkByTier(t)"><VIcon name="zap" :size="14" />{{ t.name }}</button>
        <span class="hint" style="margin-left:6px">无匹配档自动取默认型号</span>
      </div>
      <div class="ppg-ops">
        <button class="btn btn-ghost btn-sm" @click="openBatchAdd"><VIcon name="list" />批量添加/更新</button>
        <button class="btn btn-ghost btn-sm" @click="openAuto"><VIcon name="zap" />智能推算</button>
        <button class="btn btn-ghost btn-sm" @click="openCsv"><VIcon name="ul" />导入CSV</button>
        <button class="btn btn-ghost btn-sm" @click="openCsv"><VIcon name="dl" />导出CSV</button>
        <template v-if="sel.size">
          <span class="ppg-sel">已选 {{ sel.size }} 行</span>
          <button class="btn btn-danger btn-sm" @click="batchDel"><VIcon name="trash" />批量删除</button>
        </template>
      </div>
    </div>

    <!-- 网格 -->
    <div class="tbl-wrap"><table class="tbl ppg-tbl">
      <thead><tr>
        <th style="width:34px"><input type="checkbox" :checked="allChecked" @change="toggleAll" title="全选本系统点位" /></th>
        <th>设备类型</th>
        <th>规格型号</th>
        <th style="width:90px">数量</th>
        <th>备注</th>
        <th style="min-width:180px">品牌/型号</th>
        <th style="width:96px">单价(元)</th>
        <th style="width:86px"></th>
      </tr></thead>
      <tbody>
        <tr v-if="!rows.length"><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">
          暂无点位。在下方选择设备、填写数量即可新增；也可用「批量添加/更新」一次勾选多台设备写入。
        </td></tr>
        <tr v-for="r in rows" :key="r.x.id" :class="{ 'row-sel': sel.has(r.x.id), 'row-miss': r.missing }">
          <td><input type="checkbox" :checked="sel.has(r.x.id)" @change="toggle(r.x.id)" /></td>
          <td>
            <select v-if="!r.missing" :value="r.dv.id" class="ppg-sel-dev" @change="changeDevice(r, $event.target.value)">
              <option v-if="!subDevs.some(d => d.id === r.dv.id)" :value="r.dv.id">{{ r.dv.name }}（已归档）</option>
              <option v-for="d in subDevs" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <span v-else class="ppg-miss" :title="'设备字典中缺失「' + r.x.设备类型 + '」，请在资料库恢复或改用其他设备'">{{ r.x.设备类型 }}（字典缺失）</span>
          </td>
          <td class="clamp" :title="r.dv ? r.dv.spec : ''">{{ r.dv ? (r.dv.spec || '-') : '-' }}</td>
          <td><input :value="r.x.数量" type="number" min="0" step="1" class="ppg-qty" @change="setQty(r, $event.target.value)" /></td>
          <td><input :value="r.x.备注" class="ppg-note" placeholder="备注（如：1F 10台）" @change="setNote(r, $event.target.value)" /></td>
          <td>
            <template v-if="r.dv">
              <select v-if="r.variants.length" class="ppg-brand" :value="r.explicit ? (r.current.brand + '|' + r.current.model) : ''" @change="onPick(r, $event.target.value)">
                <option value="">默认型号{{ r.current ? '：' + r.current.brand + ' ' + r.current.model : '（未配置）' }}</option>
                <option v-for="v in r.variants" :key="v.id" :value="v.brand + '|' + v.model">{{ v.brand }} {{ v.model }}<template v-if="v.unitPrice != null"> · ¥{{ v.unitPrice }}</template></option>
              </select>
              <span v-else class="ppg-none" title="未配置品牌型号，请到「资料库 → 价格工作台」补型号">未配置</span>
            </template>
          </td>
          <td class="ppg-price" :class="{ 'no-price': !r.current || r.current.unitPrice == null }">{{ r.current && r.current.unitPrice != null ? r.current.unitPrice.toLocaleString('zh-CN') : '—' }}</td>
          <td>
            <div class="ppg-op">
              <button class="btn btn-icon btn-sm" title="高级编辑（含扩展字段）" @click="openEdit(r)"><VIcon name="edit" :size="14" /></button>
              <button class="btn btn-icon btn-sm del" title="删除行" @click="delRow(r)"><VIcon name="trash" :size="14" /></button>
            </div>
          </td>
        </tr>
      </tbody>
    </table></div>

    <!-- 新增行 -->
    <div class="ppg-add">
      <select v-model="addDevId" class="ppg-add-dev">
        <option value="" disabled>选择设备类型…</option>
        <option v-for="d in subDevs" :key="d.id" :value="d.id">{{ d.name }}（{{ d.category === '前端设备' ? '前端' : '后端' }}）</option>
      </select>
      <input v-model.number="addQty" type="number" min="0" step="1" class="ppg-add-qty" placeholder="数量">
      <input v-model.trim="addNote" class="ppg-add-note" placeholder="备注">
      <button class="btn btn-primary btn-sm" @click="addRow"><VIcon name="plus" />新增点位</button>
    </div>

    <div v-if="selMissing" class="ppg-tip"><VIcon name="alert" :size="13" />{{ selMissing }} 行已有型号但未人工指定，清单将按默认型号计算</div>
  </div>
</template>

<style scoped>
.ppg-bar{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.ppg-tier{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ppg-tier .btn.on{background:var(--primary);color:#fff}
.ppg-ops{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ppg-sel{font-size:12px;color:var(--accent);background:var(--primary-l);padding:3px 10px;border-radius:999px;font-weight:600}
.ppg-tbl td{vertical-align:top}
.ppg-sel-dev,.ppg-brand{width:100%;max-width:220px;font-size:12.5px}
.ppg-qty{width:72px}
.ppg-note{width:100%;min-width:120px}
.clamp{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ppg-price{font-family:var(--mono);font-weight:600;text-align:right}
.ppg-price.no-price{color:var(--text3);font-weight:400}
.ppg-op{display:flex;gap:2px}
.ppg-op .btn-icon{width:28px;height:28px;min-height:28px}
.ppg-op .del{color:var(--text3)}
.ppg-op .del:hover{color:var(--red)}
.ppg-none{font-size:12px;color:var(--red)}
.ppg-miss{font-size:12px;color:var(--amber)}
.row-sel{background:var(--primary-l)}
.row-miss td{background:var(--amber-l)}
.ppg-add{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 4px 4px;border-top:1px dashed var(--line2);margin-top:10px}
.ppg-add-dev{flex:1;min-width:200px}
.ppg-add-qty{width:90px}
.ppg-add-note{flex:1;min-width:140px}
.ppg-tip{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--amber);margin-top:8px}
.ppg-tip svg{flex-shrink:0}
</style>
