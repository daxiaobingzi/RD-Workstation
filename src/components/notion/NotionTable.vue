<script setup>
// 通用 Notion 风格数据表（表格 / 看板 / 列表三视图）
// - 字段类型：文本 / 多行文本 / 数字 / 单选标签 / 多选标签 / 日期 / 负责人 / 勾选 / 进度
// - 行内编辑（Enter 确认 / Esc 取消）、表头排序、组合筛选、全局搜索、拖拽排序、新增/删除行
// - 全部改动实时反映到传入的 rows（响应式），通过 emit('commit') 通知父级落盘
import { computed, ref, shallowRef } from 'vue'
import VIcon from '../ui/VIcon.vue'

const props = defineProps({
  columns: { type: Array, required: true }, // [{key,label,type,width?,options?,fmt?,editable?}]
  rows: { type: Array, required: true },    // 响应式行数组（直接原地修改）
  groupBy: { type: String, default: '' }    // 看板视图分组字段
})
const emit = defineEmits(['commit', 'open', 'del', 'add'])

// ---------- 状态 ----------
const view = ref('table') // table | board | list
const search = ref('')
const sortKey = ref('')
const sortDir = ref(1) // 1 升 | -1 降
const filters = ref({}) // key -> { op, val }
const editing = ref(null) // { row, key }
const editVal = shallowRef('')
const dragId = ref(null)
const filterOpen = ref(false)

const TYPE_ORDER = { text: 0, longtext: 1, number: 2, single: 3, multi: 4, date: 5, person: 6, check: 7, progress: 8 }

// ---------- 取显示值 ----------
function rawVal (row, col) {
  if (col.fmt) return col.fmt(row)
  return row[col.key]
}
function displayOf (row, col) {
  const v = rawVal(row, col)
  if (v === undefined || v === null || v === '') return ''
  return String(v)
}

// ---------- 排序 ----------
function toggleSort (col) {
  if (!col.key || !col.sortable) return
  if (sortKey.value === col.key) { if (sortDir.value === 1) sortDir.value = -1; else { sortKey.value = ''; sortDir.value = 1 } }
  else { sortKey.value = col.key; sortDir.value = 1 }
}

// ---------- 筛选 ----------
const filterable = computed(() => props.columns.filter(c => c.type === 'single' || c.type === 'multi' || c.type === 'tag' || c.type === 'date' || c.type === 'text'))
function distinct (col) {
  const s = new Set()
  props.rows.forEach(r => {
    const v = rawVal(r, col)
    if (Array.isArray(v)) v.forEach(x => s.add(String(x)))
    else if (v !== undefined && v !== null && v !== '') s.add(String(v))
  })
  return [...s].sort()
}
function toggleFilter (col, val) {
  const f = filters.value[col.key] || (filters.value[col.key] = { op: 'in', val: [] })
  if (f.op === 'in') {
    if (f.val.includes(val)) f.val = f.val.filter(x => x !== val)
    else f.val = [...f.val, val]
    if (!f.val.length) delete filters.value[col.key]
  }
}
function matches (row, col, f) {
  const v = rawVal(row, col)
  if (f.op === 'contains') return displayOf(row, col).toLowerCase().includes(String(f.val).toLowerCase())
  if (f.op === 'in') {
    const arr = Array.isArray(v) ? v.map(String) : [String(v || '')]
    return arr.some(a => f.val.includes(a))
  }
  return true
}
const filtered = computed(() => {
  let list = props.rows.slice()
  if (search.value.trim()) {
    const kw = search.value.trim().toLowerCase()
    list = list.filter(r => props.columns.some(c => (c.type === 'text' || c.type === 'longtext') && displayOf(r, c).toLowerCase().includes(kw)))
  }
  Object.keys(filters.value).forEach(k => {
    const col = props.columns.find(c => c.key === k)
    if (!col) return
    list = list.filter(r => matches(r, col, filters.value[k]))
  })
  if (sortKey.value) {
    const col = props.columns.find(c => c.key === sortKey.value)
    if (col) list.sort((a, b) => {
      let x = rawVal(a, col); let y = rawVal(b, col)
      if (x === undefined || x === null || x === '') x = ''
      if (y === undefined || y === null || y === '') y = ''
      if (col.type === 'number' || col.type === 'progress') { x = Number(x) || 0; y = Number(y) || 0 }
      else { x = String(x); y = String(y) }
      return x < y ? -1 * sortDir.value : x > y ? 1 * sortDir.value : 0
    })
  }
  return list
})
const filterActive = computed(() => Object.keys(filters.value).length)

