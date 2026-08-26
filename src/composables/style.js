// ===== UI 风格引擎：应用预置/自定义风格、持久化自定义风格集 =====
import { ref } from 'vue'
import { PRESET_STYLES } from '../db/styles'

const KEY_STYLE = 'wb_elv_ui_style'     // 当前选中风格 id
const KEY_CUSTOM = 'wb_elv_custom_styles' // 自定义风格列表

// 允许用户自定义的核心变量（编辑器中展示，缺省的从选中风格继承）
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

const root = () => (typeof document !== 'undefined' ? document.documentElement : null)
let appliedVars = [] // 当前已注入的变量名（切换时清空再重设，避免风格残留）

const styleId = ref('liquid-glass')
const customStyles = ref([])

function load () {
  try {
    const s = localStorage.getItem(KEY_STYLE)
    if (s && (PRESET_STYLES.some(p => p.id === s) || customStyles.value.some(c => c.id === s))) styleId.value = s
  } catch (e) {}
  try {
    const c = localStorage.getItem(KEY_CUSTOM)
    if (c) {
      const arr = JSON.parse(c)
      if (Array.isArray(arr)) customStyles.value = arr
    }
  } catch (e) {}
}

// 当前主题（light | dark）
function themeNow () {
  const r = root()
  if (!r) return 'light'
  return r.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

// 风格 → 变量集
function varsOf (id) {
  const preset = PRESET_STYLES.find(p => p.id === id)
  if (preset) return preset[themeNow()] || preset.light || {}
  const custom = customStyles.value.find(c => c.id === id)
  if (custom) return custom.vars || {}
  return {}
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

// 主题切换时重放当前风格（由 ThemeSwitch 调用，不写盘以免覆盖已回复的状态）
function reapply () { apply(styleId.value, false) }

function setStyle (id) { apply(id) }

function persistCustom () {
  try { localStorage.setItem(KEY_CUSTOM, JSON.stringify(customStyles.value)) } catch (e) {}
}

// 新增自定义风格（从现有风格拷贝变量做基底）
function addCustom (name, baseVars, overrides = {}) {
  const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const preset = PRESET_STYLES.find(p => p.id === 'liquid-glass')
  const brown = preset && preset[themeNow()] ? preset[themeNow()] : {}
  const vars = Object.assign({}, brown, baseVars, overrides)
  const item = { id, name, desc: '自定义风格', tags: ['自定义'], custom: true, vars }
  customStyles.value.push(item)
  persistCustom()
  apply(id)
  return item
}

function updateCustom (id, name, overrides) {
  const item = customStyles.value.find(c => c.id === id)
  if (!item) return
  if (name) item.name = name
  Object.keys(overrides || {}).forEach(k => {
    if (overrides[k] && String(overrides[k]).trim()) item.vars[k] = overrides[k]
  })
  persistCustom()
  if (styleId.value === id) apply(id)
}

function removeCustom (id) {
  customStyles.value = customStyles.value.filter(c => c.id !== id)
  persistCustom()
  if (styleId.value === id) apply('liquid-glass')
}

function switchThemeAndApply (mode) {
  // 由 ThemeSwitch 在写入 data-theme 后调用，按新主题重放风格
  reapply()
}

export function useStyleStudio () {
  return {
    styleId, customStyles,
    load, apply, reapply, setStyle,
    addCustom, updateCustom, removeCustom,
    persistCustom, themeNow, switchThemeAndApply,
    varsOf
  }
}

export const styleStudio = useStyleStudio()
// 默认加载一次（供 App.vue 挂载时调用）
export function initStyleStudio () {
  load()
  apply(styleId.value)
}