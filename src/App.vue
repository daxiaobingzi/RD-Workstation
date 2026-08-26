<script setup>
// 应用外壳：侧边栏（项目轨道 + 资料库抽屉）+ 顶栏 + 内容区 + 弹窗/Toast 宿主
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from './store'
import { layout } from './composables/layout'
import { closeDialog, openDialog } from './composables/ui'
import VIcon from './components/ui/VIcon.vue'
import ThemeSwitch from './components/layout/ThemeSwitch.vue'
import DialogHost from './components/ui/DialogHost.vue'
import ToastHost from './components/ui/ToastHost.vue'
import CommandPalette from './components/CommandPalette.vue'
import TodayPanel from './components/TodayPanel.vue'
import StyleStudio from './components/StyleStudio.vue'
import ProjectsView from './views/ProjectsView.vue'
import DatabaseView from './views/DatabaseView.vue'
import SearchView from './views/SearchView.vue'
import SettingsView from './views/SettingsView.vue'
import { initStyleStudio } from './composables/style'

const store = useAppStore()
const { curTab, ready, loading, online, syncText, curView, projects, curProjId } = storeToRefs(store)
const paletteOpen = ref(false)
// 侧边栏折叠状态（跨会话记忆）
const SB_KEY = 'wb_elv_sidebar'
const sbOpen = ref(true)
function readSb () {
  try { return localStorage.getItem(SB_KEY) !== '0' } catch (e) { return true }
}
sbOpen.value = readSb()

// ---- 跨端适配：平板/手机 判定（<1024px 均视为紧凑布局，iPad 不再误判为桌面）----
const isCompact = ref(false)
// 抽屉语义：平板/手机上侧栏收进抽屉，need 用独立状态避免与桌面折叠混淆
const sbDrawerOpen = ref(false)
const mqCompact = window.matchMedia('(max-width: 1023px)')
function applyCompact (e) {
  isCompact.value = e.matches
  // 进入紧凑布局时关闭桌面式折叠记忆，抽屉默认关闭
  sbDrawerOpen.value = false
  if (e.matches) sbOpen.value = false
}
isCompact.value = mqCompact.matches
// 紧凑布局下侧栏初始为抽屉关闭态（覆盖桌面折叠记忆）
if (isCompact.value) { sbOpen.value = false; sbDrawerOpen.value = false }
const onMqChange = applyCompact
if (mqCompact.addEventListener) mqCompact.addEventListener('change', onMqChange)
else if (mqCompact.addListener) mqCompact.addListener(onMqChange)
// 兼容第三方组件/旧代码对 toggleSb 的引用，统一指向带抽屉语义的版本
function toggleSb () {
  if (isCompact.value) {
    sbDrawerOpen.value = !sbDrawerOpen.value
  } else {
    sbOpen.value = !sbOpen.value
    try { localStorage.setItem(SB_KEY, sbOpen.value ? '1' : '0') } catch (e) {}
  }
}

const NAV = [
  ['projects', 'folder', '项目轨道'],
  ['database', 'db', '资料库'],
  ['settings', 'set', '系统配置']
]

// 最近项目快捷轨道（侧栏）
const recentProjects = computed(() => projects.value.slice(-6).reverse())

const viewMap = {
  projects: ProjectsView,
  database: DatabaseView,
  search: SearchView,
  settings: SettingsView
}
const currentView = computed(() => viewMap[curTab.value] || ProjectsView)
const pageTitle = computed(() => {
  if (curTab.value === 'search') return '全局搜索'
  if (curTab.value !== 'projects') {
    const m = NAV.find(n => n[0] === curTab.value)
    return m ? m[2] : ''
  }
  if (curView.value === 'board') return '项目看板'
  if (curView.value === 'detail' || curView.value === 'bill') {
    const p = store.projectById(store.curProjId)
    return p ? p.项目名称 : '项目轨道'
  }
  return '项目轨道'
})

