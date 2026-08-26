// ===== 全局常量与应用版本 =====
export const APP_VER = 9

// localStorage 键名（与初版一致，保证旧数据无缝迁移）
export const LS = {
  P: 'wb_elv_projects',
  PT: 'wb_elv_points',
  DV: 'wb_elv_devices',
  ST: 'wb_elv_settings',
  MT: 'wb_elv_meta',
  VER: 'wb_elv_ver',
  BILL: 'wb_elv_bills',
  SORT: 'wb_elv_devsort',
  BRAND: 'wb_elv_devbrands'
}
export const LS_NOTES = LS.MT + 'notes'

// 预算档位（智能选型使用，核心批次先保留定义）
export const BUDGET_TIERS = [
  { id: 'economic', name: '经济型', index: 0 },
  { id: 'standard', name: '标准型', index: 1 },
  { id: 'mid', name: '中高型', index: 2 },
  { id: 'high', name: '高端型', index: 3 }
]

// 默认系统配置模板
export function defaultSettings () {
  return {
    subsystems: [], // 由 seeds 填充
    globalParams: { lossRate: 5, cableFactor: 1.05, defaultStage: '施工图设计', markup: 1, tax: 0 },
    buildingTypes: [],
    subCategories: [],
    brands: [], // 品牌库
    materialPrices: {}, // 材料价格 {名称: 单价}
    designQuotas: [], // 设计定额规则
    templates: [], // 业态模板
    designStages: ['方案设计', '初步设计', '施工图设计', '技术交底', '竣工']
  }
}

export const PROJECT_COLS = ['项目名称', '项目编号', '建筑类型', '客户', '项目地址', '建筑面积', '设计阶段', '状态', '开始日期', '预计结束日期', '备注']
export const POINT_COLS = ['项目ID', '子系统', '点位名称', '安装位置', '设备类型', '设备ID', '数量', '备注', 'updatedAt']

export const FIELD_DEFS = {
  P: PROJECT_COLS,
  PT: POINT_COLS
}

// 材料分类
export const MAT_CATS = ['管材线缆', '辅材']

// 状态流转
export const PROJECT_STATUSES = ['设计中', '校核中', '已出清单', '已完成', '已归档']