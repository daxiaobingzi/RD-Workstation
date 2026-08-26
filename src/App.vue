<script setup>
// 应用外壳：侧边栏 + 顶栏 + 内容区 + 弹窗/Toast 宿主
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from './store'
import { layout } from './composables/layout'
import { closeDialog } from './composables/ui'
import VIcon from './components/ui/VIcon.vue'
import ThemeSwitch from './components/layout/ThemeSwitch.vue'
import DialogHost from './components/ui/DialogHost.vue'
import ToastHost from './components/ui/ToastHost.vue'
import TodayPanel from './components/TodayPanel.vue'
import ProjectsView from './views/ProjectsView.vue'
import DatabaseView from './views/DatabaseView.vue'
import SearchView from './views/SearchView.vue'
import SettingsView from './views/SettingsView.vue'

const store = useAppStore()
const { curTab, ready, loading, online, syncText, curView } = storeToRefs(store)

const NAV = [
  ['projects', 'folder', '项目管理'],
  ['database', 'db', '数据库'],
  ['search', 'search', '搜索'],
  ['settings', 'set', '系统配置']
]

const viewMap = {
  projects: ProjectsView,
  database: DatabaseView,
  search: SearchView,
  settings: SettingsView
}
const currentView = computed(() => viewMap[curTab.value] || ProjectsView)
const pageTitle = computed(() => {
  if (curTab.value !== 'projects') {
    const m = NAV.find(n => n[0] === curTab.value)
    return m ? m[2] : ''
  }
  if (curView.value === 'board') return '项目看板'
  if (curView.value === 'detail' || curView.value === 'bill') {
    const p = store.projectById(store.curProjId)
    return p ? p.项目名称 : '项目管理'
  }
  return '项目管理'
})

function switchTab (t) {
  store.curTab = t
  store.curView = 'list'
  store.curProjId = null
  store.curSub = null
}

function onKeydown (e) {
  if (e.key === 'Escape') { closeDialog(); return }
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    store.saveAll().then(() => store.toast('已保存'))
    return
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    if (curTab.value !== 'search') switchTab('search')
    setTimeout(() => { const el = document.querySelector('.g-search-input'); if (el) el.focus() }, 60)
  }
}

onMounted(() => {
  store.init()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <!-- PC 侧边栏 -->
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo"><VIcon name="zap" :size="20" /></div>
        <div>
          <div class="brand-name">弱电智能化设计工作台</div>
          <div class="brand-sub">项目 · 设备点表 · 清单</div>
        </div>
      </div>
      <nav class="nav">
        <button v-for="n in NAV" :key="n[0]" class="nav-item" :class="{ active: curTab === n[0] }" @click="switchTab(n[0])">
          <VIcon :name="n[1]" /><span>{{ n[2] }}</span>
        </button>
      </nav>
      <div class="side-foot">
        <div class="sync-state">
          <span class="dot" :class="{ off: !online }"></span>
          <span>{{ syncText }}</span>
        </div>
        <div>本地存储 · 预留云端接口</div>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <h1>{{ pageTitle }}</h1>
        <div class="topbar-actions">
          <button v-for="(a, i) in layout.actions" :key="i"
                  :class="['btn', a.cls === 'primary' ? 'btn-primary' : (a.cls === 'danger' ? 'btn-danger' : 'btn-ghost'), a.sm ? 'btn-sm' : '']"
                  :disabled="a.disabled" @click="a.onClick">
            <VIcon :name="a.icon || 'zap'" /><span>{{ a.label }}</span>
          </button>
        </div>
        <ThemeSwitch />
      </div>

      <div v-if="loading" class="card" style="text-align:center;padding:44px;color:var(--text3)">正在加载数据…</div>
      <template v-else-if="ready">
        <TodayPanel v-if="curTab === 'projects'" />
        <component :is="currentView" />
      </template>
    </main>

    <!-- 移动端底栏导航 -->
    <nav class="m-nav">
      <button v-for="n in NAV" :key="n[0]" class="nav-item" :class="{ active: curTab === n[0] }" @click="switchTab(n[0])">
        <VIcon :name="n[1]" /><span>{{ n[2] }}</span>
      </button>
    </nav>

    <DialogHost />
    <ToastHost />
  </div>
</template>