<script setup>
// 动态弹窗宿主：渲染 dialogStack 栈顶组件
import { onMounted, onBeforeUnmount } from 'vue'
import { dialogStack, closeDialog } from '../../composables/ui'

function onMask (e) {
  if (e.target === e.currentTarget) closeDialog()
}
function onKey (e) {
  if (e.key === 'Escape' && dialogStack.value.length) closeDialog()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="dialogStack.length" class="mask" @click.self="onMask">
      <div class="dialog" v-for="d in dialogStack.slice(-1)" :key="d.component?.__file || 'd'">
        <component :is="d.component" v-bind="d.props" @close="closeDialog" />
      </div>
    </div>
  </Teleport>
</template>