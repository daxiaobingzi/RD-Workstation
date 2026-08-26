// ===== UI 风格引擎：应用预置/自定义风格、持久化自定义风格集、支持编辑/隐藏 =====
import { ref } from 'vue'
import { PRESET_STYLES, PRESET_IDS } from '../db/styles'

const KEY_STYLE = 'wb_elv_ui_style'        // 当前选中风格 id
const KEY_CUSTOM = 'wb_elv_custom_styles'  // 自定义风格列表
const KEY_HIDDEN = 'wb_elv_hidden_styles'  // 被隐藏（删除）的预置风格 id

// 允许用户自定义的核心变量（编辑器中展示，缺省的从基底风格继承）
export const CUSTOM_VAR_KEYS = [
  ['--bg', '背景底色'],
  ['--glass', '卡片玻璃'],
  ['--text', '正文文字'],
  ['--primary', '主色'],
  ['--accent', '强调色'],
  ['--radius', '圆角'],
  ['--wallpaper', '壁纸渐变'],
  ['--blob-1', '光斑一'],
  ['--blob-2', '光斑二'],
  ['--blob-3', '光斑三'],
  ['--blob-4', '光斑四']
]

// 各主题对应的完整变量表（用于复制/继承基底）
const ALL_VAR_KEYS = [
  '--bg','--bg2','--bg3','--glass','--glass-2','--glass-3','--glass-edge',
  '--line','--line2','--line3','--text','--text2','--text3','--strong-text',
  '--primary','--primary-d','--primary-hover','--primary-l','--accent','--accent-l','--on-primary',
  '--orange','--amber','--lime','--green','--green-l','--green-ink','--green-line',
  '--red','--red-l','--red-ink','--red-line','--amber-l','--amber-ink','--amber-line',
  '--gray','--gray-bg','--gray-ink','--gray-line','--blue-bg','--blue-ink','--blue-line',
  '--radius','--shadow','--shadow-lg','--input-bg','--input-border','--input-focus-ring',
  '--blob-1','--blob-2','--blob-3','--blob-4','--wallpaper','--glow-a','--glow-b',
  '--sb-bg','--sb-line','--sb-text','--sb-hover','--brand-text','--nav-active-bg',
  '--tab-active-bg','--tab-active-shadow','--title-grad','--th-bg','--th-ink','--tbl-hover','--td-line',
  '--chip-bg','--prog-track','--mask-bg','--btn-primary-bd','--btn-primary-glow','--btn-primary-glow-h',
  '--stat-grad','--hover-glow','--proj-hover-glow','--corner-a','--corner-b'
]

const root = () => (typeof document !== 'undefined' ? document.documentElement : null)
let appliedVars = [] // 当前已注入的变量名（切换时清空再重设，避免风格残留）

const styleId = ref('liquid-glass')
const customStyles = ref([])
const hiddenPresets = ref([])

function readJSON (k, d) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d }
}
function writeJSON (k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {}
}

// 恢复持久化状态（先恢复自定义列表，再据此校验当前选中风格）
function load () {
  customStyles.value = readJSON(KEY_CUSTOM, [])
  hiddenPresets.value = readJSON(KEY_HIDDEN, [])
  try {
    const s = localStorage.getItem(KEY_STYLE)
    const known = s && (PRESET_IDS.has(s) || customStyles.value.some(c => c.id === s))
    if (known && !hiddenPresets.value.includes(s)) styleId.value = s
  } catch (e) {}
}

