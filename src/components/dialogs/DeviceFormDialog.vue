<script setup>
// 添加 / 编辑设备字典：基础信息 + 单点定额 + 数量来源规则 + 品牌与价格
// 数量来源规则保存于设备字典，全局共享：项目引用即自动套用（无需逐项目重配）
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

// 链式承载配置（承载能力可自定义：承接谁 + 每台承载多少 + 系数/预留/取整）
const srcChain = props.device?.chain || props.device?.ratio || null
const chain = reactive({
  // 新建设备：类别选“后端设备”时默认展开规则区，引导一次性配置
  enabled: !!props.device?.chain || !!props.device?.ratio || (isNew.value && f.category === '后端设备'),
  mode: srcChain?.mode || srcChain?.type || 'carry', // carry | mul | fixed
  capacity: srcChain ? (Number(srcChain.capacity) || (srcChain.type === 'ratio' ? Number(srcChain.per) || 1 : srcChain.type === 'fixed' ? Number(srcChain.qty) || 1 : 1)) : 1,
  source: srcChain?.source || (srcChain?.targetDeviceId) || (srcChain?.target && srcChain.target !== '*' ? srcChain.target : 'front') || 'front',
  factor: srcChain?.factor != null ? Number(srcChain.factor) : 1,
  reserve: srcChain?.reserve != null ? Number(srcChain.reserve) : 0,
  round: srcChain?.round || 'ceil'
})

// 本系统可作为承接来源的设备（前端 + 后端，链式）
const sameSubDevs = computed(() => devices.value.filter(d => d.subsystem === sub && d.id !== props.device?.id && d.status !== '归档'))
const frontDevs = computed(() => sameSubDevs.value.filter(d => d.category === '前端设备'))
const backDevs = computed(() => sameSubDevs.value.filter(d => d.category === '后端设备'))
const chainSrcName = computed(() => {
  if (chain.source === 'front') return '前端设备合计'
  const d = devices.value.find(x => x.id === chain.source)
  return d ? d.name : '?'
})
const brands = ref(JSON.parse(JSON.stringify(store.devBrands[props.device?.id] || [])))

function addQuotaRow () { quotaRows.value.push({ name: '', spec: '', unit: 'm', per: 1, cat: '管材线缆' }) }
function delQuotaRow (i) { quotaRows.value.splice(i, 1) }
function addBrandRow () { brands.value.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), brand: '', model: '', param: '', unitPrice: '', tier: '标准型' }) }
function delBrandRow (i) { brands.value.splice(i, 1) }

