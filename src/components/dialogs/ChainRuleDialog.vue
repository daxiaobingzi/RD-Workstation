<script setup>
// 链规则编辑：单个承载设备如何挂入推导链（方式/承载/承接对象/系数/预留/取整）
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
  mode: src?.mode || 'carry',
  capacity: src?.capacity || 1,
  source: src?.source || 'front',
  factor: src?.factor != null ? src.factor : 1,
  reserve: src?.reserve || 0,
  round: src?.round || 'ceil'
})

const frontDevs = computed(() => devices.value.filter(d => d.category === '前端设备' && d.id !== props.device?.id && d.subsystem === props.device?.subsystem))
const backDevs = computed(() => devices.value.filter(d => d.category === '后端设备' && d.id !== props.device?.id && d.subsystem === props.device?.subsystem))

// 预览：按当前参数即时估算数量公式
const preview = computed(() => {
  if (!f.enabled) return ''
  if (f.mode === 'fixed') return '数量 = 固定 ' + f.capacity
  const srcName = f.source === 'front' ? '前端合计' : (devices.value.find(x => x.id === f.source)?.name || '?')
  if (f.mode === 'mul') {
    let s = srcName + ' × ' + f.capacity
    if (f.factor !== 1) s += ' ×' + f.factor
    return '数量 = ' + s
  }
  let s = (f.round === 'floor' ? '↓' : '↑') + '(' + srcName + ' ÷ ' + f.capacity
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
  store.toast(`「${d.name}」的链承载规则已保存`)
}
</script>

<template>
  <ModalBase :title="'链承载规则 · ' + props.device?.name" width="560px" @close="emit('close')">
    <div class="fitem">
      <label><span style="display:inline-flex;align-items:center;gap:8px"><input type="checkbox" v-model="f.enabled"> 参与推导链（自动推算数量）</span></label>
    </div>

    <template v-if="f.enabled">
      <div class="form-grid">
        <div class="fitem">
          <label>推导方式</label>
          <select v-model="f.mode">
            <option value="carry">按承载能力（1 台承接 N 台）</option>
            <option value="mul">按倍数（承接量 × N）</option>
            <option value="fixed">固定值</option>
          </select>
        </div>
        <div v-if="f.mode === 'carry' || f.mode === 'mul'" class="fitem">
          <label>{{ f.mode === 'carry' ? '每台承载能力' : '倍数 N' }}</label>
          <input v-model.number="f.capacity" type="number" min="1" step="1">
        </div>
        <div v-if="f.mode === 'fixed'" class="fitem">
          <label>固定数量</label>
          <input v-model.number="f.capacity" type="number" min="1" step="1">
        </div>
        <div v-if="f.mode === 'carry' || f.mode === 'mul'" class="fitem">
          <label>承接对象</label>
          <select v-model="f.source" style="width:100%">
            <option value="front">前端设备合计</option>
            <option v-for="d in frontDevs" :key="d.id" :value="d.id">{{ d.name }}{{ d.spec ? '（' + d.spec + '）' : '' }}</option>
            <option v-if="!frontDevs.length" value="front" disabled>（暂无前端设备）</option>
          </select>
        </div>
        <div v-if="f.mode === 'carry'" class="fitem">
          <label>冗余系数（不填=1）</label>
          <input v-model.number="f.factor" type="number" min="1" step="0.05">
        </div>
        <div v-if="f.mode === 'carry'" class="fitem">
          <label>预留备件（台）</label>
          <input v-model.number="f.reserve" type="number" min="0" step="1">
        </div>
        <div v-if="f.mode === 'carry'" class="fitem">
          <label>取整方式</label>
          <select v-model="f.round">
            <option value="ceil">向上取整（推荐）</option>
            <option value="floor">向下取整</option>
          </select>
        </div>
      </div>
      <div class="hint" style="background:var(--glass-1);padding:8px 12px;border-radius:8px;border:1px dashed var(--line2)">{{ preview }}</div>
      <div class="hint" style="margin-top:6px">示例：交换机 24 口实际承载 20 路 → 上取整(64 ÷ 20 × 1.05) + 1 备 = 5 台。不同品牌型号可各自设承载能力，便于选型对比。</div>
    </template>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>