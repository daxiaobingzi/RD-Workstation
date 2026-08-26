<script setup>
// 项目详情 · 竖向流：项目头 → 系统卡（推导链） → 清单舱 / 设计说明
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { isOverdue, daysFrom } from '../../db/format'
import { useLayout } from '../../composables/layout'
import { openDialog, confirmBox, promptBox } from '../../composables/ui'
import VIcon from '../../components/ui/VIcon.vue'
import ProjectFormDialog from '../../components/dialogs/ProjectFormDialog.vue'
import PointFormDialog from '../../components/dialogs/PointFormDialog.vue'
import PointBatchAddDialog from '../../components/dialogs/PointBatchAddDialog.vue'
import PointCsvDialog from '../../components/dialogs/PointCsvDialog.vue'
import AutoQtyDialog from '../../components/dialogs/AutoQtyDialog.vue'
import BillHistoryDialog from '../../components/dialogs/BillHistoryDialog.vue'
import SystemChainCard from '../../components/SystemChainCard.vue'
import SelectionPanel from '../../components/SelectionPanel.vue'

const store = useAppStore()
const layout = useLayout()
const { points, bills, meta, settings, notes, devices } = storeToRefs(store)

const p = computed(() => store.projectById(store.curProjId))
const sub = computed(() => {
  if (store.curSub && store.curSub !== '__all' && settings.value.subsystems.some(s => s.name === store.curSub)) return store.curSub
  return (settings.value.subsystems[0] && settings.value.subsystems[0].name) || '视频监控系统'
})

// 子系统数量（点位合计）
const ptCountOf = (sn) => (p.value ? points.value.filter(x => x.项目ID === p.value.id && x.子系统 === sn).reduce((a, x) => a + (Number(x.数量) || 0), 0) : 0)
const sysCount = computed(() => settings.value.subsystems.filter(s => ptCountOf(s.name) > 0).length || settings.value.subsystems.length)

const projectPoints = computed(() => (p.value ? points.value.filter(x => x.项目ID === p.value.id).reduce((a, x) => a + (Number(x.数量) || 0), 0) : 0))
const projQuote = computed(() => {
  if (!p.value) return 0
  try {
    const q = store.quoteRowsFor(p.value)
    return q ? q.quote.total : 0
  } catch (e) { return 0 }
})

const progress = computed(() => (p.value ? store.calcProgress(
  { points: points.value, bills: bills.value, notes: notes.value }, { ...p.value }) : 0))

const stageLog = computed(() => (meta.value.stageLog && meta.value.stageLog[p.value?.id]) || [])
const histList = computed(() => store.billOfProject(p.value?.id))
const changedAfterBill = computed(() => {
  if (!p.value) return 0
  const billT = meta.value.billAt && meta.value.billAt[p.value.id]
  if (!billT) return 0
  return points.value.filter(x => x.项目ID === p.value.id && x.updatedAt && x.updatedAt > billT).length
})

const noteText = ref('')
const showSel = ref(true)

// 当前子系统未完成选型的设备数（有型号但用户未显式指定，且设备被本项目使用）
const selMissing = computed(() => {
  const sel = meta.value.projectSelections?.[p.value?.id] || {}
  return devices.value.filter(d => d.subsystem === sub.value && d.status !== '归档').filter(d => {
    const variants = (store.devBrands[d.id] || []).filter(v => v.brand)
    if (!variants.length) return true
    const cur = sel[d.id]
    return !cur || !cur.brand
  }).length
})
watch(sub, () => {
  noteText.value = (p.value && notes.value[p.value.id + '|' + sub.value]) || ''
}, { immediate: true })
watch(p, () => {
  noteText.value = (p.value && notes.value[p.value.id + '|' + sub.value]) || ''
})

const stageLogTxt = computed(() => {
  const sl = stageLog.value.slice(-3)
  return sl.map(l => `${l.from} → ${l.to}（${String(l.at).replace('T', ' ').slice(0, 16)}）`).join('；')
})

function badgeCls (s) {
  return { '设计中': 'blue', '校核中': 'amber', '已出清单': 'green', '已完成': 'gray' }[s] || 'plain'
}

// ---------- 操作 ----------
function backList () { layout.setActions([]); store.curView = 'list' }
function goBill () { store.curView = 'bill' }

