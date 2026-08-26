<script setup>
// 新增 / 编辑品牌（品牌库）
import { reactive } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  brand: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { settings } = storeToRefs(store)
const isNew = !props.brand

const cats = ['安防', '网络通信', '音视频', '机房管路', '综合', '未分类']
const f = reactive({
  name: props.brand?.name || '',
  shortName: props.brand?.shortName || '',
  category: props.brand?.category || '未分类',
  status: props.brand?.status || '启用'
})

async function save () {
  const n = f.name.trim()
  if (!n) { store.toast('请填写品牌名称'); return }
  if ((settings.value.brands || []).some(x => x.id !== props.brand?.id && String(x.name).toLowerCase() === n.toLowerCase())) {
    store.toast('品牌「' + n + '」已存在'); return
  }
  if (isNew) {
    store.addBrand({ name: n, shortName: f.shortName.trim(), category: f.category, status: f.status })
  } else {
    store.saveBrand(props.brand, { name: n, shortName: f.shortName.trim(), category: f.category, status: f.status })
  }
  await store.saveAll()
  emit('close')
  store.toast(isNew ? '品牌已添加' : '品牌已保存')
}
</script>

<template>
  <ModalBase :title="isNew ? '新增品牌' : '编辑品牌'" @close="emit('close')">
    <div class="form-grid">
      <div class="fitem"><label>品牌名称 *</label><input v-model.trim="f.name" placeholder="如：海康威视"></div>
      <div class="fitem"><label>品牌简称</label><input v-model.trim="f.shortName" placeholder="如：海康"></div>
      <div class="fitem"><label>类别</label>
        <select v-model="f.category"><option v-for="c in cats" :key="c" :value="c">{{ c }}</option></select>
      </div>
      <div class="fitem"><label>状态</label>
        <select v-model="f.status"><option>启用</option><option>停用</option></select>
      </div>
    </div>
    <div class="hint">停用品牌不会出现在新的项目智能选型候选中，但已有项目的历史选型与清单不会被修改。</div>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>