// 当前主题（light | dark）
function themeNow () {
  const r = root()
  if (!r) return 'light'
  return r.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

// 风格 → 对应主题变量集（缺省时从当前计算样式兜底，保证 liquid-glass 等空变量基底可继承）
function varsOf (id, theme) {
  const t = theme || themeNow()
  const preset = PRESET_STYLES.find(p => p.id === id)
  if (preset) {
    const v = preset[t] || preset.light || {}
    if (Object.keys(v).length) return v
    return computedRootVars(t)
  }
  const custom = customStyles.value.find(c => c.id === id)
  if (custom) {
    const v = custom[t] || custom.light || {}
    if (Object.keys(v).length) return v
    return computedRootVars(t)
  }
  return computedRootVars(t)
}

// 从 :root 计算样式读取当前生效的完整变量表（用于继承基底的兜底）
function computedRootVars (theme) {
  const r = root()
  if (!r) return {}
  // 临时切换主题属性以读取对应主题变量（不修改持久化）
  const prev = r.getAttribute('data-theme')
  r.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light')
  const rs = window.getComputedStyle(r)
  const out = {}
  ALL_VAR_KEYS.forEach(k => {
    const v = rs.getPropertyValue(k).trim()
    if (v) out[k] = v
  })
  r.setAttribute('data-theme', prev || 'light')
  return out
}

// 风格元信息（供 UI 展示）
function styleMeta (id) {
  const preset = PRESET_STYLES.find(p => p.id === id)
  if (preset) return { id, name: preset.name, desc: preset.desc, tags: preset.tags, swatch: preset.swatch, custom: false }
  const custom = customStyles.value.find(c => c.id === id)
  if (custom) return { id, name: custom.name, desc: custom.desc || '自定义风格', tags: ['自定义'], swatch: [custom.light?.['--primary'] || '#0a84ff', custom.light?.['--accent'] || '#00a5ad', custom.light?.['--bg'] || '#eef3fb'], custom: true }
  return null
}

// 应用当前风格到 :root（persist=false 表示切换主题重放，不重复写盘）
function apply (id, persist = true) {
  const r = root()
  if (!r) return
  const idToApply = id !== undefined ? id : styleId.value
  styleId.value = idToApply
  const vars = varsOf(idToApply)
  appliedVars.forEach(k => r.style.removeProperty(k))
  appliedVars = []
  Object.keys(vars).forEach(k => {
    r.style.setProperty(k, vars[k])
    appliedVars.push(k)
  })
  if (persist) {
    try { localStorage.setItem(KEY_STYLE, idToApply) } catch (e) {}
  }
}

// 主题切换时重放当前风格（由 ThemeSwitch 调用，不写盘以免覆盖已恢复状态）
function reapply () { apply(styleId.value, false) }

function setStyle (id) {
  if (hiddenPresets.value.includes(id)) return
  apply(id)
}

// 显式恢复某主题变量到 :root（编辑器预览亮/暗用，baseId 指定继承基底）
function previewVars (theme, vars, baseId) {
  const r = root()
  if (!r) return
  appliedVars.forEach(k => r.style.removeProperty(k))
  appliedVars = []
  const base = varsOf(baseId || styleId.value, theme)
  const merged = Object.assign({}, base, vars)
  Object.keys(merged).forEach(k => {
    r.style.setProperty(k, merged[k])
    appliedVars.push(k)
  })
}

// 隐藏（删除）预置风格，可恢复
function hidePreset (id) {
  if (!PRESET_IDS.has(id)) return
  hiddenPresets.value = [...new Set([...hiddenPresets.value, id])]
  writeJSON(KEY_HIDDEN, hiddenPresets.value)
  if (styleId.value === id) apply(PRESET_STYLES[0].id)
}
function restorePreset (id) {
  hiddenPresets.value = hiddenPresets.value.filter(x => x !== id)
  writeJSON(KEY_HIDDEN, hiddenPresets.value)
}

function persistCustom () { writeJSON(KEY_CUSTOM, customStyles.value) }

// 以某风格（预置或自定义）为基底创建一个自定义风格
function createCustomFrom (baseId, name, overrides = {}) {
  const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const baseLight = varsOf(baseId, 'light')
  const baseDark = varsOf(baseId, 'dark')
  const light = Object.assign({}, baseLight, overrides.light || {})
  const dark = Object.assign({}, baseDark, overrides.dark || {})
  const item = { id, name, desc: '自定义风格', custom: true, light, dark, baseId }
  customStyles.value.push(item)
  persistCustom()
  apply(id)
  return item
}

// 更新自定义风格（可改名称与任一主题变量）
function updateCustom (id, name, overrides = {}) {
  const item = customStyles.value.find(c => c.id === id)
  if (!item) return
  if (name && String(name).trim()) item.name = String(name).trim()
  const applyOv = (tgt, ov) => {
    Object.keys(ov || {}).forEach(k => {
      if (ov[k] != null && String(ov[k]).trim()) tgt[k] = ov[k]
    })
  }
  applyOv(item.light, overrides.light)
  applyOv(item.dark, overrides.dark)
  persistCustom()
  if (styleId.value === id) apply(id)
}

function removeCustom (id) {
  customStyles.value = customStyles.value.filter(c => c.id !== id)
  persistCustom()
  if (styleId.value === id) apply(PRESET_STYLES[0].id)
}

function switchThemeAndApply () { reapply() }

export function useStyleStudio () {
  return {
    styleId, customStyles, hiddenPresets,
    load, apply, reapply, setStyle,
    createCustomFrom, updateCustom, removeCustom,
    hidePreset, restorePreset,
    persistCustom, themeNow, switchThemeAndApply,
    varsOf, styleMeta, previewVars
  }
}

export const styleStudio = useStyleStudio()

// 模块加载即恢复持久化状态（App.vue 挂载时再 apply 一次）
load()

export function initStyleStudio () {
  load()
  apply(styleId.value)
}