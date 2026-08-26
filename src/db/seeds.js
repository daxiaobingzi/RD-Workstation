// ===== 预置数据（与初版一致） =====
import { defaultSettings } from './constants'

export function seedSubsystems () {
  return [
    { id: 'sp1', name: '视频监控系统', category: '安防', fields: [{ key: 'resolution', name: '分辨率', type: 'select', options: ['2MP', '4MP', '8MP'] }, { key: 'mount', name: '安装方式', type: 'select', options: ['枪式', '半球', '球机'] }, { key: 'power', name: '供电方式', type: 'select', options: ['POE供电', '集中供电'] }] },
    { id: 'sp2', name: '入侵报警系统', category: '安防', fields: [{ key: 'detType', name: '探测器类型', type: 'select', options: ['红外对射', '双鉴探测器', '紧急按钮'] }] },
    { id: 'sp3', name: '可视对讲系统', category: '安防', fields: [{ key: 'form', name: '设备形态', type: 'select', options: ['室内机', '门口机', '围墙机'] }] },
    { id: 'sp4', name: '电子巡更系统', category: '安防', fields: [{ key: 'patrol', name: '巡更类型', type: 'select', options: ['在线式', '离线式'] }] },
    { id: 'sp5', name: '门禁管理系统', category: '安防', fields: [{ key: 'doorType', name: '门类型', type: 'select', options: ['单门', '双门'] }, { key: 'auth', name: '识别方式', type: 'select', options: ['刷卡', '人脸', '指纹'] }] },
    { id: 'sp6', name: '电子围栏系统', category: '安防', fields: [{ key: 'fence', name: '围栏类型', type: 'select', options: ['四线制', '六线制'] }] },
    { id: 'sp7', name: '停车管理系统', category: '安防', fields: [{ key: 'lane', name: '出入口类型', type: 'select', options: ['入口', '出口', '双向'] }] },
    { id: 'sp8', name: '综合布线系统', category: '网络通信', fields: [{ key: 'cableType', name: '线缆类型', type: 'select', options: ['六类', '超六类', '光纤'] }, { key: 'panel', name: '面板类型', type: 'select', options: ['单口', '双口'] }] },
    { id: 'sp9', name: '信息网络系统', category: '网络通信', fields: [{ key: 'role', name: '设备角色', type: 'select', options: ['核心', '汇聚', '接入'] }] },
    { id: 'sp10', name: '全光网络系统', category: '网络通信', fields: [{ key: 'split', name: '分光类型', type: 'select', options: ['1:8', '1:16', '1:32'] }] },
    { id: 'sp11', name: '无线对讲系统', category: '网络通信', fields: [{ key: 'band', name: '频段', type: 'select', options: ['UHF', 'VHF'] }] },
    { id: 'sp12', name: '公共广播系统', category: '音视频', fields: [{ key: 'spkType', name: '扬声器类型', type: 'select', options: ['吸顶', '壁挂', '音柱'] }] },
    { id: 'sp13', name: '信息发布系统', category: '音视频', fields: [{ key: 'screen', name: '屏体类型', type: 'select', options: ['LCD', 'LED'] }] },
    { id: 'sp14', name: 'LED大屏显示系统', category: '音视频', fields: [{ key: 'pitch', name: '点间距', type: 'select', options: ['P2', 'P3', 'P4', 'P5'] }] },
    { id: 'sp15', name: '机房工程', category: '机房管路', fields: [{ key: 'equipType', name: '设备类别', type: 'select', options: ['供电', 'UPS', '空调', '消防', '装修'] }] },
    { id: 'sp16', name: '综合管路系统', category: '机房管路', fields: [{ key: 'lay', name: '敷设方式', type: 'select', options: ['室内桥架', '室外管路'] }] }
  ]
}

export function seedBuildingTypes () {
  return ['办公楼/写字楼', '住宅小区', '商业综合体/商场', '酒店/度假村', '医院/医疗综合体', '学校/教育园区', '产业园区/工厂', '数据中心/机房', '文体场馆', '交通枢纽', '政府/公检法大楼', '智慧园区/科技园区', '养老社区/康养中心']
}

