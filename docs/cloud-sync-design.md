# 弱电工作台 · 多端同步与云存储方案 v1

> 参照 Notion「云端为主、本地缓存」机制，适配「GitHub Pages 静态部署 + 阿里云 OSS 存储」的个人单用户场景。

## 1. 目标与原则

**目标**：电脑 / 手机双端数据一致、刷新不丢、断网可用、误删可回滚。

**原则**

1. **云端（OSS）是唯一权威事实源**；本地（IndexedDB）只是缓存，永远可被云端重建。
2. 同步以**集合为粒度 + 版本号**（last-write-wins + 时间戳）。单用户并发概率极低，不必引入复杂冲突合并。
3. **离线可编辑**：本地缓存随时可写，重连后自动与云端对齐。
4. 不引入需常驻的同步服务器；用「轮询 + 前台刷新 + 手动」模拟近实时（OSS 无推送能力，这是 GitHub Pages 静态前端的边界）。

## 2. 现状与差距

| 维度 | 现状 | 差距（Notion 视角） |
|---|---|---|
| 存储主体 | 本地 IndexedDB 默认主存储 | 应改为「OSS 为主，本地仅缓存」 |
| 同步模型 | 无版本，整包覆盖 | 需版本化 + 冲突留档 |
| 同步时机 | 仅启动拉取 + 编辑推送 | 需前台刷新 / 轮询 / 手动同步 / 状态展示 |
| 数据布局 | 数据对象与页面同前缀 | 需隔离（数据放 `data/` 前缀） |
| 安全 | 浏览器直连 AK（已混淆） | 需受限 RAM 子账号 + CORS 锁定来源 |

> 已落地（P0）：云读取失败回退本地缓存、非破坏性启动、仅变更时推送、AK 混淆存储。

## 3. 目标架构

```
┌──────────────┐  启动/前台刷新/轮询/手动拉取  ┌──────────────────┐
│  电脑浏览器    │ ──────────── 拉取 ────────────▶ │ 阿里云 OSS（权威）  │
│ IndexedDB 缓存 │ ◀─────────── 推送 ───────────── │  data/{key}.json  │
└──────────────┘                                 │  data/_versions.json│
┌──────────────┐                                 └────────┬─────────┘
│  手机浏览器    │ ◀──────── 双向同步（同上） ───────▶│ 同一 Bucket
│ IndexedDB 缓存 │                                      │ 另一前缀放页面静态资源
└──────────────┘                                      │ （可选 OSS 静态托管）
```

- **页面**：GitHub Pages（现状，可保留；国内慢可后续迁 OSS 静态托管 + 备案域名）。
- **数据**：OSS 同一 Bucket 的 `data/` 前缀，与页面资源隔离。

## 4. 数据模型与版本

| 对象 | 说明 |
|---|---|
| `data/{key}.json` | 业务集合数据，**保持现有原始结构**（如 projects 为数组），读写路径兼容 |
| `data/_versions.json` | 云端版本清单（修订表）：`{ key: { ver, updatedAt, deviceId } }`，用于判断新旧 |
| `data/_conflicts/{key}-{ts}.json` | 冲突留档：并发时保存败者副本，可追溯、可人工恢复 |
| 本地 `_syncstate`（IndexedDB） | 本地同步状态：`{ key: { baseVer, updatedAt, dirty } }` |
| 本地 `data/{key}`（IndexedDB） | 本地缓存数据（即「最后同步的云端数据」+ 未推送的本地编辑） |

key 集合：`projects / points / devices / settings / meta / notes / bills / devSort / devBrands`（与现有 `SYNC_KEYS` 一致）。

**版本对象字段语义**

- `ver`：集合版本号，**单调递增整数**，仅当某设备成功写入云端后 bump（`云端当前 ver + 1`）。
- `updatedAt`：该版本最后被修改的时间（ISO 字符串），冲突时作为新旧裁决依据。
- `deviceId`：产生该版本的设备标识（本地生成、持久化于 localStorage），用于时间戳打平时的确定性决胜。
- `baseVer`（本地状态）：本地缓存数据所对应的云端版本；`dirty=true` 表示本地缓存含有尚未推送的编辑。

