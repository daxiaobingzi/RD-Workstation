<script setup>
// 弹窗内容基座：标题 + 关闭按钮 + 内容区 + 底部操作区
import VIcon from './VIcon.vue'

defineProps({
  title: { type: String, default: '' },
  width: { type: String, default: '' }
})
const emit = defineEmits(['close'])
</script>

<template>
  <div :style="width ? { maxWidth: width } : {}" class="modal-body">
    <div class="dialog-head">
      <h3>{{ title }}</h3>
      <button class="btn btn-icon" aria-label="关闭" @click="emit('close')"><VIcon name="x" /></button>
    </div>
    <div class="modal-content">
      <slot />
    </div>
    <div v-if="$slots.foot" class="dialog-foot">
      <slot name="foot" />
    </div>
  </div>
</template>

<style scoped>
.modal-body { min-width: 320px; width: 100% }
.modal-content { overflow: visible }
</style>