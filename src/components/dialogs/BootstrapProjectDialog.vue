<script setup>
// 模板起盘向导：选模板 → 填建筑指标 → 一键生成项目骨架并自动推算前端设备数量
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { todayStr } from '../../db/format'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const emit = defineEmits(['close', 'created'])
const store = useAppStore()
const { settings } = storeToRefs(store)

const tplId = ref(settings.value.templates?.[0]?.id || '')
const f = reactive({
  项目名称: '',
  项目编号: '',
  建筑类型: settings.value.buildingTypes[0] || '',
  客户: '',
  项目地址: '',
  建筑面积: '',
  建筑楼层数: '',
  房间数: '',
  预计结束日期: '',
  备注: ''
})

const tpl = computed(() => (settings.value.templates || []).find(t => t.id === tplId.value) || null)

// 模板子系统/设备预览（前端设备数）
const tplPreview = computed(() => {
  if (!tpl.value) return []
  return (tpl.value.subsystems || []).map(s => ({
    name: s.name,
    front: (s.devices || []).filter(d => d.category === '前端设备').length,
    back: (s.devices || []).filter(d => d.category === '后端设备').length
  }))
})

// 定额覆盖提示：该建筑类型是否有可自动推算的定额规则
const ration = computed(() => {
  if (!tpl.value) return { area: 0, floor: 0, room: 0 }
  let area = 0; let floor = 0; let room = 0
  ;(settings.value.designQuotas || []).forEach(r => {
    if (!tpl.value.subsystems.some(s => s.name === r.subsystem)) return
    if (r.buildingType !== '全部业态' && r.buildingType !== f.建筑类型) return
    if (r.method === 'area') area++
    else if (r.method === 'floor') floor++
    else if (r.method === 'room') room++
  })
  return { area, floor, room }
})

async function create () {
  const name = f.项目名称.trim()
  if (!name) { store.toast('请填写项目名称'); return }
  if (!tpl.value) { store.toast('请选择模板'); return }
  const r = store.bootstrapFromTemplate(tpl.value, { ...f, 预计结束日期: f.预计结束日期 || '', 备注: f.备注 })
  await store.saveAll()
  emit('close')
  store.toast(`项目「${r.p.项目名称}」已起盘：${r.subCount} 个子系统、设备${r.tr.addDev}台、点表${r.tr.addPt}行${r.autoQty ? '，自动推算前端' + r.autoQty + '台' : ''}`)
  store.curProjId = r.p.id
  store.curView = 'detail'
}
</script>

<template>
  <ModalBase title="模板起盘 · 一键生成项目" width="680px" @close="emit('close')">
    <div class="hint" style="margin-bottom:10px">选择一个业态模板，系统自动创建项目、设备字典与点表骨架；已有「设计定额」规则的区域设备将按面积/楼层/房间自动推算数量。</div>

    <!-- 模板选择 -->
    <div class="fitem">
      <label>选择模板（{{ (settings.templates || []).length }} 个可用）</label>
      <select v-model="tplId" style="width:100%">
        <option v-for="t in settings.templates || []" :key="t.id" :value="t.id">{{ t.name }} · {{ t.建筑类型 || '通用' }}（{{ (t.subsystems || []).length }} 子系统）</option>
      </select>
      <div v-if="!tpl" class="hint" style="color:var(--amber)">暂无可用模板，请先到「系统配置 → 模板管理」创建或从项目存为模板。</div>
    </div>

    <!-- 模板预览 -->
    <div v-if="tplPreview.length" class="tpl-preview">
      <span v-for="s in tplPreview" :key="s.name" class="chip">
        {{ s.name }}<span class="tpl-cnt"><b>{{ s.front }}</b> 前端 / {{ s.back }} 后端</span>
      </span>
    </div>
    <div v-if="tpl && (ration.area || ration.floor || ration.room)" class="hint" style="margin-top:6px">
      检测到可自动推算规则：面积法 {{ ration.area }} 条 · 楼层法 {{ ration.floor }} 条 · 房间法 {{ ration.room }} 条（按「{{ f.建筑类型 || '默认业态' }}」匹配）
    </div>

    <!-- 项目信息 -->
    <div class="form-grid" style="margin-top:10px">
      <div class="fitem" style="grid-column:1/-1"><label>项目名称 *</label><input v-model.trim="f.项目名称" :placeholder="tpl ? tpl.name + '项目' : '如：某商业综合体弱电工程'"></div>
      <div class="fitem"><label>项目编号</label><input v-model.trim="f.项目编号" placeholder="如：2026-ELV-001"></div>
      <div class="fitem"><label>建筑类型</label>
        <select v-model="f.建筑类型"><option v-for="b in settings.buildingTypes" :key="b" :value="b">{{ b }}</option></select>
      </div>
      <div class="fitem"><label>客户</label><input v-model.trim="f.客户"></div>
      <div class="fitem"><label>项目地址</label><input v-model.trim="f.项目地址"></div>
      <div class="fitem"><label>建筑面积 (㎡)</label><input v-model.number="f.建筑面积" type="number" min="0"><div class="hint">面积类设备的推算依据</div></div>
      <div class="fitem"><label>建筑楼层数</label><input v-model.number="f.建筑楼层数" type="number" min="0" step="1"><div class="hint">楼层类设备推算依据</div></div>
      <div class="fitem"><label>房间数</label><input v-model.number="f.房间数" type="number" min="0" step="1"><div class="hint">房间类设备推算依据</div></div>
      <div class="fitem"><label>预计结束日期</label><input v-model="f.预计结束日期" type="date"></div>
      <div class="fitem" style="grid-column:1/-1"><label>备注（可选）</label><input v-model.trim="f.备注" placeholder="如：本项目为改造项目，原系统利旧"></div>
    </div>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="!tpl" @click="create"><VIcon name="zap" />起盘</button>
    </template>
  </ModalBase>
</template>

<style scoped>
.tpl-preview{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.tpl-cnt{font-size:11px;color:var(--text3);margin-left:6px}
.tpl-cnt b{color:var(--accent)}
</style>