<script setup>
// 智能推算数量：按建筑面积/楼层/房间定额与配比规则给出建议，勾选应用
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { fmtNum } from '../../db/format'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  project: { type: Object, required: true },
  sub: { type: String, required: true }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { points } = storeToRefs(store)

const rows = ref(store.autoQtyImpact(props.project, props.sub))
const picks = ref({})
rows.value.forEach(r => { if (picks.value[r.device.id] === undefined) picks.value[r.device.id] = true })

function ruleTxt (r) {
  if (!r) return '已有配比'
  if (r.method === 'area') return '面积 · 每' + r.per + '㎡'
  if (r.method === 'floor') return '楼层 · 每层' + r.per + '台'
  if (r.method === 'room') return '房间 · 每' + r.per + '间'
  return '固定'
}

async function apply () {
  const picked = rows.value.filter(r => picks.value[r.device.id])
  if (!picked.length) { store.toast('请至少选择一项'); return }
  const res = store.applyAutoQty(props.project, props.sub, picked)
  await store.saveAll()
  emit('close')
  store.toast(`已应用数量推算：修改 ${res.changed} 行，新增 ${res.added} 行`)
}
</script>

<template>
  <ModalBase :title="'智能推算数量 · ' + sub" @close="emit('close')">
    <div class="hint" style="margin-bottom:10px">根据项目建筑面积、楼层数、房间数和设备定额/配比规则推算。系统只提供建议，不会自动减少已有数量。</div>
    <div class="form-grid" style="margin-bottom:10px">
      <div class="fitem"><label>建筑面积</label><div><b>{{ fmtNum(project.建筑面积) }} ㎡</b></div></div>
      <div class="fitem"><label>楼层数</label><div><b>{{ Number(project.建筑楼层数) || 0 }}</b></div></div>
      <div class="fitem"><label>房间数</label><div><b>{{ Number(project.房间数) || 0 }}</b></div></div>
    </div>

    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th style="width:36px"></th><th>设备</th><th>当前</th><th>建议</th><th>规则</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.device.id">
            <td><input type="checkbox" v-model="picks[r.device.id]"></td>
            <td><b>{{ r.device.name }}</b><div class="src">{{ r.device.spec || '-' }}</div></td>
            <td>{{ r.current }}</td>
            <td><b>{{ r.suggested }}</b></td>
            <td class="src">{{ ruleTxt(r.rule) }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="5" style="text-align:center;color:var(--text3);padding:20px">当前子系统没有可用于自动推算的设备规则。请先在「系统配置 → 设计定额」维护规则。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="apply"><VIcon name="zap" />应用推算</button>
    </template>
  </ModalBase>
</template>