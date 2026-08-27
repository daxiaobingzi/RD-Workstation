<script setup>
// 数据库 · 设备字典：子系统页签 + Notion 风格数据表（行内编辑/排序/筛选/三视图）
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { useLayout } from '../composables/layout'
import { openDialog, confirmBox } from '../composables/ui'
import { rowsToCSV } from '../db/calc'
import { buildCsvBlob, downloadBlob } from '../db/export'
import VIcon from '../components/ui/VIcon.vue'
import NotionTable from '../components/notion/NotionTable.vue'
import DeviceFormDialog from '../components/dialogs/DeviceFormDialog.vue'
import DeviceBatchDialog from '../components/dialogs/DeviceBatchDialog.vue'
import PriceWorkbench from '../components/PriceWorkbench.vue'
import PriceGovernDialog from '../components/dialogs/PriceGovernDialog.vue'

const store = useAppStore()
const layout = useLayout()
const { settings, devices, devBrands, devSort, points } = storeToRefs(store)

const dbSub = ref(store.curSub && settings.value.subsystems.some(s => s.name === store.curSub) ? store.curSub : (settings.value.subsystems[0]?.name || '视频监控系统'))
const mode = ref('dict') // dict | price

// 当前子系统设备（按自定义排序）
const devs = computed(() => {
  const list = devices.value.filter(d => d.subsystem === dbSub.value)
  const has = list.filter(d => devSort.value[d.id] != null)
  const none = list.filter(d => devSort.value[d.id] == null)
  has.sort((a, b) => devSort.value[a.id] - devSort.value[b.id])
  return has.concat(none)
})

function selectSub (sn) { dbSub.value = sn; store.curSub = sn }

// 展示辅助（纯文本）
function ratioTxt (d) {
  const r = d.ratio
  if (!r) return '-'
  if (r.type === 'point') return '点数（手填）'
  if (r.type === 'ratio') return '1/' + (r.per || 1) + ' × 前端'
  if (r.type === 'fixed') return '固定 ' + (r.qty || 1)
  if (r.type === 'factor') return '×' + (r.factor != null ? r.factor : 1)
  if (r.type === 'length') return (r.per || 1) + ' m/点'
  return r.type
}
function brandPlain (d) {
  const bs = devBrands.value[d.id] || []
  if (!bs.length) return '未配置'
  const first = bs[0]
  return `${first.brand || ''}${first.model ? ' ' + first.model : ''}${first.unitPrice != null ? ' · ¥' + first.unitPrice : ''}${bs.length > 1 ? ' +' + (bs.length - 1) : ''}`
}
const D_COLS = [
  { key: 'name', label: '设备名称', type: 'text', sortable: true, width: '190px' },
  { key: 'spec', label: '规格型号', type: 'longtext', sortable: true, width: '170px' },
  { key: 'unit', label: '单位', type: 'text', sortable: true, width: '64px' },
  { key: 'category', label: '类别', type: 'single', options: ['前端设备', '后端设备', '管材线缆', '辅材'], sortable: true, width: '104px' },
  { key: 'brand', label: '品牌/价格', type: 'text', editable: false, fmt: brandPlain, sortable: true, width: '170px' },
  { key: 'ratio', label: '配比/链规则', type: 'text', editable: false, fmt: d => ratioTxt(d), width: '140px' },
  { key: 'status', label: '状态', type: 'single', options: ['启用', '归档'], sortable: true, width: '92px', fmt: d => d.status || '启用' }
]

// 编辑后自动落盘（防抖）
let saveTimer = null
function onCommit () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { store.saveAll() }, 400)
}
function onOpen (d) { openDialog(DeviceFormDialog, { device: d, subsystem: dbSub.value }) }
function onAdd () { openDialog(DeviceFormDialog, { subsystem: dbSub.value }) }