// ---------- 行内编辑 ----------
function beginEdit (row, col, e) {
  if (col.editable === false) return
  if (e && e.target.closest('.no-edit')) return
  editing.value = { row, key: col.key, type: col.type, options: col.options || [] }
  const v = row[col.key]
  editVal.value = Array.isArray(v) ? v.slice() : (v === undefined || v === null ? '' : v)
}
function commitEdit () {
  const ed = editing.value
  if (!ed) return
  let v = editVal.value
  if (ed.type === 'number' || ed.type === 'progress') { v = v === '' || v == null ? null : Number(v) }
  else if (ed.type === 'multi') v = Array.isArray(v) ? v : []
  ed.row[ed.key] = v
  editing.value = null
  emit('commit')
}
function cancelEdit () { editing.value = null }
function onEditKey (e) {
  if (e.key === 'Enter') { if (!e.shiftKey) commitEdit() }
  else if (e.key === 'Escape') cancelEdit()
}
function isEditing (row, col) { return editing.value && editing.value.row === row && editing.value.key === col.key }

// 勾选 / 多选 / 单选 即时修改
function toggleCheck (row, col) { row[col.key] = !row[col.key]; emit('commit') }
function toggleMulti (row, col, v) {
  const arr = row[col.key] ? row[col.key].slice() : []
  const i = arr.indexOf(v)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(v)
  row[col.key] = arr
  emit('commit')
}
function setSingle (row, col, e) { row[col.key] = e.target.value; emit('commit') }

// ---------- 拖拽排序 ----------
function dragStart (row) { dragId.value = row.id }
function dragOver (e) { e.preventDefault() }
function drop (target) {
  if (!dragId.value) return
  const from = props.rows.findIndex(r => r.id === dragId.value)
  const to = props.rows.findIndex(r => r.id === target.id)
  if (from >= 0 && to >= 0 && from !== to) {
    const [it] = props.rows.splice(from, 1)
    props.rows.splice(to, 0, it)
    emit('commit')
  }
  dragId.value = null
}

// ---------- 看板 ----------
const groups = computed(() => {
  if (view.value !== 'board' || !props.groupBy) return []
  const col = props.columns.find(c => c.key === props.groupBy)
  const map = {}
  filtered.value.forEach(r => {
    const g = rawVal(r, col) || ''
    ;(map[g] = map[g] || []).push(r)
  })
  return Object.keys(map).sort().map(g => ({ name: g || '未分组', rows: map[g] }))
})
const nameCol = computed(() => props.columns.find(c => c.type === 'text' || c.type === 'longtext'))

