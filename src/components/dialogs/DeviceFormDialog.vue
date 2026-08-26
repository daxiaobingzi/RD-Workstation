<script setup>
// 添加 / 编辑设备字典：基础信息 + 单点定额 + 配比规则 + 品牌与价格
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { BUDGET_TIERS } from '../../db/constants'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  device: { type: Object, default: null },
  subsystem: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { devices, settings, devSort, devBrands } = storeToRefs(store)
const isNew = computed(() => !props.device)
const sub = props.device?.subsystem || props.subsystem

const f = reactive({
  name: props.device?.name || '',
  spec: props.device?.spec || '',
  unit: props.device?.unit || '台',
  category: props.device?.category || '前端设备'
})

const quotaRows = ref(JSON.parse(JSON.stringify(props.device?.quota || [])))
const ratio = reactive({ type: props.device?.ratio?.type || 'point', per: props.device?.ratio?.per || 1, qty: props.device?.ratio?.qty || 1, target: props.device?.ratio?.target || '*' })

const frontDevs = computed(() => devices.value.filter(d => d.category === '前端设备' && d.id !== props.device?.id))
const brands = ref(JSON.parse(JSON.stringify(store.devBrands[props.device?.id] || [])))

function addQuotaRow () { quotaRows.value.push({ name: '', spec: '', unit: 'm', per: 1, cat: '管材线缆' }) }
function delQuotaRow (i) { quotaRows.value.splice(i, 1) }
function addBrandRow () { brands.value.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), brand: '', model: '', param: '', unitPrice: '', tier: '标准型' }) }
function delBrandRow (i) { brands.value.splice(i, 1) }

