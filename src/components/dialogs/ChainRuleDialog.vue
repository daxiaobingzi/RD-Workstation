<script setup>
// 链接收规则：后端设备数量由"前端合计"或"指定设备（含其他后端）"推导
// 规则保存在设备字典中，全局共享：所有项目引用同一台设备时自动继承本规则
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { BUDGET_TIERS } from '../../db/constants'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'
import { ensureDeviceChain } from '../../db/calc'

const props = defineProps({
  device: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { devices } = storeToRefs(store)

const src = ensureDeviceChain(props.device) || null
const f = reactive({
  enabled: !!src,
  mode: src?.mode || 'carry', // carry | mul | fixed
  capacity: src?.capacity || 1,
  source: src?.source || 'front',
  factor: src?.factor != null ? src.factor : 1,
  reserve: src?.reserve || 0,
  round: src?.round || 'ceil'
})

// 本系统可作为承接来源的设备（含前端与后端），按钮分组
const sameSubDevs = computed(() => devices.value.filter(d => d.subsystem === props.device?.subsystem && d.id !== props.device?.id && d.status !== '归档'))
const frontDevs = computed(() => sameSubDevs.value.filter(d => d.category === '前端设备'))
const backDevs = computed(() => sameSubDevs.value.filter(d => d.category === '后端设备'))

const srcName = computed(() => {
  if (f.source === 'front') return '前端设备合计'
  const d = devices.value.find(x => x.id === f.source)
  return d ? d.name : '?'
})
// 预览：按当前参数即时估算数量公式
const preview = computed(() => {
  if (!f.enabled) return ''
  if (f.mode === 'fixed') return '数量 = 固定 ' + f.capacity
  if (f.mode === 'mul') {
    let s = srcName.value + ' × ' + f.capacity
    if (f.factor !== 1) s += ' ×' + f.factor
    return '数量 = ' + s
  }
  let s = (f.round === 'floor' ? '↓' : '↑') + '(' + srcName.value + ' ÷ ' + f.capacity
  if (f.factor !== 1) s += ' × ' + f.factor
  s += ')'
  if (f.reserve) s += ' + ' + f.reserve
  return '数量 = ' + s
})

async function save () {
  const d = props.device
  let chainObj = null
  if (f.enabled) {
    if (f.mode === 'fixed') {
      chainObj = { mode: 'fixed', capacity: Math.max(1, parseInt(f.capacity) || 1) }
    } else {
      chainObj = {
        mode: f.mode === 'mul' ? 'mul' : 'carry',
        capacity: Math.max(1, parseInt(f.capacity) || 1),
        source: f.source || 'front',
        factor: parseFloat(f.factor) || 1,
        reserve: parseInt(f.reserve) || 0,
        round: f.round || 'ceil'
      }
    }
  }
  store.saveDevice(d, { chain: chainObj, ratio: chainObj ? { type: chainObj.mode === 'fixed' ? 'fixed' : 'ratio', per: chainObj.capacity, qty: chainObj.mode === 'fixed' ? chainObj.capacity : undefined, target: chainObj.source && chainObj.source !== 'front' ? (devices.value.find(x => x.id === chainObj.source)?.name || '*') : '*' } : null })
  await store.saveAll()
  emit('close')
  store.toast(`「${d.name}」链规则已保存，本规则存于设备字典，所有项目自动生效`)
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
        <div class="fitem">
          <label>数量随 … 变化</label>
          <select v-model="f.source" style="width:100%">
            <option value="front">前端设备合计（本系统全部前端）</option>
            <optgroup label="—— 指定前端设备 ——">
              <option v-for="d in frontDevs" :key="d.id" :value="d.id">{{ d.name }}{{ d.spec ? '（' + d.spec + '）' : '' }}</option>
            </optgroup>
            <optgroup label="—— 指定后端设备（链式承接）——">
              <option v-for="d in backDevs" :key="d.id" :value="d.id">{{ d.name }}{{ d.spec ? '（' + d.spec + '）' : '' }}</option>
            </optgroup>
            <option v-if="!sameSubDevs.length" disabled>（本系统暂无其他设备）</option>
          </select>
          <div class="hint">示例：硬盘数量随 NVR（后端设备）变化 → 选「指定后端设备：NVR」</div>
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
</style>