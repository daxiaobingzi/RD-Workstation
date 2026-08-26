<script setup>
// 历史清单：项目全部清单快照 · 按系统分组明细 · 可删除 / 按系统分 Sheet 导出
import { ref, computed } from 'vue'
import { useAppStore } from '../../store'
import { fmtNum } from '../../db/format'
import { rowsToCSV, rowsToTSV } from '../../db/calc'
import { buildXlsx, buildCsvBlob, downloadBlob, copyText, buildBillSheetsBySub } from '../../db/export'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'
import { confirmBox } from '../../composables/ui'

const props = defineProps({
  proj: { type: Object, required: true }
})
const emit = defineEmits(['close'])

const store = useAppStore()

const hist = computed(() => store.billOfProject(props.proj.id))
const active = ref(hist.value[hist.value.length - 1] || null)

// 每个版本的行数与金额预览（用于版本卡片角标）
const entryStats = h => {
  let dev = 0; let mat = 0
  ;(h.rows || []).forEach(r => {
    const price = r.unitPrice != null && r.unitPrice !== '' ? Number(r.unitPrice) : null
    const pr = price == null ? (r.materialUnitPrice != null && r.materialUnitPrice !== '' ? Number(r.materialUnitPrice) : null) : price
    const amt = pr != null ? Math.round(pr * Number(r.qty) * 100) / 100 : 0
    if (r.cat === '前端设备' || r.cat === '后端设备') dev += price != null ? amt : 0
    else mat += pr != null ? amt : 0
  })
  return { n: (h.rows || []).length, total: Math.round((dev + mat) * 100) / 100 }
}

function select (h) { active.value = h }
async function removeHist (h) {
  const ok = await confirmBox(`确定删除历史清单「${h.name}」？\n删除后不可恢复（若仅剩这一份，项目中需重新生成清单）。`, '删除历史清单', true)
  if (!ok) return
  store.deleteBill(props.proj.id, h.id)
  await store.saveAll()
  const rest = store.billOfProject(props.proj.id)
  active.value = rest[rest.length - 1] || null
  store.toast('历史清单已删除')
}

// 当前版本：报价 + 按系统分组明细
const quote = computed(() => active.value ? store.quoteOfBill(props.proj, active.value.rows) : null)
const subStats = computed(() => {
  const m = {}
  ;(quote.value?.quote?.order || []).forEach(o => { m[o.sub] = { dev: o.dev, mat: o.mat } })
  return m
})
const groupsBySub = computed(() => {
  const map = {}
  const arr = []
  ;(active.value?.rows || []).forEach(r => {
    const s = r.sub || '未分类'
    if (!map[s]) { map[s] = []; arr.push({ sub: s, rows: map[s] }) }
    map[s].push(r)
  })
  return arr
})
const CATS = ['前端设备', '后端设备', '管材线缆', '辅材']
const catColor = c => ({ '前端设备': 'var(--accent)', '后端设备': 'var(--primary)', '管材线缆': 'var(--green)', '辅材': 'var(--amber)' }[c] || 'var(--gray)')

const fmtD = at => at ? String(at).replace('T', ' ').slice(0, 19) : '-'

// ---- 导出：按系统分 Sheet ----
async function exportActiveXlsx () {
  if (!active.value) return
  const sheets = buildBillSheetsBySub(active.value.rows, subRows => store.buildBillRows(store, props.proj, subRows), quote.value?.rows || [])
  await downloadBlob(`施工清单-${props.proj.项目编号 || props.proj.项目名称}-${String(active.value.at).slice(0, 10)}.xlsx`, buildXlsx(sheets))
  store.toast(`已导出 Excel（${sheets.length} 个 Sheet：报价汇总 + 各系统清单）`)
}

async function exportCSV () {
  if (!active.value) return
  const rows = store.buildBillRows(store, props.proj, active.value.rows)
  await downloadBlob(`施工清单-${props.proj.项目编号 || props.proj.项目名称}-${String(active.value.at).slice(0, 10)}.csv`, buildCsvBlob(rowsToCSV(rows)))
}
async function copyTable () {
  if (!active.value) return
  const rows = store.buildBillRows(store, props.proj, active.value.rows)
  const ok = await copyText(rowsToTSV(rows))
  store.toast(ok ? '表格已复制，可直接粘贴到 Excel' : '复制失败')
}
</script>

