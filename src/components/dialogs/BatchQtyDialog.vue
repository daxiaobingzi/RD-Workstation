<script setup>
// 批量添加设备数量：列出当前子系统前端设备，批量填数量/备注
import { computed, reactive } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  project: { type: Object, required: true },
  sub: { type: String, required: true }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { devices, points } = storeToRefs(store)

const devs = computed(() => devices.value.filter(d => d.subsystem === props.sub && d.status !== '归档' && d.category === '前端设备'))

const has = {}
points.value.filter(x => x.项目ID === props.project.id && x.子系统 === props.sub).forEach(x => { has[x['设备ID'] || x.设备类型] = x })

const rows = reactive(devs.value.map(d => {
  const cur = has[d.id] || has[d.name]
  return { name: d.name, spec: d.spec, qty: cur ? Number(cur.数量) : 1, note: cur ? cur.备注 || '' : '' }
}))

function qtyOf (name) {
  const r = rows.find(x => x.name === name)
  return r ? r.qty : ''
}
function noteOf (name) {
  const r = rows.find(x => x.name === name)
  return r ? r.note : ''
}

async function save () {
  const entries = rows.map(r => ({ name: r.name, qty: parseInt(r.qty) || 0, note: r.note })).filter(e => Number(e.qty) > 0)
  if (!entries.length) { store.toast('未填写任何数量'); return }
  const res = store.batchSavePoints(props.project, props.sub, entries)
  await store.saveAll()
  emit('close')
  store.toast(`批量保存完成：新增 ${res.added} 条，更新 ${res.upd} 条`)
}
</script>

<template>
  <ModalBase :title="'批量添加设备数量 · ' + sub" @close="emit('close')">
    <div v-if="!devs.length" class="hint" style="padding:12px 0">该子系统设备字典暂无前端设备，请先到「数据库」添加。</div>
    <template v-else>
      <div class="tbl-wrap" style="max-height:54vh;overflow:auto">
        <table class="tbl">
          <thead><tr><th>设备</th><th style="width:120px">数量</th><th style="width:170px">备注</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.name">
              <td><b>{{ r.name }}</b><div v-if="r.spec" class="src">{{ r.spec }}</div></td>
              <td><input v-model.number="r.qty" type="number" min="0" step="1" style="width:96px"></td>
              <td><input v-model.trim="r.note" style="width:150px"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:6px">数量填 0 表示该设备不录入；已录入的设备将同步更新数量与备注。</div>
    </template>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>