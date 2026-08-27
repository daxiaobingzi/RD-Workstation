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

// ---------- 材料价格 ----------
const mpRows = ref([])
function syncMp () {
  mpRows.value = Object.keys(settings.value.materialPrices || {}).map(k => ({ name: k, price: settings.value.materialPrices[k] }))
}
syncMp()
function addMp () { mpRows.value.push({ name: '', price: '' }) }
function delMp (i) { mpRows.value.splice(i, 1) }
function saveMp () {
  const np = {}
  mpRows.value.forEach(r => {
    const n = r.name.trim()
    if (!n) return
    if (r.price === '' || r.price == null) return
    np[n] = Number(r.price)
  })
  settings.value.materialPrices = np
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

onMounted(() => layout.setActions([
  { label: '导出JSON', icon: 'dl', cls: 'ghost', onClick: exportJSON },
  { label: '导入恢复', icon: 'ul', cls: 'ghost', onClick: importJSON }
]))

// ---------- 阿里云 OSS 云同步 ----------
import {
  loadOssConfig, saveOssConfig, testOssConnection, hasOssConfig,
  enableOssSync, disableOssSync, isOssConfigValid
} from '../db/ossSync'
import { storage } from '../db/storage'

const _loadedCfg = loadOssConfig()
// 仅「全新配置」默认 data/ 前缀（与页面资源隔离）；老配置保留原前缀，避免云端数据读取位置被改动
if (!hasOssConfig() && _loadedCfg.prefix == null) _loadedCfg.prefix = 'data'
const ossCfg = ref(_loadedCfg)
const ossMsg = ref('')
const ossBusy = ref(false)
const ossEnabled = ref(storage.mode === 'oss')
const ossModeTxt = ossEnabled.value
  ? '云端模式（阿里云 OSS 直连）'
  : '本地模式（IndexedDB）'

async function testOssConn () {
  ossBusy.value = true
  ossMsg.value = '正在连接并校验权限…'
  const r = await testOssConnection(ossCfg.value)
  ossMsg.value = r.message
  if (r.ok) saveOssConfig({ ...ossCfg.value, enabled: ossEnabled.value })
  ossBusy.value = false
}

async function enableOss () {
  const cfg = { ...ossCfg.value, enabled: true }
  if (!isOssConfigValid(cfg)) { ossMsg.value = '请先填写 Bucket、Region、AccessKey 后再启用'; return }
  saveOssConfig(cfg)
  enableOssSync(cfg)
  await store.saveAll()
  await store.flushSync() // 版本同步：确保全量数据已推送云端再提示
  ossEnabled.value = true
  store.syncText = '阿里云 OSS'
  store.online = true
  ossMsg.value = '已启用：数据已按版本同步推送到 OSS（' + (cfg.prefix || '根目录') + ' 前缀），刷新后保持云模式'
}

async function disableOss () {
  await store.flushSync() // 先把未推送的本地修改同步到云端，再回退本地模式
  await disableOssSync()
  const c = loadOssConfig()
  c.enabled = false
  saveOssConfig(c)
  ossEnabled.value = false
  store.syncText = '离线模式'
  store.online = false
  ossMsg.value = '已停用：回到本机 IndexedDB 存储（云端对象保留，再次启用会覆盖）'
}
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
      <div class="card-title">材料价格 <span class="sub">用于施工清单材料行报价</span></div>
      <div v-for="(r, i) in mpRows" :key="i" style="display:flex;gap:8px;margin-bottom:8px">
        <input v-model.trim="r.name" placeholder="材料名，如：六类网线" style="flex:1;min-width:120px">
        <input v-model.number="r.price" type="number" min="0" step="0.01" placeholder="单价" style="width:130px">
        <button class="btn btn-icon btn-sm" @click="delMp(i)" style="color:var(--text3)"><VIcon name="trash" :size="15" /></button>
      </div>
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

    <!-- 阿里云 OSS 云同步 -->
    <div class="card set-group">
      <div class="card-title">阿里云 OSS 云同步 <span class="sub">跨设备数据同步 · 浏览器直连 Bucket（方案A）</span></div>

      <div class="kv-row">
        <div>
          <div class="k">当前模式</div>
          <div class="d">云模式：数据读写直达 OSS 对象（projects/points/devices 等 8 个集合，各对应一个 .json 对象）</div>
        </div>
        <div class="v">
          <span class="oss-tag" :class="ossEnabled ? 'on' : ''">{{ ossEnabled ? '云端模式已启用' : '本地 IndexedDB' }}</span>
        </div>
      </div>

      <div class="oss-grid">
        <label>Bucket 名称
          <input v-model="ossCfg.bucket" placeholder="如 my-rd-workstation" autocomplete="off">
        </label>
        <label>Region 地域
          <input v-model="ossCfg.region" placeholder="如 oss-cn-hangzhou" autocomplete="off">
        </label>
        <label>AccessKey ID
          <input v-model="ossCfg.accessKeyId" placeholder="RAM 子账号 AccessKey ID" autocomplete="off">
        </label>
        <label>AccessKey Secret
          <input v-model="ossCfg.accessKeySecret" type="password" placeholder="RAM 子账号 AccessKey Secret" autocomplete="off">
        </label>
        <label>对象前缀（可选）
          <input v-model="ossCfg.prefix" placeholder="如 rd-workshop，留空存 Bucket 根目录" autocomplete="off">
        </label>
        <label>自定义 Endpoint（可选）
          <input v-model="ossCfg.endpoint" placeholder="绑定自定义域名时填，如 oss.example.com" autocomplete="off">
        </label>
      </div>

      <div class="oss-actions">
        <button class="btn btn-ghost btn-sm" :disabled="ossBusy" @click="testOssConn"><VIcon name="refresh" />测试连接</button>
        <button v-if="!ossEnabled" class="btn btn-primary btn-sm" :disabled="ossBusy" @click="enableOss"><VIcon name="cloud" />启用同步</button>
        <button v-else class="btn btn-danger btn-sm" :disabled="ossBusy" @click="disableOss"><VIcon name="x" />停用同步</button>
        <span class="oss-msg" :class="{ err: /失败|错误|先填写/.test(ossMsg) }">{{ ossMsg || '&nbsp;' }}</span>
      </div>

      <div class="oss-tip">
        <strong>接入准备</strong>：① 在 RAM 控制台新建子账号并仅授予该 Bucket 读写权限；② 在 OSS 控制台为该 Bucket 配置
        <code>CORS</code> 规则（<code>AllowedOrigin</code> 填工作台域名，<code>AllowedMethod</code> 选 GET/PUT/DELETE/POST/HEAD，<code>AllowedHeader</code> 填 *）。
        密钥仅保存在本机浏览器，请勿用于多人共享场景。
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

<style scoped>
.oss-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text3);
  background: var(--glass-1);
  border: 1px solid var(--line);
}
.oss-tag.on {
  color: var(--primary);
  background: var(--primary-l);
  border-color: var(--primary);
}
.oss-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 14px 0 4px;
}
.oss-grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text2);
}
.oss-grid input {
  width: 100%;
}
.oss-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  min-height: 24px;
}
.oss-msg {
  font-size: 12.5px;
  color: var(--positive, #12a150);
}
.oss-msg.err {
  color: var(--red-ink);
}
.oss-tip {
  margin-top: 14px;
  padding: 11px 14px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text3);
  background: var(--primary-l, rgba(0, 122, 255, 0.06));
  border: 1px solid var(--line);
}
.oss-tip code {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--glass-1);
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--strong-text);
}
</style>