// ===== 导出模块：最小 XLSX 生成器（ZIP STORE + SpreadsheetML，无外部依赖） + 文件下载 =====

function xlsxEscape (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function colLetter (i) {
  let s = ''
  i++
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = (i - m - 1) / 26
  }
  return s
}

function xlsxSheetXml (rows) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
  rows.forEach((r, ri) => {
    out.push('<row r="' + (ri + 1) + '">')
    r.forEach((c, ci) => {
      out.push('<c r="' + colLetter(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xlsxEscape(c) + '</t></is></c>')
    })
    out.push('</row>')
  })
  out.push('</sheetData></worksheet>')
  return out.join('')
}

function xlsxSheetName (name) {
  const s = String(name == null ? '' : name).replace(/[\\/?#*[\]:]/g, '_').trim()
  return s.slice(0, 31) || '清单'
}

const CRC_TABLE = (function () {
  const t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32 (bytes) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function zipStore (files) {
  const enc = new TextEncoder()
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts = []
  const central = []
  let offset = 0
  files.forEach(f => {
    const nb = enc.encode(f.name)
    const crc = crc32(f.data)
    const lh = new Uint8Array(30)
    const dv = new DataView(lh.buffer)
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true)
    dv.setUint16(8, 0, true); dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true)
    dv.setUint32(14, crc, true); dv.setUint32(18, f.data.length, true); dv.setUint32(22, f.data.length, true)
    dv.setUint16(26, nb.length, true); dv.setUint16(28, 0, true)
    parts.push(lh, nb, f.data)
    const ch = new Uint8Array(46)
    const dv2 = new DataView(ch.buffer)
    dv2.setUint32(0, 0x02014b50, true); dv2.setUint16(4, 20, true); dv2.setUint16(6, 20, true)
    dv2.setUint16(8, 0, true); dv2.setUint16(10, 0, true); dv2.setUint16(12, dosTime, true)
    dv2.setUint16(14, dosDate, true); dv2.setUint32(16, crc, true); dv2.setUint32(20, f.data.length, true)
    dv2.setUint32(24, f.data.length, true); dv2.setUint16(28, nb.length, true)
    dv2.setUint16(30, 0, true); dv2.setUint16(32, 0, true); dv2.setUint16(34, 0, true)
    dv2.setUint16(36, 0, true); dv2.setUint32(38, 0, true); dv2.setUint32(42, offset, true)
    central.push([ch, nb])
    offset += 30 + nb.length + f.data.length
  })
  const centralStart = offset
  let centralSize = 0
  central.forEach(c => { centralSize += c[0].length + c[1].length })
  const eocd = new Uint8Array(22)
  const dv3 = new DataView(eocd.buffer)
  dv3.setUint32(0, 0x06054b50, true); dv3.setUint16(4, 0, true); dv3.setUint16(6, 0, true)
  dv3.setUint16(8, files.length, true); dv3.setUint16(10, files.length, true)
  dv3.setUint32(12, centralSize, true); dv3.setUint32(16, centralStart, true); dv3.setUint16(20, 0, true)
  const out = new Uint8Array(centralStart + centralSize + 22)
  let pos = 0
  parts.forEach(p => { out.set(p, pos); pos += p.length })
  central.forEach(c => {
    out.set(c[0], pos); pos += c[0].length
    out.set(c[1], pos); pos += c[1].length
  })
  out.set(eocd, pos)
  return out
}

export function buildXlsx (sheets) {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>'
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
    '</Relationships>'
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s, i) => '<sheet name="' + xlsxEscape(xlsxSheetName(s.name)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
    '</sheets></workbook>'
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'
  const files = [
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
    { name: '_rels/.rels', data: new TextEncoder().encode(rels) },
    { name: 'xl/workbook.xml', data: new TextEncoder().encode(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(wbRels) },
    { name: 'xl/styles.xml', data: new TextEncoder().encode(styles) }
  ]
  sheets.forEach((s, i) => {
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: new TextEncoder().encode(xlsxSheetXml(s.rows)) })
  })
  return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function buildCsvBlob (text) {
  return new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' })
}

export function buildTxtBlob (text) {
  return new Blob([text], { type: 'text/plain;charset=utf-8' })
}

/** 下载文件：优先系统"另存为"，兜底 a[download] */
export async function downloadBlob (filename, blob) {
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: filename })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    }
  } catch (e) { /* 用户取消或环境不支持，走兜底 */ }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 800)
}

export async function copyText (text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      return true
    } catch (e2) { return false }
  }
}