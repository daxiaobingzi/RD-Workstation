<script setup>
// ⌘K 命令面板：输入即执行（跳转 / 新建 / 保存 / 搜索 / 主题切换）
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import { openDialog } from '../composables/ui'
import { styleStudio } from '../composables/style'
import VIcon from './ui/VIcon.vue'
import ProjectFormDialog from './dialogs/ProjectFormDialog.vue'
import BootstrapProjectDialog from './dialogs/BootstrapProjectDialog.vue'
import PriceGovernDialog from './dialogs/PriceGovernDialog.vue'

const emit = defineEmits(['close'])
const store = useAppStore()
const { projects, curProjId, curTab } = storeToRefs(store)

const q = ref('')
const active = ref(0)
const inputEl = ref(null)

// 与 ThemeSwitch 共用同一主题 key（wb_elv_theme），并联动风格引擎明暗重放
const theme = ref(document.documentElement.getAttribute('data-theme') || (window.localStorage.getItem('wb_elv_theme') || 'light'))

function switchTheme () {
  const next = theme.value === 'dark' ? 'light' : 'dark'
  theme.value = next
  document.documentElement.setAttribute('data-theme', next)
  try { window.localStorage.setItem('wb_elv_theme', next) } catch (e) {}
  styleStudio.reapply()
}

// 命令列表（每组：action + label + desc + hotkey）
const commands = computed(() => {
  const cmds = [
    { id: 'nav-projects', icon: 'folder', label: '前往项目轨道', desc: '查看全部项目', run: () => { store.curTab = 'projects'; store.curView = 'list' } },
    { id: 'nav-database', icon: 'db', label: '前往资料库', desc: '设备字典 · 品牌价格', run: () => { store.curTab = 'database' } },
    { id: 'nav-settings', icon: 'set', label: '前往系统配置', desc: '子系统 · 品牌 · 定额 · 模板', run: () => { store.curTab = 'settings' } },
    { id: 'new-project', icon: 'plus', label: '新建项目', desc: '创建空白项目', run: () => openDialog(ProjectFormDialog, { newProject: true }) },
    { id: 'bootstrap', icon: 'zap', label: '模板起盘…', desc: '一键生成项目骨架并按面积缩放', run: () => openDialog(BootstrapProjectDialog, {}) },
    { id: 'save', icon: 'save', label: '保存全部数据', desc: 'Ctrl+S', run: () => store.saveAll().then(() => store.toast('已保存')) },
    { id: 'toggle-theme', icon: 'set', label: theme.value === 'dark' ? '切换到浅色主题' : '切换到深色主题', desc: '深色 / 浅色', run: switchTheme },
    { id: 'preview-price', icon: 'db', label: '价格治理…', desc: '缺价体检 · 批量调价 · 品牌替换', run: () => { store.curTab = 'database'; openDialog(PriceGovernDialog, {}) } }
  ]
  // 项目快捷跳转
  projects.value.slice(-8).reverse().forEach(p => {
    cmds.push({ id: 'proj-' + p.id, icon: 'folder', label: '打开项目：' + p.项目名称, desc: p.项目编号 || p.建筑类型 || '', run: () => { store.curTab = 'projects'; store.curView = 'detail'; store.curProjId = p.id } })
  })
  return cmds.filter(c => !q.value || c.label.toLowerCase().includes(q.value.toLowerCase()) || c.desc.toLowerCase().includes(q.value.toLowerCase()))
})

function run (cmd) {
  emit('close')
  cmd.run()
}

function onKeydown (e) {
  if (e.key === 'Escape') { emit('close'); return }
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(active.value + 1, commands.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(active.value - 1, 0) }
  else if (e.key === 'Enter' && commands.value[active.value]) { e.preventDefault(); run(commands.value[active.value]) }
}
watch(q, () => { active.value = 0 })
watch(commands, () => { if (active.value >= commands.value.length) active.value = 0 })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  setTimeout(() => inputEl.value && inputEl.value.focus(), 30)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="palette-mask" @mousedown.self="emit('close')">
      <div class="palette">
        <div class="palette-input">
          <VIcon name="search" :size="16" style="color:var(--text3);flex-shrink:0" />
          <input ref="inputEl" v-model="q" placeholder="输入命令或项目名…（↑↓ 选择，Enter 执行，Esc 关闭）" @keydown.stop>
          <span class="kbd-tip">Esc</span>
        </div>
        <div class="palette-list">
          <button v-for="(c, i) in commands" :key="c.id" class="palette-item" :class="{ active: i === active }" @mousemove="active = i" @click="run(c)">
            <span class="p-ic"><VIcon :name="c.icon" :size="15" /></span>
            <span class="p-label">{{ c.label }}</span>
            <span class="p-desc">{{ c.desc }}</span>
          </button>
          <div v-if="!commands.length" class="palette-empty">没有匹配的命令，「搜索」请到搜索页输入内容。</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-mask{position:fixed;inset:0;background:var(--mask-bg);backdrop-filter:blur(6px);z-index:150;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
.palette{width:560px;max-width:92vw;background:var(--card3);border:1px solid var(--line3);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden;animation:palIn .18s ease}
@keyframes palIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
.palette-input{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
.palette-input input{border:none;background:none;font-size:15px;padding:4px 0;outline:none;color:var(--text)}
.kbd-tip{font-size:11px;color:var(--text3);border:1px solid var(--line2);border-radius:6px;padding:2px 8px;font-family:var(--mono)}
.palette-list{max-height:46vh;overflow-y:auto;padding:8px}
.palette-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border-radius:10px;text-align:left;color:var(--text2);transition:background .12s}
.palette-item .p-ic{width:26px;height:26px;border-radius:8px;background:var(--glass-1);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text3)}
.palette-item .p-label{font-size:14px;font-weight:600;color:var(--text);flex-shrink:0}
.palette-item .p-desc{font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.palette-item.active{background:var(--primary-l)}
.palette-item.active .p-ic{background:var(--primary);color:#fff;border-color:var(--primary)}
.palette-empty{padding:24px;text-align:center;color:var(--text3);font-size:13px}
</style>