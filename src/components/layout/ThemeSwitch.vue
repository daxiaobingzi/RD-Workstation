<script setup>
// 主题切换：白天 / 黑夜 / 随系统（状态 localStorage 'wb_elv_theme'，与初版一致）
import { ref, onMounted, onBeforeUnmount } from 'vue'
import VIcon from '../ui/VIcon.vue'

const KEY = 'wb_elv_theme'
const mode = ref('system')
let mq = null

function sysTheme () { return mq && mq.matches ? 'light' : 'dark' }
function readMode () {
  try {
    const m = localStorage.getItem(KEY)
    return (m === 'light' || m === 'dark' || m === 'system') ? m : 'system'
  } catch (e) { return 'system' }
}
function writeMode (m) { try { localStorage.setItem(KEY, m) } catch (e) {} }
function apply () {
  const m = readMode()
  mode.value = m
  document.documentElement.setAttribute('data-theme', m === 'system' ? sysTheme() : m)
}
function onChange () { if (readMode() === 'system') apply() }

onMounted(() => {
  mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null
  if (mq && mq.addEventListener) mq.addEventListener('change', onChange)
  apply()
})
onBeforeUnmount(() => {
  if (mq && mq.removeEventListener) mq.removeEventListener('change', onChange)
})
function setMode (m) { writeMode(m); apply() }
</script>

<template>
  <div class="theme-switch" role="group" aria-label="主题切换">
    <button :class="{ active: mode === 'light' }" title="白天" aria-label="白天主题" @click="setMode('light')">
      <VIcon name="sun" /><span>白天</span>
    </button>
    <button :class="{ active: mode === 'dark' }" title="黑夜" aria-label="黑夜主题" @click="setMode('dark')">
      <VIcon name="moon" /><span>黑夜</span>
    </button>
    <button :class="{ active: mode === 'system' }" title="随系统" aria-label="随系统" @click="setMode('system')">
      <VIcon name="monitor" /><span>随系统</span>
    </button>
  </div>
</template>