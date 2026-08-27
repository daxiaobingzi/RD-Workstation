<script setup>
// 系统配置：全局参数 / 品牌库 / 子系统管理 / 材料价格 / 设计定额 / 设计模板 / 建筑类型 / 数据管理
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { useLayout } from '../composables/layout'
import { openDialog, confirmBox } from '../composables/ui'
import { BUDGET_TIERS } from '../db/constants'
import VIcon from '../components/ui/VIcon.vue'
import BrandFormDialog from '../components/dialogs/BrandFormDialog.vue'
import SubsystemFormDialog from '../components/dialogs/SubsystemFormDialog.vue'
import QuotaFormDialog from '../components/dialogs/QuotaFormDialog.vue'

const store = useAppStore()
const layout = useLayout()
const { settings } = storeToRefs(store)

const params = computed(() => settings.value.globalParams)
const qrs = computed(() => settings.value.designQuotas || [])
const newSubCat = ref('')
const newBtype = ref('')

function addSubCat () {
  const v = newSubCat.value.trim()
  if (!v) return
  store.addSubCategory(v)
  store.saveAll()
  newSubCat.value = ''
}
function addBtype () {
  const v = newBtype.value.trim()
  if (!v) return
  store.addBuildingType(v)
  store.saveAll()
  newBtype.value = ''
}

const devNameOf = (did) => {
  const d = store.devices.find(x => x.id === did)
  return d ? d.name : '（未知设备 ' + did + '）'
}
const methodTxt = (m) => ({ area: '面积', floor: '楼层', room: '房间', fixed: '固定' })[m] || m
function quotaRuleTxt (r) {
  const m = methodTxt(r.method)
  if (r.method === 'fixed') return m + ' ' + r.per + ' 台'
  return m + ' · 每' + r.per + (r.method === 'floor' ? '层' : '㎡/间') + (r.min ? ' · 最少' + r.min : '') + (r.max ? ' · 最多' + r.max : '')
}

async function delBrand (id) {
  store.deleteBrand(id)
  await store.saveAll()
  store.toast('品牌已删除')
}
async function delSubsystem (x) {
  const ok = await confirmBox(`确定删除子系统「${x.name}」？`, '删除子系统')
  if (!ok) return
  store.deleteSubsystem(x.id)
  await store.saveAll()
  store.toast('子系统已删除')
}
async function delQuota (id) {
  store.deleteQuota(id)
  await store.saveAll()
}
async function delTemplate (id) {
  store.deleteTemplate(id)
  await store.saveAll()
}

// ---------- 材料价格（品牌/型号结构；默认品牌国产、型号国产优质） ----------
const mpRows = ref([])
function syncMp () {
  mpRows.value = (settings.value.materialPrices || []).map(m => ({ ...m }))
}
syncMp()
function addMp () { mpRows.value.push({ id: 'mp_' + Date.now().toString(36), name: '', spec: '', unit: 'm', cat: '管材线缆', brand: '国产', model: '国产优质', price: '' }) }
function delMp (i) { mpRows.value.splice(i, 1) }
function saveMp () {
  const arr = mpRows.value.map(r => ({
    id: r.id || 'mp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: r.name.trim(), spec: r.spec.trim(), unit: r.unit.trim() || 'm', cat: r.cat || '管材线缆',
    brand: r.brand.trim() || '国产', model: r.model.trim() || '国产优质',
    price: r.price === '' || r.price == null ? null : Number(r.price)
  })).filter(r => r.name)
  settings.value.materialPrices = arr
  store.saveAll().then(() => { syncMp(); store.toast('材料价格已保存') })
}

// ---------- 数据管理 ----------
const backupInput = ref(null)
function onImportFile (e) {
  const f = e.target.files[0]
  if (!f) return
  const rd = new FileReader()
  rd.onload = async () => {
    const ok = await store.importJSON(rd.result)
    store.toast(ok ? '数据导入成功（导入前数据已备份）' : '导入失败：文件格式不正确')
  }
  rd.readAsText(f, 'utf-8')
}
function importJSON () { if (backupInput.value) backupInput.value.click() }
function exportJSON () { store.exportJSON() }
async function clearDemo () {
  const ok = await confirmBox('删除示例项目与设备数量（保留子系统/参数等基础配置）？', '清空示例数据')
  if (!ok) return
  store.clearDemo()
  await store.saveAll()
  store.toast('示例数据已清空')
}
async function seedDemo () {
  store.seedDemo()
  await store.saveAll()
  store.toast('示例数据已恢复')
}

onMounted(() => {
  layout.setActions([
    { label: '导出JSON', icon: 'dl', cls: 'ghost', onClick: exportJSON },
    { label: '导入恢复', icon: 'ul', cls: 'ghost', onClick: importJSON }
  ])
})

onBeforeUnmount(() => layout.setActions([]))
</script>

