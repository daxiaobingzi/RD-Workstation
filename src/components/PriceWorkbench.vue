<script setup>
// 价格工作台：按子系统整页批量编辑设备品牌/型号/档次/单价，支持 Excel 粘贴导入
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { BUDGET_TIERS } from '../db/constants'
import { openDialog, confirmBox } from '../composables/ui'
import ModalBase from './ui/ModalBase.vue'
import VIcon from './ui/VIcon.vue'

const props = defineProps({
  dbSub: { type: String, default: '' }
})

const store = useAppStore()
const { devices, devBrands } = storeToRefs(store)

// [{ devId, devName, devSpec, devUnit, devCat, key, brand, model, tier, param, unitPrice }]
const rows = ref([])

function rebuild () {
  rows.value = []
  devices.value
    .filter(d => d.subsystem === props.dbSub && d.status !== '归档')
    .forEach(d => {
      const variants = store.devBrands[d.id] || []
      if (!variants.length) {
        rows.value.push(emptyRow(d))
      } else {
        variants.forEach(v => rows.value.push({
          devId: d.id, devName: d.name, devSpec: d.spec || '', devUnit: d.unit, devCat: d.category,
          key: v.id || mkKey(), brand: v.brand || '', model: v.model || '', tier: v.tier || '标准型',
          param: v.param || '', unitPrice: v.unitPrice != null ? v.unitPrice : ''
        }))
      }
    })
}
function emptyRow (d) {
  return { devId: d.id, devName: d.name, devSpec: d.spec || '', devUnit: d.unit, devCat: d.category, key: mkKey(), brand: '', model: '', tier: '标准型', param: '', unitPrice: '' }
}
function mkKey () { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

watch(() => props.dbSub, rebuild, { immediate: true })

// 每台设备至少保留一行（品牌型号可多行）
function addVariant (devId) {
  const d = devices.value.find(x => x.id === devId)
  if (d) rows.value.push(emptyRow(d))
}
function removeRow (i) {
  rows.value.splice(i, 1)
}

// 有效性
const stats = computed(() => {
  const total = rows.value.length
  const priced = rows.value.filter(r => r.brand && r.unitPrice !== '' && r.unitPrice != null).length
  const noBrand = rows.value.filter(r => !r.brand.trim()).length
  return { total, priced, noBrand }
})

function unitsText () {
  return `共 ${stats.value.total} 行 · 已配价 ${stats.value.priced} 行${stats.value.noBrand ? ' · 空品牌 ' + stats.value.noBrand + ' 行（保存时忽略）' : ''}`
}

async function save () {
  const map = {}
  rows.value.forEach(r => {
    if (!r.brand.trim() && !r.model.trim()) return // 整行空白跳过
    const list = map[r.devId] || (map[r.devId] = [])
    list.push({
      id: r.key.startsWith('r') ? undefined : r.key,
      brand: r.brand.trim(), model: r.model.trim(), tier: r.tier || '标准型',
      param: r.param.trim(), unitPrice: r.unitPrice !== '' && r.unitPrice != null ? Number(r.unitPrice) : null
    })
  })
  // 品牌+型号唯一性校验（同设备下）
  for (const did of Object.keys(map)) {
    const seen = new Set()
    for (const v of map[did]) {
      if (!v.brand) continue
      const key = v.brand + '|' + v.model
      if (seen.has(key)) { store.toast(`品牌+型号重复：${rName(did)} → ${v.brand} ${v.model}`); return }
      seen.add(key)
    }
  }
  const next = { ...store.devBrands }
  const devicesInSub = devices.value.filter(d => d.subsystem === props.dbSub)
  devicesInSub.forEach(d => {
    if (map[d.id]) {
      next[d.id] = map[d.id].map(v => ({ ...v, id: v.id || 'bm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }))
    } else if (next[d.id] !== undefined) {
      delete next[d.id]
    }
  })
  store.devBrands = next
  await store.saveAll()
  const added = devicesInSub.filter(d => map[d.id]).length
  store.toast(`价格已保存：${added} 台设备更新品牌价格`)
}
function rName (did) {
  const d = devices.value.find(x => x.id === did)
  return d ? d.name : did
}

// ---------- Excel 粘贴导入 ----------
function openPaste () {
  openDialog(PasteDialog, {
    onDone: (res) => {
      if (!res) return
      if (res.added || res.updated) { store.toast(`粘贴导入：新增 ${res.added} 行，更新 ${res.updated} 行${res.skipped.length ? '，跳过 ' + res.skipped.length + ' 个未知设备' : ''}`) }
      else if (res.skipped.length) store.toast('没有匹配到可导入的设备：' + res.skipped.slice(0, 5).join('、'))
    }
  })
}

const PasteDialog = {
  components: { ModalBase, VIcon },
  props: { onDone: Function },
  emits: ['close'],
  setup (props, { emit }) {
    const subDevices = devices.value.filter(d => d.subsystem === props.dbSub).map(d => d.name)
    const text = ref('')
    const tip = ref('')
    const apply = () => {
      const lines = String(text.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      const skipFirst = lines.length && lines[0].indexOf('设备') >= 0
      const rowsParsed = []
      const skipped = []
      lines.forEach((line, i) => {
        if (skipFirst && i === 0) return
        const parts = line.split(/[,，\t]/).map(s => s.trim())
        if (!parts[0]) return
        rowsParsed.push(parts)
      })
      // 匹配设备并写入 rows
      let added = 0
      let updated = 0
      rowsParsed.forEach(p => {
        const dst = p[0]
        const dev = devices.value.find(d => d.subsystem === props.dbSub && d.name === dst)
        if (!dev) { skipped.push(dst); return }
        const brand = p[1] || ''
        const model = p[2] || ''
        const priceVal = p[3]
        const tier = p[4] || '标准型'
        const existing = rows.value.find(r => r.devId === dev.id && r.brand === brand && r.model === model)
        if (existing) {
          if (priceVal !== undefined && priceVal !== '') existing.unitPrice = Number(priceVal) || ''
          existing.tier = tier
          updated++
        } else {
          rows.value.push({
            devId: dev.id, devName: dev.name, devSpec: dev.spec || '', devUnit: dev.unit, devCat: dev.category,
            key: mkKey(), brand, model, tier,
            param: '', unitPrice: priceVal !== undefined && priceVal !== '' ? Number(priceVal) : ''
          })
          added++
        }
      })
      emit('close')
      props.onDone({ added, updated, skipped, devices: subDevices })
    }
    return { text, tip, apply, cancel: () => emit('close') }
  },
  template: `
    <ModalBase title="批量粘贴品牌价格" @close="cancel">
      <p class="hint" style="margin-bottom:8px">从 Excel/表格复制后粘贴（第一行若含"设备"表头会自动跳过）。每行格式：<b>设备名称, 品牌, 型号, 单价</b>（设备名须与当前子系统完全一致，单价可留空）。</p>
      <textarea v-model="text" rows="10" style="width:100%;font-family:var(--mono);font-size:13px" placeholder="例如：&#10;网络摄像机(枪式), 海康威视, DS-2CD3T46, 520&#10;网络摄像机(半球), 海康威视, DS-2CD3346, 430"></textarea>
      <div class="dialog-foot">
        <button class="btn btn-ghost" @click="cancel">取消</button>
        <button class="btn btn-primary" @click="apply"><VIcon name="ul"/>导入</button>
      </div>
    </ModalBase>`
}

// Ctrl+S 保存本页
function onKey (e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    e.stopImmediatePropagation()
    save()
  }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div>
    <div class="kv-row" style="margin:0 0 10px;border:none;padding:0">
      <div>
        <div class="k">{{ dbSub }} · 品牌价格工作台</div>
        <div class="d">整页编辑品牌/型号/单价，一次保存；同一设备可配多个型号，多行粘贴一键导入</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" @click="openPaste"><VIcon name="ul" />粘贴导入</button>
        <button class="btn btn-primary" @click="save"><VIcon name="save" />保存本页</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">设备品牌价格 <span class="sub">{{ unitsText() }}</span></div>
      <div class="tbl-wrap" style="overflow-y:auto;max-height:62vh">
        <table class="tbl">
          <thead><tr>
            <th style="width:38px"></th>
            <th>设备</th><th>类别</th><th>品牌</th><th>型号</th><th>配置档次</th><th>参数</th><th>单价(元)</th><th style="width:38px"></th>
          </tr></thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.key" :class="{ 'price-empty': !r.brand.trim() }">
              <td>
                <span v-if="i === 0 || rows[i - 1].devId !== r.devId" class="badge blue" style="font-size:11px;padding:2px 8px">{{ r.devUnit }}</span>
              </td>
              <td>
                <b v-if="i === 0 || rows[i - 1].devId !== r.devId">{{ r.devName }}</b>
                <div v-if="(i === 0 || rows[i - 1].devId !== r.devId) && r.devSpec" class="src">{{ r.devSpec }}</div>
              </td>
              <td style="white-space:nowrap"><span v-if="i === 0 || rows[i - 1].devId !== r.devId" class="badge" :class="r.devCat === '前端设备' ? 'blue' : (r.devCat === '后端设备' ? 'green' : 'plain')">{{ r.devCat }}</span></td>
              <td style="min-width:130px"><input v-model.trim="r.brand" placeholder="品牌"></td>
              <td style="min-width:150px"><input v-model.trim="r.model" placeholder="型号"></td>
              <td><select v-model="r.tier" style="width:auto"><option v-for="t in BUDGET_TIERS" :key="t.id" :value="t.name">{{ t.name }}</option></select></td>
              <td style="min-width:120px"><input v-model.trim="r.param" placeholder="参数"></td>
              <td style="min-width:110px"><input v-model.number="r.unitPrice" type="number" min="0" step="0.01" placeholder="单价"></td>
              <td>
                <div class="op">
                  <button :title="'为「' + r.devName + '」添加一个型号'" @click="addVariant(r.devId)"><VIcon name="plus" /></button>
                  <button v-if="rows.filter(x => x.devId === r.devId).length > 1 || r.brand.trim()" class="del" title="删除该行" @click="removeRow(i)"><VIcon name="x" /></button>
                </div>
              </td>
            </tr>
            <tr v-if="!rows.length"><td colspan="9" style="text-align:center;color:var(--text3);padding:24px">该子系统暂无设备，请先到「设备字典」添加。</td></tr>
          </tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:8px">空品牌行保存时忽略；单价留空表示该型号暂无价格（清单中显示"未配置"）。Ctrl+S 或「保存本页」提交。</div>
    </div>
  </div>
</template>