export function seedSubCategories () {
  return ['安防', '网络通信', '音视频', '机房管路']
}

export function seedTemplates () {
  return [
    {
      id: 'tpl1', name: '办公楼-标准弱电模板', 建筑类型: '办公楼/写字楼', subsystems: [
        {
          name: '视频监控系统', devices: [
            { name: '网络摄像机(枪式)', spec: '200万像素', unit: '台', category: '前端设备', auto: { method: 'area', per: 400 }, quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 20, cat: '管材线缆' }, { name: '电源线', spec: 'RVV2*1.0', unit: 'm', per: 15, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 15, cat: '管材线缆' }, { name: '摄像机支架', spec: '壁装', unit: '套', per: 1, cat: '辅材' }], ratio: { type: 'point' } },
            { name: 'NVR', spec: '16路', unit: '台', category: '后端设备', quota: [], ratio: { type: 'ratio', per: 16, target: '*' } }]
        },
        {
          name: '门禁管理系统', devices: [
            { name: '读卡器', spec: 'IC/ID', unit: '台', category: '前端设备', auto: { method: 'room', per: 2 }, quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 10, cat: '管材线缆' }, { name: '门禁电源线', spec: 'RVV2*1.5', unit: 'm', per: 10, cat: '管材线缆' }], ratio: { type: 'point' } },
            { name: '门禁控制器', spec: '单门', unit: '台', category: '后端设备', quota: [], ratio: { type: 'ratio', per: 2, target: '*' } }]
        },
        {
          name: '综合布线系统', devices: [
            { name: '信息面板', spec: '双口', unit: '套', category: '前端设备', auto: { method: 'area', per: 12 }, quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 35, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 35, cat: '管材线缆' }], ratio: { type: 'point' } }]
        }
      ]
    }
  ]
}