<template>
  <ModalBase title="历史清单" width="920px" @close="emit('close')">
    <!-- 空态 -->
    <div v-if="!hist.length" class="hist-empty">
      <p><b>暂无历史清单</b></p>
      <p>在项目页点击「生成施工清单」后会在此留存历史快照，可随时回看、导出或删除。</p>
    </div>

    <template v-else>
      <!-- 版本列表（卡片式，含删除） -->
      <div class="hist-list">
        <div v-for="h in hist" :key="h.id" class="hist-chip" :class="{ on: active && active.id === h.id }" @click="select(h)">
          <div class="h-main">
            <span class="h-name">{{ h.name }}</span>
            <span class="h-del" title="删除该版本" @click.stop="removeHist(h)"><VIcon name="trash" :size="13" /></span>
          </div>
          <div class="h-meta">
            <span class="hm">{{ fmtD(h.at) }}</span>
            <span class="hm">{{ entryStats(h).n }} 项</span>
            <span class="hm amt">¥ {{ fmtNum(entryStats(h).total) }}</span>
          </div>
        </div>
      </div>

      <!-- 当前版本汇总条 -->
      <div v-if="quote" class="hisum">
        <span class="si">总额 <b>¥ {{ fmtNum(quote.quote.total) }}</b></span>
        <span class="si">设备 ¥ {{ fmtNum(quote.quote.devAmt) }}</span>
        <span class="si">材料 ¥ {{ fmtNum(quote.quote.matAmt) }}</span>
        <span v-if="quote.markup !== 1" class="si">调价 ×{{ quote.markup }}</span>
        <span v-if="quote.tax" class="si">税 {{ quote.tax }}%</span>
        <span class="si accent">含税 ¥ {{ fmtNum(quote.finalAmt) }}</span>
      </div>

      <!-- 按系统分组明细 -->
      <div v-for="g in groupsBySub" :key="g.sub" class="hsub">
        <div class="hsub-head">
          <span class="hsub-name">{{ g.sub }}</span>
          <span v-if="subStats[g.sub]" class="hsub-amt">设备 ¥ {{ fmtNum(subStats[g.sub].dev) }} + 材料 ¥ {{ fmtNum(subStats[g.sub].mat) }}</span>
          <span class="hsub-n">{{ g.rows.length }} 项</span>
        </div>
        <div v-for="c in CATS" :key="c">
          <div v-if="g.rows.filter(r => r.cat === c).length" class="hcat">
            <span class="chip" :style="{ background: catColor(c) }"></span>{{ c }}<span class="hcat-n">{{ g.rows.filter(r => r.cat === c).length }}</span>
          </div>
          <table v-if="g.rows.filter(r => r.cat === c).length" class="tbl heq">
            <thead><tr><th style="width:44px">#</th><th>材料名称</th><th>规格型号</th><th>单位</th><th>数量</th><th>品牌</th><th>型号</th><th>单价</th><th>合价</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in g.rows.filter(r => r.cat === c)" :key="i">
                <td class="src">{{ i + 1 }}</td>
                <td><b>{{ r.name }}</b></td>
                <td class="src">{{ r.spec || '-' }}</td>
                <td>{{ r.unit }}</td>
                <td><b>{{ r.qty }}</b></td>
                <td>{{ r.brand || '-' }}</td>
                <td class="src">{{ r.model || '-' }}</td>
                <td class="src">{{ r.unitPrice != null ? '¥ ' + fmtNum(r.unitPrice) : (r.materialUnitPrice != null ? '¥ ' + fmtNum(r.materialUnitPrice) : '-') }}</td>
                <td><b>{{ r.unitPrice != null || r.materialUnitPrice != null ? '¥ ' + fmtNum((Number(r.unitPrice != null ? r.unitPrice : r.materialUnitPrice)) * Number(r.qty)) : '-' }}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <template #foot>
      <button v-if="active" class="btn btn-ghost" @click="copyTable"><VIcon name="copy" />复制表格</button>
      <button v-if="active" class="btn btn-ghost" @click="exportCSV"><VIcon name="dl" />导出 CSV</button>
      <button v-if="active" class="btn btn-primary" @click="exportActiveXlsx"><VIcon name="dl" />导出 Excel（按系统分 Sheet）</button>
    </template>
  </ModalBase>
</template>

<style scoped>
.hist-empty { padding: 26px 10px; text-align: center; color: var(--text3); line-height: 1.9; font-size: 13px; }
.hist-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.hist-chip { background: var(--glass-1); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; cursor: pointer; transition: all .15s; min-width: 170px; }
.hist-chip:hover { border-color: var(--line2); background: var(--glass-2); }
.hist-chip.on { border-color: var(--accent); background: var(--primary-l); }
.h-main { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.h-name { font-size: 12.5px; font-weight: 600; color: var(--text); }
.h-del { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; color: var(--text3); }
.h-del:hover { background: var(--red-l); color: var(--red); }
.h-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.hm { font-size: 11px; color: var(--text3); }
.hm.amt { color: var(--green); font-weight: 600; font-family: var(--mono); }
.hisum { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 12px; }
.si { font-size: 12px; color: var(--text2); background: var(--glass-1); border-radius: 999px; padding: 3px 10px; }
.si b { color: var(--text); font-family: var(--mono); }
.si.accent { background: var(--primary-l); color: var(--accent); }
.hsub { border: 1px solid var(--line); border-radius: 12px; margin-bottom: 12px; overflow: hidden; background: var(--card); }
.hsub-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--glass-1); border-bottom: 1px solid var(--line); }
.hsub-name { font-weight: 700; font-size: 14px; color: var(--text); }
.hsub-amt { font-size: 11.5px; color: var(--green); font-family: var(--mono); }
.hsub-n { margin-left: auto; font-size: 11.5px; color: var(--text3); }
.hsub .tbl { margin: 0; border: none; }
.hcat { display: flex; align-items: center; gap: 6px; padding: 8px 14px 2px; font-size: 11.5px; font-weight: 600; color: var(--text2); }
.chip { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.hcat-n { margin-left: 4px; color: var(--text3); font-weight: 400; }
.heq td, .heq th { white-space: nowrap; }
</style>