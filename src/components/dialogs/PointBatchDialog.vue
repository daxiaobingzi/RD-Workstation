<script setup>
// 点表批量操作：批量填数量 / 智能推算 / 批量增减 / CSV 导入导出
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { todayStr } from '../../db/format'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'
import { rowsToCSV } from '../../db/calc'
import { buildCsvBlob, downloadBlob } from '../../db/export'

const props = defineProps({
  project: { type: Object, required: true },
  sub: { type: String, required: true }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { devices, points } = storeToRefs(store)

const tab = ref('fill')

// ---- ① 批量填数量 ----
const fillRows = computed(() => {
  const has = {}
  points.value.filter(x => x.项目ID === props.project.id && x.子系统 === props.sub).forEach(x => { has[x['设备ID'] || x.设备类型] = x })
  return devices.value.filter(d => d.subsystem === props.sub && d.status !== '归档' && d.category === '前端设备').map(d => {
    const cur = has[d.id] || has[d.name]
    return { devId: d.id, name: d.name, spec: d.spec, qty: cur ? Number(cur.数量) : 1, note: cur ? cur.备注 || '' : '' }
  })
})
async function saveFill () {
  const entries = fillRows.value.map(r => ({ name: r.name, qty: parseInt(r.qty) || 0, note: r.note })).filter(e => Number(e.qty) > 0)
  if (!entries.length) { store.toast('未填写任何数量'); return }
  const res = store.batchSavePoints(props.project, props.sub, entries)
  await store.saveAll()
  store.toast(`批量保存完成：新增 ${res.added} 条，更新 ${res.upd} 条`)
}

// ---- ② 智能推算 ----
const autoRows = ref(store.autoQtyImpact(props.project, props.sub))
const picks = ref({})
autoRows.value.forEach(r => { if (picks.value[r.device.id] === undefined) picks.value[r.device.id] = true })
function ruleTxt (r) {
  if (!r) return '已有配比'
  if (r.method === 'area') return '面积 · 每' + r.per + '㎡'
  if (r.method === 'floor') return '楼层 · 每层' + r.per + '台'
  if (r.method === 'room') return '房间 · 每' + r.per + '间'
  return '固定'
}
async function saveAuto () {
  const picked = autoRows.value.filter(r => picks.value[r.device.id])
  if (!picked.length) { store.toast('请至少选择一项'); return }
  const res = store.applyAutoQty(props.project, props.sub, picked)
  await store.saveAll()
  store.toast(`已应用数量推算：修改 ${res.changed} 行，新增 ${res.added} 行`)
}

// ---- ③ 批量增减 ----
const adj = reactive({ op: '+', val: 1 })
async function saveAdj () {
  const n = Number(adj.val)
  if (!n) { store.toast('请输入增减数值'); return }
  const r = store.bulkAdjustPoints(props.project.id, props.sub, adj.op, n)
  await store.saveAll()
  store.toast(`批量${adj.op === '+' ? '加' : adj.op === '-' ? '减' : '乘'}完成：${r.changed} 行已更新`)
}

// ---- ④ CSV ----
const csvText = ref('')
async function exportCsv () {
  const rows = [['设备类型', '数量', '备注']]
  points.value.filter(x => x.项目ID === props.project.id && x.子系统 === props.sub).forEach(x => rows.push([x.设备类型, x.数量, x.备注 || '']))
  await downloadBlob(`点表-${props.sub.replace(/[\\/:*?"<>|]/g, '_')}-${todayStr()}.csv`, buildCsvBlob(rowsToCSV(rows)))
}
async function importCsv () {
  const res = store.importPointsCSV(props.project, props.sub, csvText.value)
  if (!res.ok) { store.toast(res.msg); return }
  await store.saveAll()
  store.toast(`导入完成：新增 ${res.add} 条，更新 ${res.upd} 条${res.skip ? `，跳过 ${res.skip} 条` : ''}`)
  csvText.value = ''
}
</script>

<template>
  <ModalBase :title="'批量操作 · ' + sub" width="680px" @close="emit('close')">
    <div class="tabs" style="margin-bottom:12px">
      <button class="tab" :class="{ active: tab === 'fill' }" @click="tab = 'fill'">批量填数量</button>
      <button class="tab" :class="{ active: tab === 'auto' }" @click="tab = 'auto'">智能推算</button>
      <button class="tab" :class="{ active: tab === 'adj' }" @click="tab = 'adj'">批量增减</button>
      <button class="tab" :class="{ active: tab === 'csv' }" @click="tab = 'csv'">CSV 导入导出</button>
    </div>

    <!-- ① 批量填数量 -->
    <div v-if="tab === 'fill'">
      <div class="tbl-wrap" style="max-height:48vh;overflow:auto">
        <table class="tbl">
          <thead><tr><th>设备</th><th style="width:110px">数量</th><th style="width:180px">备注</th></tr></thead>
          <tbody>
            <tr v-for="r in fillRows" :key="r.devId">
              <td><b>{{ r.name }}</b><div v-if="r.spec" class="src">{{ r.spec }}</div></td>
              <td><input v-model.number="r.qty" type="number" min="0" step="1" style="width:90px"></td>
              <td><input v-model.trim="r.note" style="width:160px"></td>
            </tr>
            <tr v-if="!fillRows.length"><td colspan="3" style="text-align:center;color:var(--text3);padding:20px">该子系统暂无前端设备</td></tr>
          </tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:8px">数量填 0 表示该设备不录入；已录入设备同步更新数量与备注。</div>
      <div class="dialog-foot"><button class="btn btn-primary" @click="saveFill"><VIcon name="save" />保存数量</button></div>
    </div>

    <!-- ② 智能推算 -->
    <div v-else-if="tab === 'auto'">
      <div class="form-grid" style="margin-bottom:10px">
        <div class="fitem"><label>建筑面积</label><div><b>{{ Number(props.project.建筑面积) || 0 }} ㎡</b></div></div>
        <div class="fitem"><label>楼层数</label><div><b>{{ Number(props.project.建筑楼层数) || 0 }}</b></div></div>
        <div class="fitem"><label>房间数</label><div><b>{{ Number(props.project.房间数) || 0 }}</b></div></div>
      </div>
      <div class="tbl-wrap" style="max-height:42vh;overflow:auto">
        <table class="tbl">
          <thead><tr><th style="width:36px"></th><th>设备</th><th>当前</th><th>建议</th><th>规则</th></tr></thead>
          <tbody>
            <tr v-for="r in autoRows" :key="r.device.id">
              <td><input type="checkbox" v-model="picks[r.device.id]"></td>
              <td><b>{{ r.device.name }}</b><div class="src">{{ r.device.spec || '-' }}</div></td>
              <td>{{ r.current }}</td>
              <td><b>{{ r.suggested }}</b></td>
              <td class="src">{{ ruleTxt(r.rule) }}</td>
            </tr>
            <tr v-if="!autoRows.length"><td colspan="5" style="text-align:center;color:var(--text3);padding:20px">没有可自动推算的设备规则</td></tr>
          </tbody>
        </table>
      </div>
      <div class="dialog-foot"><button class="btn btn-primary" @click="saveAuto"><VIcon name="zap" />应用推算</button></div>
    </div>

    <!-- ③ 批量增减 -->
    <div v-else-if="tab === 'adj'">
      <div class="form-grid">
        <div class="fitem"><label>操作</label>
          <select v-model="adj.op">
            <option value="+">数量 +N</option>
            <option value="-">数量 -N（不低于0）</option>
            <option value="*">数量 ×N</option>
          </select>
        </div>
        <div class="fitem"><label>数值 N</label><input v-model.number="adj.val" type="number" min="0.01" step="1"></div>
      </div>
      <div class="hint" style="padding:10px 12px;background:var(--amber-l);color:var(--amber-ink);border-radius:8px;margin:6px 0 12px">
        会作用于「{{ sub }}」当前点表全部已填数量行（不改备注中未单独添加的部分外均加注批量标记）。
      </div>
      <div class="dialog-foot"><button class="btn btn-primary" @click="saveAdj"><VIcon name="zap" />执行增减</button></div>
    </div>

    <!-- ④ CSV -->
    <div v-else>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-ghost" @click="exportCsv"><VIcon name="dl" />导出当前点表 CSV</button>
      </div>
      <label>粘贴导入（格式：设备类型,数量,备注，设备类型须在字典中）</label>
      <textarea v-model="csvText" rows="8" style="width:100%;font-family:var(--mono);font-size:13px" placeholder="网络摄像机(枪式),30,1F大堂&#10;网络摄像机(半球),20,各层走廊"></textarea>
      <div class="dialog-foot"><button class="btn btn-primary" @click="importCsv"><VIcon name="ul" />导入</button></div>
    </div>
  </ModalBase>
</template>