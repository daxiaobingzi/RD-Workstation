<script setup>
// UI 风格工作室：预置/自定义风格一键切换、编辑（基于副本）、删除（隐藏）、恢复
// 未来新增风格登记进 db/styles.js 的 PRESET_STYLES 即自动出现。
import { ref, computed } from 'vue'
import { PRESET_STYLES } from '../db/styles'
import { styleStudio, CUSTOM_VAR_KEYS } from '../composables/style'
import { confirmBox } from '../composables/ui'
import ModalBase from './ui/ModalBase.vue'
import VIcon from './ui/VIcon.vue'

const emit = defineEmits(['close'])

const visiblePresets = computed(() => PRESET_STYLES.filter(s => !styleStudio.hiddenPresets.value.includes(s.id)))
const hiddenPresets = computed(() => PRESET_STYLES.filter(s => styleStudio.hiddenPresets.value.includes(s.id)))

// 卡片取色
function colorOf (vars, k, def) {
  if (!vars) return def
  const v = vars[k]
  if (!v) return def
  const m = String(v).match(/#[0-9a-fA-F]{6}|rgba?\([^)]+\)/)
  return m ? m[0] : def
}
function presetSwatch (s) { return s.swatch || ['#0a84ff', '#00a5ad', '#eef3fb'] }
function customSwatch (c) {
  return [
    colorOf(c.light || {}, '--primary', '#0a84ff'),
    colorOf(c.light || {}, '--accent', '#00a5ad'),
    colorOf(c.light || {}, '--bg', '#eef3fb')
  ]
}

// ---------- 编辑器 ----------
const editing = ref(null) // { mode:'new'|'edit', baseId?, id?, name, tab }
const edName = ref('')
const edTab = ref('light')
const edLight = ref({})
const edDark = ref({})

function fillEdFromBase (baseId) {
  edLight.value = {}
  edDark.value = {}
  CUSTOM_VAR_KEYS.forEach(([k]) => {
    edLight.value[k] = styleStudio.varsOf(baseId, 'light')[k] || ''
    edDark.value[k] = styleStudio.varsOf(baseId, 'dark')[k] || ''
  })
}
function openNew (baseId) {
  const base = styleStudio.styleMeta(baseId) || { name: '自定义' }
  edName.value = '我的风格 · ' + base.name
  edTab.value = 'light'
  fillEdFromBase(baseId)
  editing.value = { mode: 'new', baseId }
}
// 编辑预置 = 副本编辑；编辑自定义 = 原样修改
function openEdit (s) {
  if (!s.custom) { openNew(s.id); return }
  edName.value = s.name
  edTab.value = 'light'
  edLight.value = {}; edDark.value = {}
  CUSTOM_VAR_KEYS.forEach(([k]) => {
    edLight.value[k] = (s.light && s.light[k]) || ''
    edDark.value[k] = (s.dark && s.dark[k]) || ''
  })
  editing.value = { mode: 'edit', id: s.id, baseId: s.id }
}
function livePreview () {
  const target = edTab.value === 'dark' ? edDark.value : edLight.value
  styleStudio.previewVars(edTab.value, target, editing.value?.baseId)
}
function closeEditor () {
  editing.value = null
  styleStudio.apply(styleStudio.styleId.value)
}
function saveCustom () {
  if (!edName.value.trim()) return
  const ov = { light: edLight.value, dark: edDark.value }
  if (editing.value.mode === 'edit') {
    styleStudio.updateCustom(editing.value.id, edName.value.trim(), ov)
  } else {
    styleStudio.createCustomFrom(editing.value.baseId, edName.value.trim(), ov)
  }
  editing.value = null
  emit('preview')
}

// 删除预置 = 隐藏；删除自定义 = 真删
async function removeStyle (s) {
  if (s.custom) {
    const ok = await confirmBox(`删除自定义风格「${s.name}」？删除后不可恢复。`, '删除自定义风格')
    if (!ok) return
    styleStudio.removeCustom(s.id)
  } else {
    const ok = await confirmBox(`从列表中移除预置风格「${s.name}」？可在底部「已移除」中随时恢复。`, '移除预置风格')
    if (!ok) return
    styleStudio.hidePreset(s.id)
  }
  emit('preview')
}
</script>

<template>
  <ModalBase title="界面风格 · Style Studio" width="720px" @close="emit('close')">
    <!-- 预置风格 -->
    <label>预置风格 <span style="opacity:.65;font-weight:400">一键切换 · 可编辑副本 · 可移除恢复</span></label>
    <div class="ss-grid">
      <div v-for="s in visiblePresets" :key="s.id" class="ss-card" :class="{ on: styleStudio.styleId.value === s.id }" @click="styleStudio.setStyle(s.id)">
        <div class="swatch" :style="{ background: `linear-gradient(135deg, ${presetSwatch(s)[0]} 0%, ${presetSwatch(s)[1]} 55%, ${presetSwatch(s)[2]} 130%)` }"></div>
        <div class="s-info">
          <div class="s-name">{{ s.name }}
            <span v-if="styleStudio.styleId.value === s.id" class="s-ok"><VIcon name="check" :size="12" /></span>
          </div>
          <div class="s-desc">{{ s.desc }}</div>
          <div class="s-tags"><span v-for="t in s.tags" :key="t" class="tag">{{ t }}</span></div>
        </div>
        <div class="s-ops">
          <button class="op" title="基于此风格新建副本编辑" @click.stop="openEdit(s)"><VIcon name="edit" :size="13" /></button>
          <button class="op del" title="从列表中移除（可恢复）" @click.stop="removeStyle(s)"><VIcon name="trash" :size="13" /></button>
        </div>
      </div>
    </div>

    <!-- 已移除的预置（可恢复） -->
    <div v-if="hiddenPresets.length" style="margin-top:12px">
      <div class="ss-hd">已移除（点击恢复）</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button v-for="s in hiddenPresets" :key="s.id" class="ss-restore" @click="styleStudio.restorePreset(s.id)">
          <span class="swatch sm" :style="{ background: `linear-gradient(135deg, ${presetSwatch(s)[0]}, ${presetSwatch(s)[1]})` }"></span>{{ s.name }}
        </button>
      </div>
    </div>

    <!-- 自定义风格 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 6px">
      <label style="margin:0">自定义风格 <span style="opacity:.65;font-weight:400">基于任意风格副本调色保存</span></label>
      <button class="btn btn-primary btn-sm" @click="openNew(styleStudio.styleId.value)"><VIcon name="plus" :size="15" />新建风格</button>
    </div>
    <div v-if="styleStudio.customStyles.value.length" class="ss-grid">
      <div v-for="c in styleStudio.customStyles.value" :key="c.id" class="ss-card custom" :class="{ on: styleStudio.styleId.value === c.id }" @click="styleStudio.setStyle(c.id)">
        <div class="swatch" :style="{ background: `linear-gradient(135deg, ${customSwatch(c)[0]} 0%, ${customSwatch(c)[1]} 60%)` }"></div>
        <div class="s-info">
          <div class="s-name">{{ c.name }}
            <span v-if="styleStudio.styleId.value === c.id" class="s-ok"><VIcon name="check" :size="12" /></span>
          </div>
          <div class="s-desc">自定义风格 · 支持明暗双主题</div>
          <div class="s-tags">
            <button class="tag act" title="编辑" @click.stop="openEdit(c)"><VIcon name="edit" :size="11" />编辑</button>
            <button class="tag act del" title="删除" @click.stop="removeStyle(c)"><VIcon name="trash" :size="11" />删除</button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="ss-empty">还没有自定义风格。「新建风格」可基于当前风格调色并长期保存，未来任何新 UI 风格都可登记进系统供一键切换。</div>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">关闭</button>
    </template>

    <!-- 自定义编辑器 -->
    <div v-if="editing" class="ss-mask" @click.self="closeEditor">
      <div class="ss-editor">
        <div class="dialog-head">
          <h3>{{ editing.mode === 'edit' ? '编辑自定义风格' : '新建自定义风格' }}</h3>
          <button class="btn btn-icon" @click="closeEditor"><VIcon name="x" /></button>
        </div>
        <div class="fitem"><label>风格名称</label><input v-model="edName" placeholder="如：我的工程蓝"></div>

        <!-- 明暗双主题编辑 -->
        <div class="ed-tabs">
          <button :class="{ on: edTab === 'light' }" @click="edTab = 'light'; livePreview()">亮色主题</button>
          <button :class="{ on: edTab === 'dark' }" @click="edTab = 'dark'; livePreview()">暗色主题</button>
        </div>
        <div class="frow" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
          <div v-for="([k, lbl]) in CUSTOM_VAR_KEYS" :key="k" class="fitem">
            <label :style="k === '--wallpaper' ? 'color:var(--text3)' : ''">{{ lbl }}</label>
            <div style="display:flex;gap:6px;align-items:center">
              <template v-if="edTab === 'light'">
                <input v-if="k === '--radius'" v-model="edLight[k]" placeholder="16px" style="font-family:var(--mono)">
                <input v-else-if="k === '--wallpaper'" v-model="edLight[k]" placeholder="linear-gradient(...)" style="font-family:var(--mono);font-size:12px">
                <template v-else>
                  <input :value="colorOf(edLight, k, '#000000')" type="color" style="width:46px;padding:3px;height:40px;flex-shrink:0" @input="e => { edLight[k] = e.target.value; livePreview() }">
                  <input :value="edLight[k]" style="font-family:var(--mono);font-size:12px" @input="e => { edLight[k] = e.target.value; livePreview() }">
                </template>
              </template>
              <template v-else>
                <input v-if="k === '--radius'" v-model="edDark[k]" placeholder="16px" style="font-family:var(--mono)">
                <input v-else-if="k === '--wallpaper'" v-model="edDark[k]" placeholder="linear-gradient(...)" style="font-family:var(--mono);font-size:12px">
                <template v-else>
                  <input :value="colorOf(edDark, k, '#000000')" type="color" style="width:46px;padding:3px;height:40px;flex-shrink:0" @input="e => { edDark[k] = e.target.value; livePreview() }">
                  <input :value="edDark[k]" style="font-family:var(--mono);font-size:12px" @input="e => { edDark[k] = e.target.value; livePreview() }">
                </template>
              </template>
            </div>
          </div>
        </div>
        <div class="hint">改动即时预览当前主题；也可切换「暗色主题」分别校准。保存时亮/暗两套一并写入该风格。</div>
        <div class="dialog-foot">
          <button class="btn btn-ghost" @click="closeEditor">取消</button>
          <button class="btn btn-primary" @click="saveCustom"><VIcon name="save" :size="16" />保存风格</button>
        </div>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.ss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:10px;margin-top:10px}
