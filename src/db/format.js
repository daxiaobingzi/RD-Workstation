// ===== 通用工具函数 =====
import { BUDGET_TIERS } from './constants'

export function uid (p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

export function esc (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function todayStr () {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function nowISO () { return new Date().toISOString() }

export function daysFrom (dStr) {
  const t = new Date()
  const d = new Date(dStr)
  return Math.floor((t - d) / 86400000)
}

export function ceil2 (n) { return Math.ceil(n * 100) / 100 }

export function round2 (n) { return Math.round(n * 100) / 100 }

export function tierIndex (name) {
  const x = BUDGET_TIERS.find(t => t.name === name)
  return x ? x.index : 1
}

export function tierName (v) {
  if (!v) return '标准型'
  if (BUDGET_TIERS.some(t => t.name === v)) return v
  const x = BUDGET_TIERS.find(t => t.id === v)
  return x ? x.name : '标准型'
}

export function nextLowerTier (name) {
  const i = tierIndex(name)
  return i > 0 ? BUDGET_TIERS[i - 1].name : null
}

export function isOverdue (p) {
  if (!p || !p.预计结束日期 || p.状态 === '已完成' || p.状态 === '已归档') return false
  return p.预计结束日期 < todayStr()
}

export function fmtNum (n) {
  return (Number(n) || 0).toLocaleString()
}

export function stamp2 () {
  const d = new Date()
  const p2 = n => String(n).padStart(2, '0')
  return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds())
}

export function statusBadge (s) {
  const map = {
    '设计中': 'blue',
    '校核中': 'amber',
    '已出清单': 'green',
    '已完成': 'gray'
  }
  return { status: s, cls: map[s] || 'plain' }
}