<script setup>
// 价格治理：全局缺价体检 + 批量调价 + 品牌替换（一次跨库操作）
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const emit = defineEmits(['close'])
const store = useAppStore()
const { devices, devBrands, settings } = storeToRefs(store)

const tab = ref('audit')

// ---- ① 缺价体检 ----
const auditRows = computed(() => store.priceAudit())

// ---- ② 批量调价 ----
const allBrands = computed(() => {
  const set = new Set()
  Object.values(devBrands.value || {}).forEach(list => (list || []).forEach(v => { if (v.brand) set.add(v.brand) }))
  return [...set].sort()
})
const adjBrand = ref('')
const adjPct = ref(10)
const adjRound = ref(10)
const adjusting = ref(false)
async function doAdjust () {
  if (!adjPct.value) { store.toast('请输入调价百分比（如 10 表示 +10%）'); return }
  if (!adjBrand.value) { store.toast('请选择品牌'); return }
  adjusting.value = true
  const r = store.bulkAdjustPrice(adjBrand.value, Number(adjPct.value), Number(adjRound.value) || 0)
  await store.saveAll()
  adjusting.value = false
  store.toast(`已调整「${adjBrand.value}」：${r.devices} 台设备、${r.variants} 个型号单价${adjPct.value > 0 ? '上浮' : '下调'} ${Math.abs(adjPct.value)}%`)
}

// ---- ③ 品牌替换 ----
const repOld = ref('')
const repNew = ref('')
async function doReplace () {
  if (!repOld.value || !repNew.value) { store.toast('请选择原品牌与新品牌'); return }
  if (repOld.value === repNew.value) { store.toast('新旧品牌不能相同'); return }
  const r = store.replaceBrand(repOld.value, repNew.value)
  await store.saveAll()
  store.toast(`已替换：${r.moved} 个型号由「${repOld.value}」改为「${repNew.value}」`)
  repOld.value = ''
  repNew.value = ''
}
</script>

<template>
  <ModalBase title="价格治理 · 全库" width="720px" @close="emit('close')">
    <div class="tabs" style="margin-bottom:12px">
      <button class="tab" :class="{ active: tab === 'audit' }" @click="tab = 'audit'">缺价体检</button>
      <button class="tab" :class="{ active: tab === 'adjust' }" @click="tab = 'adjust'">批量调价</button>
      <button class="tab" :class="{ active: tab === 'replace' }" @click="tab = 'replace'">品牌替换</button>
    </div>

    <!-- ① 缺价体检 -->
    <div v-if="tab === 'audit'">
      <div class="hint" style="margin-bottom:8px">扫描全部设备字典，找出未配价/空品牌/有品牌无单价的型号，是报价前必做的一步。</div>
      <div v-if="auditRows.length" class="tbl-wrap" style="max-height:46vh;overflow-y:auto">
        <table class="tbl">
          <thead><tr><th>设备</th><th>子系统</th><th>品牌 / 型号</th><th>问题</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in auditRows" :key="i">
              <td><b>{{ r.device.name }}</b><div class="src">{{ r.device.spec || '' }} · {{ r.device.unit }}</div></td>
              <td><span class="badge plain">{{ r.sub }}</span></td>
              <td>{{ r.brand || '-' }} {{ r.model || '' }}</td>
              <td><span class="badge red">{{ r.msg }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="hint" style="text-align:center;padding:28px;color:var(--green)">✓ 全部设备均已配置品牌与单价，可正常报价。</div>
      <div class="hint" style="margin-top:8px">共 {{ auditRows.length }} 项待处理。可切换到「价格工作台」逐项补价，或用「批量调价 / 品牌替换」快速治理。</div>
    </div>

    <!-- ② 批量调价 -->
    <div v-else-if="tab === 'adjust'">
      <div class="form-grid">
        <div class="fitem">
          <label>目标品牌</label>
          <select v-model="adjBrand">
            <option value="" disabled>请选择品牌</option>
            <option v-for="b in allBrands" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
        <div class="fitem">
          <label>调整幅度 (%)</label>
          <input v-model.number="adjPct" type="number" step="1" placeholder="如 10 = +10%，-5 = -5%">
        </div>
        <div class="fitem">
          <label>取整到 (元)</label>
          <select v-model="adjRound">
            <option :value="10">10 元</option>
            <option :value="50">50 元</option>
            <option :value="100">100 元</option>
            <option :value="0">不取整</option>
          </select>
        </div>
      </div>
      <div class="hint" style="padding:10px 12px;background:var(--glass-1);border-radius:8px;margin:6px 0 12px">
        示例：某品牌全线涨价 8% → 选品牌、输入 8、取整到 10 → 所有项目中该品牌所有型号单价统一调整。此操作会覆写默认价格，项目选型按原金额比例同步生效。
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn-primary" :disabled="adjusting" @click="doAdjust"><VIcon name="zap" />{{ adjusting ? '调整中…' : '执行批量调价' }}</button>
      </div>
    </div>

    <!-- ③ 品牌替换 -->
    <div v-else>
      <div class="form-grid">
        <div class="fitem">
          <label>原品牌（停产 / 弃用）</label>
          <select v-model="repOld">
            <option value="" disabled>请选择原品牌</option>
            <option v-for="b in allBrands" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
        <div class="fitem">
          <label>新品牌（替换为）</label>
          <input v-model.trim="repNew" placeholder="如：海康威视">
          <div class="hint">可为已有品牌或新品牌名</div>
        </div>
      </div>
      <div class="hint" style="padding:10px 12px;background:var(--glass-1);border-radius:8px;margin:6px 0 12px">
        品牌停产/换主供时使用：把原品牌的所有型号整体换到新品牌，报价单上品牌名统一更新；单价保持不变，可在替换后再用「批量调价」统一调整。
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn-primary" @click="doReplace"><VIcon name="copy" />执行替换</button>
      </div>
    </div>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </ModalBase>
</template>