.ss-card{display:flex;gap:12px;align-items:center;background:var(--glass-1);border:1px solid var(--line);border-radius:16px;padding:12px;cursor:pointer;transition:all .18s;position:relative}
.ss-card:hover{border-color:var(--primary);transform:translateY(-2px);box-shadow:var(--hover-glow)}
.ss-card.on{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary), var(--shadow)}
.ss-card.custom{border-style:dashed}
.swatch{width:46px;height:46px;border-radius:13px;flex-shrink:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.4), 0 3px 10px rgba(0,0,0,.18)}
.swatch.sm{width:22px;height:22px;border-radius:7px}
.s-info{min-width:0;flex:1}
.s-name{font-weight:700;font-size:14px;color:var(--text);display:flex;align-items:center;gap:5px}
.s-ok{width:17px;height:17px;border-radius:50%;background:var(--primary);color:#fff;display:inline-flex;align-items:center;justify-content:center}
.s-desc{font-size:11.5px;color:var(--text3);margin-top:2px;line-height:1.4}
.s-tags{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}
.s-tags .tag{font-size:10.5px;color:var(--text3);background:var(--chip-bg);border:1px solid var(--line);border-radius:999px;padding:1px 7px}
.s-tags .tag.act{display:inline-flex;align-items:center;gap:3px;color:var(--accent);cursor:pointer;border-color:var(--blue-line);background:var(--blue-bg)}
.s-tags .tag.act:hover{color:var(--primary)}
.s-tags .tag.act.del{color:var(--red-ink);border-color:var(--red-line);background:var(--red-l)}
.s-tags .tag.act.del:hover{filter:brightness(1.1)}
/* 卡片右上操作钮（编辑/删除） */
.s-ops{position:absolute;right:8px;bottom:8px;display:flex;gap:4px;opacity:0;transition:opacity .15s}
.ss-card:hover .s-ops{opacity:1}
.s-ops .op{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--text3);background:var(--glass-2);border:1px solid var(--line)}
.s-ops .op:hover{color:var(--primary);border-color:var(--primary)}
.s-ops .op.del:hover{color:var(--red-ink);border-color:var(--red-line);background:var(--red-l)}
.ss-hd{font-size:12px;color:var(--text3);margin-bottom:6px;font-weight:600}
.ss-restore{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;font-size:12.5px;color:var(--text2);
  background:var(--glass-1);border:1px dashed var(--line2);cursor:pointer;transition:all .15s}
.ss-restore:hover{color:var(--primary);border-color:var(--primary)}
.ss-empty{padding:22px 8px;font-size:12.5px;color:var(--text3);text-align:center;border:1px dashed var(--line2);border-radius:14px;margin-top:10px}
/* 编辑器 */
.ss-mask{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;
  background:var(--mask-bg);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.ss-editor{width:100%;max-width:680px;max-height:88vh;overflow:auto;padding:20px;border-radius:24px;
  background:var(--glass-3);border:1px solid var(--glass-edge);
  box-shadow:var(--shadow-lg),inset 0 1px 0 rgba(255,255,255,.6);
  backdrop-filter:blur(30px) saturate(1.6);-webkit-backdrop-filter:blur(30px) saturate(1.6)}
.ed-tabs{display:flex;gap:6px;margin:6px 0 12px}
.ed-tabs button{flex:1;padding:8px 0;border-radius:999px;font-size:13px;font-weight:600;color:var(--text2);
  background:var(--glass-1);border:1px solid var(--line);cursor:pointer;transition:all .18s}
.ed-tabs button.on{background:var(--tab-active-bg);color:#fff;border-color:transparent;box-shadow:var(--tab-active-shadow)}
</style>