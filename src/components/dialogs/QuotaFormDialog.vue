<script setup>
// 新增 / 编辑设计定额：子系统 × 设备 × 业态 × 计算方法
import { reactive, computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  rule: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { settings, devices } = storeToRefs(store)
const isNew = !props.rule

const subs = computed(() => settings.value.subsystems.map(s => s.name))
const devs = computed(() => devices.value.filter(d => d.subsystem === f.subsystem && (d.category === '前端设备' || d.category === '后端设备')))

const f = reactive({
  subsystem: props.rule?.subsystem || subs.value[0] || '',
  deviceId: props.rule?.deviceId || '',
  buildingType: props.rule?.buildingType || '全部业态',
  method: props.rule?.method || 'area',
  per: Number(props.rule?.per) || 100,
  min: Number(props.rule?.min) || 0,
  max: Number(props.rule?.max) || 0
})

const perLabel = computed(() =>
  f.method === 'area' ? '每多少㎡1台' : f.method === 'floor' ? '每层多少台' : f.method === 'room' ? '每多少间1台' : '固定台数')

function onSubChange () { f.deviceId = '' }

async function save () {
  if (!f.deviceId) { store.toast('请选择设备'); return }
  const per = Math.max(0.01, parseFloat(f.per) || 1)
  const min = parseInt(f.min) || 0
  const max = parseInt(f.max) || 0
  if (max && max < min) { store.toast('最大数量不能小于最小数量'); return }

  const data = { subsystem: f.subsystem, deviceId: f.deviceId, buildingType: f.buildingType, method: f.method, per, min, max }
  if (props.rule) {
    store.saveQuota(props.rule, data)
    // 去重：同 子系统+设备+业态 只保留一条
    settings.value.designQuotas = settings.value.designQuotas.filter((x, i, arr) =>
      x.id === props.rule.id || arr.findIndex(y => y.subsystem === x.subsystem && y.deviceId === x.deviceId && y.buildingType === x.buildingType) === i)
  } else {
    store.addQuota(data)
  }
  await store.saveAll()
  emit('close')
  store.toast(isNew ? '定额已添加' : '定额已保存')
}
</script>

<template>
  <ModalBase :title="isNew ? '新增设计定额' : '编辑设计定额'" @close="emit('close')">
    <div class="form-grid">
      <div class="fitem"><label>子系统 *</label>
        <select v-model="f.subsystem" @change="onSubChange">
          <option v-for="s in subs" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div class="fitem"><label>设备 *</label>
        <select v-model="f.deviceId">
          <option disabled value="">请选择设备</option>
          <option v-for="d in devs" :key="d.id" :value="d.id">{{ d.name }}（{{ d.spec || '-' }}）</option>
        </select>
      </div>
      <div class="fitem"><label>适用业态</label>
        <select v-model="f.buildingType">
          <option value="全部业态">全部业态</option>
          <option v-for="b in settings.buildingTypes" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>
      <div class="fitem"><label>计算方式</label>
        <select v-model="f.method">
          <option value="area">按建筑面积</option>
          <option value="floor">按楼层</option>
          <option value="room">按房间</option>
          <option value="fixed">固定数量</option>
        </select>
      </div>
      <div class="fitem"><label>{{ perLabel }}</label><input v-model.number="f.per" type="number" min="0.01" step="0.01"></div>
      <div class="fitem"><label>最小数量</label><input v-model.number="f.min" type="number" min="0" step="1"></div>
      <div class="fitem"><label>最大数量</label><input v-model.number="f.max" type="number" min="0" step="1"><div class="hint">0 表示不限</div></div>
    </div>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>