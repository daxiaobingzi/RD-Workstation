<script setup>
// 施工清单视图：汇总/报价/按系统明细/导出
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { fmtNum } from '../../db/format'
import { useLayout } from '../../composables/layout'
import { openDialog } from '../../composables/ui'
import { rowsToCSV, rowsToTSV } from '../../db/calc'
import { buildXlsx, buildCsvBlob, buildTxtBlob, downloadBlob, copyText } from '../../db/export'
import VIcon from '../../components/ui/VIcon.vue'
import BillHistoryDialog from '../../components/dialogs/BillHistoryDialog.vue'

const store = useAppStore()
const layout = useLayout()
const { settings, bills, meta } = storeToRefs(store)

const p = computed(() => store.projectById(store.curProjId))
const histList = computed(() => store.billOfProject(p.value?.id))

// 优先恢复本项目已生成的清单缓存
const billRows = ref(null)
function ensureCache () {
  if (!p.value) return
  // store.billCache 不可持久读，统一从历史取最新
  const hl = histList.value
  if (!billRows.value) {
    if (hl.length) billRows.value = hl[hl.length - 1].rows.slice()
    else {
      const { bill, diff } = store.prepareBill(p.value)
      if (!bill.length) { billRows.value = [] } else { store.commitBill(p.value, bill); billRows.value = bill }
    }
  }
}
watch(p, () => { billRows.value = null; ensureCache() }, { immediate: true })

const groups = computed(() => {
  const map = {}
  const arr = []
  ;(billRows.value || []).forEach(r => {
    const sub = r.sub || '未分类'
    if (!map[sub]) { map[sub] = []; arr.push({ sub, rows: map[sub] }) }
    map[sub].push(r)
  })
  return arr
})

const quote = computed(() => (p.value && billRows.value) ? store.quoteOfBill(p.value, billRows.value) : null)
const summary = computed(() => {
  const q = quote.value
  if (!q) return null
  const gp = settings.value.globalParams || {}
  const markup = gp.markup || 1
  const tax = gp.tax || 0
  const total = q.quote.total
  const finalAmt = Math.round(total * markup * (1 + tax / 100) * 100) / 100
  return { quote: q, markup, tax, total, finalAmt }
})

const maxQ = computed(() => {
  let m = 0
  groups.value.forEach(g => {
    const q = g.rows.reduce((a, r) => a + Number(r.qty) || 0, 0)
    if (q > m) m = q
  })
  return m
})

function catOf (r) { return r.cat }
const CATS = ['前端设备', '后端设备', '管材线缆', '辅材']
const CAT_COLORS = { '前端设备': '#6a5fc1', '后端设备': '#38bdf8', '管材线缆': '#34d399', '辅材': '#F7A501' }

function genBill () {
  const { bill, diff } = store.prepareBill(p.value)
  if (!bill.length) { store.toast('当前项目没有有效设备数量，无法生成清单'); return }
  if (diff && (diff.added.length + diff.removed.length + diff.changed.length)) {
    openDialog(ConfirmDiff, { diff, bill, proj: p.value, done: () => { store.commitBill(p.value, bill); billRows.value = bill } })
  } else {
    store.commitBill(p.value, bill)
    billRows.value = bill
  }
}

const ConfirmDiff = {
  components: { VIcon },
  props: { diff: Object, bill: Array, proj: Object, done: Function },
  emits: ['close'],
  setup (props, { emit }) {
    return { props, dTotal: props.diff.added.length + props.diff.removed.length + props.diff.changed.length, ok () { emit('close'); props.done() }, cancel () { emit('close') } }
  },
  template: `
    <div class="dialog-head"><h3>清单差异确认</h3><button class="btn btn-icon" @click="cancel"><VIcon name="x"/></button></div>
    <div class="hint" style="margin:6px 0 10px">重新生成将覆盖当前清单。本次差异共 {{ dTotal }} 项。</div>
    <div class="dialog-foot">
      <button class="btn btn-ghost" @click="cancel">取消</button>
      <button class="btn btn-primary" @click="ok"><VIcon name="save"/>确认覆盖</button>
    </div>`
}

async function exportXlsx () {
  if (!billRows.value) return
  const sheets = [
    { name: '设备材料清单', rows: store.buildBillRows(store, p.value, billRows.value) },
    { name: '报价汇总', rows: quote.value?.rows || [] }
  ]
  await downloadBlob(`施工清单-${p.value.项目编号 || p.value.项目名称}-${new Date().toISOString().slice(0, 10)}.xlsx`, buildXlsx(sheets))
  store.toast('已导出 Excel')
}
async function exportCSV () {
  if (!billRows.value) return
  const rows = store.buildBillRows(store, p.value, billRows.value)
  await downloadBlob(`施工清单-${p.value.项目编号 || p.value.项目名称}.csv`, buildCsvBlob(rowsToCSV(rows)))
}
async function copyTable () {
  const rows = store.buildBillRows(store, p.value, billRows.value)
  const ok = await copyText(rowsToTSV(rows))
  store.toast(ok ? '汇总表格已复制，可直接粘贴到 Excel' : '复制失败')
}
function printPage () {
  window.print()
}

