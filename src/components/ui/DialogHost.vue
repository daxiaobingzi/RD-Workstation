<script setup>
// 动态弹窗宿主：渲染 dialogStack 全部层级（上层浮于下层之上）
import { onMounted, onBeforeUnmount } from 'vue'
import { dialogStack, closeDialog } from '../../composables/ui'

function onKey (e) {
  if (e.key === 'Escape' && dialogStack.value.length) closeDialog()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <!-- 渲染弹窗栈全部层级：上层弹窗浮于下层之上，关闭后下层原样保留（避免"重开"割裂感） -->
    <div v-for="(d, di) in dialogStack" :key="di + (d.component?.__file || 'd')" class="mask" :style="{ zIndex: 100 + di }" @click.self="closeDialog">
      <div class="dialog">
        <component :is="d.component" v-bind="d.props" @close="closeDialog" />
      </div>
    </div>
  </Teleport>
</template>