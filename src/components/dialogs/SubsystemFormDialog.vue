<script setup>
// 新增 / 编辑子系统（含扩展字段模板）
import { reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../../store'
import ModalBase from '../ui/ModalBase.vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  system: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const store = useAppStore()
const { settings } = storeToRefs(store)
const isNew = !props.system

const f = reactive({
  name: props.system?.name || '',
  category: props.system?.category || settings.value.subCategories[0] || '未分类'
})
const fields = ref(JSON.parse(JSON.stringify(props.system?.fields || [])))

function addField () { fields.value.push({ key: '', name: '', type: 'select', options: [] }) }
function delField (i) { fields.value.splice(i, 1) }

async function save () {
  const name = f.name.trim()
  if (!name) { store.toast('请填写子系统名称'); return }
  const cleanFields = fields.value.map(x => ({
    key: x.key.trim(), name: x.name.trim(), type: x.type || 'select',
    options: [...new Set(String(x.options || '').split(/[,，]/).map(s => s.trim()).filter(Boolean))]
  })).filter(x => x.key && x.name)

  if (isNew) {
    if (settings.value.subsystems.some(s => s.name === name)) { store.toast('子系统「' + name + '」已存在'); return }
    store.addSubsystem({ name, category: f.category, fields: cleanFields })
  } else {
    store.saveSubsystem(props.system, { name, category: f.category, fields: cleanFields })
  }
  await store.saveAll()
  emit('close')
  store.toast(isNew ? '子系统已添加' : '子系统已保存')
}
</script>

<template>
  <ModalBase :title="isNew ? '新增子系统' : '编辑子系统'" @close="emit('close')">
    <div class="form-grid">
      <div class="fitem"><label>子系统名称 *</label><input v-model.trim="f.name" placeholder="如：视频监控系统"></div>
      <div class="fitem"><label>分类</label>
        <select v-model="f.category">
          <option v-for="c in settings.subCategories" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
    </div>
    <div class="card-title" style="margin-top:8px">扩展字段 <span class="sub">点表录入时可填写的动态属性</span>
      <button class="btn btn-ghost btn-sm" @click="addField"><VIcon name="plus" />添加字段</button>
    </div>
    <div class="tbl-wrap"><table class="tbl" style="min-width:520px">
      <thead><tr><th>字段键</th><th>字段名</th><th>类型</th><th>选项（逗号分隔）</th><th></th></tr></thead>
      <tbody>
        <tr v-if="!fields.length"><td colspan="5" style="text-align:center;color:var(--text3);padding:16px">暂无扩展字段</td></tr>
        <tr v-for="(x, i) in fields" :key="i">
          <td><input v-model.trim="x.key" placeholder="如：resolution" style="min-width:110px"></td>
          <td><input v-model.trim="x.name" placeholder="如：分辨率" style="min-width:90px"></td>
          <td><select v-model="x.type" style="width:90px"><option>select</option><option>text</option></select></td>
          <td><input v-model="x.options" placeholder="如：2MP,4MP,8MP"></td>
          <td><button class="btn btn-icon btn-sm" style="color:var(--text3)" @click="delField(i)"><VIcon name="trash" :size="15" /></button></td>
        </tr>
      </tbody>
    </table></div>
    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" @click="save"><VIcon name="save" />保存</button>
    </template>
  </ModalBase>
</template>