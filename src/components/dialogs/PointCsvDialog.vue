<script setup>
// 点表 · CSV 独立入口：下载模板 / 导出当前点表 / 粘贴导入（不再内嵌在批量操作中）
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { todayStr } from '../../db/format'
import { rowsToCSV } from '../../db/calc'
import { buildCsvBlob, downloadBlob } from '../../db/export'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  project: { type: Object, required: true },
  sub: { type: String, required: true }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { devices, points } = storeToRefs(store)
const csvText = ref('')
const subSafe = props.sub.replace(/[\\/:*?"<>|]/g, '_')

async function exportCsv () {
  const rows = [['设备类型', '数量', '备注']]
  points.value.filter(x => x.项目ID === props.project.id && x.子系统 === props.sub).forEach(x => rows.push([x.设备类型, x.数量, x.备注 || '']))
  await downloadBlob(`点表-${subSafe}-${todayStr()}.csv`, buildCsvBlob(rowsToCSV(rows)))
  store.toast('已导出当前点表 CSV')
}

async function downloadTemplate () {
  const rows = [['设备类型', '数量', '备注']]
  devices.value.filter(d => d.subsystem === props.sub && d.status !== '归档' && d.category === '前端设备').forEach(d => rows.push([d.name, 1, '']))
  await downloadBlob(`点表模板-${subSafe}.csv`, buildCsvBlob(rowsToCSV(rows)))
  store.toast(`模板已下载（含 ${rows.length - 1} 台设备），编辑后整段复制回来粘贴导入`)
}

async function importCsv () {
  const res = store.importPointsCSV(props.project, props.sub, csvText.value)
  if (!res.ok) { store.toast(res.msg); return }
  await store.saveAll()
  store.toast(`导入完成：新增 ${res.add} 条，更新 ${res.upd} 条${res.skip ? `，跳过 ${res.skip} 条` : ''}`)
  emit('close')
}
</script>

<template>
  <ModalBase :title="'点表 CSV 导入 / 导出 · ' + sub" width="620px" @close="emit('close')">
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn btn-ghost" @click="exportCsv"><VIcon name="dl" />导出当前点表</button>
      <button class="btn btn-ghost" @click="downloadTemplate"><VIcon name="dl" />下载 CSV 模板</button>
      <span class="hint" style="align-self:center">模板含全部前端设备，Excel 里填数量后整段复制</span>
    </div>
    <label>粘贴导入（格式：设备类型,数量,备注，设备类型须在字典中）</label>
    <textarea v-model="csvText" rows="8" style="width:100%;font-family:var(--mono);font-size:13px" placeholder="网络摄像机(枪式),30,1F大堂&#10;网络摄像机(半球),20,各层走廊"></textarea>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="importCsv"><VIcon name="ul" />导入</button>
    </template>
  </ModalBase>
</template>