function genBill () {
  const proj = p.value
  const { bill, diff } = store.prepareBill(proj)
  if (!bill.length) {
    store.toast('当前项目没有有效设备数量，无法生成清单')
    return
  }
  if (diff && (diff.added.length + diff.removed.length + diff.changed.length)) {
    const dTotal = diff.added.length + diff.removed.length + diff.changed.length
    openDialog(ConfirmBillDiff, {
      diff, dTotal, bill, proj,
      done: () => { store.commitBill(proj, bill); store.curView = 'bill' }
    })
  } else {
    store.commitBill(proj, bill)
    store.curView = 'bill'
  }
}

// 差异确认弹窗（内联定义）
const ConfirmBillDiff = {
  components: { VIcon },
  props: { diff: Object, dTotal: Number, bill: Array, proj: Object, done: Function },
  emits: ['close'],
  setup (props, { emit }) {
    const rowsOf = list => list.map(it => ({ name: it.name, qty: it.qty, old: it.old, nw: it.nw }))
    return {
      props, rowsOf,
      ok () { emit('close'); props.done() },
      cancel () { emit('close') }
    }
  },
  template: `
    <div class="dialog-head"><h3>清单差异确认</h3><button class="btn btn-icon" @click="cancel"><VIcon name="x"/></button></div>
    <div class="hint" style="margin:6px 0 10px">重新生成将覆盖当前清单。本次差异共 {{ props.dTotal }} 项。</div>
    <div v-if="props.diff.added.length" class="bill-cat">
      <div class="bill-cat-head" style="color:var(--green)">新增<span class="n">{{ props.diff.added.length }} 项</span></div>
      <div class="tbl-wrap"><table class="tbl"><tbody>
        <tr v-for="it in rowsOf(props.diff.added)" :key="it.name"><td><b>{{ it.name }}</b></td><td style="text-align:right">{{ it.qty }}</td></tr>
      </tbody></table></div>
    </div>
    <div v-if="props.diff.removed.length" class="bill-cat">
      <div class="bill-cat-head" style="color:var(--red)">减少<span class="n">{{ props.diff.removed.length }} 项</span></div>
      <div class="tbl-wrap"><table class="tbl"><tbody>
        <tr v-for="it in rowsOf(props.diff.removed)" :key="it.name"><td><b>{{ it.name }}</b></td><td style="text-align:right">{{ it.qty }}</td></tr>
      </tbody></table></div>
    </div>
    <div v-if="props.diff.changed.length" class="bill-cat">
      <div class="bill-cat-head" style="color:var(--amber)">数量变更<span class="n">{{ props.diff.changed.length }} 项</span></div>
      <div class="tbl-wrap"><table class="tbl"><tbody>
        <tr v-for="it in rowsOf(props.diff.changed)" :key="it.name"><td><b>{{ it.name }}</b></td><td style="text-align:right">{{ it.old }} → {{ it.nw }}</td></tr>
      </tbody></table></div>
    </div>
    <div class="dialog-foot">
      <button class="btn btn-ghost" @click="cancel">取消</button>
      <button class="btn btn-primary" @click="ok"><VIcon name="save"/>确认覆盖</button>
    </div>`
}

