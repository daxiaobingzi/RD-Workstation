<script setup>
// 添加 / 编辑设备点表（含子系统扩展字段）
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  project: { type: Object, required: true },
  point: { type: Object, default: null },
  sub: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { devices, settings } = storeToRefs(store)
const isNew = computed(() => !props.point)

const sub = ref(props.sub || (props.point && props.point.子系统) || '视频监控系统')
const pt = reactive({
  子系统: sub.value,
  设备ID: props.point?.['设备ID'] || '',
  设备类型: props.point?.设备类型 || '',
  数量: props.point ? Number(props.point.数量) : 1,
  备注: props.point?.备注 || '',
  扩展字段: props.point?.扩展字段 || ''
})

const subDef = computed(() => settings.value.subsystems.find(x => x.name === sub.value))
const fields = computed(() => (subDef.value && subDef.value.fields) || [])
const devs = computed(() => devices.value.filter(d => d.subsystem === sub.value && d.status !== '归档' && (d.category === '前端设备' || d.category === '后端设备')))

const extVals = reactive({})
fields.value.forEach(f => {
  let raw = {}
  try { raw = pt.扩展字段 ? JSON.parse(pt.扩展字段) : {} } catch (e) {}
  extVals[f.key] = raw[f.key] || ''
})

function onSubChange () {
  pt.子系统 = sub.value
  pt.设备ID = ''
  pt.设备类型 = ''
  fields.value.forEach(f => { extVals[f.key] = '' })
}

async function save () {
  const selVal = pt.设备ID
  const selDev = store.devById(selVal) || store.resolveDevice(store.devices, sub.value, selVal, null)
  if (!selDev) { store.toast('请选择有效的设备类型'); return }
  const qty = parseInt(pt.数量) || 0
  if (qty <= 0) { store.toast('请填写正确的数量'); return }

  const extObj = {}
  Object.keys(extVals).forEach(k => { if (extVals[k]) extObj[k] = extVals[k] })

  if (isNew.value) {
    store.addPoint({
      项目ID: props.project.id, 子系统: sub.value, 设备类型: selDev.name, 设备ID: selDev.id,
      数量: qty, 备注: pt.备注.trim(), 扩展字段: Object.keys(extObj).length ? JSON.stringify(extObj) : ''
    })
  } else {
    store.savePoint(props.point, {
      子系统: sub.value, 设备类型: selDev.name, 设备ID: selDev.id, 数量: qty,
      备注: pt.备注.trim(), 扩展字段: Object.keys(extObj).length ? JSON.stringify(extObj) : ''
    })
  }
  await store.saveAll()
  emit('close')
  store.toast(isNew.value ? '设备已添加' : '设备已保存')
}
</script>

<template>
  <ModalBase :title="(isNew ? '添加设备' : '编辑设备') + ' · ' + sub" @close="emit('close')">
    <div class="form-grid">
      <div v-if="isNew && !props.sub" class="fitem"><label>子系统</label>
        <select v-model="sub" @change="onSubChange">
          <option v-for="s in settings.subsystems" :key="s.id" :value="s.name">{{ s.name }}</option>
        </select>
      </div>
      <div class="fitem" style="grid-column:1/-1">
        <label>设备类型 *</label>
        <select v-model="pt.设备ID">
          <option v-for="d in devs" :key="d.id" :value="d.id">{{ d.name }}（{{ d.category === '前端设备' ? '前端' : '后端' }} · {{ d.spec || '-' }} · {{ d.id }}）</option>
          <option v-if="pt.设备类型 && !devs.some(d => d.id === pt.设备ID && d.name === pt.设备类型)" :value="pt.设备ID">{{ pt.设备类型 }}（历史值·字典缺失）</option>
        </select>
        <div class="hint">{{ devs.length ? '设备来自数据库模块；前端/后端设备数量都直接填写，清单据此推算' : '该子系统暂无前端/后端设备，请先到「数据库」添加' }}</div>
      </div>
      <div class="fitem"><label>数量 *</label><input v-model.number="pt.数量" type="number" min="1" step="1"></div>
      <div class="fitem" style="grid-column:1/-1"><label>备注</label><input v-model.trim="pt.备注" placeholder="如：1F 10台，2F 10台"></div>
      <template v-if="fields.length">
        <div class="card-title" style="grid-column:1/-1;margin-top:6px">扩展属性 <span class="sub">{{ sub }} 子系统模板字段</span></div>
        <div v-for="f in fields" :key="f.key" class="fitem">
          <label>{{ f.name }}</label>
          <select v-if="f.type === 'select'" v-model="extVals[f.key]">
            <option v-for="o in f.options || []" :key="o" :value="o">{{ o }}</option>
            <option value="">（不填）</option>
          </select>
          <input v-else v-model="extVals[f.key]">
        </div>
      </template>
    </div>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>