**冲突留档文件格式**（写入 `data/_conflicts/{key}-{ts}.json`）

```json
{
  "key": "projects",
  "createdAt": "2026-08-27T10:00:00.000Z",
  "conflict": { "winner": "remote", "reason": "updatedAt 较新 / deviceId 决胜" },
  "winner": { "ver": 12, "updatedAt": "2026-08-27T09:59:00.000Z", "deviceId": "phone-2" },
  "loser":  { "ver": 11, "updatedAt": "2026-08-27T09:58:00.000Z", "deviceId": "pc-1", "data": [ ...败者数据... ] }
}
```

> 留档是**败者的完整数据**（含其版本信息），不是合并结果——合并交给用户决策，保证「数据永不丢失」。

## 5. 同步机制

### 5.1 同步时机

| 时机 | 动作 |
|---|---|
| 启动 init | 拉取 `_versions.json` → 逐集合对比：云端 ver 更新 → 以云端为准刷新本地缓存；本地 dirty 且云端未变 → 推送本地 |
| 编辑保存 | 写本地缓存 + 置 dirty → 防抖（约 800ms）→ 推送云端并 bump ver |
| 切回前台 / 定时 | `visibilitychange` 回到前台 + 每 60s 轮询 → 拉最新并合并 |
| 手动 | 设置页「立即同步」按钮 + 「最后同步时间」展示 |

### 5.2 本地同步状态模型

每台设备在本地维护两个关键状态：

- `local data`（IndexedDB 同键）：**最后已知数据** = 最后同步的云端数据 + 可能存在的未推送本地编辑。
- `_syncstate[key]`：`{ baseVer, updatedAt, dirty }`
  - `baseVer`：本地数据对应的云端版本（若 dirty，指本地编辑之前的基础版本）。
  - `updatedAt`：本地最后一次编辑时间（仅 dirty 时有意义）。
  - `dirty`：本地是否有未推送的编辑。

### 5.3 冲突判定矩阵

同步单个集合时，读取**云端版本清单** `_versions.json` 与**本地状态** `_syncstate`，按以下矩阵决策：

| 云端 `ver` | 本地 `baseVer` | 本地 dirty | 判定 | 动作 |
|---|---|---|---|---|
| 无 | 无 | - | 初始态 | 无操作 |
| 无 | 有 | 是 | 本地新建 | 推送本地（`ver = 1`） |
| 无 | 有 | 否 | 仅本地缓存 | 无操作 |
| 有 | 无 | - | 新设备 / 清缓存 | 拉取云端覆盖本地缓存 |
| `> baseVer` | 有 | 否 | 云端更新 | 拉取云端覆盖本地缓存 |
| `> baseVer` | 有 | **是** | **真冲突** | 见 5.4 冲突裁决 |
| `<= baseVer` | 有 | 是 | 本地更新 | 推送本地（`ver = 云端 ver + 1`） |
| `== baseVer` | 有 | 否 | 一致 | 无操作 |

> 关键：**冲突只发生在同一集合同时被两设备修改**。PC 改 `projects`、手机改 `points` 是不同集合，互不覆盖，不会触发冲突。

### 5.4 冲突裁决（核心逻辑）

**裁决规则**：比较双方 `updatedAt`，较新者胜；**同一毫秒则用 `deviceId` 字典序决胜**——保证两台设备对同一冲突得出**完全相同且可复现**的结论。败者完整数据写入 `data/_conflicts/`，之后拉取/推送胜者，最后提示用户可人工查看/恢复。

**核心同步函数（示意实现，落地时并入 `ossSync.js`）**