// 标签配色（按值哈希取柔和色板）
const TAG_COLORS = ['#3b82f6', '#16a34a', '#ea580c', '#d97706', '#dc2626', '#0891b2', '#7c3aed', '#db2777', '#64748b']
function tagColor (v) {
  const s = String(v || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}
function tagBg (v) { const c = tagColor(v); return { color: c, background: c + '1f', borderColor: c + '3d' } }
function personColor (n) { return tagColor(n || '?') }
</script>

<template>
  <div class="nt">
    <!-- 工具栏 -->
    <div class="nt-toolbar">
      <div class="nt-search">
        <VIcon name="search" :size="14" />
        <input v-model="search" placeholder="搜索…" />
      </div>
      <div class="nt-view">
        <button class="nt-vbtn" :class="{ on: view === 'table' }" @click="view = 'table'"><VIcon name="list" :size="14" />表格</button>
        <button class="nt-vbtn" :class="{ on: view === 'board' }" @click="view = 'board'"><VIcon name="grid" :size="14" />看板</button>
        <button class="nt-vbtn" :class="{ on: view === 'list' }" @click="view = 'list'"><VIcon name="menu" :size="14" />列表</button>
      </div>
      <div class="nt-filter-wrap">
        <button class="nt-fbtn" :class="{ on: filterActive }" @click="filterOpen = !filterOpen"><VIcon name="filter" :size="14" />筛选{{ filterActive ? ' · ' + filterActive : '' }}</button>
        <div v-if="filterOpen" class="nt-filter-panel">
          <div class="nt-filter-head">筛选条件（组合生效）<button class="nt-ghost" @click="filters = {}; filterOpen = false">清除全部</button></div>
          <div v-for="c in filterable" :key="c.key" class="nt-filter-group">
            <div class="nt-filter-label">{{ c.label }}</div>
            <div class="nt-filter-opts">
              <label v-for="v in distinct(c)" :key="v" class="nt-fopt" :class="{ on: (filters[c.key] && filters[c.key].val.includes(v)) }">
                <input type="checkbox" :checked="filters[c.key] && filters[c.key].val.includes(v)" @change="toggleFilter(c, v)" />
                <span v-if="c.type === 'single' || c.type === 'tag'" class="nt-tag" :style="tagBg(v)">{{ v }}</span>
                <span v-else>{{ v }}</span>
              </label>
              <div v-if="!distinct(c).length" class="nt-fnone">无</div>
            </div>
          </div>
        </div>
      </div>
      <div class="nt-add">
        <button class="nt-addbtn" @click="emit('add')"><VIcon name="plus" :size="15" />新增</button>
      </div>
    </div>

    <!-- 表格视图 -->
    <div v-if="view === 'table'" class="nt-table-wrap">
      <table class="nt-table">
        <thead>
          <tr>
            <th class="nt-grip-h"></th>
            <th v-for="c in columns" :key="c.key" class="nt-th" :class="{ sortable: c.sortable }" :style="c.width ? { width: c.width } : {}" @click="toggleSort(c)">
              <span>{{ c.label }}</span>
              <span v-if="sortKey === c.key" class="nt-sort">{{ sortDir === 1 ? '↑' : '↓' }}</span>
            </th>
            <th class="nt-op-h"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.id" class="nt-row" draggable="true" @dragstart="dragStart(row)" @dragover="dragOver" @drop="drop(row)" @dblclick="emit('open', row)">
            <td class="nt-grip" title="拖拽调整顺序"><VIcon name="grip" :size="12" /></td>
            <td v-for="c in columns" :key="c.key" class="nt-cell" :class="{ editing: isEditing(row, c) }" @click="beginEdit(row, c, $event)">
              <!-- 文本 -->
              <input v-if="isEditing(row, c) && c.type === 'text'" v-model="editVal" class="nt-input" @keydown="onEditKey" @blur="commitEdit" autofocus />
              <span v-else-if="c.type === 'text'" class="nt-text">{{ displayOf(row, c) }}</span>

              <!-- 多行文本 -->
              <textarea v-if="isEditing(row, c) && c.type === 'longtext'" v-model="editVal" rows="3" class="nt-input nt-ta" @keydown="onEditKey" @blur="commitEdit" autofocus></textarea>
              <span v-else-if="c.type === 'longtext'" class="nt-long" :title="displayOf(row, c)">{{ displayOf(row, c) }}</span>

              <!-- 数字 -->
              <input v-if="isEditing(row, c) && c.type === 'number'" v-model="editVal" type="number" class="nt-input nt-num" @keydown="onEditKey" @blur="commitEdit" autofocus />
              <span v-else-if="c.type === 'number'" class="nt-num-val">{{ displayOf(row, c) }}</span>

              <!-- 单选标签 -->
              <select v-if="isEditing(row, c) && c.type === 'single'" v-model="editVal" class="nt-input" @change="commitEdit" @keydown.esc="cancelEdit" autofocus>
                <option value="">（空）</option>
                <option v-for="o in c.options || []" :key="o" :value="o">{{ o }}</option>
              </select>
              <span v-else-if="c.type === 'single'" class="nt-tag" :style="displayOf(row, c) ? tagBg(displayOf(row, c)) : {}">{{ displayOf(row, c) || '—' }}</span>

              <!-- 多选标签 -->
              <span v-else-if="c.type === 'multi'" class="nt-multi" @click.stop="beginEdit(row, c, $event)">
                <span v-for="v in (rawVal(row, c) || [])" :key="v" class="nt-tag" :style="tagBg(v)">{{ v }}</span>
                <span v-if="isEditing(row, c)" class="nt-multi-edit" @click.stop>
                  <label v-for="o in c.options || []" :key="o" class="nt-mopt"><input type="checkbox" :checked="(rawVal(row, c) || []).includes(o)" @change="toggleMulti(row, c, o)" />{{ o }}</label>
                </span>
                <span v-if="!(rawVal(row, c) || []).length" class="nt-mut">—</span>
              </span>

              <!-- 日期 -->
              <input v-if="isEditing(row, c) && c.type === 'date'" v-model="editVal" type="date" class="nt-input" @change="commitEdit" @keydown.esc="cancelEdit" autofocus />
              <span v-else-if="c.type === 'date'" class="nt-date">{{ displayOf(row, c) || '—' }}</span>

              <!-- 负责人 -->
              <input v-if="isEditing(row, c) && c.type === 'person'" v-model="editVal" class="nt-input" @keydown="onEditKey" @blur="commitEdit" autofocus />
              <span v-else-if="c.type === 'person'" class="nt-person">
                <span v-if="displayOf(row, c)" class="nt-avatar" :style="{ background: personColor(displayOf(row, c)) + '1f', color: personColor(displayOf(row, c)) }">{{ displayOf(row, c).slice(0, 1) }}</span>
                {{ displayOf(row, c) || '—' }}
              </span>

              <!-- 勾选 -->
              <span v-else-if="c.type === 'check'" class="nt-check" @click.stop="toggleCheck(row, c)">
                <span class="nt-checkbox" :class="{ on: !!rawVal(row, c) }"><VIcon v-if="rawVal(row, c)" name="check" :size="12" /></span>
              </span>

              <!-- 进度 -->
              <span v-else-if="c.type === 'progress'" class="nt-prog" @click.stop="beginEdit(row, c, $event)">
                <input v-if="isEditing(row, c)" v-model="editVal" type="number" min="0" max="100" class="nt-input nt-num" @keydown="onEditKey" @blur="commitEdit" autofocus />
                <span v-else class="nt-prog-bar"><i :style="{ width: (Number(rawVal(row, c)) || 0) + '%' }"></i></span>
                <b>{{ Number(rawVal(row, c)) || 0 }}%</b>
              </span>

              <!-- 只读展示列 -->
              <span v-else-if="c.fmt" class="nt-text">{{ displayOf(row, c) }}</span>
            </td>
            <td class="nt-op"><button class="nt-del" title="删除行" @click.stop="emit('del', row)"><VIcon name="trash" :size="14" /></button></td>
          </tr>
          <tr v-if="!filtered.length"><td :colspan="columns.length + 2" class="nt-empty">{{ search || filterActive ? '没有符合筛选条件的行' : '暂无数据，点击「新增」开始' }}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 看板视图 -->
    <div v-else-if="view === 'board'" class="nt-board">
      <div v-for="g in groups" :key="g.name" class="nt-col">
        <div class="nt-col-head">
          <span class="nt-tag" :style="g.name ? tagBg(g.name) : {}">{{ g.name || '未分组' }}</span>
          <span class="nt-col-count">{{ g.rows.length }}</span>
        </div>
        <div class="nt-cards">
          <div v-for="row in g.rows" :key="row.id" class="nt-card" @click="emit('open', row)">
            <div class="nt-card-name">{{ nameCol ? displayOf(row, nameCol) : row.id }}</div>
            <div class="nt-card-row" v-for="c in columns.filter(c => c.type !== 'text' && c.type !== 'longtext' && c.key !== props.groupBy)" :key="c.key">
              <span class="nt-card-label">{{ c.label }}</span>
              <span class="nt-card-val">
                <span v-if="c.type === 'single'" class="nt-tag" :style="displayOf(row, c) ? tagBg(displayOf(row, c)) : {}">{{ displayOf(row, c) || '—' }}</span>
                <span v-else-if="c.type === 'multi'"><span v-for="v in (rawVal(row, c) || [])" :key="v" class="nt-tag" :style="tagBg(v)">{{ v }}</span></span>
                <span v-else-if="c.type === 'check'"><span class="nt-checkbox mini" :class="{ on: !!rawVal(row, c) }"><VIcon v-if="rawVal(row, c)" name="check" :size="10" /></span></span>
                <span v-else-if="c.type === 'progress'"><span class="nt-prog-bar mini"><i :style="{ width: (Number(rawVal(row, c)) || 0) + '%' }"></i></span>{{ Number(rawVal(row, c)) || 0 }}%</span>
                <span v-else>{{ displayOf(row, c) || '—' }}</span>
              </span>
            </div>
          </div>
          <div v-if="!g.rows.length" class="nt-col-empty">空</div>
        </div>
      </div>
    </div>

    <!-- 列表视图 -->
    <div v-else class="nt-list">
      <div v-for="row in filtered" :key="row.id" class="nt-list-row" @click="emit('open', row)">
        <span class="nt-list-name">{{ nameCol ? displayOf(row, nameCol) : row.id }}</span>
        <span class="nt-list-tags">
          <span v-for="c in columns.filter(c => c.type === 'single' || c.type === 'multi' || c.type === 'tag')" :key="c.key">
            <span v-if="c.type === 'single'" class="nt-tag" :style="displayOf(row, c) ? tagBg(displayOf(row, c)) : {}">{{ displayOf(row, c) }}</span>
            <span v-for="v in (c.type === 'multi' ? (rawVal(row, c) || []) : [])" :key="v" class="nt-tag" :style="tagBg(v)">{{ v }}</span>
          </span>
        </span>
        <span class="nt-list-meta">
          <span v-for="c in columns.filter(c => c.type === 'date' || c.type === 'number' || c.type === 'person' || c.type === 'progress')" :key="c.key">
            {{ c.label }} {{ displayOf(row, c) || '—' }}
          </span>
        </span>
      </div>
      <div v-if="!filtered.length" class="nt-empty">暂无数据</div>
    </div>
  </div>
</template>

<style scoped>
.nt{font-family:var(--font-body);color:var(--text)}
/* ---- 工具栏 ---- */
.nt-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.nt-search{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:0 10px;height:32px;flex:1;min-width:180px;max-width:280px;color:var(--text3)}
.nt-search input{border:none;outline:none;background:transparent;flex:1;font-size:13px;color:var(--text)}
.nt-view{display:flex;gap:2px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:2px}
.nt-vbtn{display:inline-flex;align-items:center;gap:5px;border:none;background:transparent;font-size:12.5px;color:var(--text3);padding:5px 10px;border-radius:6px;cursor:pointer;transition:all .18s ease}
.nt-vbtn:hover{color:var(--text2)}
.nt-vbtn.on{background:var(--primary);color:#fff}
.nt-filter-wrap{position:relative}
.nt-fbtn{display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:12.5px;color:var(--text2);padding:6px 11px;cursor:pointer;transition:all .18s ease}
.nt-fbtn:hover{border-color:var(--line2)}
.nt-fbtn.on{border-color:var(--primary);color:var(--primary);background:var(--primary-l)}
.nt-filter-panel{position:absolute;right:0;top:36px;z-index:40;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 36px rgba(15,23,42,.14);padding:12px;min-width:240px;max-width:320px;max-height:420px;overflow:auto;animation:ntIn .18s ease}
@keyframes ntIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.nt-filter-head{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;font-weight:600;margin-bottom:8px}
.nt-ghost{border:none;background:none;color:var(--text3);font-size:12px;cursor:pointer}
.nt-ghost:hover{color:var(--red)}
.nt-filter-group{margin-bottom:10px}
.nt-filter-label{font-size:11.5px;color:var(--text3);font-weight:600;margin-bottom:5px}
.nt-filter-opts{display:flex;flex-wrap:wrap;gap:5px}
.nt-fopt{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:3px 8px;border-radius:6px;cursor:pointer;border:1px solid transparent}
.nt-fopt input{width:auto;margin:0}
.nt-fopt:hover{background:var(--bg3)}
.nt-fopt.on{background:var(--primary-l);border-color:var(--blue-line)}
.nt-fnone{font-size:12px;color:var(--text3)}
.nt-addbtn{display:inline-flex;align-items:center;gap:5px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;padding:7px 14px;cursor:pointer;transition:all .18s ease}
.nt-addbtn:hover{background:var(--primary-hover)}
/* ---- 表格 ---- */
.nt-table-wrap{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:auto}
.nt-table{width:100%;border-collapse:collapse;min-width:640px}
.nt-th{padding:9px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--text2);background:var(--bg2);border-bottom:1px solid var(--line);cursor:default;white-space:nowrap;user-select:none}
.nt-th.sortable{cursor:pointer}
.nt-th.sortable:hover{color:var(--primary)}
.nt-sort{color:var(--primary);margin-left:3px}
.nt-row{transition:background .15s ease}
.nt-row:hover{background:var(--bg2)}
.nt-row.dragging{opacity:.4}
.nt-cell{padding:7px 12px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top;cursor:cell;max-width:280px}
.nt-cell.editing{background:var(--primary-l)}
.nt-grip-h,.nt-grip{width:26px}
.nt-grip{color:var(--text3);cursor:grab;text-align:center;border-bottom:1px solid var(--line)}
.nt-grip:active{cursor:grabbing}
.nt-op-h{width:40px}
.nt-op{text-align:center;border-bottom:1px solid var(--line)}
.nt-del{border:none;background:transparent;color:var(--text3);padding:4px;border-radius:6px;cursor:pointer;transition:all .15s ease;opacity:0}
.nt-row:hover .nt-del{opacity:1}
.nt-del:hover{color:var(--red);background:var(--red-l)}
.nt-input{width:100%;border:1px solid var(--primary);border-radius:6px;padding:4px 8px;font-size:13px;outline:none;font-family:inherit;color:var(--text);background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.nt-ta{resize:vertical;min-height:56px;line-height:1.5}
.nt-num{width:110px}
.nt-num-val{font-family:var(--mono);font-variant-numeric:tabular-nums}
.nt-text{line-height:1.5}
.nt-long{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5;cursor:help}
.nt-tag{display:inline-flex;align-items:center;font-size:12px;font-weight:500;padding:2px 9px;border-radius:999px;border:1px solid transparent;line-height:1.4}
.nt-multi{display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center}
.nt-multi-edit{display:inline-flex;flex-wrap:wrap;gap:6px;background:#fff;border:1px solid var(--primary);border-radius:8px;padding:6px;max-width:220px}
.nt-mopt{display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer}
.nt-mopt input{width:auto;margin:0}
.nt-mut{color:var(--text3)}
.nt-date{font-variant-numeric:tabular-nums;color:var(--text2)}
.nt-person{display:inline-flex;align-items:center;gap:6px}
.nt-avatar{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600}
.nt-checkbox{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line2);display:inline-flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;transition:all .15s ease}
.nt-checkbox.on{background:var(--primary);border-color:var(--primary)}
.nt-checkbox.mini{width:14px;height:14px;border-radius:4px}
.nt-prog{display:inline-flex;align-items:center;gap:8px;min-width:140px}
.nt-prog-bar{flex:1;height:7px;border-radius:999px;background:var(--bg3);overflow:hidden}
.nt-prog-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--primary),var(--accent));transition:width .3s ease}
.nt-prog-bar.mini{width:54px;height:6px}
.nt-prog b{font-family:var(--mono);font-size:12px;font-weight:600}
.nt-empty{text-align:center;color:var(--text3);padding:26px;font-size:13px}
/* ---- 看板 ---- */
.nt-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}
.nt-col{flex:1;min-width:220px;max-width:300px;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:10px}
.nt-col-head{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.nt-col-count{font-size:12px;color:var(--text3);background:#fff;border:1px solid var(--line);border-radius:999px;padding:0 8px}
.nt-cards{display:flex;flex-direction:column;gap:8px}
.nt-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;box-shadow:0 1px 3px rgba(15,23,42,.05);transition:all .18s ease}
.nt-card:hover{box-shadow:0 6px 18px rgba(15,23,42,.1);transform:translateY(-1px)}
.nt-card-name{font-size:13.5px;font-weight:600;margin-bottom:6px}
.nt-card-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;margin-top:4px}
.nt-card-label{color:var(--text3)}
.nt-card-val{display:flex;align-items:center;gap:4px;flex-wrap:wrap;color:var(--text2);min-width:0}
.nt-col-empty{text-align:center;color:var(--text3);font-size:12px;padding:16px 0}
/* ---- 列表 ---- */
.nt-list{display:flex;flex-direction:column;gap:6px}
.nt-list-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px;cursor:pointer;transition:all .15s ease}
.nt-list-row:hover{border-color:var(--line2);box-shadow:0 4px 14px rgba(15,23,42,.08)}
.nt-list-name{font-weight:600;font-size:13.5px;min-width:160px}
.nt-list-tags{display:flex;gap:5px;flex-wrap:wrap;flex:1}
.nt-list-meta{display:flex;gap:14px;font-size:12px;color:var(--text3);flex-wrap:wrap}
</style>