function switchTab (t) {
  store.curTab = t
  store.curView = 'list'
  store.curProjId = null
  store.curSub = null
}

// 风格工作室弹窗（经 DialogHost 渲染）
function openStyleStudio () { openDialog(StyleStudio, {}) }

function openProject (id) {
  store.curTab = 'projects'
  store.curView = 'detail'
  store.curProjId = id
  store.curSub = null
}
function togglePalette (v) {
  paletteOpen.value = v === undefined ? !paletteOpen.value : v
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
    togglePalette(true)
  }
}

onMounted(() => {
  store.init()
  initStyleStudio()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (mqCompact.removeEventListener) mqCompact.removeEventListener('change', onMqChange)
  else if (mqCompact.removeListener) mqCompact.removeListener(onMqChange)
})
</script>

<template>
  <div class="app" :class="{ 'sb-collapsed': !isCompact && !sbOpen, 'sb-drawer': isCompact }">
    <!-- 折叠后的展开按钮（桌面；平板/手机上由顶栏汉堡触发） -->
    <button v-if="!sbOpen && !isCompact" class="sb-expand" title="展开侧边栏" @click="toggleSb"><VIcon name="list" :size="18" /></button>

    <!-- 平板/手机：顶栏汉堡按钮 -->
    <button v-if="isCompact" class="sb-drawer-toggle" title="菜单" @click="toggleSb"><VIcon name="list" :size="22" /></button>
    <!-- 平板/手机：侧栏抽屉遮罩 -->
    <div v-if="isCompact && sbDrawerOpen" class="sb-mask" @click="toggleSb"></div>

    <!-- PC 侧边栏：玻璃浮动面板（可折叠）；平板/手机会变装为抽屉 -->
    <aside class="sidebar" :class="{ open: sbOpen, drawer: isCompact }">
      <div class="sb-collapse" title="收起侧边栏" @click="toggleSb"><VIcon name="x" :size="14" /></div>
      <div class="brand">
        <div class="brand-logo"><VIcon name="zap" :size="20" /></div>
        <div>
          <div class="brand-name">弱电智能化设计台</div>
          <div class="brand-sub">ELV · 设计工作台</div>
        </div>
      </div>
      <nav class="nav">
        <button v-for="n in NAV" :key="n[0]" class="nav-item" :class="{ active: curTab === n[0] }" @click="switchTab(n[0])">
          <VIcon :name="n[1]" /><span>{{ n[2] }}</span>
        </button>
        <button class="nav-item" title="命令面板 ⌘K" @click="togglePalette(true)">
          <VIcon name="search" /><span>命令 <kbd class="kbd">⌘K</kbd></span>
        </button>
        <div v-if="recentProjects.length" class="rail-projects">
          <div class="rail-label">最近项目</div>
          <button v-for="rp in recentProjects" :key="rp.id" class="rail-project" :class="{ active: curTab === 'projects' && curProjId === rp.id }" @click="openProject(rp.id)">
            <span class="rp-dot" :class="{ done: rp.状态 === '已完成' || rp.状态 === '已归档' }"></span>
            <span class="rp-name">{{ rp.项目名称 }}</span>
          </button>
        </div>
      </nav>
      <div class="side-foot">
        <div class="sync-state">
          <span class="dot" :class="{ off: !online }"></span>
          <span>{{ syncText }}</span>
        </div>
        <div class="t-dim">图签栏 · 本地存储 · 预留云端</div>
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
          <button class="btn btn-ghost" title="界面风格" @click="openStyleStudio"><VIcon name="palette" /><span>风格</span></button>
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
      <button class="nav-item" :class="{ active: curTab === 'search' }" @click="togglePalette(true)">
        <VIcon name="search" /><span>命令</span>
      </button>
    </nav>

    <DialogHost />
    <ToastHost />
    <CommandPalette v-if="paletteOpen" @close="togglePalette(false)" />
  </div>
</template>