```js
const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem('wb_elv_device')
    if (!id) { id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); localStorage.setItem('wb_elv_device', id) }
    return id
  } catch (e) { return 'dev-anon' }
})()

/**
 * 时间裁决：主键 updatedAt，平局按 deviceId 字典序（大者胜），结果确定可复现
 */
function newerThan (a, b) {
  const ta = new Date(a.updatedAt).getTime()
  const tb = new Date(b.updatedAt).getTime()
  if (ta !== tb) return ta > tb
  if (a.deviceId === b.deviceId) return false
  return a.deviceId > b.deviceId
}

/**
 * 同步单个集合：拉取云端版本清单后逐集合决策（核心入口）
 * @returns {{action:'none'|'pull'|'push', conflict?:boolean, winner?:string}}
 */
async function syncCollection (key, remoteManifest) {
  const rv = remoteManifest[key] || null                     // 云端版本
  const lv = (await loadLocalState())[key] || null           // 本地状态 {baseVer,updatedAt,dirty}

  if (!rv && !lv) return { action: 'none' }                  // 两边都没有
  if (!rv && lv.dirty) { await pushCollection(key, null); return { action: 'push' } } // 本地新建
  if (!lv) { await pullCollection(key, rv); return { action: 'pull' } }               // 云端拉取

  if (rv.ver > lv.baseVer) {                                 // 云端比本地基础新
    if (lv.dirty) return await resolveConflict(key, rv, lv)  // 真冲突
    await pullCollection(key, rv); return { action: 'pull' } // 云端覆盖缓存
  }
  if (lv.dirty) { await pushCollection(key, rv); return { action: 'push' } } // 推送本地
  return { action: 'none' }                                  // 一致
}

/**
 * 冲突裁决：较新者胜，败者留档，提示用户
 */
async function resolveConflict (key, rv, lv) {
  const localWins = lv.dirty && newerThan(lv, rv)
  if (localWins) {
    // 本地胜：先把云端旧数据留档，再推送本地覆盖
    const remoteData = await getObject(`${DATA_PREFIX}/${key}.json`)
    await writeConflict(key, remoteData, { winner: 'local', rv, lv })
    await pushCollection(key, rv)
    return { action: 'push', conflict: true, winner: 'local' }
  }
  // 云端胜：把本地未推送修改留档，再拉取云端覆盖
  const localData = await storage.load(key, undefined)
  if (localData !== undefined) await writeConflict(key, localData, { winner: 'remote', rv, lv })
  await pullCollection(key, rv)
  return { action: 'pull', conflict: true, winner: 'remote' }
}

/**
 * 推送本地：先写数据对象，再 bump 版本清单，最后清 dirty。
 * 乐观并发：写前重读一次云端清单，版本若已变化则重入 syncCollection 重新决策。
 */
async function pushCollection (key, rv) {
  const data = await storage.load(key, undefined)            // 本地缓存数据
  const manifest = await readManifest()                      // 重读，防并发期间被改
  const cur = manifest[key]
  if (rv && cur && cur.ver !== rv.ver) return syncCollection(key, manifest) // 变了→重入

  const base = Math.max(rv ? rv.ver : 0, cur ? cur.ver : 0)
  const entry = { ver: base + 1, updatedAt: nowISO(), deviceId: DEVICE_ID }

  await putObject(`${DATA_PREFIX}/${key}.json`, data)                    // 1) 写数据
  await putObject(`${DATA_PREFIX}/_versions.json`, { ...manifest, [key]: entry }) // 2) bump 版本
  await setLocalState(key, { baseVer: entry.ver, updatedAt: entry.updatedAt, dirty: false }) // 3) 清 dirty
}

/**
 * 拉取云端：云端数据为权威，覆盖本地缓存并更新本地状态
 */
async function pullCollection (key, rv) {
  const data = await getObject(`${DATA_PREFIX}/${key}.json`) // 云端权威数据
  await storage.save(key, data)                              // 覆盖本地缓存
  await setLocalState(key, { baseVer: rv.ver, updatedAt: rv.updatedAt, dirty: false })
}
```

**要点**

- **写顺序固定**：先写 `data/{key}.json`，再写 `_versions.json`。若中途失败，云端版本未 bump——下次同步时数据对象被重新覆盖为权威值，不会出现「版本新、数据旧」的错位。
- **乐观重入**：`pushCollection` 写前重读清单，发现版本已变（另一设备抢先）则重入 `syncCollection` 重新决策，最多重试一次即收敛。
- **本地胜时也先留档云端旧数据**：即使本地胜，云端被覆盖前的那份数据也进 `_conflicts/`，双份保险。

### 5.5 冲突边界与保证

- **数据永不丢失**：败者一定留档（含完整数据与版本信息），不覆盖不删除。
- **同一集合两设备同时编辑**：以 `updatedAt` 较新者胜，平局按 `deviceId` 决胜（结果确定），败者留档。
- **不同集合**：互不影响，各自独立同步。
- **云端不可达**：直接使用本地缓存（P0 已实现），`dirty` 保留，重连后按矩阵自动对齐。