function moreMenu () {
  const proj = p.value
  const st = proj.状态
  const flowBtn = st === '设计中'
    ? { label: '提交校核', icon: 'check', fn: async () => { store.setProjectStatus(proj.id, '校核中'); await store.saveAll(); store.toast('已提交校核') } }
    : st === '校核中'
      ? { label: '标记完成', icon: 'check', fn: async () => { store.setProjectStatus(proj.id, '已完成'); await store.saveAll(); store.toast('已标记完成') } }
      : (st === '已完成'
        ? { label: '归档项目', icon: 'folder', fn: async () => {
          const ok = await confirmBox(`归档项目「${proj.项目名称}」？归档后不再出现在今日待办中，可随时在筛选「已归档」中查看。`, '归档项目', false)
          if (!ok) return
          store.setProjectStatus(proj.id, '已归档')
          await store.saveAll()
          store.toast('项目已归档')
        } }
        : (st === '设计中' && proj.清单状态 === '已生成'
          ? { label: '标记完成', icon: 'check', fn: async () => { store.setProjectStatus(proj.id, '已完成'); await store.saveAll(); store.toast('已标记完成') } }
          : null))
  const items = [
    flowBtn,
    { label: `历史清单 (${histList.value.length})`, icon: 'folder', fn: () => openDialog(BillHistoryDialog, { proj }) },
    { label: '复制项目', icon: 'copy', fn: async () => { const np = store.copyProject(proj.id); await store.saveAll(); store.curProjId = np.id; store.toast(`已复制为独立新项目「${np.项目名称}」`) } },
    { label: '存为模板', icon: 'save', fn: async () => {
      const nm = await promptBox('模板名称：', proj.项目名称 + '模板', '存为模板')
      if (nm == null || !nm.trim()) return
      const tpl = store.saveProjectAsTemplate(proj, nm.trim())
      if (!tpl) { store.toast('该项目点表对应的设备字典已缺失，无法生成模板'); return }
      await store.saveAll()
      store.toast(`已保存为模板「${tpl.name}」（${tpl.subsystems.length} 子系统）`)
    } },
    { label: '编辑项目', icon: 'edit', fn: () => openDialog(ProjectFormDialog, { project: proj }) },
    { label: '删除项目', icon: 'trash', danger: true, fn: async () => {
      const ptN = points.value.filter(x => x.项目ID === proj.id).length
      const blN = histList.value.length
      const ok = await confirmBox(`确定删除项目「${proj.项目名称}」？\n\n级联影响：\n· 设备点表 ${ptN} 行\n· 历史施工清单 ${blN} 份\n\n删除后不可恢复，建议先导出 JSON 备份。`, '删除项目')
      if (!ok) return
      store.deleteProject(proj.id)
      await store.saveAll()
      store.curView = 'list'
      store.toast('项目已删除')
    } }
  ].filter(Boolean)

  // 用对话框展示菜单
  openDialog(ProjectMenuDialog, { items })
}

const ProjectMenuDialog = {
  components: { VIcon },
  props: { items: Array },
  emits: ['close'],
  setup (props, { emit }) {
    return {
      props,
      act (it) { emit('close'); it.fn() }
    }
  },
  template: `
    <div class="dialog-head"><h3>项目操作</h3><button class="btn btn-icon" @click="$emit('close')"><VIcon name="x"/></button></div>
    <div style="display:flex;flex-direction:column;gap:8px;min-width:240px">
      <button v-for="(it,i) in props.items" :key="i" class="btn" :class="it.danger ? 'btn-danger' : 'btn-ghost'" @click="act(it)">
        <VIcon :name="it.icon" />{{ it.label }}
      </button>
    </div>`
}

// ---------- 点表操作 ----------
function openPointForm (pt) {
  openDialog(PointFormDialog, { project: p.value, point: pt, sub: sub.value })
}
function addPoint () { openPointForm(null) }

// 勾选式批量选择（点位行）
const selPts = ref(new Set())
const allPtsChecked = computed(() => subPointRows.value.length > 0 && subPointRows.value.every(x => selPts.value.has(x.id)))
function togglePt (id) { const s = new Set(selPts.value); s.has(id) ? s.delete(id) : s.add(id); selPts.value = s }
function toggleAllPt () { selPts.value = allPtsChecked.value ? new Set() : new Set(subPointRows.value.map(x => x.id)) }
function clearSelPt () { selPts.value = new Set() }
watch(sub, () => clearSelPt())

// 批量添加：一次勾选多台设备直接写入点表
function openBatchAdd () { openDialog(PointBatchAddDialog, { project: p.value, sub: sub.value }) }
// 智能推算：独立入口（按定额/配比自动算数量，供参考勾选应用）
function openAuto () { openDialog(AutoQtyDialog, { project: p.value, sub: sub.value }) }
// CSV 导入/导出：独立入口
function openCsv () { openDialog(PointCsvDialog, { project: p.value, sub: sub.value }) }

// 批量删除：勾选/全选点位行
async function batchDelPts () {
  if (!selPts.value.size) { store.toast('请先勾选要删除的点位行'); return }
  const list = subPointRows.value.filter(x => selPts.value.has(x.id))
  const total = list.reduce((a, x) => a + (Number(x.数量) || 0), 0)
  const ok = await confirmBox(`确定删除选中的 ${list.length} 行点位（合计数量 ${total}）？\n对应设备的数量将被移出点表，清单推算随之变化。`, '批量删除点表行')
  if (!ok) return
  list.forEach(x => store.deletePoint(x.id))
  selPts.value = new Set()
  await store.saveAll()
  store.toast(`已删除 ${list.length} 行点位`)
}

