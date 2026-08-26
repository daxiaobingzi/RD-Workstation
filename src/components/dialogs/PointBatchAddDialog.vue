<script setup>
// 点表 · 批量添加/更新点位：一次勾选多台设备直接写入点表（不再逐个点「添加点位」）
// - 设备池 = 该子系统全部"前端设备 + 后端设备"
// - 已有点位行显示当前数量，可直接修改（即批量更新）；未录入的默认数量 1
// - 支持粘贴设备名列表快速勾选
import { computed, ref } from 'vue'
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

const rows = ref([])
function build () {
  const has = {}
  points.value.filter(x => x.项目ID === props.project.id && x.子系统 === props.sub).forEach(x => { has[x['设备ID'] || x.设备类型] = x })
  rows.value = devices.value
    .filter(d => d.subsystem === props.sub && d.status !== '归档' && (d.category === '前端设备' || d.category === '后端设备'))
    .map(d => {
      const cur = has[d.id] || has[d.name]
      return {
        devId: d.id, name: d.name, spec: d.spec || '', cat: d.category,
        cur: cur ? Number(cur.数量) : 0,
        qty: cur ? Number(cur.数量) : 1,
        note: cur ? (cur.备注 || '') : '',
        picked: !cur
      }
    })
}
build()

const pickedN = computed(() => rows.value.filter(r => r.picked).length)
const allPicked = computed(() => rows.value.length > 0 && rows.value.every(r => r.picked))
function toggleAll () { const v = !allPicked.value; rows.value.forEach(r => { r.picked = v }) }
function pickOnlyMissing () { rows.value.forEach(r => { r.picked = !r.cur }) }
function clearPicks () { rows.value.forEach(r => { r.picked = false }) }

const pasteTxt = ref('')
function applyPaste () {
  const names = String(pasteTxt.value || '').split(/[,，、\r\n\t]+/).map(s => s.trim()).filter(Boolean)
  if (!names.length) { store.toast('请粘贴设备名称（一行一个或用逗号分隔）'); return }
  let hit = 0
  rows.value.forEach(r => {
    if (names.includes(r.name) || names.some(n => r.name.includes(n))) { r.picked = true; hit++ }
  })
  store.toast(hit ? `已勾选 ${hit} 台设备` : '未匹配到任何设备，请确认名称与字典一致')
}

async function apply () {
  const entries = rows.value.filter(r => r.picked && Number(r.qty) > 0).map(r => ({ name: r.name, qty: parseInt(r.qty) || 0, note: r.note }))
  if (!entries.length) { store.toast('请先勾选设备并填写数量'); return }
  const res = store.batchSavePoints(props.project, props.sub, entries)
  await store.saveAll()
  emit('close')
  store.toast(`已批量写入点表：新增 ${res.added} 条，更新 ${res.upd} 条`)
}
</script>

<template>
  <ModalBase :title="'批量添加 / 更新点位 · ' + sub" width="780px" @close="emit('close')">
    <div class="hint" style="margin-bottom:10px">勾选设备即写入点表；未录入的默认数量 1，已录入的显示当前数量可直接改（= 批量更新）。无需逐个点「添加点位」。</div>

    <!-- 快捷操作 -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
      <button class="btn btn-ghost btn-sm" @click="toggleAll"><VIcon name="check" />{{ allPicked ? '取消全选' : '全选' }}</button>
      <button class="btn btn-ghost btn-sm" @click="pickOnlyMissing"><VIcon name="zap" />只选未录入</button>
      <button class="btn btn-ghost btn-sm" @click="clearPicks">清空选择</button>
      <span class="hint" style="margin-left:auto">已选 <b style="color:var(--accent)">{{ pickedN }}</b> / {{ rows.length }} 台</span>
    </div>

    <!-- 设备列表 -->
    <div class="tbl-wrap" style="max-height:46vh;overflow:auto">
      <table class="tbl">
        <thead><tr><th style="width:34px"><input type="checkbox" :checked="allPicked" @change="toggleAll" /></th><th>设备</th><th>类别</th><th>已有数量</th><th style="width:100px">录入数量</th><th style="width:160px">备注</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.devId" :class="{ miss: r.cur > 0 }">
            <td><input type="checkbox" v-model="r.picked"></td>
            <td><b>{{ r.name }}</b><div class="src">{{ r.spec || '-' }}</div></td>
            <td><span class="badge" :class="{ 'blue': r.cat === '前端设备', 'green': r.cat === '后端设备' }">{{ r.cat }}</span></td>
            <td><span :class="r.cur > 0 ? 'cur' : 'none'">{{ r.cur || '未录入' }}</span></td>
            <td><input v-model.number="r.qty" type="number" min="0" step="1" style="width:88px"></td>
            <td><input v-model.trim="r.note" style="width:150px"></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6" style="text-align:center;color:var(--text3);padding:24px">该子系统暂无前端/后端设备，请先到「资料库」添加。</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 粘贴快速勾选 -->
    <div style="margin-top:10px">
      <label style="margin-bottom:4px">粘贴设备名快速勾选 <span class="src" style="color:var(--text3);font-weight:400">（与字典名称匹配即自动勾选，如：从 Excel 复制一行设备名）</span></label>
      <div style="display:flex;gap:8px">
        <textarea v-model="pasteTxt" rows="2" style="flex:1;font-family:var(--mono);font-size:12.5px" placeholder="网络摄像机(枪式)&#10;网络摄像机(半球),光缆"></textarea>
        <button class="btn btn-ghost" @click="applyPaste"><VIcon name="zap" />匹配勾选</button>
      </div>
    </div>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="apply"><VIcon name="save" />写入点表（{{ pickedN }} 台）</button>
    </template>
  </ModalBase>
</template>

<style scoped>
tr.miss { opacity: .85; }
.cur { color: var(--green); font-weight: 600; font-family: var(--mono); }
.none { color: var(--text3); font-size: 12px; }
</style>