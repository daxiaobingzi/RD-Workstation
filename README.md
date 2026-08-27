# RD-Workstation

弱电智能化设计工作台（Vue 3 + Vite 重构版）

## 技术栈

- Vue 3（完整版构建，支持运行时模板）/ Vite 5 / Pinia
- 纯前端、零后端依赖；数据层为**纯本地存储**（业务数据存 IndexedDB，UI 小状态存 localStorage），无任何云端/账号依赖

## 目录结构

```
src/
  main.js / App.vue        # 入口与应用外壳（侧边栏/顶栏/弹窗/Toast 宿主）
  db/                      # 领域层（纯函数，无 DOM 依赖）
    constants.js           # 常量、localStorage 键、预算档位
    seeds.js               # 预置数据（16 子系统/设备字典/示例项目/模板）
    storage.js             # 存储抽象层（本地 IndexedDB）
    calc.js                # 数量推算 / 清单生成 / 报价 / 项目进度
    format.js              # 通用工具（日期/转义/档位）
    export.js              # 导出模块（最小 XLSX 生成器 / CSV / TSV / 下载）
  store/index.js           # Pinia 中央状态：数据加载、持久化、全部业务动作
  views/                   # 四大模块视图
    ProjectsView.vue       # 项目管理（列表/看板/详情/清单）
    DatabaseView.vue       # 数据库（子系统/设备字典）
    SearchView.vue         # 全局搜索
    SettingsView.vue       # 系统配置（参数/品牌/定额/模板/数据管理）
  components/              # UI 组件与业务弹窗（项目/设备/数量推算/清单历史等）
  composables/             # 布局总线与弹窗/确认框/输入框
```

## 开发命令

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 生产构建 → dist/（Web / GitHub Pages 版）
npm run preview  # 预览构建产物
```

## 桌面离线版（Electron）

桌面版是**本地可安装、完全离线**的应用：加载本机构建产物，无 Service Worker、无任何网络依赖，数据存于应用内 IndexedDB。

```bash
npm install
npm run app             # 直接以 Electron 运行（需先 npm run build:desktop）
npm run dist:desktop    # 构建渲染包并打包当前平台安装程序 → release/
# 指定平台（在对应系统上执行）：
npx electron-builder --linux AppImage --publish never   # Linux
npx electron-builder --win nsis --publish never         # Windows（需在 Windows 上构建）
npx electron-builder --mac dmg --publish never          # macOS
```

## 数据说明

- 全部数据存于浏览器/应用内 IndexedDB（键名与初版一致，旧数据无缝迁移；仅本机可见，无云端/账号）
- 首次打开自动播种示例数据（2 个项目 + 设备点表）
- 报价金额默认 0：需要在「数据库 → 设备」维护品牌/型号单价，在「系统配置 → 材料价格」维护材料单价

## 迁移进度

第一批（核心）已完成：项目管理四视图、设备点表全套、数量推算、清单生成与差异确认、报价、CSV/XLSX 导出、数据库、搜索、系统配置、模板应用/存为模板、JSON 备份恢复。
第二批规划：智能选型（预算档位约束优化、子系统品牌策略、方案对比）等高级能力。