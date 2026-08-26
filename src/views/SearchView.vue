<script setup>
// 全局搜索：项目 / 设备 / 点位
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import VIcon from '../components/ui/VIcon.vue'

const store = useAppStore()
const { projects, devices, points, settings } = storeToRefs(store)
const kw = ref('')
const results = ref(null)

function globalSearch () {
  const k = kw.value.trim().toLowerCase()
  if (!k) { results.value = null; return }
  const hit = (s) => String(s == null ? '' : s).toLowerCase().includes(k)
  return {
    projects: projects.value.filter(p => hit(p.项目名称) || hit(p.项目编号) || hit(p.客户) || hit(p.项目地址) || hit(p.备注)),
    devices: devices.value.filter(d => hit(d.name) || hit(d.spec) || hit(d.subsystem)),
    points: points.value.filter(x => hit(x.设备类型) || hit(x.子系统) || hit(x.备注) || hit(x.点位名称) || hit(x.安装位置))
  }
}
function doSearch () { results.value = globalSearch() }
function jump (type, id) {
  if (type === 'P') {
    const p = projects.value.find(x => x.id === id)
    if (!p) return
    store.curTab = 'projects'; store.curProjId = id; store.curView = 'detail'; store.curSub = null
  } else if (type === 'D') {
    const d = devices.value.find(x => x.id === id)
    if (!d) return
    store.curTab = 'database'; store.curSub = d.subsystem
  } else if (type === 'T') {
    const x = points.value.find(x2 => x2.id === id)
    if (!x) return
    store.curTab = 'projects'; store.curProjId = x.项目ID; store.curView = 'detail'; store.curSub = x.子系统
  }
}
onMounted(() => {
  setTimeout(() => {
    const el = document.querySelector('.g-search-input')
    if (el) el.focus()
  }, 60)
})
</script>

<template>
  <div>
    <div class="card">
      <div class="card-title">全局搜索 <span class="sub">项目 / 设备 / 点位 关键词检索，点击直达</span></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <input v-model="kw" class="g-search-input" placeholder="输入关键词，如：摄像机、综合体、2026-ELV…" style="max-width:420px" @keydown.enter="doSearch">
        <button class="btn btn-primary" @click="doSearch"><VIcon name="search" />搜索</button>
      </div>
    </div>

    <div v-if="!results && !kw" class="hint" style="padding:24px;text-align:center;color:var(--text3)">输入关键词开始检索</div>
    <div v-else-if="results && !results.projects.length && !results.devices.length && !results.points.length" class="card" style="text-align:center;padding:32px;color:var(--text3)">
      未找到与「{{ kw }}」相关的内容
    </div>
    <template v-else-if="results">
      <div v-if="results.projects.length" class="card">
        <div class="card-title">项目 <span style="font-size:12px;color:var(--text3)">{{ results.projects.length }} 条</span></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
          <tr v-for="p in results.projects" :key="p.id" style="cursor:pointer" @click="jump('P', p.id)">
            <td><b>{{ p.项目名称 }}</b><span class="src"> {{ p.项目编号 || '' }} · {{ p.客户 || '' }}</span></td>
            <td style="width:120px;text-align:right"><span class="badge blue">项目</span></td>
          </tr>
        </tbody></table></div>
      </div>
      <div v-if="results.devices.length" class="card">
        <div class="card-title">设备 <span style="font-size:12px;color:var(--text3)">{{ results.devices.length }} 条</span></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
          <tr v-for="d in results.devices" :key="d.id" style="cursor:pointer" @click="jump('D', d.id)">
            <td><b>{{ d.name }}</b><span class="src"> {{ d.subsystem || '' }} · {{ d.spec || '' }}</span></td>
            <td style="width:120px;text-align:right"><span class="badge green">设备</span></td>
          </tr>
        </tbody></table></div>
      </div>
      <div v-if="results.points.length" class="card">
        <div class="card-title">点位 <span style="font-size:12px;color:var(--text3)">{{ results.points.length }} 条</span></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
          <tr v-for="x in results.points" :key="x.id" style="cursor:pointer" @click="jump('T', x.id)">
            <td><b>{{ x.设备类型 }}</b><span class="src"> {{ x.子系统 || '' }} · {{ x.点位名称 || x.安装位置 || '' }}</span></td>
            <td style="width:120px;text-align:right"><span class="badge gray">点位</span></td>
          </tr>
        </tbody></table></div>
      </div>
    </template>
  </div>
</template>