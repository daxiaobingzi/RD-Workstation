<script setup>
// 今日待办面板：超期 / 校核 / 清单过期 / 未录入 / 推进中
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { isOverdue, daysFrom, todayStr } from '../db/format'
import VIcon from './ui/VIcon.vue'

const store = useAppStore()
const { projects, points, meta, bills } = storeToRefs(store)

const items = computed(() => {
  const out = []
  projects.value.forEach(p => {
    const pts = points.value.filter(x => x.项目ID === p.id)
    if (isOverdue(p)) {
      out.push({ lv: 'red', p, t1: '已超预计结束日期 ' + (-daysFrom(p.预计结束日期)) + ' 天', t2: '项目未完成，建议评估进度并调整预计结束日期', btn: '去项目' })
    }
    if (p.状态 === '校核中') {
      out.push({ lv: 'amber', p, t1: '项目处于校核中', t2: '完成校核后标记完成或归档', btn: '去校核' })
    } else if (p.状态 === '设计中') {
      const progress = calcP(p)
      const billT = meta.value.billAt && meta.value.billAt[p.id]
      let stale = false
      if (billT) {
        pts.forEach(x => { if (x.updatedAt && x.updatedAt > billT) stale = true })
      }
      if (stale) out.push({ lv: 'amber', p, t1: '设备数量有变更，施工清单可能过期', t2: '建议重新生成施工清单', btn: '重新生成' })
      else if (progress < 50 && pts.length === 0) out.push({ lv: 'blue', p, t1: '项目尚未填写设备数量', t2: '进入项目设计流程填写设备点表', btn: '去录入' })
      else if (progress < 80) out.push({ lv: 'blue', p, t1: '项目设计推进中', t2: '当前进度 ' + progress + '%，建议继续完善点表、说明与项目选型', btn: '去设计' })
    }
  })
  return out
})

function calcP (p) {
  return store.calcProgress(
    { points: points.value, bills: bills.value, notes: store.notes },
    { ...p })
}

function go (it) {
  store.curTab = 'projects'
  store.curProjId = it.p.id
  store.curSub = null
  store.curView = 'detail'
}

function iconOf (lv) { return lv === 'red' ? 'alert' : (lv === 'amber' ? 'clock' : 'file') }
</script>

<template>
  <div class="card today-card">
    <div v-if="!items.length" class="today-empty">
      <VIcon name="check" /> 今天没有待处理事项，一切就绪，可以安心做设计。
    </div>
    <div v-for="(it, i) in items" :key="i" class="today-item">
      <div class="ic" :class="it.lv"><VIcon :name="iconOf(it.lv)" /></div>
      <div class="info">
        <div class="t1">{{ it.p.项目名称 }}</div>
        <div class="t2" :class="{ red: it.lv === 'red' }">{{ it.t1 }} · {{ it.t2 }}</div>
      </div>
      <button class="btn btn-primary btn-sm" @click="go(it)">
        <VIcon name="zap" /><span>{{ it.btn }}</span>
      </button>
    </div>
  </div>
</template>