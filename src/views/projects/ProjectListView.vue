<script setup>
// 项目轨道 · Notion 风格数据表（表格/看板/列表 三视图 + 行内编辑 + 排序筛选搜索）
import { computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { isOverdue } from '../../db/format'
import { PROJECT_STATUSES } from '../../db/constants'
import { useLayout } from '../../composables/layout'
import VIcon from '../../components/ui/VIcon.vue'
import NotionTable from '../../components/notion/NotionTable.vue'
import ProjectFormDialog from '../../components/dialogs/ProjectFormDialog.vue'
import BootstrapProjectDialog from '../../components/dialogs/BootstrapProjectDialog.vue'
import { openDialog, confirmBox } from '../../composables/ui'

const store = useAppStore()
const { projects, points, bills, notes: notesRef, settings } = storeToRefs(store)
const layout = useLayout()

// 进度：存值优先，否则按项目进度模型计算
function progressOf (p) {
  if (p.进度 != null && p.进度 !== '') return Number(p.进度) || 0
  if (p.状态 === '已完成' || p.状态 === '已归档') return 100
  return store.calcProgress({ points: points.value, bills: bills.value, notes: notesRef.value }, { ...p })
}

const stats = computed(() => {
  const ps = projects.value
  return {
    total: ps.length,
    d: ps.filter(x => x.状态 === '设计中').length,
    c: ps.filter(x => x.状态 === '校核中').length,
    b: ps.filter(x => x.清单状态 === '已生成' || x.状态 === '已出清单').length,
    f: ps.filter(x => x.状态 === '已完成').length,
    a: ps.filter(x => x.状态 === '已归档').length,
    od: ps.filter(isOverdue).length
  }
})

function optsOf (base, field) {
  return [...new Set([...(base || []), ...projects.value.map(p => p[field]).filter(Boolean)])]
}
const P_COLS = [
  { key: '项目名称', label: '项目名称', type: 'text', sortable: true, width: '200px' },
  { key: '项目编号', label: '编号', type: 'text', sortable: true, width: '110px' },
  { key: '建筑类型', label: '建筑类型', type: 'single', options: optsOf(settings.value.buildingTypes, '建筑类型'), sortable: true, width: '120px' },
  { key: '客户', label: '客户', type: 'text', sortable: true, width: '130px' },
  { key: '建筑面积', label: '面积(㎡)', type: 'number', sortable: true, width: '96px' },
  { key: '设计阶段', label: '设计阶段', type: 'single', options: settings.value.designStages, sortable: true, width: '120px' },
  { key: '状态', label: '状态', type: 'single', options: PROJECT_STATUSES, sortable: true, width: '104px' },
  { key: '负责人', label: '负责人', type: 'person', sortable: true, width: '104px' },
  { key: '开始日期', label: '开始', type: 'date', sortable: true, width: '118px' },
  { key: '预计结束日期', label: '预计结束', type: 'date', sortable: true, width: '118px' },
  { key: '重点', label: '重点', type: 'check', sortable: true, width: '70px' },
  { key: '进度', label: '进度', type: 'progress', sortable: true, width: '150px', fmt: p => (p.进度 != null && p.进度 !== '' ? p.进度 : progressOf(p)) },
  { key: '备注', label: '备注', type: 'longtext', width: '150px' }
]

// 编辑后自动落盘（防抖）
let saveTimer = null
function onCommit () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { store.saveAll() }, 400)
}
async function onDel (p) {
  const ptN = points.value.filter(x => x.项目ID === p.id).length
  const blN = (bills.value[p.id] || []).length
  const ok = await confirmBox(
    `确定删除项目「${p.项目名称}」？\n\n级联影响：\n· 设备点表 ${ptN} 行\n· 历史施工清单 ${blN} 份\n· 设计说明\n\n删除后不可恢复，建议先导出 JSON 备份。`,
    '删除项目')
  if (!ok) return
  store.deleteProject(p.id)
  await store.saveAll()
  store.toast('项目已删除')
}
function onOpen (p) { store.curProjId = p.id; store.curView = 'detail' }
function onAdd () { openDialog(ProjectFormDialog, { newProject: true }) }
function newProject () { openDialog(ProjectFormDialog, { newProject: true }) }
function bootstrapProject () { openDialog(BootstrapProjectDialog, {}) }
function board () { store.curView = 'board' }

onMounted(() => layout.setActions([
  { label: '看板', icon: 'list', cls: 'ghost', onClick: board },
  { label: '模板起盘', icon: 'zap', cls: 'ghost', onClick: bootstrapProject },
  { label: '新建项目', icon: 'plus', cls: 'primary', onClick: newProject }
]))
watch(() => store.curTab, () => { if (store.curTab !== 'projects') layout.setActions([]) })
</script>

<template>
  <div>
    <!-- 统计卡片 -->
    <div v-if="projects.length" class="stat-cards">
      <div v-for="(s, i) in [
        ['项目总数', stats.total, 'var(--primary)', 'folder'],
        ['设计中', stats.d, 'var(--amber)', 'clock'],
        ['校核中', stats.c, 'var(--accent)', 'check'],
        ['已出清单', stats.b, 'var(--green)', 'check'],
        ['已完成', stats.f, 'var(--gray)', 'check'],
        ['已归档', stats.a, 'var(--text3)', 'folder'],
        ['超期项目', stats.od, 'var(--red)', 'alert']
      ]" :key="s[0]" class="stat-card" :style="{ color: s[2] }">
        <div class="bar"></div>
        <div class="ic" :style="{ background: s[2] }"><VIcon :name="s[3]" /></div>
        <div class="num">{{ s[1] }}</div>
        <div class="lbl">{{ s[0] }}</div>
      </div>
    </div>

    <!-- Notion 数据表：表格/看板/列表 -->
    <NotionTable
      :columns="P_COLS"
      :rows="projects"
      group-by="状态"
      @commit="onCommit"
      @open="onOpen"
      @del="onDel"
      @add="onAdd"
    />

    <!-- 空状态 -->
    <div v-if="!projects.length" class="card" style="text-align:center;padding:44px 40px;margin-top:12px">
      <div style="display:inline-flex;width:52px;height:52px;border-radius:14px;background:var(--primary-l);color:var(--primary);align-items:center;justify-content:center;margin-bottom:12px">
        <VIcon name="folder" :size="24" />
      </div>
      <div style="font-weight:600;font-size:15px;margin-bottom:4px">还没有项目</div>
      <div style="font-size:13px;color:var(--text3)">点击右上角「新建项目」，开始第一个弱电智能化设计</div>
    </div>
  </div>
</template>