<template>
  <div>
    <!-- 全局参数 -->
    <div class="card set-group">
      <div class="card-title">全局参数 <span class="sub">清单推算与报价计算参数</span></div>
      <div class="form-grid">
        <div class="fitem"><label>清单损耗率 (%)</label><input v-model.number="params.lossRate" type="number" min="0" step="0.5"></div>
        <div class="fitem"><label>线缆材料系数</label><input v-model.number="params.cableFactor" type="number" min="1" step="0.05"></div>
        <div class="fitem"><label>默认设计阶段</label>
          <select v-model="params.defaultStage"><option v-for="s in settings.designStages" :key="s" :value="s">{{ s }}</option></select>
        </div>
        <div class="fitem"><label>调价系数</label><input v-model.number="params.markup" type="number" min="0" step="0.01"></div>
        <div class="fitem"><label>税率 (%)</label><input v-model.number="params.tax" type="number" min="0" step="0.1"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="btn btn-primary" @click="store.saveAll().then(() => store.toast('参数已保存'))"><VIcon name="save" />保存参数</button>
      </div>
    </div>

    <!-- 品牌库 -->
    <div class="card set-group">
      <div class="card-title">品牌库 <span class="sub">{{ (settings.brands || []).length }} 个 · 统一管理项目与子系统可用品牌</span>
        <button class="btn btn-primary btn-sm" @click="openDialog(BrandFormDialog, {})"><VIcon name="plus" />新增品牌</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>品牌名称</th><th>简称</th><th>类别</th><th>状态</th><th style="width:90px"></th></tr></thead>
        <tbody>
          <tr v-if="!(settings.brands || []).length"><td colspan="5" style="text-align:center;color:var(--text3);padding:18px">暂无品牌。</td></tr>
          <tr v-for="b in settings.brands || []" :key="b.id">
            <td><b>{{ b.name }}</b></td>
            <td>{{ b.shortName || '-' }}</td>
            <td>{{ b.category || '未分类' }}</td>
            <td><span class="badge" :class="b.status === '启用' ? 'green' : 'gray'">{{ b.status || '启用' }}</span></td>
            <td>
              <div class="op">
                <button title="编辑" @click="openDialog(BrandFormDialog, { brand: b })"><VIcon name="edit" /></button>
                <button class="del" title="删除" @click="delBrand(b.id)"><VIcon name="trash" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table></div>
    </div>

    <!-- 子系统管理 -->
    <div class="card set-group">
      <div class="card-title">子系统管理 <span class="sub">{{ settings.subsystems.length }} 个 · 开放式可拓展</span>
        <button class="btn btn-primary btn-sm" @click="openDialog(SubsystemFormDialog, {})"><VIcon name="plus" />新增子系统</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>子系统</th><th>分类</th><th>扩展字段</th><th>设备数</th><th style="width:90px"></th></tr></thead>
        <tbody>
          <tr v-for="x in settings.subsystems" :key="x.id">
            <td><b>{{ x.name }}</b></td>
            <td><span class="badge blue">{{ x.category || '未分类' }}</span></td>
            <td class="src">{{ (x.fields || []).map(f => f.name).join('、') || '-' }}</td>
            <td>{{ store.devices.filter(d => d.subsystem === x.name).length }}</td>
            <td>
              <div class="op">
                <button title="编辑" @click="openDialog(SubsystemFormDialog, { system: x })"><VIcon name="edit" /></button>
                <button class="del" title="删除" @click="delSubsystem(x)"><VIcon name="trash" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table></div>
      <div class="card-title" style="margin-top:14px">子系统分类</div>
      <div class="chips">
        <span v-for="c in settings.subCategories" :key="c" class="chip">
          {{ c }}
          <button title="删除分类" @click="store.removeSubCategory(c).then(() => store.saveAll())"><VIcon name="x" /></button>
        </span>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <input v-model="newSubCat" placeholder="输入新分类，如：综合布线" style="max-width:260px" @keydown.enter="addSubCat">
        <button class="btn btn-primary" @click="addSubCat"><VIcon name="plus" />添加</button>
      </div>
    </div>

    <!-- 材料价格 -->
    <div class="card set-group">
      <div class="card-title">材料价格 <span class="sub">与设备「定额材料」联动定价；默认品牌「国产」/型号「国产优质」，可自定义</span></div>
      <div class="tbl-wrap"><table class="tbl" style="min-width:720px">
        <thead><tr><th>材料名称</th><th>规格</th><th>单位</th><th>类别</th><th>品牌</th><th>型号</th><th>单价(元)</th><th style="width:40px"></th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in mpRows" :key="r.id || i">
            <td><input v-model.trim="r.name" placeholder="材料名，如：六类网线" style="min-width:110px"></td>
            <td><input v-model.trim="r.spec" placeholder="规格" style="min-width:90px"></td>
            <td><input v-model.trim="r.unit" style="width:56px"></td>
            <td><select v-model="r.cat"><option>管材线缆</option><option>辅材</option></select></td>
            <td><input v-model.trim="r.brand" placeholder="默认：国产" style="min-width:70px"></td>
            <td><input v-model.trim="r.model" placeholder="默认：国产优质" style="min-width:90px"></td>
            <td><input v-model.number="r.price" type="number" min="0" step="0.01" placeholder="单价" style="width:90px"></td>
            <td><button class="btn btn-icon btn-sm" @click="delMp(i)" style="color:var(--text3)"><VIcon name="trash" :size="15" /></button></td>
          </tr>
          <tr v-if="!mpRows.length"><td colspan="8" style="text-align:center;color:var(--text3);padding:18px">暂无材料价格。添加后，设备「定额材料」将自动联动此处的品牌/型号/单价。</td></tr>
        </tbody>
      </table></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-ghost btn-sm" @click="addMp"><VIcon name="plus" />添加行</button>
        <button class="btn btn-primary btn-sm" style="margin-left:auto" @click="saveMp"><VIcon name="save" />保存</button>
      </div>
    </div>

    <!-- 设计定额 -->
    <div class="card set-group">
      <div class="card-title">设计定额库 <span class="sub">{{ qrs.length }} 条 · 用于项目设备数量智能推算</span>
        <button class="btn btn-primary btn-sm" @click="openDialog(QuotaFormDialog, {})"><VIcon name="plus" />新增定额</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>子系统</th><th>设备</th><th>适用业态</th><th>规则</th><th style="width:90px"></th></tr></thead>
        <tbody>
          <tr v-if="!qrs.length"><td colspan="5" style="text-align:center;color:var(--text3);padding:18px">暂无定额规则</td></tr>
          <tr v-for="q in qrs" :key="q.id">
            <td>{{ q.subsystem }}</td>
            <td><b>{{ devNameOf(q.deviceId) }}</b></td>
            <td>{{ q.buildingType }}</td>
            <td class="src">{{ quotaRuleTxt(q) }}</td>
            <td>
              <div class="op">
                <button title="编辑" @click="openDialog(QuotaFormDialog, { rule: q })"><VIcon name="edit" /></button>
                <button class="del" title="删除" @click="delQuota(q.id)"><VIcon name="trash" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table></div>
    </div>

    <!-- 设计模板 -->
    <div class="card set-group">
      <div class="card-title">设计模板 <span class="sub">可在新建项目时一键应用，沉淀业态设计知识</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>模板名称</th><th>建筑类型</th><th>内容</th><th style="width:90px"></th></tr></thead>
        <tbody>
          <tr v-if="!(settings.templates || []).length"><td colspan="4" style="text-align:center;color:var(--text3);padding:18px">暂无模板。可在项目详情页点「存为模板」创建，新项目弹窗可选「应用模板」。</td></tr>
          <tr v-for="t in settings.templates || []" :key="t.id">
            <td><b>{{ t.name }}</b></td>
            <td>{{ t.建筑类型 || '-' }}</td>
            <td class="src">{{ (t.subsystems || []).map(s => s.name + '(' + s.devices.length + ')').join('、') }}</td>
            <td>
              <div class="op">
                <button class="del" title="删除" @click="delTemplate(t.id)"><VIcon name="trash" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table></div>
    </div>

    <!-- 建筑类型 -->
    <div class="card set-group">
      <div class="card-title">建筑类型 <span class="sub">项目建档时可选，用于业态定额匹配</span></div>
      <div class="chips">
        <span v-for="b in settings.buildingTypes" :key="b" class="chip">
          {{ b }}<button title="删除" @click="store.removeBuildingType(b).then(() => store.saveAll())"><VIcon name="x" /></button>
        </span>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <input v-model="newBtype" placeholder="输入新建筑类型" style="max-width:260px" @keydown.enter="addBtype">
        <button class="btn btn-primary" @click="addBtype"><VIcon name="plus" />添加</button>
      </div>
    </div>

    <!-- 数据管理 -->
    <div class="card set-group">
      <div class="card-title">数据管理 <span class="sub">备份 / 恢复 / 演示数据</span></div>
      <div class="kv-row"><div><div class="k">导出 JSON 备份</div><div class="d">导出全部数据为 JSON 文件，可随时导入恢复</div></div><button class="btn btn-ghost btn-sm" @click="exportJSON"><VIcon name="dl" />导出</button></div>
      <div class="kv-row"><div><div class="k">导入恢复</div><div class="d">从 JSON 备份恢复数据（会覆盖当前数据）</div></div><button class="btn btn-ghost btn-sm" @click="importJSON"><VIcon name="ul" />导入</button></div>
      <div class="kv-row"><div><div class="k">清空示例数据</div><div class="d">删除示例项目与设备数量（保留子系统/参数等基础配置）</div></div><button class="btn btn-danger btn-sm" @click="clearDemo"><VIcon name="trash" />清空</button></div>
      <div class="kv-row"><div><div class="k">恢复示例数据</div><div class="d">重新写入演示项目与设备数量</div></div><button class="btn btn-ghost btn-sm" @click="seedDemo"><VIcon name="refresh" />恢复</button></div>
    </div>

    <input ref="backupInput" type="file" accept=".json,application/json" style="display:none" @change="onImportFile">
  </div>
</template>