async function onDel (d) {
  const refs = points.value.filter(x => x['设备ID'] === d.id || (!x['设备ID'] && x.子系统 === d.subsystem && x.设备类型 === d.name))
  if (refs.length) {
    const ok = await confirmBox(
      `设备「${d.name}」被 ${refs.length} 处项目点表引用，物理删除将导致项目清单推算失效。\n建议改为归档（编辑中置状态），或先删除引用该设备的点表行。`,
      '设备被引用', true)
    if (!ok) return
  } else {
    const ok = await confirmBox(`确定删除设备「${d.name}」？`, '删除设备')
    if (!ok) return
  }
  store.deleteDevice(d.id)
  await store.saveAll()
  store.toast('设备已删除')
}

function openBatchAdd () { openDialog(DeviceBatchDialog, { subsystem: dbSub.value, selectedIds: [], tab: 'add' }) }
function openGovern () { openDialog(PriceGovernDialog, {}) }

// 全库缺价统计（价格治理按钮角标）
const missingN = computed(() => devices.value.filter(d => {
  const bs = devBrands.value[d.id] || []
  if (!bs.length) return true
  return !bs.some(b => b.brand && b.unitPrice != null && b.unitPrice !== '')
}).length)

function exportSel () {
  const list = devs.value
  const head = ['设备名称', '规格型号', '单位', '类别', '配比规则', '品牌型号价格']
  const rows = [head].concat(list.map(d => {
    return [d.name, d.spec || '', d.unit, d.category, ratioTxt(d), brandPlain(d)]
  }))
  downloadBlob(`设备字典-${dbSub.value}.csv`, buildCsvBlob(rowsToCSV(rows)))
  store.toast(`已导出 ${list.length} 台设备`)
}

const addDev = () => onAdd()
onMounted(() => layout.setActions(mode.value === 'price' ? [] : [{ label: '添加设备', icon: 'plus', cls: 'primary', onClick: addDev }]))
onBeforeUnmount(() => layout.setActions([]))
function switchMode (m) {
  mode.value = m
  layout.setActions(m === 'price' ? [] : [{ label: '添加设备', icon: 'plus', cls: 'primary', onClick: addDev }])
}
</script>

<template>
  <div>
    <div class="tabs">
      <button v-for="s in settings.subsystems" :key="s.id" class="tab" :class="{ active: dbSub === s.name }" @click="selectSub(s.name)">
        {{ s.name }}<span v-if="devices.filter(d => d.subsystem === s.name).length" class="cnt">{{ devices.filter(d => d.subsystem === s.name).length }}</span>
      </button>
    </div>

    <div class="tabs" style="margin-bottom:10px">
      <button class="tab" :class="{ active: mode === 'dict' }" @click="switchMode('dict')">设备字典</button>
      <button class="tab" :class="{ active: mode === 'price' }" @click="switchMode('price')">价格工作台</button>
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" @click="openGovern"><VIcon name="zap" />价格治理{{ missingN ? ` · ${missingN} 缺价` : '' }}</button>
    </div>

    <template v-if="mode === 'price'">
      <PriceWorkbench :db-sub="dbSub" />
    </template>
    <template v-else>
      <div class="batch-bar">
        <button class="btn btn-ghost btn-sm" @click="openBatchAdd"><VIcon name="plus" />批量添加</button>
        <button class="btn btn-ghost btn-sm" @click="exportSel"><VIcon name="download" />导出CSV</button>
        <span class="hint">行内点击单元格直接编辑（Enter 确认 / Esc 取消）；双击行打开编辑弹窗；拖拽手柄调整顺序</span>
      </div>
      <div class="card">
        <div class="card-title">{{ dbSub }} 设备类型 <span class="sub">Notion 风格数据表 · 状态列可归档设备</span></div>
        <NotionTable
          :columns="D_COLS"
          :rows="devs"
          group-by="category"
          @commit="onCommit"
          @open="onOpen"
          @del="onDel"
          @add="onAdd"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.batch-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
</style>
