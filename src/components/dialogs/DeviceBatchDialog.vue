<script setup>
// 设备字典批量操作：批量添加（粘贴建库）/ 批量修改（统一字段）
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  subsystem: { type: String, default: '' },
  selectedIds: { type: Array, default: () => [] },
  tab: { type: String, default: 'add' }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { settings, devices, devSort } = storeToRefs(store)
const tab = ref(props.tab)
const busy = ref(false)

const CATS = ['前端设备', '后端设备', '管材线缆', '辅材']

// ---------- ① 批量添加：粘贴建库 ----------
const pasteText = ref('')
const CATEGORY_HINT = '· 每行一个设备，最简单：一行只填设备名称（含空格也没问题）\n· 需要规格/单位：用 Tab 或逗号/顿号分隔第2、3列\n· 行尾可写类别（前端设备/后端设备/管材线缆/辅材），不写按前端设备\n· 示例：\n  网络摄像机(半球)\n  8口交换机\t千兆非网管\t台\t后端设备\n  光缆,12芯单模,米,管材线缆'

const UNIT_WORDS = ['台', '套', '个', '只', '块', '路', '点', '米', 'm', 'km', '箱', '卷', '根', '条', '个点']

const parsed = computed(() => {
  const lines = pasteText.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const rows = []
  const seen = new Set()
  lines.forEach(line => {
    const { name, spec, unit, cat } = parseLine(line)
    if (!name) return
    if (seen.has(name)) return
    seen.add(name)
    rows.push({ name, spec, unit: unit || '台', cat, bad: !cat })
  })
  return rows
})

// 纯空格行：剥离行尾的“类别”与“单位”词，其余整行作为设备名（允许名称含空格）
function parseLine (line) {
  if (line.includes('\t')) {
    const c = line.split('\t').map(s => s.trim())
    return { name: c[0] || '', spec: c[1] || '', unit: c[2] || '', cat: CATS.includes(c[3]) ? c[3] : '' }
  }
  const segs = line.split(/[,，;；、]+/).map(s => s.trim()).filter(Boolean)
  if (segs.length > 1) {
    return { name: segs[0] || '', spec: segs[1] || '', unit: segs[2] || '', cat: CATS.includes(segs[3]) ? segs[3] : '' }
  }
  let clean = line.trim().replace(/\s+/g, ' ')
  let cat = ''
  let unit = ''
  let changed = true
  while (changed) {
    changed = false
    CATS.forEach(c => {
      const i = clean.lastIndexOf(c)
      if (i >= 0 && i > 0) {
        clean = (clean.slice(0, i)).trim()
        cat = c
        changed = true
      }
    })
    if (UNIT_WORDS.includes(clean.trim().split(/\s+/).pop())) {
      unit = clean.trim().split(/\s+/).pop()
      clean = clean.trim().slice(0, clean.trim().lastIndexOf(' ')).trim()
      changed = true
    }
  }
  return { name: clean, spec: '', unit, cat }
}

async function doAdd () {
  const list = parsed.value
  if (!list.length) { store.toast('请先粘贴设备内容'); return }
  busy.value = true
  let added = 0
  const tail = devices.value.filter(d => d.subsystem === props.subsystem).length + list.length
  list.forEach((r, i) => {
    const d = store.addDevice({
      subsystem: props.subsystem, name: r.name, spec: r.spec,
      unit: r.unit || '台', category: r.cat || '前端设备'
    })
    store.devSort[d.id] = tail - list.length + i
    added++
  })
  await store.saveAll()
  busy.value = false
  store.toast(`已批量添加 ${added} 台设备`)
  emit('close')
}

// ---------- ② 批量修改：统一字段 + 数量来源规则 ----------
const edit = reactive({ category: '', unit: '', toSub: '' })
const rule = reactive({ enabled: false, mode: 'carry', capacity: 1, factor: 1, reserve: 0, round: 'ceil' })
const selected = computed(() => {
  const set = new Set(props.selectedIds)
  return devices.value.filter(d => d.subsystem === props.subsystem && set.has(d.id))
})
const ruleTargets = computed(() => selected.value.filter(d => d.category !== '前端设备'))
const subs = computed(() => settings.value.subsystems.map(s => s.name))

// 生成与设备编辑弹窗一致的数量规则结构（chain + ratio）
function chainFor (mode, capacity, factor, reserve, round) {
  const cap = Math.max(1, parseInt(capacity) || 1)
  if (mode === 'fixed') {
    return {
      chain: { mode: 'fixed', capacity: cap },
      ratio: { type: 'fixed', per: cap, qty: cap, target: '*' }
    }
  }
  return {
    chain: { mode, capacity: cap, source: 'front', sources: [], factor: parseFloat(factor) || 1, reserve: parseInt(reserve) || 0, round: round || 'ceil' },
    ratio: { type: 'ratio', per: cap, target: '*' }
  }
}

async function doEdit () {
  const list = selected.value
  if (!list.length) { store.toast('未勾选任何设备'); return }
  if (!edit.category && !edit.unit.trim() && !edit.toSub && !rule.enabled) { store.toast('请至少填写一项要修改的内容'); return }
  busy.value = true
  let ruleApplied = 0
  list.forEach(d => {
    const data = {}
    if (edit.category) data.category = edit.category
    if (edit.unit.trim()) data.unit = edit.unit.trim()
    if (rule.enabled && d.category !== '前端设备') {
      Object.assign(data, chainFor(rule.mode, rule.capacity, rule.factor, rule.reserve, rule.round))
      ruleApplied++
    }
    store.saveDevice(d, data)
    if (edit.toSub && edit.toSub !== d.subsystem) {
      d.subsystem = edit.toSub
      const tail = devices.value.filter(x => x.subsystem === edit.toSub).length
      store.devSort[d.id] = tail
    }
  })
  await store.saveAll()
  busy.value = false
  const note = rule.enabled
    ? (ruleApplied < list.length ? `，其中 ${ruleApplied} 台已设数量规则（前端设备跳过）` : '，数量规则已统一设置')
    : ''
  store.toast(`已批量修改 ${list.length} 台设备${note}`)
  emit('close')
}

