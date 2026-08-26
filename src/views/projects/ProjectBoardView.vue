<script setup>
// 项目看板：状态分布条 + 按预计结束日期排序表
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import { daysFrom } from '../../db/format'
import { useLayout } from '../../composables/layout'
import ProjectFormDialog from '../../components/dialogs/ProjectFormDialog.vue'
import { openDialog } from '../../composables/ui'

const store = useAppStore()
const { projects } = storeToRefs(store)
const layout = useLayout()

const ps = computed(() => projects.value)

const dist = computed(() => ({
  total: ps.value.length,
  d: ps.value.filter(x => x.状态 === '设计中').length,
  c: ps.value.filter(x => x.状态 === '校核中').length,
  b: ps.value.filter(x => x.清单状态 === '已生成' || x.状态 === '已出清单').length,
  f: ps.value.filter(x => x.状态 === '已完成').length,
  a: ps.value.filter(x => x.状态 === '已归档').length,
  od: ps.value.filter(x => x.预计结束日期 && x.状态 !== '已完成' && x.预计结束日期 < new Date().toISOString().slice(0, 10)).length
}))

const dueList = computed(() =>
  ps.value.filter(p => p.预计结束日期 && p.状态 !== '已完成')
    .sort((a, b) => a.预计结束日期 < b.预计结束日期 ? -1 : 1))

function bar (name, n, color) {
  const pct = ps.value.length ? Math.round(n / ps.value.length * 100) : 0
  return { name, n, pct, color }
}
function goProject (id) {
  store.curProjId = id
  store.curView = 'detail'
}
const backList = () => { store.curView = 'list' }
const newProject = () => openDialog(ProjectFormDialog, { newProject: true })

onMounted(() => layout.setActions([
  { label: '返回列表', icon: 'back', cls: 'ghost', onClick: backList },
  { label: '新建项目', icon: 'plus', cls: 'primary', onClick: newProject }
]))
onBeforeUnmount(() => layout.setActions([]))
</script>

<template>
  <div>
    <div v-if="!projects.length" class="card" style="text-align:center;padding:44px;color:var(--text3)">暂无项目</div>
    <template v-else>
      <div class="card">
        <div class="card-title">项目状态分布 <span class="sub">共 {{ projects.length }} 个项目 · 超期按预计结束日期判定</span></div>
        <div v-for="b in [
          bar('设计中', dist.d, '#F7A501'),
          bar('校核中', dist.c, '#38bdf8'),
          bar('已出清单', dist.b, '#6a5fc1'),
          bar('已完成', dist.f, '#34d399'),
          bar('已归档', dist.a, '#7c74a0'),
          bar('超期（预计结束已过）', dist.od, '#d9381f')
        ]" :key="b.name" class="kv-row" style="margin:0">
          <div class="k" style="min-width:150px">{{ b.name }} <b :style="{ color: b.color }">{{ b.n }}</b></div>
          <div style="flex:1"><div class="prog-bar" style="max-width:340px"><div class="prog-fill" :style="{ width: b.pct + '%', background: b.color }"></div></div></div>
        </div>
      </div>

      <div v-if="dueList.length" class="card">
        <div class="card-title">按预计结束日期排序 <span class="sub">越临近越靠前，超期标红</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>项目</th><th>预计结束</th><th>剩余/超期</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="p in dueList" :key="p.id" style="cursor:pointer" @click="goProject(p.id)">
              <td><b>{{ p.项目名称 }}</b></td>
              <td>{{ p.预计结束日期 }}</td>
              <td>
                <span v-if="daysFrom(p.预计结束日期) >= 0" class="badge red">已超 {{ daysFrom(p.预计结束日期) }} 天</span>
                <span v-else class="badge blue">剩 {{ -daysFrom(p.预计结束日期) }} 天</span>
              </td>
              <td><span class="badge" :class="({ '设计中': 'blue', '校核中': 'amber', '已出清单': 'green', '已完成': 'gray' })[p.状态] || 'plain'">{{ p.状态 }}</span></td>
            </tr>
          </tbody>
        </table></div>
      </div>
    </template>
  </div>
</template>