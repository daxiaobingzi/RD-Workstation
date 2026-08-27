<script setup>
// 查看同步冲突留档内容（只读）
import { ref, onMounted } from 'vue'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'

const props = defineProps({
  entry: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const loading = ref(false)
const content = ref('')

onMounted(async () => {
  if (!props.entry) return
  loading.value = true
  const data = await store.readConflictArchive(props.entry.object)
  content.value = data ? JSON.stringify(data, null, 2) : '（无法读取归档内容：可能已删除，或 AK 无该对象读取权限）'
  loading.value = false
})
</script>

<template>
  <ModalBase :title="'冲突留档 · ' + (entry?.key || '')" width="680px" @close="emit('close')">
    <div class="c-meta">
      <span>发生时间：{{ entry?.at }}</span>
      <span class="badge" :class="entry?.winner === 'local' ? 'green' : 'gray'">{{ entry?.winner === 'local' ? '本地胜' : '云端胜' }}</span>
    </div>
    <div class="c-path">OSS 归档对象：data/{{ entry?.object }}.json</div>
    <pre v-if="content" class="c-json">{{ content }}</pre>
    <div v-else-if="loading" class="c-empty">正在读取归档内容…</div>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </ModalBase>
</template>

<style scoped>
.c-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text2);
  margin-bottom: 6px;
}
.c-path {
  font-size: 12px;
  color: var(--text3);
  margin-bottom: 10px;
}
.c-json {
  max-height: 46vh;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--glass-1);
  border: 1px solid var(--line);
  font-size: 12px;
  line-height: 1.6;
  color: var(--strong-text);
  white-space: pre-wrap;
  word-break: break-all;
}
.c-empty {
  padding: 22px;
  text-align: center;
  color: var(--text3);
}
</style>