function resetEdit () { edit.category = ''; edit.unit = ''; edit.toSub = '' }
</script>

<template>
  <ModalBase :title="'设备批量操作 · ' + subsystem" @close="emit('close')" width="620px">
    <div class="tabs" style="margin-bottom:12px">
      <button class="tab" :class="{ active: tab === 'add' }" @click="tab = 'add'">批量添加</button>
      <button class="tab" :class="{ active: tab === 'edit' }" @click="tab = 'edit'">批量修改<span v-if="selected.length" class="cnt">{{ selected.length }}</span></button>
    </div>

    <div v-if="tab === 'add'">
      <div class="hint" style="padding:10px 12px;background:var(--amber-l);color:var(--amber-ink);border-radius:8px;margin-bottom:10px">
        一次粘贴多行即批量建库，自动归入「{{ subsystem }}」。同名设备自动去重。
      </div>
      <textarea v-model="pasteText" rows="9" placeholder="网络摄像机(枪式)&#10;网络摄像机(半球)&#10;光缆 12芯单模 米 管材线缆" style="width:100%;font-family:var(--mono);font-size:12.5px;resize:vertical" />
      <div class="hint" style="margin:8px 0;font-size:12px;white-space:pre-line">{{ CATEGORY_HINT }}</div>
      <div v-if="parsed.length" class="card" style="margin-top:6px">
        <div class="card-title">识别到 {{ parsed.length }} 台设备 <span class="sub">{{ parsed.filter(p => p.bad).length }} 台未识别类别（默认前端设备）</span></div>
        <div class="tbl-wrap" style="max-height:180px;overflow:auto">
          <table class="tbl"><thead><tr><th>设备名称</th><th>规格</th><th>单位</th><th>类别</th></tr></thead><tbody>
            <tr v-for="(p, i) in parsed" :key="i"><td><b>{{ p.name }}</b></td><td class="src">{{ p.spec || '-' }}</td><td>{{ p.unit }}</td><td><span class="badge" :class="{ 'plain': !p.bad, 'warn': p.bad }">{{ p.cat || '前端设备(默认)' }}</span></td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="busy" @click="doAdd"><VIcon name="plus" />添加 {{ parsed.length || '' }} 台设备</button>
      </div>
    </div>

    <div v-else>
      <div class="hint" style="padding:10px 12px;background:var(--amber-l);color:var(--amber-ink);border-radius:8px;margin-bottom:10px">
        将统一修改已勾选的 <b>{{ selected.length }}</b> 台设备；留空表示不改该项。
      </div>
      <div class="form-grid">
        <div class="fitem"><label>类别（统一改为）</label>
          <select v-model="edit.category">
            <option value="">保持不变</option>
            <option v-for="c in CATS" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="fitem"><label>单位（统一改为）</label><input v-model.trim="edit.unit" placeholder="留空 = 保持不变"></div>
        <div class="fitem" style="grid-column:1/-1"><label>移动至子系统</label>
          <select v-model="edit.toSub">
            <option value="">保持不变</option>
            <option v-for="s in subs" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>

      <!-- 数量来源规则（批量配置） -->
      <div class="rule-batch">
        <label class="rb-check">
          <input type="checkbox" v-model="rule.enabled"> 统一设置数量来源规则
          <span class="src">（仅对勾选设备中非「前端设备」生效，当前可应用 {{ ruleTargets.length }} 台）</span>
        </label>
        <div v-if="rule.enabled" class="form-grid" style="margin-top:10px">
          <div class="fitem"><label>推算方式</label>
            <select v-model="rule.mode">
              <option value="carry">前端合计每 N 台 → 1 台本设备（承载）</option>
              <option value="mul">前端合计 × N（倍数）</option>
              <option value="fixed">固定数量</option>
            </select>
          </div>
          <div class="fitem"><label>{{ rule.mode === 'fixed' ? '固定数量' : 'N（每 N 台 / 倍数）' }}</label><input v-model.number="rule.capacity" type="number" min="1" step="1"></div>
          <div v-if="rule.mode !== 'fixed'" class="fitem"><label>冗余系数（不填=1）</label><input v-model.number="rule.factor" type="number" min="1" step="0.05"></div>
          <div v-if="rule.mode === 'carry'" class="fitem"><label>预留备件（台）</label><input v-model.number="rule.reserve" type="number" min="0" step="1"></div>
          <div v-if="rule.mode === 'carry'" class="fitem"><label>取整方式</label>
            <select v-model="rule.round">
              <option value="ceil">向上取整（推荐）</option>
              <option value="floor">向下取整</option>
            </select>
          </div>
        </div>
      </div>
      <div v-if="selected.length" class="card" style="margin-top:6px;max-height:200px;overflow:auto">
        <div class="card-title">将作用于以下设备</div>
        <ul style="padding:0;margin:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px">
          <li v-for="d in selected" :key="d.id" class="chip" style="background:var(--glass-2)">{{ d.name }}</li>
        </ul>
      </div>
      <div class="dialog-foot">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="busy" @click="doEdit"><VIcon name="save" />应用修改（{{ selected.length }} 台）</button>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.rule-batch { margin-top: 12px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--glass-1); }
.rb-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); margin: 0; }
.rb-check input[type="checkbox"] { margin: 0; }
.rb-check .src { color: var(--text3); font-size: 12px; font-weight: 400; }
</style>