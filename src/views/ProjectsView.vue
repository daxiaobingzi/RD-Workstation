<script setup>
// 项目管理入口：按当前视图分发 列表 / 看板 / 详情 / 清单
import { storeToRefs } from 'pinia'
import { useAppStore } from '../store'
import ProjectListView from './projects/ProjectListView.vue'
import ProjectBoardView from './projects/ProjectBoardView.vue'
import ProjectDetailView from './projects/ProjectDetailView.vue'
import ProjectBillView from './projects/ProjectBillView.vue'

const store = useAppStore()
const { curView, curProjId, projects } = storeToRefs(store)

function hasProject () { return curProjId.value && projects.value.some(x => x.id === curProjId.value) }
</script>

<template>
  <ProjectListView v-if="curView === 'list'" />
  <ProjectBoardView v-else-if="curView === 'board'" />
  <template v-else-if="hasProject()">
    <ProjectDetailView v-if="curView === 'detail'" />
    <ProjectBillView v-else-if="curView === 'bill'" />
  </template>
  <ProjectListView v-else />
</template>