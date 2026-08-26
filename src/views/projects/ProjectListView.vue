<script setup>
// 项目列表：统计卡片 + 状态筛选 + 项目卡片（按预计结束日期升序）
import { computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { isOverdue, daysFrom, fmtNum } from '../../db/format'
import { useLayout } from '../../composables/layout'
import VIcon from '../../components/ui/VIcon.vue'
import ProjectFormDialog from '../../components/dialogs/ProjectFormDialog.vue'
import BootstrapProjectDialog from '../../components/dialogs/BootstrapProjectDialog.vue'
import { openDialog, confirmBox, promptBox } from '../../composables/ui'

const store = useAppStore()
const { projects, points, bills, notes: notesRef, projFilterVal, settings } = storeToRefs(store)
const layout = useLayout()

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

const list = computed(() => {
  const f = projFilterVal.value
  return projects.value.slice()
    .sort((a, b) => {
      const ad = a.预计结束日期 || ''
      const bd = b.预计结束日期 || ''
      if (!ad && !bd) return 0
      if (!ad) return 1
      if (!bd) return -1
      return ad < bd ? -1 : ad > bd ? 1 : 0
    })
    .filter(p => {
      if (f === '__overdue') return isOverdue(p)
      if (f === '__all') return true
      if (f === '已出清单') return p.清单状态 === '已生成' || p.状态 === '已出清单'
      return p.状态 === f
    })
})

function progressOf (p) {
  if (p.状态 === '已完成' || p.状态 === '已归档') return 100
  return store.calcProgress({ points: points.value, bills: bills.value, notes: notesRef.value }, { ...p })
}
function progColor (p) {
  if (p.状态 === '已完成' || p.状态 === '已归档') return '#34d399'
  if (p.清单状态 === '已生成' || p.状态 === '校核中') return '#6a5fc1'
  return '#F7A501'
}
function badgeCls (s) {
  return { '设计中': 'blue', '校核中': 'amber', '已出清单': 'green', '已完成': 'gray' }[s] || 'plain'
}

function openProject (id) {
  store.curProjId = id
  store.curView = 'detail'
}
function newProject () {
  openDialog(ProjectFormDialog, { newProject: true })
}
function bootstrapProject () {
  openDialog(BootstrapProjectDialog, {})
}
function board () { store.curView = 'board' }

async function delProject (e, p) {
  e.stopPropagation()
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

async function copyProject (e, id) {
  e.stopPropagation()
  const np = store.copyProject(id)
  await store.saveAll()
  store.toast(`已复制为独立新项目「${np.项目名称}」`)
}

async function cloneScaled (e, p) {
  e.stopPropagation()
  const nm = await promptBox('新项目名称：', p.项目名称 + '（二期）', '克隆并按面积缩放', '克隆')
  if (nm == null || !nm.trim()) return
  const area = await promptBox('新项目建筑面积 (㎡)：', p.建筑面积 || '', '克隆并按面积缩放', '确定')
  if (area == null) return
  const np = store.cloneScaledProject(p.id, { 项目名称: nm.trim(), 建筑面积: parseFloat(area) || 0, scaleBy: 'area' })
  await store.saveAll()
  store.toast(`已克隆为「${np.项目名称}」（点按面积比缩放，请核对）`)
  store.curProjId = np.id
  store.curView = 'detail'
}

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
        ['项目总数', stats.total, '#6a5fc1', 'folder'],
        ['设计中', stats.d, '#F7A501', 'clock'],
        ['校核中', stats.c, '#38bdf8', 'check'],
        ['已出清单', stats.b, '#34d399', 'check'],
        ['已完成', stats.f, '#5b6b7d', 'check'],
        ['已归档', stats.a, '#7c74a0', 'folder'],
        ['超期项目', stats.od, '#d9381f', 'alert']
      ]" :key="s[0]" class="stat-card" :style="{ color: s[2] }">
        <div class="bar"></div>
        <div class="ic" :style="{ background: s[2] }"><VIcon :name="s[3]" /></div>
        <div class="num">{{ s[1] }}</div>
        <div class="lbl">{{ s[0] }}</div>
      </div>
    </div>

    <!-- 状态筛选 -->
    <div class="kv-row" style="margin:0 0 12px">
      <div class="k">按状态筛选</div>
      <div><select v-model="store.projFilterVal" style="min-width:200px">
        <option value="__all">全部项目</option>
        <option v-for="s in ['设计中','校核中','已出清单','已完成','已归档']" :key="s" :value="s">{{ s }}</option>
        <option value="__overdue">已超期（预计结束已过）</option>
      </select></div>
    </div>

    <!-- 项目卡片 -->
    <div v-if="list.length" class="grid">
      <div v-for="p in list" :key="p.id" class="proj-card" :class="{ overdue: isOverdue(p) }" @click="openProject(p.id)">
        <div class="phead">
          <div>
            <div class="pname">{{ p.项目名称 }}</div>
            <div class="pmeta">{{ p.项目编号 }} · {{ p.建筑类型 || '未分类' }}</div>
          </div>
          <span class="badge" :class="badgeCls(p.状态)">{{ p.状态 || '-' }}</span>
        </div>
        <div class="pmeta">
          <VIcon name="building" :size="13" style="vertical-align:-2px" />
          {{ p.客户 || '-' }} · {{ p.项目地址 || '-' }}
        </div>
        <div class="pfoot">
          <span>{{ p.设计阶段 || '-' }}</span>
          <span>预计结束 {{ p.预计结束日期 || '-' }}</span>
          <span style="margin-left:auto;display:flex;gap:4px">
            <button class="btn btn-icon btn-sm" title="克隆并按面积缩放" @click="cloneScaled($event, p)">
              <VIcon name="copy" :size="15" />
            </button>
          </span>
        </div>
        <div class="prog">
          <div class="prog-bar"><div class="prog-fill" :style="{ width: progressOf(p) + '%', background: progColor(p) }"></div></div>
          <div class="prog-meta"><span>{{ p.状态 || '-' }}</span><span>{{ progressOf(p) }}%</span></div>
        </div>
        <div v-if="isOverdue(p)" class="today-item" style="padding:8px 0 0;border:none">
          <span class="badge red"><VIcon name="alert" />已超预计结束 {{ -daysFrom(p.预计结束日期) }} 天</span>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="card" style="text-align:center;padding:44px 40px">
      <div style="display:inline-flex;width:52px;height:52px;border-radius:14px;background:var(--primary-l);color:var(--primary);align-items:center;justify-content:center;margin-bottom:12px">
        <VIcon name="folder" :size="24" />
      </div>
      <div style="font-weight:600;font-size:15px;margin-bottom:4px">
        {{ projects.length ? '没有符合条件的项目' : '还没有项目' }}
      </div>
      <div style="font-size:13px;color:var(--text3)">点击右上角「新建项目」，开始第一个弱电智能化设计</div>
    </div>
  </div>
</template>