async function save () {
  const name = f.name.trim()
  if (!name) { store.toast('请填写设备名称'); return }

  const quota = quotaRows.value.map(m => ({ name: m.name.trim(), spec: m.spec.trim(), unit: m.unit.trim() || 'm', per: parseFloat(m.per) || 0, cat: m.cat })).filter(m => m.name)

  let ratioObj = null
  if (ratio.type === 'point') ratioObj = { type: 'point' }
  else if (ratio.type === 'ratio') ratioObj = { type: 'ratio', per: parseInt(ratio.per) || 1, target: ratio.target || '*' }
  else if (ratio.type === 'fixed') ratioObj = { type: 'fixed', qty: parseInt(ratio.qty) || 1 }

  let d = props.device
  if (isNew.value) {
    d = store.addDevice({ subsystem: sub, name, spec: f.spec.trim(), unit: f.unit.trim() || '台', category: f.category, quota, ratio: ratioObj })
    // 新设备排到该子系统末尾
    const tail = devices.value.filter(x => x.subsystem === sub).length
    store.devSort[d.id] = tail
  } else {
    store.saveDevice(d, { name, spec: f.spec.trim(), unit: f.unit.trim() || '台', category: f.category, quota, ratio: ratioObj })
  }

  // 品牌价格
  const clean = brands.value.map(b => ({
    brand: b.brand.trim(), model: b.model.trim(), param: b.param.trim(),
    unitPrice: b.unitPrice !== '' && b.unitPrice != null ? Number(b.unitPrice) : null,
    tier: b.tier || '标准型'
  })).filter(b => b.brand)
  if (clean.length) {
    const seen = new Set()
    for (const b of clean) {
      const key = b.brand + '|' + b.model
      if (seen.has(key)) { store.toast('品牌 + 型号必须唯一：' + b.brand + ' / ' + b.model); return }
      seen.add(key)
    }
  }
  store.devBrands[d.id] = clean.map(c => ({ id: 'bm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...c }))

  await store.saveAll()
  emit('close')
  store.toast(isNew.value ? '设备已添加' : '设备已保存')
}
</script>

<template>
  <ModalBase :title="(isNew ? '添加设备' : '编辑设备') + ' · ' + sub" @close="emit('close')">
    <div class="form-grid">
      <div class="fitem"><label>设备名称 *</label><input v-model.trim="f.name" placeholder="如：网络摄像机(枪式)"></div>
      <div class="fitem"><label>规格型号</label><input v-model.trim="f.spec" placeholder="如：200万像素"></div>
      <div class="fitem"><label>单位</label><input v-model.trim="f.unit"></div>
      <div class="fitem"><label>类别</label>
        <select v-model="f.category">
          <option>前端设备</option><option>后端设备</option><option>管材线缆</option><option>辅材</option>
        </select>
      </div>
    </div>

    <div class="card-title" style="margin-top:8px">单点定额 <span class="sub">每台设备消耗的材料（前端设备填写，用于推算管材线缆/辅材）</span></div>
    <div class="tbl-wrap">
      <table class="tbl" style="min-width:560px">
        <thead><tr><th>材料名称</th><th>规格</th><th>单位</th><th>每点用量</th><th>类别</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!quotaRows.length"><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">暂无定额材料</td></tr>
          <tr v-for="(m, i) in quotaRows" :key="i">
            <td><input v-model.trim="m.name" placeholder="材料名" style="min-width:110px"></td>
            <td><input v-model.trim="m.spec" placeholder="规格" style="min-width:90px"></td>
            <td><input v-model.trim="m.unit" style="width:56px"></td>
            <td><input v-model.number="m.per" type="number" min="0" step="0.1" style="width:72px"></td>
            <td><select v-model="m.cat"><option>管材线缆</option><option>辅材</option></select></td>
            <td><button class="btn btn-icon btn-sm del" @click="delQuotaRow(i)" style="color:var(--text3)"><VIcon name="trash" :size="15" /></button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:8px" @click="addQuotaRow"><VIcon name="plus" />添加定额材料</button>

    <div class="card-title" style="margin-top:14px">品牌与价格 <span class="sub">一行=品牌+型号+配置档次+参数+单价</span></div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th>品牌</th><th>型号</th><th>配置档次</th><th>参数</th><th>单价(元)</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(b, i) in brands" :key="b.id">
            <td><input v-model.trim="b.brand" style="min-width:90px"></td>
            <td><input v-model.trim="b.model" style="min-width:110px"></td>
            <td><select v-model="b.tier"><option v-for="t in BUDGET_TIERS" :key="t.id" :value="t.name">{{ t.name }}</option></select></td>
            <td><input v-model.trim="b.param" style="min-width:80px"></td>
            <td><input v-model.number="b.unitPrice" type="number" min="0" step="0.01" style="width:96px"></td>
            <td><button class="btn btn-icon btn-sm del" @click="delBrandRow(i)" style="color:var(--text3)"><VIcon name="trash" :size="15" /></button></td>
          </tr>
          <tr v-if="!brands.length"><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">暂无品牌型号，可点击下方「添加品牌」</td></tr>
        </tbody>
      </table>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:8px" @click="addBrandRow"><VIcon name="plus" />添加品牌</button>

    <div class="form-grid" style="margin-top:10px">
      <div class="fitem" style="grid-column:1/-1">
        <label>配比规则 <span style="color:var(--text3);font-weight:400">决定施工清单中该设备/材料的数量来源</span></label>
        <select v-model="ratio.type">
          <option value="point">前端设备 / 点数（手填，不推算）</option>
          <option value="ratio">按配比 1/N</option>
          <option value="fixed">固定值</option>
        </select>
      </div>
      <div v-if="ratio.type === 'ratio'" class="fitem">
        <label>每 N 台前端设备配 1 台</label>
        <input v-model.number="ratio.per" type="number" min="1" step="1">
      </div>
      <div v-if="ratio.type === 'fixed'" class="fitem">
        <label>固定数量</label>
        <input v-model.number="ratio.qty" type="number" min="1" step="1">
      </div>
      <div v-if="ratio.type === 'ratio'" class="fitem">
        <label>关联前端设备</label>
        <select v-model="ratio.target" style="width:100%">
          <option value="*">全部前端设备（*）</option>
          <option v-for="d in frontDevs" :key="d.id" :value="d.id">{{ d.name }}{{ d.spec ? '（' + d.spec + '）' : '' }}</option>
        </select>
        <div class="hint">选择参与计算的前端设备；「全部」= 所有前端设备按数量合计</div>
      </div>
    </div>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>