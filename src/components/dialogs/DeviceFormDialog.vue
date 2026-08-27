<script setup>
// 添加 / 编辑设备字典：基础信息 + 单点定额 + 数量来源规则 + 品牌与价格
// 数量来源规则保存于设备字典，全局共享：项目引用即自动套用（无需逐项目重配）
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { BUDGET_TIERS } from '../../db/constants'
import { findMaterialPrice, buildChainObj } from '../../db/calc'
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

// 本系统可作为承接来源的设备（前端 + 后端，链式）
const sameSubDevs = computed(() => devices.value.filter(d => d.subsystem === sub && d.id !== props.device?.id && d.status !== '归档'))
const frontDevs = computed(() => sameSubDevs.value.filter(d => d.category === '前端设备'))
const backDevs = computed(() => sameSubDevs.value.filter(d => d.category === '后端设备'))

const chain = reactive({
  // 新建设备：类别选“后端设备”时默认展开规则区，引导一次性配置
  enabled: !!props.device?.chain || !!props.device?.ratio || (isNew.value && f.category === '后端设备'),
  mode: srcChain?.mode || srcChain?.type || 'carry', // carry | mul | fixed
  capacity: srcChain ? (Number(srcChain.capacity) || (srcChain.type === 'ratio' ? Number(srcChain.per) || 1 : srcChain.type === 'fixed' ? Number(srcChain.qty) || 1 : 1)) : 1,
  srcKind: (srcChain?.sources && srcChain.sources.length) || (srcChain?.source && srcChain.source !== 'front') ? 'multi' : 'front',
  sources: (srcChain?.sources || (srcChain?.source && srcChain.source !== 'front' ? [srcChain.source] : [])).slice(),
  factor: srcChain?.factor != null ? Number(srcChain.factor) : 1,
  reserve: srcChain?.reserve != null ? Number(srcChain.reserve) : 0,
  round: srcChain?.round || 'ceil'
})
function toggleSrc (id) {
  const i = chain.sources.indexOf(id)
  if (i >= 0) chain.sources.splice(i, 1)
  else chain.sources.push(id)
  chain.srcKind = chain.sources.length ? 'multi' : 'front'
}
function setFrontAll () { chain.srcKind = 'front'; chain.sources = [] }
const chainSrcName = computed(() => {
  if (chain.srcKind === 'front' || !chain.sources.length) return '前端设备合计'
  return chain.sources.map(id => { const d = devices.value.find(x => x.id === id); return d ? d.name : '?' }).join('+')
})
const brands = ref(JSON.parse(JSON.stringify(store.devBrands[props.device?.id] || [])))

// 材料价格联动：名称/规格/单位 匹配系统配置中的材料价格（默认品牌国产、型号国产优质）
const mpNames = computed(() => {
  const list = store.settings.materialPrices || []
  return Array.isArray(list) ? [...new Set(list.map(m => m.name).filter(Boolean))].sort() : []
})
function matPriceOf (m) {
  const entry = findMaterialPrice(store.settings, m.name, m.spec, m.unit)
  return entry || null
}

function addQuotaRow () { quotaRows.value.push({ name: '', spec: '', unit: 'm', per: 1, cat: '管材线缆', mpId: null }) }
function delQuotaRow (i) { quotaRows.value.splice(i, 1) }
function addBrandRow () { brands.value.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), brand: '', model: '', param: '', unitPrice: '', tier: '标准型' }) }
function delBrandRow (i) { brands.value.splice(i, 1) }