export function seedDevices () {
  return [
    { id: 'dv1', subsystem: '视频监控系统', name: '网络摄像机(枪式)', spec: '200万像素 星光级', unit: '台', category: '前端设备', quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 20, cat: '管材线缆' }, { name: '电源线', spec: 'RVV2*1.0', unit: 'm', per: 15, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 15, cat: '管材线缆' }, { name: '摄像机支架', spec: '壁装', unit: '套', per: 1, cat: '辅材' }], ratio: null },
    { id: 'dv2', subsystem: '视频监控系统', name: '网络摄像机(半球)', spec: '200万像素', unit: '台', category: '前端设备', quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 20, cat: '管材线缆' }, { name: '电源线', spec: 'RVV2*1.0', unit: 'm', per: 15, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 15, cat: '管材线缆' }, { name: '吸顶支架', spec: '', unit: '套', per: 1, cat: '辅材' }], ratio: null },
    { id: 'dv3', subsystem: '视频监控系统', name: '网络摄像机(球机)', spec: '400万像素', unit: '台', category: '前端设备', quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 25, cat: '管材线缆' }, { name: '电源线', spec: 'RVV2*1.0', unit: 'm', per: 20, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN25', unit: 'm', per: 20, cat: '管材线缆' }, { name: '球机支架', spec: '吊装', unit: '套', per: 1, cat: '辅材' }], ratio: null },
    { id: 'dv4', subsystem: '视频监控系统', name: '网络硬盘录像机NVR', spec: '32路', unit: '台', category: '后端设备', quota: [], ratio: { type: 'ratio', per: 32, target: '*' } },
    { id: 'dv4a', subsystem: '视频监控系统', name: 'POE接入交换机', spec: '24口·含4口上行', unit: '台', category: '后端设备', quota: [], ratio: null, chain: { mode: 'carry', capacity: 20, source: 'front', factor: 1.05, reserve: 1, round: 'ceil' } },
    { id: 'dv5', subsystem: '视频监控系统', name: '监控专用硬盘', spec: '4TB', unit: '块', category: '后端设备', quota: [], ratio: null, chain: { mode: 'mul', capacity: 2, source: 'dv4', factor: 1, reserve: 0, round: 'ceil' } },
    { id: 'dv6', subsystem: '综合布线系统', name: '信息插座(单口六类)', spec: '86型', unit: '个', category: '前端设备', quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 25, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 15, cat: '管材线缆' }, { name: '86底盒', spec: '', unit: '个', per: 1, cat: '辅材' }], ratio: null },
    { id: 'dv7', subsystem: '综合布线系统', name: '信息插座(双口六类)', spec: '86型', unit: '个', category: '前端设备', quota: [{ name: '六类网线', spec: 'CAT6', unit: 'm', per: 40, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 15, cat: '管材线缆' }, { name: '86底盒', spec: '', unit: '个', per: 1, cat: '辅材' }], ratio: null },
    { id: 'dv8', subsystem: '综合布线系统', name: '24口配线架', spec: '六类', unit: '个', category: '后端设备', quota: [], ratio: { type: 'ratio', per: 24, target: '信息插座' } },
    { id: 'dv9', subsystem: '综合布线系统', name: '理线器', spec: '1U', unit: '个', category: '后端设备', quota: [], ratio: { type: 'ratio', per: 24, target: '信息插座' } },
    { id: 'dv10', subsystem: '门禁管理系统', name: '门禁读卡器', spec: '刷卡+密码', unit: '台', category: '前端设备', quota: [{ name: '读卡器线', spec: 'RVV4*0.5', unit: 'm', per: 15, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 10, cat: '管材线缆' }], ratio: null },
    { id: 'dv11', subsystem: '门禁管理系统', name: '门禁读卡器', spec: '人脸识别', unit: '台', category: '前端设备', quota: [{ name: '读卡器线', spec: 'RVV4*0.5', unit: 'm', per: 15, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 10, cat: '管材线缆' }], ratio: null },
    { id: 'dv12', subsystem: '门禁管理系统', name: '单门门禁控制器', spec: 'TCP/IP', unit: '台', category: '后端设备', quota: [], ratio: { type: 'ratio', per: 1, target: '读卡器' } },
    { id: 'dv13', subsystem: '门禁管理系统', name: '电插锁', spec: '280kg', unit: '把', category: '前端设备', quota: [{ name: '电源线', spec: 'RVV2*1.0', unit: 'm', per: 10, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 10, cat: '管材线缆' }], ratio: null },
    { id: 'dv14', subsystem: '门禁管理系统', name: '出门按钮', spec: '86型', unit: '个', category: '前端设备', quota: [], ratio: null },
    { id: 'dv15', subsystem: '机房工程', name: 'UPS不间断电源', spec: '10KVA', unit: '台', category: '后端设备', quota: [], ratio: { type: 'fixed', qty: 1, when: '*' } },
    { id: 'dv16', subsystem: '机房工程', name: '精密空调', spec: '12.5KW', unit: '台', category: '后端设备', quota: [], ratio: { type: 'fixed', qty: 1, when: '*' } },
    { id: 'dv17', subsystem: '机房工程', name: '服务器机柜', spec: '42U', unit: '台', category: '后端设备', quota: [], ratio: { type: 'fixed', qty: 2, when: '*' } },
    { id: 'dv18', subsystem: '公共广播系统', name: '吸顶扬声器', spec: '3W', unit: '只', category: '前端设备', quota: [{ name: '广播线', spec: 'RVV2*1.5', unit: 'm', per: 20, cat: '管材线缆' }, { name: 'PVC线管', spec: 'DN20', unit: 'm', per: 12, cat: '管材线缆' }], ratio: null },
    { id: 'dv19', subsystem: '公共广播系统', name: '广播功放', spec: '120W', unit: '台', category: '后端设备', quota: [], ratio: { type: 'ratio', per: 30, target: '扬声器' } },
    { id: 'dv20', subsystem: '综合管路系统', name: '金属线槽', spec: '200*100', unit: 'm', category: '管材线缆', quota: [], ratio: null },
    { id: 'dv21', subsystem: '综合管路系统', name: '室外手孔井', spec: '600*600', unit: '座', category: '辅材', quota: [], ratio: null }
  ]
}

