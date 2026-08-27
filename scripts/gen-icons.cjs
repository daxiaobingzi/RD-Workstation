// ===== 用 @resvg/resvg-js 把 SVG 图标栅格化为多尺寸 PNG =====
// 用法: node scripts/gen-icons.cjs
const fs = require('fs')
const path = require('path')
const { Resvg } = require('@resvg/resvg-js')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'app-icons')
const svg = fs.readFileSync(path.join(outDir, 'icon.svg'), 'utf8')

const sizes = [512, 192, 64, 32, 16]
for (const s of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: s },
    background: 'transparent'
  })
  const png = resvg.render().asPng()
  fs.writeFileSync(path.join(outDir, `icon-${s}.png`), png)
  console.log(`icon-${s}.png`, png.length, 'bytes')
}
console.log('done')
