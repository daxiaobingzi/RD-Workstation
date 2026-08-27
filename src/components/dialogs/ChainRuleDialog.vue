<script setup>
// 链接收规则：后端设备数量由"前端合计"或"指定设备（可多选，含其他后端）"推导
// 规则保存在设备字典中，全局共享：所有项目引用同一台设备时自动继承本规则
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { BUDGET_TIERS } from '../../db/constants'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'
import { ensureDeviceChain, chainSourceIds, buildChainObj } from '../../db/calc'

const props = defineProps({
  device: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { devices } = storeToRefs(store)

const src = ensureDeviceChain(props.device) || null
// 承接来源：'front'=全部前端合计；'multi'=自定义多选（sources 数组）
const srcIds = chainSourceIds(src)
const f = reactive({
  enabled: !!src,
  mode: src?.mode || 'carry', // carry | mul | fixed
  capacity: src?.capacity || 1,
  srcKind: srcIds && srcIds.length ? 'multi' : 'front',
  sources: srcIds.slice(),
  factor: src?.factor != null ? src.factor : 1,
  reserve: src?.reserve || 0,
  round: src?.round || 'ceil'
})

// 本系统可作为承接来源的设备（含前端与后端），按钮分组
const sameSubDevs = computed(() => devices.value.filter(d => d.subsystem === props.device?.subsystem && d.id !== props.device?.id && d.status !== '归档'))
const frontDevs = computed(() => sameSubDevs.value.filter(d => d.category === '前端设备'))
const backDevs = computed(() => sameSubDevs.value.filter(d => d.category === '后端设备'))

function toggleSrc (id) {
  const i = f.sources.indexOf(id)
  if (i >= 0) f.sources.splice(i, 1)
  else f.sources.push(id)
  // 多选为空则退回前端合计
  if (!f.sources.length) f.srcKind = 'front'
  else f.srcKind = 'multi'
}
function setFrontAll () { f.srcKind = 'front'; f.sources = [] }

const srcName = computed(() => {
  if (f.srcKind === 'front' || !f.sources.length) return '前端设备合计'
  const names = f.sources.map(id => { const d = devices.value.find(x => x.id === id); return d ? d.name : '?' })
  return names.join('+')
})
// 预览：按当前参数即时估算数量公式
const preview = computed(() => {
  if (!f.enabled) return ''
  if (f.mode === 'fixed') return '数量 = 固定 ' + f.capacity
  const base = srcName.value
  if (f.mode === 'mul') {
    let s = base + ' × ' + f.capacity
    if (f.factor !== 1) s += ' ×' + f.factor
    return '数量 = ' + s
  }
  let s = (f.round === 'floor' ? '↓' : '↑') + '(' + base + ' ÷ ' + f.capacity
  if (f.factor !== 1) s += ' × ' + f.factor
  s += ')'
  if (f.reserve) s += ' + ' + f.reserve
  return '数量 = ' + s
})

async function save () {
  const d = props.device
  let chainObj = null
  if (f.enabled) {
    chainObj = buildChainObj({
      mode: f.mode, capacity: f.capacity, srcKind: f.srcKind,
      sources: f.sources, factor: f.factor, reserve: f.reserve, round: f.round
    })
  }
  store.saveDevice(d, { chain: chainObj, ratio: chainObj ? { type: chainObj.mode === 'fixed' ? 'fixed' : 'ratio', per: chainObj.capacity, qty: chainObj.mode === 'fixed' ? chainObj.capacity : undefined, target: '*' } : null })
  await store.saveAll()
  emit('close')
  store.toast(`「${d.name}」链规则已保存，存于设备字典，所有项目自动生效`)
}
</script>

<template>
  <ModalBase :title="'数量来源规则 · ' + props.device?.name" width="580px" @close="emit('close')">
    <div class="rule-tip">此规则保存在 <b>设备字典</b> 中，全局共享：项目中引用该设备即自动套用，无需每个项目重复配置。改这里 = 一次改全部项目。</div>

    <div class="fitem" style="margin-top:6px">
      <label><span style="display:inline-flex;align-items:center;gap:8px"><input type="checkbox" v-model="f.enabled"
        style="width:auto"> 启用自动推算（若关闭，本设备数量在项目中手填）</span></label>
    </div>

    <template v-if="f.enabled">
      <div class="form-grid">
        <div class="fitem" style="grid-column:1/-1">
          <label>数量随 … 变化（可多选设备组合）</label>
          <div class="src-row">
            <button type="button" class="src-pill" :class="{ on: f.srcKind === 'front' || !f.sources.length }" @click="setFrontAll">前端设备合计</button>
            <button type="button" class="src-pill multi" :class="{ on: f.srcKind === 'multi' && f.sources.length }" @click="f.srcKind = 'multi'">自定义勾选</button>
          </div>
          <div v-if="f.srcKind === 'multi'" class="src-pick">
            <div class="src-group">
              <div class="src-group-t">前端设备</div>
              <label v-for="d in frontDevs" :key="d.id" class="src-check" :class="{ on: f.sources.indexOf(d.id) >= 0 }">
                <input type="checkbox" :checked="f.sources.indexOf(d.id) >= 0" @change="toggleSrc(d.id)">
                {{ d.name }}<span v-if="d.spec" class="src-dim">（{{ d.spec }}）</span>
              </label>
              <div v-if="!frontDevs.length" class="src-none">无</div>
            </div>
            <div class="src-group">
              <div class="src-group-t">后端设备（链式承接）</div>
              <label v-for="d in backDevs" :key="d.id" class="src-check" :class="{ on: f.sources.indexOf(d.id) >= 0 }">
                <input type="checkbox" :checked="f.sources.indexOf(d.id) >= 0" @change="toggleSrc(d.id)">
                {{ d.name }}<span v-if="d.spec" class="src-dim">（{{ d.spec }}）</span>
              </label>
              <div v-if="!backDevs.length" class="src-none">无</div>
            </div>
            <div v-if="!sameSubDevs.length" class="src-none">本系统暂无其他设备</div>
          </div>
          <div class="hint">勾选多台设备 = 按所选设备的数量<b>求和</b>计算本设备数量；不勾选任何 = 全部前端合计。</div>
        </div>
        <div class="fitem">
          <label>推算方式</label>
          <select v-model="f.mode">
            <option value="carry">{{ srcName }}每 N 台 → 1 台本设备（承载）</option>
            <option value="mul">{{ srcName }} 数量 × N（倍数）</option>
            <option value="fixed">固定值（不随任何设备变化）</option>
          </select>
        </div>
        <div v-if="f.mode === 'carry' || f.mode === 'mul'" class="fitem">
          <label>{{ f.mode === 'carry' ? '每台承接 N 台' : '倍数 N' }}</label>
          <input v-model.number="f.capacity" type="number" min="1" step="1">
        </div>
        <div v-if="f.mode === 'fixed'" class="fitem">
          <label>固定数量</label>
          <input v-model.number="f.capacity" type="number" min="1" step="1">
        </div>
        <div v-if="f.mode === 'carry'" class="fitem">
          <label>冗余系数（不填=1）</label>
          <input v-model.number="f.factor" type="number" min="1" step="0.05">
          <div class="hint">如 1.1 = 额外 10% 余量</div>
        </div>
        <div v-if="f.mode === 'carry'" class="fitem">
          <label>预留备件（台）</label>
          <input v-model.number="f.reserve" type="number" min="0" step="1">
          <div class="hint">如机房备 1 台</div>
        </div>
        <div v-if="f.mode === 'carry'" class="fitem">
          <label>取整方式</label>
          <select v-model="f.round">
            <option value="ceil">向上取整（推荐）</option>
            <option value="floor">向下取整</option>
          </select>
        </div>
      </div>
      <div class="preview">{{ preview }}</div>
    </template>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>

<style scoped>
.rule-tip{font-size:12.5px;color:var(--green-ink);background:var(--green-l);border:1px solid var(--green-line);border-radius:10px;padding:8px 12px;line-height:1.6}
.rule-tip b{color:inherit}
.preview{font-family:var(--mono);font-size:13px;color:var(--text2);background:var(--glass-1);padding:8px 12px;border-radius:8px;border:1px dashed var(--line2);margin-top:10px}
.src-row{display:flex;gap:8px;margin-bottom:8px}
.src-pill{padding:6px 14px;border-radius:999px;border:1px solid var(--line2);font-size:12.5px;cursor:pointer;color:var(--text2);background:var(--glass-1)}
.src-pill.on{border-color:var(--accent);color:var(--on-primary);background:var(--accent)}
.src-pick{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--glass-1)}
.src-group{display:flex;flex-direction:column;gap:4px}
.src-group-t{font-size:11.5px;color:var(--text3);font-weight:600;margin-bottom:2px}
.src-check{display:flex;align-items:center;gap:6px;font-size:12.5px;padding:3px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.src-check input{width:auto;margin:0}
.src-check.on{background:var(--primary-l)}
.src-dim{color:var(--text3);font-size:11px}
.src-none{font-size:12px;color:var(--text3);padding:4px 0}
</style>