export function seedProjects () {
  return [
    { id: 'prj1', 项目名称: '某商业综合体弱电工程', 项目编号: '2026-ELV-001', 建筑类型: '商业综合体/商场', 客户: '华城置业', 项目地址: '深圳市南山区科技园路1号', 建筑面积: 86000, 设计阶段: '施工图设计', 状态: '设计中', 开始日期: '2026-07-02', 预计结束日期: '2026-09-30', 备注: '含视频监控、综合布线、门禁、公共广播' },
    { id: 'prj2', 项目名称: '某办公楼智能化改造项目', 项目编号: '2026-ELV-002', 建筑类型: '办公楼/写字楼', 客户: '恒信物业', 项目地址: '广州市天河区中山大道100号', 建筑面积: 32000, 设计阶段: '初步设计', 状态: '已出清单', 开始日期: '2026-08-05', 预计结束日期: '2026-11-20', 备注: '改造项目，原系统利旧' }
  ]
}

export function seedPoints () {
  return [
    { id: 'dq1', 项目ID: 'prj1', 子系统: '视频监控系统', 设备类型: '网络摄像机(枪式)', 数量: 20, 备注: '1F大堂4、B1车库6、2F办公10', updatedAt: '2026-08-10' },
    { id: 'dq2', 项目ID: 'prj1', 子系统: '视频监控系统', 设备类型: '网络摄像机(半球)', 数量: 30, 备注: '各层走廊与电梯厅', updatedAt: '2026-08-10' },
    { id: 'dq3', 项目ID: 'prj1', 子系统: '视频监控系统', 设备类型: '网络摄像机(球机)', 数量: 4, 备注: '大堂中庭与屋面', updatedAt: '2026-08-11' },
    { id: 'dq4', 项目ID: 'prj1', 子系统: '视频监控系统', 设备类型: '网络硬盘录像机NVR', 数量: 2, 备注: '32路×2，弱电间', updatedAt: '2026-08-11' },
    { id: 'dq5', 项目ID: 'prj1', 子系统: '视频监控系统', 设备类型: '监控专用硬盘', 数量: 8, 备注: '4TB×8', updatedAt: '2026-08-12' },
    { id: 'dq6', 项目ID: 'prj1', 子系统: '综合布线系统', 设备类型: '信息插座(单口六类)', 数量: 40, 备注: '办公区', updatedAt: '2026-08-12' },
    { id: 'dq7', 项目ID: 'prj1', 子系统: '综合布线系统', 设备类型: '信息插座(双口六类)', 数量: 10, 备注: '会议室', updatedAt: '2026-08-12' },
    { id: 'dq8', 项目ID: 'prj1', 子系统: '综合布线系统', 设备类型: '24口配线架', 数量: 3, 备注: '楼层配线间', updatedAt: '2026-08-13' },
    { id: 'dq9', 项目ID: 'prj1', 子系统: '综合布线系统', 设备类型: '理线器', 数量: 3, 备注: '', updatedAt: '2026-08-13' },
    { id: 'dq10', 项目ID: 'prj1', 子系统: '门禁管理系统', 设备类型: '门禁读卡器', 数量: 8, 备注: '刷卡+密码', updatedAt: '2026-08-14' },
    { id: 'dq11', 项目ID: 'prj1', 子系统: '门禁管理系统', 设备类型: '单门门禁控制器', 数量: 8, 备注: '', updatedAt: '2026-08-14' },
    { id: 'dq12', 项目ID: 'prj1', 子系统: '门禁管理系统', 设备类型: '电插锁', 数量: 8, 备注: '', updatedAt: '2026-08-14' },
    { id: 'dq13', 项目ID: 'prj1', 子系统: '门禁管理系统', 设备类型: '出门按钮', 数量: 8, 备注: '', updatedAt: '2026-08-14' },
    { id: 'dq14', 项目ID: 'prj2', 子系统: '视频监控系统', 设备类型: '网络摄像机(枪式)', 数量: 5, 备注: '', updatedAt: '2026-08-16' },
    { id: 'dq15', 项目ID: 'prj2', 子系统: '视频监控系统', 设备类型: '网络摄像机(半球)', 数量: 6, 备注: '', updatedAt: '2026-08-16' },
    { id: 'dq16', 项目ID: 'prj2', 子系统: '视频监控系统', 设备类型: '网络硬盘录像机NVR', 数量: 1, 备注: '', updatedAt: '2026-08-16' },
    { id: 'dq17', 项目ID: 'prj2', 子系统: '视频监控系统', 设备类型: '监控专用硬盘', 数量: 2, 备注: '', updatedAt: '2026-08-16' }
  ]
}