async function save () {
  const name = f.name.trim()
  if (!name) { store.toast('请填写设备名称'); return }

  const quota = quotaRows.value.map(m => ({ name: m.name.trim(), spec: m.spec.trim(), unit: m.unit.trim() || 'm', per: parseFloat(m.per) || 0, cat: m.cat })).filter(m => m.name)

  let chainObj = null
  if (chain.enabled && f.category !== '前端设备') {
    if (chain.mode === 'fixed') {
      chainObj = { mode: 'fixed', capacity: Math.max(1, parseInt(chain.capacity) || 1) }
    } else {
      chainObj = {
        mode: chain.mode === 'mul' ? 'mul' : 'carry',
        capacity: Math.max(1, parseInt(chain.capacity) || 1),
        source: chain.source || 'front',
        factor: parseFloat(chain.factor) || 1,
        reserve: parseInt(chain.reserve) || 0,
        round: chain.round || 'ceil'
      }
    }
  }

  let d = props.device
  if (isNew.value) {
    d = store.addDevice({ subsystem: sub, name, spec: f.spec.trim(), unit: f.unit.trim() || '台', category: f.category, quota, chain: chainObj, ratio: chainObj ? { type: chainObj.mode === 'fixed' ? 'fixed' : 'ratio', per: chainObj.capacity, qty: chainObj.mode === 'fixed' ? chainObj.capacity : undefined, target: chainObj.source && chainObj.source !== 'front' ? (devices.value.find(x => x.id === chainObj.source)?.name || '*') : '*' } : null })
    // 新设备排到该子系统末尾
    const tail = devices.value.filter(x => x.subsystem === sub).length
    store.devSort[d.id] = tail
  } else {
    store.saveDevice(d, { name, spec: f.spec.trim(), unit: f.unit.trim() || '台', category: f.category, quota, chain: chainObj, ratio: chainObj ? { type: chainObj.mode === 'fixed' ? 'fixed' : 'ratio', per: chainObj.capacity, qty: chainObj.mode === 'fixed' ? chainObj.capacity : undefined, target: chainObj.source && chainObj.source !== 'front' ? (devices.value.find(x => x.id === chainObj.source)?.name || '*') : '*' } : null })
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
        <label>
          <span style="display:inline-flex;align-items:center;gap:8px">
            <input type="checkbox" v-model="chain.enabled" :disabled="f.category === '前端设备'">
            数量来源规则 <span style="color:var(--text3);font-weight:400">存于设备字典，项目中自动套用（无需每个项目重配）</span>
          </span>
        </label>
        <div v-if="isNew && f.category === '后端设备' && !srcChain" class="rule-tip">「后端设备」支持自动推算数量：建议在此一并配置规则（如每 32 台前端配 1 台 NVR、每 1 台 NVR 配 2 块硬盘），否则项目中需手填数量。</div>
      </div>

      <template v-if="chain.enabled && f.category !== '前端设备'">
        <div class="fitem">
          <label>数量随 … 变化（承接来源）</label>
          <select v-model="chain.source" style="width:100%">
            <option value="front">前端设备合计（本系统全部前端）</option>
            <optgroup label="—— 指定前端设备 ——">
              <option v-for="d in frontDevs" :key="d.id" :value="d.id">{{ d.name }}{{ d.spec ? '（' + d.spec + '）' : '' }}</option>
            </optgroup>
            <optgroup label="—— 指定后端设备（链式承接）——">
              <option v-for="d in backDevs" :key="d.id" :value="d.id">{{ d.name }}{{ d.spec ? '（' + d.spec + '）' : '' }}</option>
            </optgroup>
            <option v-if="!sameSubDevs.length" disabled>（本系统暂无其他设备）</option>
          </select>
          <div class="hint">示例：硬盘数量随 NVR（后端）变化 → 选「指定后端设备：NVR」</div>
        </div>
        <div class="fitem">
          <label>推算方式</label>
          <select v-model="chain.mode">
            <option value="carry">{{ chainSrcName }}每 N 台 → 1 台本设备（承载）</option>
            <option value="mul">{{ chainSrcName }} 数量 × N（倍数）</option>
            <option value="fixed">固定值（不随其他设备变化）</option>
          </select>
        </div>
        <div v-if="chain.mode === 'carry' || chain.mode === 'mul'" class="fitem">
          <label>{{ chain.mode === 'carry' ? '每台承接 N 台' : '倍数 N' }}</label>
          <input v-model.number="chain.capacity" type="number" min="1" step="1">
        </div>
        <div v-if="chain.mode === 'fixed'" class="fitem">
          <label>固定数量</label>
          <input v-model.number="chain.capacity" type="number" min="1" step="1">
        </div>
        <div v-if="chain.mode === 'carry'" class="fitem">
          <label>冗余系数（不填=1）</label>
          <input v-model.number="chain.factor" type="number" min="1" step="0.05">
        </div>
        <div v-if="chain.mode === 'carry'" class="fitem">
          <label>预留备件（台）</label>
          <input v-model.number="chain.reserve" type="number" min="0" step="1">
        </div>
        <div v-if="chain.mode === 'carry'" class="fitem">
          <label>取整方式</label>
          <select v-model="chain.round">
            <option value="ceil">向上取整（推荐）</option>
            <option value="floor">向下取整</option>
          </select>
        </div>
        <div class="fitem" style="grid-column:1/-1">
          <div class="rule-prev">数量 = <template v-if="chain.mode === 'fixed'">固定 {{ chain.capacity }}</template><template v-else-if="chain.mode === 'mul'">{{ chainSrcName }} × {{ chain.capacity }}<template v-if="chain.factor !== 1"> × {{ chain.factor }}</template></template><template v-else>({{ chain.round === 'floor' ? '↓' : '↑' }}){{ chainSrcName }} ÷ {{ chain.capacity }}<template v-if="chain.factor !== 1"> × {{ chain.factor }}</template><template v-if="chain.reserve"> + {{ chain.reserve }}</template></template></div>
        </div>
      </template>
    </div>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>

<style scoped>
.rule-tip{font-size:12.5px;color:var(--green-ink);background:var(--green-l);border:1px solid var(--green-line);border-radius:10px;padding:8px 12px;line-height:1.6;margin-top:6px}
.rule-prev{font-family:var(--mono);font-size:13px;color:var(--text2);background:var(--glass-1);padding:8px 12px;border-radius:8px;border:1px dashed var(--line2)}
</style>