async function save () {
  const name = f.name.trim()
  if (!name) { store.toast('请填写设备名称'); return }

  const quota = quotaRows.value.map(m => {
    const entry = findMaterialPrice(store.settings, m.name.trim(), m.spec.trim(), m.unit.trim() || 'm')
    return { name: m.name.trim(), spec: m.spec.trim(), unit: m.unit.trim() || 'm', per: parseFloat(m.per) || 0, cat: m.cat, mpId: entry ? entry.id : null }
  }).filter(m => m.name)

  let chainObj = null
  if (chain.enabled && f.category !== '前端设备') {
    chainObj = buildChainObj({
      mode: chain.mode, capacity: chain.capacity, srcKind: chain.srcKind,
      sources: chain.sources, factor: chain.factor, reserve: chain.reserve, round: chain.round
    })
  }

  const ratioTarget = '*'
  let d = props.device
  if (isNew.value) {
    d = store.addDevice({ subsystem: sub, name, spec: f.spec.trim(), unit: f.unit.trim() || '台', category: f.category, quota, chain: chainObj, ratio: chainObj ? { type: chainObj.mode === 'fixed' ? 'fixed' : 'ratio', per: chainObj.capacity, qty: chainObj.mode === 'fixed' ? chainObj.capacity : undefined, target: ratioTarget } : null })
    // 新设备排到该子系统末尾
    const tail = devices.value.filter(x => x.subsystem === sub).length
    store.devSort[d.id] = tail
  } else {
    store.saveDevice(d, { name, spec: f.spec.trim(), unit: f.unit.trim() || '台', category: f.category, quota, chain: chainObj, ratio: chainObj ? { type: chainObj.mode === 'fixed' ? 'fixed' : 'ratio', per: chainObj.capacity, qty: chainObj.mode === 'fixed' ? chainObj.capacity : undefined, target: ratioTarget } : null })
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
      <div class="fitem"><label>规格型号</label><textarea v-model.trim="f.spec" rows="2" placeholder="多行文字，如：200万像素&#10;星光级红外50m"></textarea></div>
      <div class="fitem"><label>单位</label><input v-model.trim="f.unit"></div>
      <div class="fitem"><label>类别</label>
        <select v-model="f.category">
          <option>前端设备</option><option>后端设备</option><option>管材线缆</option><option>辅材</option>
        </select>
      </div>
    </div>

    <div class="card-title" style="margin-top:8px">单点定额 <span class="sub">每台设备消耗的材料（前端设备填写）；名称/规格/单位自动联动「系统配置 → 材料价格」</span></div>
    <div class="tbl-wrap">
      <table class="tbl" style="min-width:720px">
        <thead><tr><th>材料名称</th><th>规格</th><th>单位</th><th>每点用量</th><th>类别</th><th>材料价格(元)</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!quotaRows.length"><td colspan="7" style="text-align:center;color:var(--text3);padding:16px">暂无定额材料</td></tr>
          <tr v-for="(m, i) in quotaRows" :key="i">
            <td><input v-model.trim="m.name" list="mp-names" placeholder="材料名" style="min-width:110px"></td>
            <td><textarea v-model.trim="m.spec" rows="2" placeholder="规格（多行）" style="min-width:90px"></textarea></td>
            <td><input v-model.trim="m.unit" style="width:56px"></td>
            <td><input v-model.number="m.per" type="number" min="0" step="0.1" style="width:72px"></td>
            <td><select v-model="m.cat"><option>管材线缆</option><option>辅材</option></select></td>
            <td>
              <template v-if="matPriceOf(m)">
                <span class="mp-linked" :title="'品牌 ' + (matPriceOf(m).brand || '') + ' · 型号 ' + (matPriceOf(m).model || '')">¥{{ matPriceOf(m).price ?? '—' }}<span class="mp-bm">{{ matPriceOf(m).brand }} / {{ matPriceOf(m).model }}</span></span>
              </template>
              <span v-else class="mp-none" title="系统配置中无对应材料价格，保存后清单将无价">未定价</span>
            </td>
            <td><button class="btn btn-icon btn-sm del" @click="delQuotaRow(i)" style="color:var(--text3)"><VIcon name="trash" :size="15" /></button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:8px" @click="addQuotaRow"><VIcon name="plus" />添加定额材料</button>
    <datalist id="mp-names"><option v-for="n in mpNames" :key="n" :value="n">{{ n }}</option></datalist>

    <div class="card-title" style="margin-top:14px">品牌与价格 <span class="sub">一行=品牌+型号+配置档次+参数+单价</span></div>
    <div class="hint" style="margin-bottom:8px">与「价格工作台」共用同一份数据：此处保存的信息在价格工作台「{{ sub }}」对应设备分组下同步可见、可继续维护。</div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th>品牌</th><th>型号</th><th>配置档次</th><th>参数</th><th>单价(元)</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(b, i) in brands" :key="b.id">
            <td><input v-model.trim="b.brand" style="min-width:90px"></td>
            <td><input v-model.trim="b.model" style="min-width:110px"></td>
            <td><select v-model="b.tier"><option v-for="t in BUDGET_TIERS" :key="t.id" :value="t.name">{{ t.name }}</option></select></td>
            <td><textarea v-model.trim="b.param" rows="2" placeholder="参数（多行）" style="min-width:80px"></textarea></td>
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
        <div v-if="isNew && f.category === '后端设备' && !srcChain" class="rule-tip">「后端设备」可配置数量来源规则实现自动推算；规则存于设备字典，项目中自动套用。</div>
      </div>

      <template v-if="chain.enabled && f.category !== '前端设备'">
        <div class="fitem" style="grid-column:1/-1">
          <label>数量随 … 变化（可多选设备组合求和）</label>
          <div class="src-row">
            <button type="button" class="pick-pill" :class="{ on: chain.srcKind === 'front' || !chain.sources.length }" @click="setFrontAll">前端设备合计</button>
            <button type="button" class="pick-pill" :class="{ on: chain.srcKind === 'multi' && chain.sources.length }" @click="chain.srcKind = 'multi'">自定义勾选</button>
          </div>
          <div v-if="chain.srcKind === 'multi'" class="pick-box">
            <div class="pick-group">
              <div class="pick-group-t">前端设备</div>
              <label v-for="d in frontDevs" :key="d.id" class="pick-check" :class="{ on: chain.sources.indexOf(d.id) >= 0 }">
                <input type="checkbox" :checked="chain.sources.indexOf(d.id) >= 0" @change="toggleSrc(d.id)">{{ d.name }}
              </label>
            </div>
            <div class="pick-group">
              <div class="pick-group-t">后端设备（链式承接）</div>
              <label v-for="d in backDevs" :key="d.id" class="pick-check" :class="{ on: chain.sources.indexOf(d.id) >= 0 }">
                <input type="checkbox" :checked="chain.sources.indexOf(d.id) >= 0" @change="toggleSrc(d.id)">{{ d.name }}
              </label>
            </div>
          </div>
          <div class="hint">勾选多台 = 按所选数量求和推算本设备；不勾选 = 全部前端合计。</div>
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
.src-row{display:flex;gap:8px;margin-bottom:8px}
.pick-pill{padding:6px 14px;border-radius:999px;border:1px solid var(--line2);font-size:12.5px;cursor:pointer;color:var(--text2);background:var(--glass-1);display:inline-flex;align-items:center;gap:6px}
.pick-pill.on{border-color:var(--accent);color:var(--on-primary);background:var(--accent)}
.pick-box{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--glass-1)}
.pick-group{display:flex;flex-direction:column;gap:4px}
.pick-group-t{font-size:11.5px;color:var(--text3);font-weight:600;margin-bottom:2px}
.pick-check{display:flex;align-items:center;gap:6px;font-size:12.5px;padding:3px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pick-check input{width:auto;margin:0}
.pick-check.on{background:var(--primary-l)}
.mp-linked{display:inline-flex;flex-direction:column;gap:2px;font-family:var(--mono);font-size:12.5px;color:var(--green);cursor:help}
.mp-linked .mp-bm{font-size:11px;color:var(--text3);font-family:var(--font-body);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-none{font-size:12px;color:var(--amber);cursor:help}
textarea{resize:vertical;min-height:34px}
</style>