export function seedNotes () {
  return {
    'prj1|视频监控系统': '本系统覆盖大堂、车库、屋面等区域，前端摄像机按设备点表数量配置，通过 POE 交换机汇聚至弱电间 NVR。',
    'prj1|综合布线系统': '办公区信息点按 6-8 m²/点设置，双口插座预留语音/数据，水平链路六类非屏蔽，楼层配线间设置 24 口配线架。'
  }
}

export function seedMeta () {
  return { billAt: { prj2: '2026-08-18T10:00:00' }, seeded: true }
}

export function seedAllSettings () {
  const s = defaultSettings()
  s.subsystems = seedSubsystems()
  s.buildingTypes = seedBuildingTypes()
  s.subCategories = seedSubCategories()
  s.templates = seedTemplates()
  s.designQuotas = seedQuotas()
  return s
}

/** 默认设计定额（供旧数据环境补齐） */
export function seedQuotas () {
  return [
    { id: 'dq_area_cam', subsystem: '视频监控系统', deviceId: 'dv1', method: 'area', per: 400, buildingType: '全部业态', min: 4, max: 0 },
    { id: 'dq_area_dome', subsystem: '视频监控系统', deviceId: 'dv2', method: 'area', per: 800, buildingType: '全部业态', min: 2, max: 0 },
    { id: 'dq_area_reader', subsystem: '门禁管理系统', deviceId: 'dv10', method: 'area', per: 2000, buildingType: '全部业态', min: 2, max: 0 },
    { id: 'dq_area_info', subsystem: '综合布线系统', deviceId: 'dv6', method: 'area', per: 12, buildingType: '全部业态', min: 8, max: 0 },
    { id: 'dq_floor_cam', subsystem: '视频监控系统', deviceId: 'dv3', method: 'floor', per: 0.25, buildingType: '全部业态', min: 0, max: 0 },
    { id: 'dq_room_broad', subsystem: '公共广播系统', deviceId: 'dv18', method: 'room', per: 2, buildingType: '全部业态', min: 0, max: 0 }
  ]
}

/** 幂等补齐：给旧模板里缺 auto 密度字段的设备，从同名种子模板合并 auto */
export function patchTemplatesAuto (templates, seedTpl = seedTemplates()) {
  const seedBy = {}
  seedTpl.forEach(t => { seedBy[t.name + '||' + (t.建筑类型 || '')] = t })
  ;(templates || []).forEach(t => {
    // 优先级：同名且建筑类型一致；否则只有同名
    let seed = seedBy[t.name + '||' + (t.建筑类型 || '')] || (seedTpl.find(x => x.name === t.name) || null)
    if (!seed) return
    ;(t.subsystems || []).forEach(s => {
      const seedSub = seed.subsystems.find(x => x.name === s.name)
      if (!seedSub) return
      ;(s.devices || []).forEach(d => {
        const sd = seedSub.devices.find(x => x.name === d.name)
        if (sd && sd.auto && !d.auto) d.auto = JSON.parse(JSON.stringify(sd.auto))
      })
    })
  })
}