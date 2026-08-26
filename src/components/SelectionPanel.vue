<script setup>
// 选型面板：项目内每款设备的品牌型号选择（存 meta.projectSelections）
// - 每款有多型号的设备显示候选卡，点选即更新选型
// - 顶部按配置档次一键批量选型
// - 缺型号/未选型设备提示去价格工作台补
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { BUDGET_TIERS } from '../db/constants'
import { tierName } from '../db/format'
import { chainFormulaText } from '../db/calc'
import VIcon from './ui/VIcon.vue'

const props = defineProps({
  project: { type: Object, default: null },
  sub: { type: String, default: '' }
})

const store = useAppStore()
const { devices, devBrands, meta, points } = storeToRefs(store)

const curTier = ref('')
const selMap = computed(() => (meta.value.projectSelections?.[props.project?.id] || {}))

// 本系统全部设备（前端+后端），含选型状态
const rows = computed(() => {
  const frontQty = {}
  points.value.filter(x => x.项目ID === props.project?.id && x.子系统 === props.sub).forEach(x => {
    const dv = store.resolveDevice(devices.value, props.sub, x.设备类型, x['设备ID'])
    if (!dv) return
    frontQty[dv.id] = (frontQty[dv.id] || 0) + (Number(x.数量) || 0)
  })
  return devices.value
    .filter(d => d.subsystem === props.sub && d.status !== '归档')
    .map(d => {
      const variants = (devBrands.value[d.id] || []).filter(v => v.brand)
      const sel = selMap.value[d.id]
      const current = sel ? { brand: sel.brand, model: sel.model, tier: tierName(sel.tier), param: sel.param, unitPrice: Number(sel.unitPrice) || null } : null
      return {
        device: d,
        variants,
        frontQty: frontQty[d.id] || 0,
        current,
        selectedId: sel ? ((devBrands.value[d.id] || []).findIndex(v => v.brand === sel.brand && (v.model || '') === (sel.model || '')) >= 0 ? devBrands.value[d.id][(devBrands.value[d.id] || []).findIndex(v => v.brand === sel.brand && (v.model || '') === (sel.model || ''))].id : null) : null
      }
    })
})

function isSelected (r, v) {
  return r.current && r.current.brand === v.brand && (r.current.model || '') === (v.model || '')
}
async function pick (r, v) {
  store.setProjectSelection(props.project.id, r.device.id, { brand: v.brand, model: v.model, tier: v.tier, param: v.param, unitPrice: v.unitPrice })
  await store.saveAll()
  store.toast(`已为「${r.device.name}」选型：${v.brand} ${v.model}（¥${v.unitPrice}）`)
}
async function useDefault (r) {
  store.setProjectSelection(props.project.id, r.device.id, null)
  await store.saveAll()
  store.toast(`「${r.device.name}」已恢复默认第 1 个型号`)
}

const tiers = BUDGET_TIERS
async function bulkByTier (t) {
  curTier.value = t.name
  const n = store.bulkSelectionByTier(props.project.id, props.sub, t.name)
  await store.saveAll()
  store.toast(n ? `已按「${t.name}」批量选型 ${n} 台设备` : '该档次无匹配型号，已取各设备默认型号')
}

const hasFrontQty = computed(() => rows.value.some(r => r.frontQty > 0))
</script>

<template>
  <div class="sel-panel">
    <div class="card">
      <div class="card-title">选型面板 · {{ sub }} <span class="sub">按品牌型号选择，清单/报价据此计算</span></div>

      <div class="tier-bar">
        <span class="tier-hint">按档次批量选型：</span>
        <button v-for="t in tiers" :key="t.id" class="btn btn-ghost btn-sm" :class="{ on: curTier === t.name }" @click="bulkByTier(t)">
          <VIcon name="zap" :size="14" />{{ t.name }}</button>
        <span class="tier-sub">无匹配档时自动取默认型号</span>
      </div>

      <div v-for="r in rows" :key="r.device.id" class="sel-item" :class="{ front: r.device.category === '前端设备' }">
        <div class="sel-head">
          <span class="sel-dev">
            <b>{{ r.device.name }}</b>
            <span v-if="r.device.spec" class="src">{{ r.device.spec }}</span>
          </span>
          <span class="sel-qty">{{ r.frontQty }} 台</span>
          <span v-if="r.current" class="sel-cur">已选：{{ r.current.brand }} {{ r.current.model }} · ¥{{ r.current.unitPrice }}</span>
          <span v-else class="sel-un">默认型号</span>
        </div>
        <div v-if="r.variants.length" class="sel-opts">
          <div v-for="v in r.variants" :key="v.id" class="opt" :class="{ on: isSelected(r, v) }" @click="pick(r, v)">
            <div class="o-top"><span class="o-brand">{{ v.brand }}</span><span class="o-tier">{{ tierName(v.tier) }}</span></div>
            <div class="o-model">{{ v.model || '—' }}</div>
            <div class="o-meta">{{ v.param || '' }}</div>
            <div class="o-price">{{ v.unitPrice != null ? '¥' + Number(v.unitPrice).toLocaleString('zh-CN') : '缺价' }}</div>
          </div>
          <button class="btn btn-icon btn-sm" title="恢复默认第1个型号" @click="useDefault(r)"><VIcon name="x" :size="13" /></button>
        </div>
        <div v-else class="sel-none">
          <VIcon name="alert" :size="14" /> 未配置品牌型号，请到「资料库 → 价格工作台」为该设备补型号
        </div>
      </div>

      <div v-if="!hasFrontQty" class="hint" style="margin-top:10px">提示：以下设备暂未被本项目使用（点位为 0），选型仍会保存，供后续项目引用。</div>
    </div>
  </div>
</template>

<style scoped>
.tier-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--glass-1);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px}
.tier-hint{font-size:12.5px;color:var(--text3);font-weight:600}
.tier-bar .btn.on{background:var(--primary);color:#fff}
.tier-sub{font-size:11.5px;color:var(--text3);margin-left:auto}
.sel-item{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--glass-1)}
.sel-item.front{border-left:3px solid var(--accent)}
.sel-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.sel-dev{font-size:14px;display:flex;align-items:baseline;gap:6px}
.sel-dev .src{color:var(--text3);font-weight:400;font-size:12px}
.sel-qty{font-size:12px;color:var(--accent);background:var(--green-l);border:1px solid var(--green-line);border-radius:999px;padding:2px 10px;font-weight:700}
.sel-cur{font-size:12px;color:var(--green);margin-left:auto}
.sel-un{font-size:12px;color:var(--text3);margin-left:auto}
.sel-opts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.opt{flex:1;min-width:150px;max-width:210px;border:1px solid var(--line2);border-radius:10px;padding:10px 12px;cursor:pointer;background:var(--card2);transition:all .15s}
.opt:hover{border-color:var(--orange);transform:translateY(-1px)}
.opt.on{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary), 0 4px 14px rgba(106,95,193,.25)}
.opt.on .o-brand,.opt.on .o-price{color:var(--primary)}
.o-top{display:flex;align-items:center;justify-content:space-between;gap:6px}
.o-brand{font-weight:700;font-size:13px}
.o-tier{font-size:11px;color:var(--text3);background:var(--glass-1);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.o-model{font-size:12.5px;color:var(--text2);margin-top:3px;font-family:var(--mono)}
.o-meta{font-size:11px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o-price{font-size:13px;font-weight:700;margin-top:4px;font-family:var(--mono)}
.sel-none{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--red);padding:8px 0}
.sel-none svg{flex-shrink:0}
.sel-item .btn-icon{width:30px;height:30px;min-height:30px;color:var(--text3)}
</style>