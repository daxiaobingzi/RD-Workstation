<script setup>
// 项目详情：基本信息 + 子系统页签 + 设备点表 + 施工清单入口 + 设计说明
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { isOverdue, daysFrom, fmtNum } from '../../db/format'
import { useLayout } from '../../composables/layout'
import { openDialog, confirmBox, promptBox } from '../../composables/ui'
import { rowsToCSV } from '../../db/calc'
import { buildCsvBlob, downloadBlob } from '../../db/export'
import { todayStr } from '../../db/format'
import VIcon from '../../components/ui/VIcon.vue'
import ProjectFormDialog from '../../components/dialogs/ProjectFormDialog.vue'
import PointFormDialog from '../../components/dialogs/PointFormDialog.vue'
import BatchQtyDialog from '../../components/dialogs/BatchQtyDialog.vue'
import AutoQtyDialog from '../../components/dialogs/AutoQtyDialog.vue'
import BillHistoryDialog from '../../components/dialogs/BillHistoryDialog.vue'

const store = useAppStore()
const layout = useLayout()
const { points, bills, meta, settings, notes } = storeToRefs(store)

const p = computed(() => store.projectById(store.curProjId))
const sub = computed(() => {
  if (store.curSub && store.curSub !== '__all' && settings.value.subsystems.some(s => s.name === store.curSub)) return store.curSub
  return (settings.value.subsystems[0] && settings.value.subsystems[0].name) || '视频监控系统'
})
const subPoints = computed(() => (p.value ? points.value.filter(x => x.项目ID === p.value.id && x.子系统 === sub.value) : []))
const subTotal = computed(() => subPoints.value.reduce((a, x) => a + (Number(x.数量) || 0), 0))