const backDetail = () => { store.curView = 'detail' }

onMounted(() => {
  ensureCache()
  layout.setActions([
    { label: '返回项目', icon: 'back', cls: 'ghost', onClick: backDetail },
    { label: `历史清单 (${histList.value.length})`, icon: 'folder', cls: 'ghost', onClick: () => openDialog(BillHistoryDialog, { proj: p.value }) },
    { label: '重新生成', icon: 'refresh', cls: 'ghost', onClick: genBill },
    { label: '导出清单', icon: 'dl', cls: 'primary', onClick: exportXlsx }
  ])
})
onBeforeUnmount(() => layout.setActions([]))
</script>

<template>
  <div v-if="p">
    <div v-if="!billRows || !billRows.length" class="card" style="text-align:center;color:var(--text2);padding:40px">
      该项目暂无施工清单，请确认已填写设备数量后，在项目页点击「生成施工清单」。
    </div>
    <template v-else>
      <!-- 汇总 -->
      <div class="card">
        <div class="card-title">施工清单汇总 <span class="sub">{{ p.项目名称 }} · 损耗率 {{ settings.globalParams.lossRate }}% · 按系统分列</span></div>
        <div class="bill-sum">
          <div v-for="g in groups" :key="g.sub" class="cell">
            <b>{{ g.rows.reduce((a, r) => a + (Number(r.qty) || 0), 0) }}</b><span>{{ g.sub }} {{ g.rows.length }} 项</span>
          </div>
        </div>
        <div v-if="summary" class="bill-sum" style="margin-top:10px">
          <div v-for="s in summary.quote.order" :key="s.sub" class="cell">
            <b>{{ fmtNum(s.dev + s.mat) }}</b><span>{{ s.sub }} 小计(元)</span>
          </div>
          <div class="cell" style="border-left:2px solid var(--accent)">
            <b>{{ fmtNum(summary.total) }}</b><span>总投资(元) · 设备 {{ fmtNum(summary.quote.devAmt) }} + 材料 {{ fmtNum(summary.quote.matAmt) }}{{ summary.total === 0 ? '（未配置价格）' : '' }}</span>
          </div>
          <div class="cell" style="border-left:2px solid var(--accent)">
            <b>{{ fmtNum(summary.finalAmt) }}</b><span>含税总价(元) · 调价×{{ summary.markup }}{{ summary.tax ? ' · 税率' + summary.tax + '%' : '' }}</span>
          </div>
        </div>
        <!-- 数量占比 -->
        <div class="card-title" style="margin-top:10px">系统数量占比 <span class="sub">按清单数量占比</span></div>
        <div v-for="g in groups" :key="'pct-' + g.sub" class="kv-row" style="margin:0">
          <div class="k" style="min-width:130px">{{ g.sub }} <b>{{ g.rows.reduce((a, r) => a + (Number(r.qty) || 0), 0) }}</b></div>
          <div style="flex:1"><div class="prog-bar" style="max-width:340px"><div class="prog-fill" :style="{ width: (maxQ ? Math.round(g.rows.reduce((a, r) => a + (Number(r.qty) || 0), 0) / maxQ * 100) : 0) + '%', background: '#6a5fc1' }"></div></div></div>
        </div>
      </div>

      <!-- 每系统明细 -->
      <div v-for="g in groups" :key="g.sub" class="card">
        <div class="card-title">{{ g.sub }} <span class="sub">{{ g.rows.length }} 项 · 设备与材料明细</span></div>
        <div class="bill-sum">
          <div v-for="c in CATS" :key="c" class="cell">
            <b>{{ g.rows.filter(r => r.cat === c).reduce((a, r) => a + (Number(r.qty) || 0), 0) }}</b><span>{{ c }} {{ g.rows.filter(r => r.cat === c).length }} 项</span>
          </div>
        </div>
        <div v-for="c in CATS" :key="c" class="bill-cat">
          <div class="bill-cat-head">
            <span class="chip" :style="{ background: CAT_COLORS[c] }"></span>{{ c }}<span class="n">{{ g.rows.filter(r => r.cat === c).length }} 项</span>
          </div>
          <div v-if="!g.rows.filter(r => r.cat === c).length" class="hint" style="padding:6px 0 12px">无</div>
          <div v-else class="tbl-wrap"><table class="tbl">
            <thead><tr><th>材料名称</th><th>规格型号</th><th>单位</th><th>数量</th><th>推算来源</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in g.rows.filter(r => r.cat === c)" :key="i">
                <td><b>{{ r.name }}</b></td>
                <td>{{ r.spec || '-' }}</td>
                <td>{{ r.unit }}</td>
                <td><b>{{ r.qty }}</b></td>
                <td class="src">{{ r.src }}</td>
              </tr>
            </tbody>
          </table></div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" @click="printPage"><VIcon name="file" />打印版</button>
        <button class="btn btn-ghost" @click="copyTable"><VIcon name="copy" />复制表格</button>
        <button class="btn btn-ghost" @click="exportCSV"><VIcon name="dl" />导出 CSV</button>
        <button class="btn btn-primary" @click="exportXlsx"><VIcon name="dl" />导出 Excel</button>
      </div>
    </template>
  </div>
</template>