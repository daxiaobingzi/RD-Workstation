<script setup>
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
const store = useAppStore()
const { toastMsg, toastVisible } = storeToRefs(store)
</script>

<template>
  <Teleport to="body">
    <div v-if="toastVisible" class="toast">{{ toastMsg }}</div>
  </Teleport>
</template>