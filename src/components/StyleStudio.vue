<script setup>
// UI 风格工作室：预置风格一键切换 + 自定义风格创建/编辑/删除
// 未来新增的 UI 风格只需登记进 db/styles.js 的 PRESET_STYLES，即自动出现在本面板。
import { ref, computed } from 'vue'
import { PRESET_STYLES } from '../db/styles'
import { styleStudio, CUSTOM_VAR_KEYS } from '../composables/style'
import ModalBase from './ui/ModalBase.vue'
import VIcon from './ui/VIcon.vue'

const emit = defineEmits(['close'])

const allStyles = computed(() => [...PRESET_STYLES, ...styleStudio.customStyles.value])

// ---------- 自定义风格编辑器 ----------
const editing = ref(null) // null = 未打开；{mode:'new'|'edit', id?, name} 
const edName = ref('')
const edVars = ref({})

function openNew () {
  edName.value = '我的风格 ' + (styleStudio.customStyles.value.length + 1)
  // 以当前生效变量为基底（读取 :root 计算样式）
  const rs = getComputedStyle(document.documentElement)
  edVars.value = {}
  CUSTOM_VAR_KEYS.forEach(([k]) => { edVars.value[k] = rs.getPropertyValue(k).trim() })
  editing.value = { mode: 'new' }
}
function openEdit (c) {
  edName.value = c.name
  edVars.value = {}
  const rs = getComputedStyle(document.documentElement)
  CUSTOM_VAR_KEYS.forEach(([k]) => {
    edVars.value[k] = (c.vars && c.vars[k]) || rs.getPropertyValue(k).trim()
  })
  editing.value = { mode: 'edit', id: c.id }
}
function livePreview () {
  // 编辑过程中实时预览关键变量
  const r = document.documentElement
  CUSTOM_VAR_KEYS.forEach(([k]) => {
    if (edVars.value[k] && String(edVars.value[k]).trim()) r.style.setProperty(k, edVars.value[k])
  })
}
function closeEditor () {
  // 关闭编辑器：恢复当前选中风格
  editing.value = null
  styleStudio.apply(styleStudio.styleId.value)
}
function saveCustom () {
  if (!edName.value.trim()) return
  const overrides = {}
  CUSTOM_VAR_KEYS.forEach(([k]) => {
    if (edVars.value[k] && String(edVars.value[k]).trim()) overrides[k] = edVars.value[k]
  })
  if (editing.value.mode === 'edit') {
    styleStudio.updateCustom(editing.value.id, edName.value.trim(), overrides)
  } else {
    styleStudio.addCustom(edName.value.trim(), {}, overrides)
  }
  editing.value = null
  emitPreviewNote()
}
function emitPreviewNote () {
}

function removeCustom (c) {
  styleStudio.removeCustom(c.id)
}

