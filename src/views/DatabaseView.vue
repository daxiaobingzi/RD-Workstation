<script setup>
// 数据库 · 设备字典：子系统页签 + 设备列表（排序/编辑/复制/删除）
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { useLayout } from '../composables/layout'
import { openDialog, confirmBox } from '../composables/ui'
import { rowsToCSV } from '../db/calc'
import { buildCsvBlob, downloadBlob } from '../db/export'
import VIcon from '../components/ui/VIcon.vue'
import DeviceFormDialog from '../components/dialogs/DeviceFormDialog.vue'
import DeviceBatchDialog from '../components/dialogs/DeviceBatchDialog.vue'
import PriceWorkbench from '../components/PriceWorkbench.vue'
import PriceGovernDialog from '../components/dialogs/PriceGovernDialog.vue'

const store = useAppStore()
const layout = useLayout()
const { settings, devices, devBrands, devSort, points } = storeToRefs(store)

const dbSub = ref(store.curSub && settings.value.subsystems.some(s => s.name === store.curSub) ? store.curSub : (settings.value.subsystems[0]?.name || '视频监控系统'))
const mode = ref('dict') // dict | price

// ---------- 批量操作 ----------
const sel = ref(new Set())
const selList = computed(() => devices.value.filter(d => sel.value.has(d.id)))
const allChecked = computed(() => devs.value.length > 0 && devs.value.every(d => sel.value.has(d.id)))
watch([dbSub, mode], () => sel.value = new Set())
function toggle (id) { const s = new Set(sel.value); s.has(id) ? s.delete(id) : s.add(id); sel.value = s }
function toggleAll () { sel.value = allChecked.value ? new Set() : new Set(devs.value.map(d => d.id)) }
function clearSel () { sel.value = new Set() }

function openBatchAdd () { openDialog(DeviceBatchDialog, { subsystem: dbSub.value, selectedIds: [], tab: 'add' }) }
function openBatchEdit () { if (!sel.value.size) { store.toast('请先勾选设备'); return } openDialog(DeviceBatchDialog, { subsystem: dbSub.value, selectedIds: [...sel.value], tab: 'edit' }) }

async function batchDelete () {
  const list = selList.value
  if (!list.length) { store.toast('请先勾选设备'); return }
  let refCount = 0
  list.forEach(d => {
    refCount += points.value.filter(x => x['设备ID'] === d.id || (!x['设备ID'] && x.子系统 === d.subsystem && x.设备类型 === d.name)).length
  })
  const ok = await confirmBox(
    refCount
      ? `所选 ${list.length} 台设备共被 ${refCount} 处项目点表引用，批量删除将导致涉及项目的清单推算失效。\n建议改为归档，或先清理引用。仍要删除？`
      : `确定批量删除所选 ${list.length} 台设备？`,
    '批量删除设备', true)
  if (!ok) return
  list.forEach(d => store.deleteDevice(d.id))
  sel.value = new Set()
  await store.saveAll()
  store.toast(`已删除 ${list.length} 台设备`)
}

