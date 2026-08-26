// ===== 布局总线：视图向顶栏注册标题与操作按钮 =====
import { reactive } from 'vue'

export const layout = reactive({
  title: '弱电智能化设计工作台',
  // [{ label, icon, cls: 'primary'|'ghost'|'danger', onClick, disabled }]
  actions: []
})

export function useLayout () {
  return {
    title: layout.title,
    actions: layout.actions,
    setTitle (t) { layout.title = t || '' },
    setActions (actions = []) { layout.actions = actions }
  }
}