const ptCountOf = (sn) => (p.value ? points.value.filter(x => x.项目ID === p.value.id && x.子系统 === sn).length : 0)

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
function resolvePointDevice (x) {
  return store.resolveDevice(store.devices, x.子系统, x.设备类型, x['设备ID'])
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
        <tr v-for="it in props.diff.changed" :key="it.name"><td><b>{{ it.name }}</b></td><td style="text-align:right">{{ it.old }} → {{ it.nw }}</td></tr>
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
function bringOut () {
  const proj = p.value
  const rows = store.buildBringOut(proj, sub.value)
  if (!rows.length) { store.toast('当前子系统前端设备已全部录入，或字典无前端设备'); return }
  store.points.push(...rows)
  store.saveAll().then(() => store.toast(`已带出 ${rows.length} 台设备，请核对数量`))
}
function openPointForm (pt) {
  openDialog(PointFormDialog, { project: p.value, point: pt, sub: sub.value })
}
async function delPoint (id) {
  const pt = store.points.find(x => x.id === id)
  if (!pt) return
  const ok = await confirmBox(`确定删除设备数量「${pt.设备类型} × ${pt.数量}」？`, '删除设备')
  if (!ok) return
  store.deletePoint(id)
  await store.saveAll()
}
function exportCSV () {
  const proj = p.value
  const rows = [['设备类型', '数量', '备注']]
  subPoints.value.forEach(x => rows.push([x.设备类型, x.数量, x.备注 || '']))
  const csv = '\ufeff' + rowsToCSV(rows)
  downloadBlob(`点表-${sub.value.replace(/[\\/:*?"<>|]/g, '_')}-${todayStr()}.csv`, buildCsvBlob(csv.replace(/^\ufeff/, '')))
}
function importCSV () {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv,.txt,text/csv'
  input.onchange = () => {
    const f = input.files[0]
    if (!f) return
    const rd = new FileReader()
    rd.onload = async () => {
      const res = store.importPointsCSV(p.value, sub.value, rd.result)
      if (!res.ok) { store.toast(res.msg); return }
      if (!res.add && !res.upd) { store.toast(`导入完成：${res.skip} 条被跳过（设备类型不在字典）`); return }
      await store.saveAll()
      store.toast(`导入完成：新增 ${res.add} 条，更新 ${res.upd} 条${res.skip ? `，跳过 ${res.skip} 条（类型不在字典）` : ''}`)
    }
    rd.readAsText(f, 'utf-8')
  }
  input.click()
}
function openBatch () { openDialog(BatchQtyDialog, { project: p.value, sub: sub.value }) }
function openAutoQty () { openDialog(AutoQtyDialog, { project: p.value, sub: sub.value }) }

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
    <!-- 基本信息 -->
    <div class="card">
      <div class="card-title">
        项目基本信息
        <span style="display:flex;gap:6px">
          <span class="badge" :class="badgeCls(p.状态)">{{ p.状态 }}</span>
          <span v-if="p.清单状态 === '已生成'" class="badge green">清单已生成</span>
        </span>
      </div>
      <div class="form-grid">
        <div class="fitem"><label>项目名称</label><div>{{ p.项目名称 }}</div></div>
        <div class="fitem"><label>项目编号</label><div>{{ p.项目编号 }}</div></div>
        <div class="fitem"><label>建筑类型</label><div>{{ p.建筑类型 || '-' }}</div></div>
        <div class="fitem"><label>客户</label><div>{{ p.客户 || '-' }}</div></div>
        <div class="fitem"><label>项目地址</label><div>{{ p.项目地址 || '-' }}</div></div>
        <div class="fitem"><label>建筑面积</label><div>{{ p.建筑面积 ? p.建筑面积 + ' ㎡' : '-' }}</div></div>
        <div class="fitem"><label>建筑楼层数</label><div>{{ Number(p.建筑楼层数 || 0) ? p.建筑楼层数 + ' 层' : '-' }}</div></div>
        <div class="fitem"><label>房间数</label><div>{{ Number(p.房间数 || 0) ? p.房间数 + ' 间' : '-' }}</div></div>
        <div class="fitem"><label>设计阶段</label><div>{{ p.设计阶段 || '-' }}</div></div>
        <div class="fitem"><label>开始日期</label><div>{{ p.开始日期 || '-' }}</div></div>
        <div class="fitem"><label>预计结束日期</label><div>{{ p.预计结束日期 || '-' }}</div></div>
      </div>
      <div class="hint" style="margin-top:8px">备注：{{ p.备注 || '-' }}</div>
      <div class="bill-sum" style="margin-top:10px">
        <div class="cell"><b>{{ p.设计阶段 || '-' }}</b><span>设计阶段</span></div>
        <div class="cell"><b>{{ p.开始日期 || '-' }}</b><span>开始日期</span></div>
        <div v-if="p.预计结束日期" class="cell">
          <b>{{ p.预计结束日期 }}</b>
          <span>预计结束
            <span v-if="isOverdue(p)" class="badge red">已超 {{ -daysFrom(p.预计结束日期) }} 天</span>
            <span v-else class="badge blue">剩 {{ -daysFrom(p.预计结束日期) }} 天</span>
          </span>
        </div>
      </div>
      <div class="prog" style="margin-top:10px">
        <div class="prog-bar"><div class="prog-fill" :style="{ width: progress + '%', background: p.状态 === '已完成' || p.状态 === '已归档' ? '#34d399' : '#6a5fc1' }"></div></div>
        <div class="prog-meta"><span>项目进度（基础资料/点表/清单/说明/校核加权）</span><span>{{ progress }}%</span></div>
      </div>
      <div v-if="stageLogTxt" class="hint" style="margin-top:8px">阶段变更：{{ stageLogTxt }}</div>
    </div>

    <!-- 子系统页签 -->
    <div class="tabs">
      <button v-for="s in settings.subsystems" :key="s.id" class="tab" :class="{ active: sub === s.name }" @click="selectSub(s.name)">
        {{ s.name }}<span v-if="ptCountOf(s.name)" class="cnt">{{ ptCountOf(s.name) }}</span>
      </button>
    </div>

    <!-- 设备点表 -->
    <div class="card">
      <div class="card-title">
        <span>设备点表 · {{ sub }} <span class="sub">{{ subPoints.length }} 行 / {{ subTotal }} 台（套）· 直接填写设备数量，施工清单据此推算</span></span>
      </div>
      <div class="kv-row" style="margin:0 0 10px;border:none;padding:0">
        <div style="display:flex;gap:6px;flex-wrap:wrap;width:100%">
          <button class="btn btn-ghost btn-sm" @click="bringOut"><VIcon name="plus" />从字典带出</button>
          <button class="btn btn-ghost btn-sm" @click="openBatch"><VIcon name="list" />批量添加</button>
          <button class="btn btn-ghost btn-sm" @click="openAutoQty"><VIcon name="zap" />数量推算</button>
          <button class="btn btn-ghost btn-sm" @click="exportCSV"><VIcon name="dl" />导出CSV</button>
          <button class="btn btn-ghost btn-sm" @click="importCSV"><VIcon name="ul" />导入CSV</button>
          <button class="btn btn-primary btn-sm" style="margin-left:auto" @click="openPointForm(null)"><VIcon name="plus" />添加设备</button>
        </div>
      </div>

      <div v-if="subPoints.length" class="stat-row">
        <span v-for="(v, k) in (() => { const m = {}; subPoints.forEach(x => { m[x.设备类型] = (m[x.设备类型] || 0) + (Number(x.数量) || 0) }); return m })()" :key="k" class="stat-chip">
          <b>{{ v }}</b><span class="tag">{{ k }}</span>
        </span>
      </div>

      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>设备类型</th><th>类别</th><th>数量</th><th>备注</th><th style="width:90px"></th></tr></thead>
        <tbody>
          <tr v-if="!subPoints.length"><td colspan="5" style="text-align:center;color:var(--text3);padding:22px">该子系统暂无设备数量，点击「添加设备」填写。</td></tr>
          <tr v-for="x in subPoints" :key="x.id">
            <td>
              <b>{{ x.设备类型 }}</b>
              <div v-if="resolvePointDevice(x)?.spec" class="src">{{ resolvePointDevice(x).spec }}</div>
              <div v-if="!resolvePointDevice(x)" class="src" style="color:#d9381f">⚠ 设备字典缺失（清单推算不生效）</div>
            </td>
            <td><span class="badge" :class="resolvePointDevice(x)?.category === '前端设备' ? 'blue' : 'green'">{{ resolvePointDevice(x)?.category || '前端设备' }}</span></td>
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
    </div>

    <!-- 变更影响 -->
    <div v-if="changedAfterBill" class="card" style="border-color:rgba(245,170,50,.45)">
      <div class="card-title">变更影响 <span class="badge amber">{{ changedAfterBill }} 行数量发生变化</span></div>
      <div class="hint">设备数量变化会影响设备金额、材料数量以及施工清单。建议重新生成施工清单后再导出最终报价。</div>
    </div>

    <!-- 施工清单入口 -->
    <div class="card">
      <div class="card-title">施工清单 <span class="sub">{{ p.项目名称 }} 的清单与报价</span></div>
      <div class="kv-row" style="margin:0">
        <div class="k">最新清单</div>
        <div class="d">{{ meta.billAt?.[p.id] ? '生成于 ' + String(meta.billAt[p.id]).replace('T', ' ').slice(0, 19) + ' · 历史 ' + histList.length + ' 份' : '尚未生成，填写设备数量后点右上角「生成施工清单」' }}</div>
      </div>
      <div class="kv-row" style="margin:0">
        <div class="k">清单状态</div>
        <div class="d">{{ p.清单状态 || '未生成' }} · 生成后清单行价格与项目选型会冻结</div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-ghost" @click="goBill"><VIcon name="file" />查看 / 导出清单</button>
      </div>
    </div>

    <!-- 设计说明 -->
    <div class="card">
      <div class="card-title">设计说明 · {{ sub }} <span class="sub">系统架构描述 · 设计依据 · 备注</span></div>
      <textarea v-model="noteText" placeholder="填写该子系统的设计说明（架构、依据、要点）…"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-primary" @click="saveNote"><VIcon name="save" />保存设计说明</button>
      </div>
    </div>
  </div>
</template>