function exportSel () {
  const list = selList.value.length ? selList.value : devs.value
  const head = ['设备名称', '规格型号', '单位', '类别', '配比规则', '品牌型号价格']
  const rows = [head].concat(list.map(d => {
    return [d.name, d.spec || '', d.unit, d.category, ratioTxt(d), brandTxt(d).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')]
  }))
  downloadBlob(`设备字典-${dbSub.value}.csv`, buildCsvBlob(rowsToCSV(rows)))
  store.toast(`已导出 ${list.length} 台设备`)
}

// 全库缺价统计（价格治理按钮角标）
const missingN = computed(() => devices.value.filter(d => {
  const bs = devBrands.value[d.id] || []
  if (!bs.length) return true
  return !bs.some(b => b.brand && b.unitPrice != null && b.unitPrice !== '')
}).length)

function openGovern () { openDialog(PriceGovernDialog, {}) }

const devs = computed(() => {
  const list = devices.value.filter(d => d.subsystem === dbSub.value)
  const has = list.filter(d => devSort.value[d.id] != null)
  const none = list.filter(d => devSort.value[d.id] == null)
  has.sort((a, b) => devSort.value[a.id] - devSort.value[b.id])
  return has.concat(none)
})

function selectSub (sn) { dbSub.value = sn; store.curSub = sn }

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

const brandTxt = d => {
  const bs = devBrands.value[d.id] || []
  if (!bs.length) return '<span style="color:var(--text3)">未配置</span>'
  const first = bs[0]
  return `${first.brand || ''}${first.model ? ' ' + first.model : ''}${first.unitPrice != null ? ' · ¥' + first.unitPrice : ''}${bs.length > 1 ? ' +' + (bs.length - 1) : ''}`
}

function openForm (d) { openDialog(DeviceFormDialog, { device: d, subsystem: dbSub.value }) }

function move (id, dir) {
  store.moveDevice(id, dir)
}

async function copy (id) {
  const nd = store.copyDevice(id)
  await store.saveAll()
  store.toast(`已复制设备「${nd.name}」`)
}

async function del (id) {
  const d = store.devById(id)
  if (!d) return
  const refs = points.value.filter(x => x['设备ID'] === id || (!x['设备ID'] && x.子系统 === d.subsystem && x.设备类型 === d.name))
  if (refs.length) {
    const ok = await confirmBox(
      `设备「${d.name}」被 ${refs.length} 处项目点表引用，物理删除将导致项目清单推算失效。\n建议改为归档（在编辑中置类别/状态），或先删除引用该设备的点表行。`,
      '设备被引用', true)
    if (!ok) return
  } else {
    const ok = await confirmBox(`确定删除设备「${d.name}」？`, '删除设备')
    if (!ok) return
  }
  store.deleteDevice(id)
  await store.saveAll()
  store.toast('设备已删除')
}

const addDev = () => openDialog(DeviceFormDialog, { subsystem: dbSub.value })

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
        <template v-if="sel.size">
          <span class="sel-count"><b>{{ sel.size }}</b> 台已选</span>
          <button class="btn btn-ghost btn-sm" @click="openBatchEdit"><VIcon name="edit" />批量修改</button>
          <button class="btn btn-ghost btn-sm" @click="batchDelete"><VIcon name="trash" />批量删除</button>
          <button class="btn btn-ghost btn-sm" @click="exportSel"><VIcon name="download" />导出CSV</button>
          <button class="btn btn-ghost btn-sm" @click="clearSel">清除选择</button>
        </template>
        <span v-else class="hint">勾选设备后可批量修改 / 删除 / 导出；「批量添加」支持粘贴多行快速建库</span>
      </div>
      <div class="card">
        <div class="card-title">{{ dbSub }} 设备类型 <span class="sub">设备名称/规格/单位/类别/配比规则/品牌价格</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" :checked="allChecked" @change="toggleAll" title="全选" /></th>
          <th>设备名称</th><th>规格型号</th><th>单位</th><th>类别</th><th>品牌/价格</th><th>配比规则</th><th style="width:168px">操作</th></tr></thead>
        <tbody>
          <tr v-if="!devs.length"><td colspan="9" style="text-align:center;color:var(--text3);padding:24px">该子系统暂无设备，点击「添加设备」或「批量添加」录入。</td></tr>
          <tr v-for="(d, idx) in devs" :key="d.id">
            <td><input type="checkbox" :checked="sel.has(d.id)" @change="toggle(d.id)" /></td>
            <td><b>{{ d.name }}</b></td>
            <td class="src">{{ d.spec || '-' }}</td>
            <td>{{ d.unit }}</td>
            <td><span class="badge" :class="{ 'blue': d.category === '前端设备', 'green': d.category === '后端设备', 'plain': d.category !== '前端设备' && d.category !== '后端设备' }">{{ d.category }}</span></td>
            <td v-html="brandTxt(d)"></td>
            <td class="src">{{ ratioTxt(d) }}</td>
            <td>
              <div class="op">
                <button title="上移" :disabled="idx === 0" @click="move(d.id, -1)"><VIcon name="up" /></button>
                <button title="下移" :disabled="idx === devs.length - 1" @click="move(d.id, 1)"><VIcon name="down" /></button>
                <button title="编辑" @click="openForm(d)"><VIcon name="edit" /></button>
                <button title="复制" @click="copy(d.id)"><VIcon name="copy" /></button>
                <button class="del" title="删除" @click="del(d.id)"><VIcon name="trash" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.batch-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.sel-count { font-size: 12.5px; color: var(--accent); background: var(--primary-l); padding: 3px 10px; border-radius: 999px; }
.batch-bar input[type="checkbox"] { width: auto; margin: 0; accent-color: var(--accent); }
</style>