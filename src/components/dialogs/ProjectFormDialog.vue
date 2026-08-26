<script setup>
// 新建 / 编辑项目
import { reactive, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { todayStr, tierName } from '../../db/format'
import { BUDGET_TIERS } from '../../db/constants'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  project: { type: Object, default: null },
  newProject: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { settings, meta } = storeToRefs(store)
const isNew = computed(() => props.newProject || !props.project)

const f = reactive({
  项目名称: props.project?.项目名称 || '',
  项目编号: props.project?.项目编号 || '',
  建筑类型: props.project?.建筑类型 || settings.value.buildingTypes[0] || '',
  客户: props.project?.客户 || '',
  项目地址: props.project?.项目地址 || '',
  建筑面积: props.project?.建筑面积 ?? '',
  建筑楼层数: Number(props.project?.建筑楼层数) || 0,
  房间数: Number(props.project?.房间数) || 0,
  设计阶段: props.project?.设计阶段 || settings.value.globalParams.defaultStage || '施工图设计',
  开始日期: props.project?.开始日期 || todayStr(),
  预计结束日期: props.project?.预计结束日期 || '',
  备注: props.project?.备注 || '',
  模板: '',
  budgetTier: tierName((meta.value.projectBudget?.[props.project?.id] || {}).defaultTier),
  budget: Number((meta.value.projectBudget?.[props.project?.id] || {}).budget) || 0,
  budgetMode: (meta.value.projectBudget?.[props.project?.id] || {}).budgetMode || 'strict'
})

async function save () {
  const name = f.项目名称.trim()
  if (!name) { store.toast('请填写项目名称'); return }
  if (f.预计结束日期 && f.预计结束日期 < f.开始日期) { store.toast('预计结束日期不能早于开始日期'); return }

  let proj = props.project
  const isNewP = isNew.value
  if (isNewP) {
    proj = store.newProject({ 项目名称: name, 项目编号: f.项目编号.trim(), 建筑类型: f.建筑类型, 客户: f.客户.trim(), 项目地址: f.项目地址.trim(), 建筑面积: parseFloat(f.建筑面积) || 0, 设计阶段: f.设计阶段, 状态: '设计中', 开始日期: f.开始日期, 预计结束日期: f.预计结束日期, 备注: f.备注.trim() })
  }
  store.updateProject(proj, {
    项目编号: f.项目编号.trim(), 建筑类型: f.建筑类型, 客户: f.客户.trim(), 项目地址: f.项目地址.trim(),
    建筑面积: parseFloat(f.建筑面积) || 0, 建筑楼层数: parseInt(f.建筑楼层数) || 0, 房间数: parseInt(f.房间数) || 0,
    设计阶段: f.设计阶段, 开始日期: f.开始日期, 预计结束日期: f.预计结束日期, 备注: f.备注.trim()
  })

  // 预算档位（智能选型数据，二期启用）
  const cfg = store.setProjectBudget(proj)
  cfg.defaultTier = tierName(f.budgetTier)
  cfg.budget = Number(f.budget) || 0
  cfg.budgetMode = f.budgetMode || 'strict'

  let tplMsg = ''
  if (isNewP && f.模板) {
    const tpl = (settings.value.templates || []).find(t => t.id === f.模板)
    if (tpl) {
      const tr = store.applyTemplate(tpl, proj)
      tplMsg = `；已应用模板「${tpl.name}」：新增设备 ${tr.addDev} 台、点表 ${tr.addPt} 行${tr.skipPt ? `，跳过重复点表 ${tr.skipPt} 行` : ''}`
    }
  }
  await store.saveAll()
  emit('close')
  store.toast(isNewP ? `项目已创建${tplMsg}` : '项目已保存')
  if (isNewP) {
    store.curProjId = proj.id
    store.curView = 'detail'
  }
}
</script>

<template>
  <ModalBase :title="isNew ? '新建项目' : '编辑项目'" @close="emit('close')">
    <div class="form-grid">
      <div class="fitem" style="grid-column:1/-1"><label>项目名称 *</label><input v-model.trim="f.项目名称" placeholder="如：某商业综合体弱电工程"></div>
      <div class="fitem"><label>项目编号</label><input v-model.trim="f.项目编号" placeholder="如：2026-ELV-001"></div>
      <div class="fitem"><label>建筑类型</label>
        <select v-model="f.建筑类型"><option v-for="b in settings.buildingTypes" :key="b" :value="b">{{ b }}</option></select>
      </div>
      <div class="fitem"><label>客户</label><input v-model.trim="f.客户"></div>
      <div class="fitem"><label>项目地址</label><input v-model.trim="f.项目地址"></div>
      <div class="fitem"><label>建筑面积 (㎡)</label><input v-model.number="f.建筑面积" type="number" min="0"></div>
      <div class="fitem"><label>建筑楼层数</label><input v-model.number="f.建筑楼层数" type="number" min="0" step="1"><div class="hint">用于楼层类数量推算</div></div>
      <div class="fitem"><label>房间数</label><input v-model.number="f.房间数" type="number" min="0" step="1"><div class="hint">用于房间类数量推算</div></div>
      <div class="fitem"><label>设计阶段</label>
        <select v-model="f.设计阶段">
          <option v-for="s in settings.designStages" :key="s" :value="s">{{ s }}</option>
          <option v-if="f.设计阶段 && !settings.designStages.includes(f.设计阶段)" :value="f.设计阶段">{{ f.设计阶段 }}</option>
        </select>
      </div>
      <div class="fitem"><label>开始日期</label><input v-model="f.开始日期" type="date"></div>
      <div class="fitem"><label>预计结束日期</label><input v-model="f.预计结束日期" type="date"><div class="hint">预计完工时间，可根据实际进度动态调整</div></div>
      <div v-if="isNew" class="fitem" style="grid-column:1/-1">
        <label>应用模板（可选）</label>
        <select v-model="f.模板">
          <option value="">不使用模板</option>
          <option v-for="t in settings.templates || []" :key="t.id" :value="t.id">{{ t.name }}（{{ (t.subsystems || []).length }} 子系统）</option>
        </select>
        <div class="hint">应用后自动生成设备字典与前端设备点表骨架，可到「系统配置 → 设计模板」管理</div>
      </div>
      <div class="fitem"><label>项目默认设备档次</label>
        <select v-model="f.budgetTier"><option v-for="t in BUDGET_TIERS" :key="t.id" :value="t.name">{{ t.name }}</option></select>
        <div class="hint">未单独设置的系统自动继承此档次</div>
      </div>
      <div class="fitem"><label>项目设备预算目标（元）</label><input v-model.number="f.budget" type="number" min="0" step="1000"><div class="hint">预算为0表示暂不启用预算约束</div></div>
      <div class="fitem"><label>预算模式</label>
        <select v-model="f.budgetMode">
          <option value="strict">严格预算</option>
          <option value="target">目标预算（±5%）</option>
          <option value="reference">参考预算</option>
        </select>
      </div>
      <div class="fitem" style="grid-column:1/-1"><label>备注</label><textarea v-model.trim="f.备注"></textarea></div>
    </div>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>