async function delPoint (id) {
  const pt = points.value.find(x => x.id === id)
  if (!pt) return
  const ok = await confirmBox(`确定删除「${pt.设备类型}」这行点位（数量 ${pt.数量}）？`, '删除点表行')
  if (!ok) return
  store.deletePoint(id)
  await store.saveAll()
}
const subPointRows = computed(() => (p.value ? points.value.filter(x => x.项目ID === p.value.id && x.子系统 === sub.value) : []))

async function saveNote () {
  store.saveNote(p.value.id, sub.value, noteText.value)
  await store.saveAll()
  store.toast('设计说明已保存')
}

function selectSub (sn) { store.curSub = sn }

onMounted(() => {
  layout.setActions([
    { label: '返回', icon: 'back', cls: 'ghost', onClick: backList },
    { label: p.value?.清单状态 === '已生成' ? '重新生成施工清单' : '生成施工清单', icon: 'zap', cls: 'primary', onClick: genBill },
    { label: '更多', icon: 'list', cls: 'ghost', onClick: moreMenu }
  ])
})
onBeforeUnmount(() => layout.setActions([]))
</script>

<template>
  <div v-if="p">
    <!-- ① 项目头 -->
    <div class="proj-head-card">
      <div>
        <div class="ph-name">{{ p.项目名称 }}
          <span class="badge" :class="badgeCls(p.状态)" style="margin-left:8px">{{ p.状态 }}</span>
          <span v-if="p.清单状态 === '已生成'" class="badge green" style="margin-left:6px">清单已生成</span>
        </div>
        <div class="ph-meta">{{ p.项目编号 || '未编号' }} · {{ p.建筑类型 || '未分类' }} · {{ p.设计阶段 || '-' }} · {{ p.客户 || '-' }}</div>
        <div class="ph-meta" v-if="stageLogTxt">阶段：{{ stageLogTxt }}</div>
      </div>
      <div class="ph-stats">
        <div class="ph-stat"><b>{{ projectPoints }}</b><span>点位总计</span></div>
        <div class="ph-stat"><b>{{ sysCount }}</b><span>子系统</span></div>
        <div class="ph-stat"><b>¥ {{ projQuote.toLocaleString('zh-CN') }}</b><span>累计参考金额</span></div>
        <div class="ph-stat"><b>{{ progress }}%</b><span>项目进度</span></div>
      </div>
      <div class="ph-actions" v-if="isOverdue(p)">
        <span class="badge red">已超 {{ -daysFrom(p.预计结束日期) }} 天</span>
      </div>
      <div class="prog" style="flex-basis:100%">
        <div class="prog-bar"><div class="prog-fill" :style="{ width: progress + '%', background: p.状态 === '已完成' || p.状态 === '已归档' ? '#34d399' : '#6a5fc1' }"></div></div>
      </div>
    </div>

    <!-- ② 子系统轨道（页签） -->
    <div class="tabs rail-tabs">
      <button v-for="s in settings.subsystems" :key="s.id" class="tab" :class="{ active: sub === s.name }" @click="selectSub(s.name)">
        {{ s.name }}<span v-if="ptCountOf(s.name)" class="cnt">{{ ptCountOf(s.name) }}</span>
      </button>
    </div>

    <!-- ③ 操作行：添加点位 + 批量添加/智能推算/CSV（独立入口） -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-primary btn-sm" @click="addPoint"><VIcon name="plus" />添加点位</button>
      <button class="btn btn-ghost btn-sm" @click="openBatchAdd"><VIcon name="list" />批量添加/更新</button>
      <button class="btn btn-ghost btn-sm" @click="openAuto"><VIcon name="zap" />智能推算</button>
      <button class="btn btn-ghost btn-sm" @click="openCsv"><VIcon name="ul" />导入CSV</button>
      <button class="btn btn-ghost btn-sm" @click="openCsv"><VIcon name="dl" />导出CSV</button>
      <span class="hint" style="align-self:center">批量添加：一次勾选多台设备直接写入点表；批量删除：勾选或全选点位行</span>
    </div>

    <!-- ③ 系统卡 · 推导链 -->
    <SystemChainCard
      :project="p"
      :sub="sub"
      @go-bill="goBill"
      @add-point="addPoint"
    />

    <!-- ③.5 点位明细表（勾选式批量删除 + 行内编辑） -->
    <div class="card">
      <div class="card-title">
        <span>点位明细 · {{ sub }} <span class="sub">{{ subPointRows.length }} 行 · 勾选行可批量删除，行内可编辑</span></span>
        <span v-if="selPts.size" style="display:flex;gap:6px;align-items:center">
          <span class="badge amber">已选 {{ selPts.size }} 行</span>
          <button class="btn btn-danger btn-sm" @click="batchDelPts"><VIcon name="trash" />批量删除</button>
          <button class="btn btn-ghost btn-sm" @click="clearSelPt">取消选择</button>
        </span>
      </div>
      <div v-if="subPointRows.length" class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" :checked="allPtsChecked" @change="toggleAllPt" title="全选本系统点位" /></th>
          <th>设备类型</th><th>数量</th><th>备注</th><th style="width:96px">操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="x in subPointRows" :key="x.id" :class="{ 'row-sel': selPts.has(x.id) }">
            <td><input type="checkbox" :checked="selPts.has(x.id)" @change="togglePt(x.id)" /></td>
            <td><b>{{ x.设备类型 }}</b><div v-if="store.resolveDevice(store.devices, x.子系统, x.设备类型, x['设备ID'])?.spec" class="src">{{ store.resolveDevice(store.devices, x.子系统, x.设备类型, x['设备ID']).spec }}</div></td>
            <td><b>{{ x.数量 }}</b></td>
            <td class="src">{{ x.备注 || '' }}</td>
            <td>
              <div class="op">
                <button title="编辑" @click="openPointForm(x)"><VIcon name="edit" /></button>
                <button class="del" title="删除" @click="delPoint(x.id)"><VIcon name="trash" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table></div>
      <div v-else class="hint" style="padding:12px 0">暂无点位，可点上方「添加点位」逐个录入，或「批量添加/更新」一次勾选多台设备写入。</div>
    </div>

    <!-- ③.5 选型面板（折叠） -->
    <div class="card" style="margin-top:16px">
      <div class="card-title" style="cursor:pointer;margin-bottom:0" @click="showSel = !showSel">
        <span>选型面板 · {{ sub }} <span class="sub">品牌型号选择，决定清单与报价</span></span>
        <span style="display:flex;gap:6px;align-items:center">
          <span class="badge" :class="selMissing ? 'amber' : 'green'">{{ selMissing ? selMissing + ' 未定' : '已全部选型' }}</span>
          <VIcon :name="showSel ? 'up' : 'down'" :size="15" style="color:var(--text3)" />
        </span>
      </div>
      <template v-if="showSel">
        <SelectionPanel :project="p" :sub="sub" />
      </template>
    </div>

    <!-- 变更影响 -->
    <div v-if="changedAfterBill" class="card" style="border-color:rgba(245,170,50,.45)">
      <div class="card-title">变更影响 <span class="badge amber">{{ changedAfterBill }} 行数量发生变化</span></div>
      <div class="hint">设备数量变化会影响设备金额、材料数量以及施工清单。建议重新生成施工清单后再导出最终报价。</div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-ghost" @click="goBill"><VIcon name="file" />查看 / 导出清单</button>
      </div>
    </div>

    <!-- ④ 清单舱 -->
    <div class="card">
      <div class="card-title">清单舱 <span class="sub">{{ p.项目名称 }} 的施工清单与报价</span></div>
      <div class="kv-row" style="margin:0">
        <div class="k">最新清单</div>
        <div class="d">{{ meta.billAt?.[p.id] ? '生成于 ' + String(meta.billAt[p.id]).replace('T', ' ').slice(0, 19) + ' · 历史 ' + histList.length + ' 份' : '尚未生成，请先在系统卡中确认数量，再点右上角「生成施工清单」' }}</div>
      </div>
      <div class="kv-row" style="margin:0">
        <div class="k">清单状态</div>
        <div class="d">{{ p.清单状态 || '未生成' }} · 生成后清单行价格与项目选型会冻结</div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-ghost" @click="goBill"><VIcon name="file" />查看 / 导出清单</button>
        <button class="btn btn-primary" @click="genBill" style="margin-left:8px"><VIcon name="zap" />{{ p.清单状态 === '已生成' ? '重新生成' : '生成' }}</button>
      </div>
    </div>

    <!-- ⑤ 设计说明 -->
    <div class="card">
      <div class="card-title">设计说明 · {{ sub }} <span class="sub">系统架构描述 · 设计依据 · 备注</span></div>
      <textarea v-model="noteText" placeholder="填写该子系统的设计说明（架构、依据、要点）…"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-primary" @click="saveNote"><VIcon name="save" />保存设计说明</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row-sel { background: var(--primary-l); }
.row-sel:hover { background: var(--primary-l); }
</style>