### 5.6 本地缓存策略

- 云不可达 / 读失败 → 用本地缓存（P0 已实现）。
- 缓存保留最后已知状态，**断网可编辑**，重连后自动对齐。
- 本地只是缓存：只要云端在，换设备 / 清缓存都能完整恢复。

## 6. 安全设计

1. **RAM 子账号**：仅授权 `oss:GetObject / PutObject / DeleteObject`，作用域限定 `{bucket}/data/*`；不授 ListAll、不授其他 Bucket。
2. **CORS**：放行你的 GitHub Pages 来源域名，允许 `GET / PUT / DELETE / HEAD`，允许全部请求头，暴露 `ETag`。
3. **AK**：本机混淆存储（已实现），不落入业务数据集合。
4. （可选）**版本控制**：Bucket 开启，防误删/误覆盖可回滚。
5. （可选）**防盗链**：Referer 白名单仅你的域名。

## 7. 阿里云控制台操作清单（需你自行完成）

> 以下为控制台手动步骤，代码无法代劳。

1. **创建受限 RAM 子账号**
   - RAM 控制台 → 创建用户 → 勾选「编程访问」（生成 AccessKey ID/Secret）。
   - 授权：新建自定义策略，Effect=Allow，Action=`oss:GetObject,oss:PutObject,oss:DeleteObject`，Resource=`acs:oss:*:*:{你的bucket}/data/*`，仅授权给该子账号。
2. **在 Bucket 配置 CORS 规则**
   - 来源：`https://<你的用户名>.github.io`
   - 方法：`GET, PUT, DELETE, HEAD`
   - 允许 Headers：`*`；暴露 Headers：`ETag`
3. **（推荐）开启版本控制**
   - Bucket → 数据安全 → 版本控制 → 开启。
4. **（可选）防盗链 / 生命周期**
   - Referer 白名单仅你的域名；`data/_conflicts/` 可设生命周期自动清理。

## 8. 代码侧改造任务

### P1：版本感知同步核心
- [ ] `ossSync.js`：
  - 读写云端版本清单 `_versions.json` 与本地 `_syncstate`（`baseVer/updatedAt/dirty`）
  - 实现 `syncCollection / resolveConflict / pushCollection / pullCollection`（见 5.4）
  - 冲突留档 `writeConflict()` 写 `data/_conflicts/{key}-{ts}.json`
  - 数据前缀默认 `data/`（设置页默认值 + 迁移已存配置）
- [ ] `store/index.js`：编辑时写本地 + 置 `dirty` → 防抖（约 800ms）→ 批量推送；`visibilitychange` / 60s 轮询拉取并执行同步决策；保留 P0「仅变更时推送」
- [ ] 首启迁移：为旧版（无版本清单）云端对象初始化 `_versions.json`（`ver=1`），避免误判冲突

### P2：体验与可见性
- [ ] 设置页 OSS 卡片：新增「立即同步」「最后同步时间」「云端/本地状态」指示
- [ ] 同步日志 / 冲突提示（toast + 冲突列表入口）

## 9. 局限与演进

- **非实时**：OSS 无推送通道，轮询有延迟（个人单用户可接受）。若需秒级一致，可升级为「同步代理 + WebSocket / Server-Sent Events」（复用 `cloudSync.js` 预留的 REST 接口，AK 上收后端，业务代码零改动）。
- **集合级 last-write-wins**：极端并发以时间戳为准并保留备份，数据不丢。
- **升级路径**：未来若多用户 / 高频协作，演进方向 = 同步代理 + 字段级增量 + 服务端合并（更接近 Notion 的完整模型）。

## 10. 验收标准

- [ ] 电脑新增项目 → 手机切回前台或手动同步后可见
- [ ] 断网编辑 → 恢复网络后自动推送云端
- [ ] 手机与电脑同时改同一集合 → 以较新为准，败者留档可查
- [ ] 云端误删 / 误覆盖 → 版本控制可回滚
- [ ] 换新设备 / 清缓存 → 从云端完整恢复