// 色板占位：edVars 扩展用于让 color input 也可表达（仍保存原字符串）
function colorVal (k, def) {
  const v = edVars.value[k]
  if (!v) return def || '#000000'
  const m = String(v).match(/#[0-9a-fA-F]{6}|rgba?\([^)]+\)/)
  return m ? m[0] : def || '#000000'
}
function onColor (k, hex) {
  edVars.value[k] = hex
  livePreview()
}
// 自定义风格卡片的取色（从 vars 或当前计算样式取主色/强调色）
function colorVal2 (c, k, def) {
  const set = c.vars || {}
  const primary = set['--primary'] || set['--accent']
  if (k === '--primary') {
    if (set['--primary']) { const m = String(set['--primary']).match(/#[0-9a-fA-F]{6}|rgba?\([^)]+\)/); return m ? m[0] : def }
    if (set['--accent']) return '#b5651d'
    return def
  }
  if (k === '--accent') {
    if (set['--accent']) { const m = String(set['--accent']).match(/#[0-9a-fA-F]{6}|rgba?\([^)]+\)/); return m ? m[0] : def }
    if (set['--primary']) return '#0e8e9a'
    return def
  }
  return def
}
</script>

<template>
  <ModalBase title="界面风格 · Style Studio" width="700px" @close="emit('close')">
    <!-- 预置风格 -->
    <label>预置风格 <span style="opacity:.65;font-weight:400">一键切换整体视觉</span></label>
    <div class="ss-grid">
      <div v-for="s in PRESET_STYLES" :key="s.id" class="ss-card" :class="{ on: styleStudio.styleId.value === s.id }" @click="styleStudio.setStyle(s.id)">
        <div class="swatch" :style="{ background: `linear-gradient(135deg, ${s.swatch[0]} 0%, ${s.swatch[1]} 55%, ${s.swatch[2]} 130%)` }"></div>
        <div class="s-info">
          <div class="s-name">{{ s.name }}
            <span v-if="styleStudio.styleId.value === s.id" class="s-ok"><VIcon name="check" :size="12" /></span>
          </div>
          <div class="s-desc">{{ s.desc }}</div>
          <div class="s-tags"><span v-for="t in s.tags" :key="t" class="tag">{{ t }}</span></div>
        </div>
      </div>
    </div>

    <!-- 自定义风格 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 6px">
      <label style="margin:0">自定义风格 <span style="opacity:.65;font-weight:400">基于任意预置风格调色保存</span></label>
      <button class="btn btn-primary btn-sm" @click="openNew"><VIcon name="plus" :size="15" />新建风格</button>
    </div>
    <div v-if="styleStudio.customStyles.value.length" class="ss-grid">
      <div v-for="c in styleStudio.customStyles.value" :key="c.id" class="ss-card custom" :class="{ on: styleStudio.styleId.value === c.id }" @click="styleStudio.setStyle(c.id)">
        <div class="swatch" :style="{ background: `linear-gradient(135deg, ${colorVal2(c, '--primary', '#0a84ff')} 0%, ${colorVal2(c, '--accent', '#00a5ad')} 60%)` }"></div>
        <div class="s-info">
          <div class="s-name">{{ c.name }}
            <span v-if="styleStudio.styleId.value === c.id" class="s-ok"><VIcon name="check" :size="12" /></span>
          </div>
          <div class="s-desc">自定义风格 · 点击应用</div>
          <div class="s-tags">
            <button class="tag act" title="编辑" @click.stop="openEdit(c)"><VIcon name="edit" :size="11" />编辑</button>
            <button class="tag act del" title="删除" @click.stop="removeCustom(c)"><VIcon name="trash" :size="11" />删除</button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="ss-empty">还没有自定义风格。「新建风格」后可自由调色并长期保存，之后任一行 UI 风格都可登记进来供一键切换。</div>

    <template #foot>
      <button class="btn btn-ghost" @click="emit('close')">关闭</button>
    </template>

    <!-- 自定义编辑器（内嵌于同一弹窗） -->
    <div v-if="editing" class="ss-mask" @click.self="closeEditor">
      <div class="ss-editor">
        <div class="dialog-head">
          <h3>{{ editing.mode === 'edit' ? '编辑自定义风格' : '新建自定义风格' }}</h3>
          <button class="btn btn-icon" @click="closeEditor"><VIcon name="x" /></button>
        </div>
        <div class="fitem"><label>风格名称</label><input v-model="edName" placeholder="如：我的工程蓝"></div>
        <div class="frow" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
          <div v-for="([k, lbl]) in CUSTOM_VAR_KEYS" :key="k" class="fitem">
            <label :style="k === '--wallpaper' ? 'color:var(--text3)' : ''">{{ lbl }}</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input v-if="k === '--radius'" v-model="edVars[k]" placeholder="16px" style="font-family:var(--mono)">
              <input v-else-if="k === '--wallpaper'" v-model="edVars[k]" placeholder="linear-gradient(...)" style="font-family:var(--mono);font-size:12px">
              <input v-else :value="colorVal(k)" type="color" style="width:46px;padding:3px;height:40px;flex-shrink:0" @input="e => onColor(k, e.target.value)">
              <input v-if="k !== '--radius' && k !== '--wallpaper'" :value="edVars[k]" style="font-family:var(--mono);font-size:12px" @input="e => { edVars[k] = e.target.value; livePreview() }">
            </div>
          </div>
        </div>
        <div class="hint">改动实时预览；「保存」后写入自定义风格列表，随时一键切换。也可先点选任意预置风格作为基底再微调。</div>
        <div class="dialog-foot">
          <button class="btn btn-ghost" @click="closeEditor">取消</button>
          <button class="btn btn-primary" @click="saveCustom"><VIcon name="save" :size="16" />保存风格</button>
        </div>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.ss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:10px}
.ss-card{display:flex;gap:12px;align-items:center;background:var(--glass-1);border:1px solid var(--line);border-radius:16px;padding:12px;cursor:pointer;transition:all .18s}
.ss-card:hover{border-color:var(--primary);transform:translateY(-2px);box-shadow:var(--hover-glow)}
.ss-card.on{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary), var(--shadow)}
.ss-card.custom{border-style:dashed}
.swatch{width:46px;height:46px;border-radius:13px;flex-shrink:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.4), 0 3px 10px rgba(0,0,0,.18)}
.s-info{min-width:0}
.s-name{font-weight:700;font-size:14px;color:var(--text);display:flex;align-items:center;gap:5px}
.s-ok{width:17px;height:17px;border-radius:50%;background:var(--primary);color:#fff;display:inline-flex;align-items:center;justify-content:center}
.s-desc{font-size:11.5px;color:var(--text3);margin-top:2px;line-height:1.4}
.s-tags{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}
.s-tags .tag{font-size:10.5px;color:var(--text3);background:var(--chip-bg);border:1px solid var(--line);border-radius:999px;padding:1px 7px}
.s-tags .tag.act{display:inline-flex;align-items:center;gap:3px;color:var(--accent);cursor:pointer;border-color:var(--blue-line);background:var(--blue-bg)}
.s-tags .tag.act:hover{color:var(--primary)}
.s-tags .tag.act.del{color:var(--red-ink);border-color:var(--red-line);background:var(--red-l)}
.s-tags .tag.act.del:hover{filter:brightness(1.1)}
.ss-empty{padding:22px 8px;font-size:12.5px;color:var(--text3);text-align:center;border:1px dashed var(--line2);border-radius:14px;margin-top:10px}
.ss-mask{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;
  background:var(--mask-bg);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.ss-editor{width:100%;max-width:640px;max-height:86vh;overflow:auto;padding:20px;border-radius:24px;
  background:var(--glass-3);border:1px solid var(--glass-edge);
  box-shadow:var(--shadow-lg),inset 0 1px 0 rgba(255,255,255,.6);
  backdrop-filter:blur(30px) saturate(1.6);-webkit-backdrop-filter:blur(30px) saturate(1.6)}
</style>