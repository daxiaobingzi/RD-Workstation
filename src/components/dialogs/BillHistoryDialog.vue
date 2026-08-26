<script setup>
// 历史清单：展示项目全部清单快照，可查看/导出
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { buildBillRows, rowsToCSV, rowsToTSV } from '../../db/calc'
import { buildXlsx, buildCsvBlob, buildTxtBlob, downloadBlob, copyText } from '../../db/export'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  proj: { type: Object, required: true }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { settings, devBrands, devices } = storeToRefs(store)

const hist = computed(() => store.billOfProject(props.proj.id))
const active = ref(hist.value[hist.value.length - 1] || null)
const activeRows = computed(() => active.value ? buildBillRows(
  { settings: settings.value, devices: devices.value, devBrands: devBrands.value },
  props.proj, active.value.rows) : [])

function select (h) { active.value = h }

async function exportActiveXlsx () {
  const sheets = [
    { name: '设备材料清单', rows: activeRows.value },
    { name: '报价汇总', rows: store.quoteOfBill(props.proj, active.value.rows).rows }
  ]
  await downloadBlob(`施工清单-${props.proj.项目编号 || props.proj.项目名称}-${String(active.value.at).slice(0, 10)}.xlsx`, buildXlsx(sheets))
  store.toast('已导出 Excel')
}
const activeCsvText = computed(() => rowsToCSV(activeRows.value))
const activeTsvText = computed(() => rowsToTSV(activeRows.value))

async function exportCSV () {
  await downloadBlob(`施工清单-${props.proj.项目编号 || props.proj.项目名称}-${String(active.value.at).slice(0, 10)}.csv`, buildCsvBlob(activeCsvText.value))
}
</script>

<template>
  <ModalBase title="历史清单" width="880px" @close="emit('close')">
    <div v-if="!hist.length" class="hint" style="padding:20px 0;text-align:center">暂无历史清单</div>
    <template v-else>
      <div class="tabs" style="margin-bottom:8px">
        <button v-for="h in hist" :key="h.id" class="tab" :class="{ active: active && active.id === h.id }" @click="select(h)">
          {{ h.name }}<span v-if="h.at" class="cnt">{{ String(h.at).slice(0, 10) }}</span>
        </button>
      </div>
      <div v-if="active" class="tbl-wrap" style="max-height:52vh;overflow:auto">
        <table class="tbl">
          <thead><tr><th>类别</th><th>材料名称</th><th>规格型号</th><th>单位</th><th>数量</th><th>品牌</th><th>型号</th><th>单价</th><th>合价</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in active.rows" :key="i">
              <td>{{ r.cat }}</td>
              <td><b>{{ r.name }}</b></td>
              <td class="src">{{ r.spec || '' }}</td>
              <td>{{ r.unit }}</td>
              <td>{{ r.qty }}</td>
              <td>{{ r.brand || (r.materialUnitPrice != null ? '' : '-') }}</td>
              <td class="src">{{ r.model || '' }}</td>
              <td>{{ r.unitPrice != null ? r.unitPrice : (r.materialUnitPrice != null ? r.materialUnitPrice : '-') }}</td>
              <td>{{ r.unitPrice != null && r.qty != null ? Math.round(Number(r.unitPrice) * r.qty * 100) / 100 : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <template #foot>
      <button v-if="active" class="btn btn-ghost" @click="exportCSV"><VIcon name="dl" />导出 CSV</button>
      <button v-if="active" class="btn btn-primary" @click="exportActiveXlsx"><VIcon name="dl" />导出 Excel</button>
    </template>
  </ModalBase>
</template>