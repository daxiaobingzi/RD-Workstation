// ===== 全局 UI 状态：弹窗栈 + 确认框 =====
import { ref, shallowRef, computed, createVNode, render } from 'vue'

// 弹窗栈：{ component, props }
export const dialogStack = shallowRef([])

export function openDialog (component, props = {}) {
  dialogStack.value = dialogStack.value.concat([{ component, props }])
}

export function closeDialog () {
  if (!dialogStack.value.length) return
  dialogStack.value = dialogStack.value.slice(0, -1)
}

export function closeAllDialogs () {
  dialogStack.value = []
}

// 应用级 confirm（替代 window.confirm，支持异步）
export function confirmBox (message, title = '确认操作', danger = true) {
  return new Promise(resolve => {
    const ConfirmDialog = {
      props: { message: String, title: String, danger: Boolean },
      emits: ['close'],
      setup (props, { emit }) {
        return {
          props,
          ok () { emit('close', true) },
          cancel () { emit('close', false) }
        }
      },
      template: `
        <div class="dialog-head"><h3>{{ props.title }}</h3></div>
        <div style="white-space:pre-wrap;color:var(--text2);font-size:14px;line-height:1.7">{{ props.message }}</div>
        <div class="dialog-foot">
          <button class="btn btn-ghost" @click="cancel">取消</button>
          <button :class="props.danger ? 'btn btn-danger' : 'btn btn-primary'" @click="ok">确定</button>
        </div>`
    }
    openDialog(ConfirmDialog, { message, title, danger, onClose: v => { closeDialog(); resolve(v) } })
  })
}

// 应用级输入框（替代 window.prompt，在 iframe 沙箱中也可用）
export function promptBox (label, initial = '', title = '请输入', okText = '确定') {
  return new Promise(resolve => {
    const PromptDialog = {
      props: { label: String, initial: String, title: String, okText: String },
      emits: ['close'],
      setup (props, { emit }) {
        const val = ref(initial)
        return {
          val, props,
          ok () { emit('close', val.value.trim()) },
          cancel () { emit('close', null) },
          onEnter () { emit('close', val.value.trim()) }
        }
      },
      template: `
        <div class="dialog-head"><h3>{{ props.title }}</h3></div>
        <label>{{ props.label }}</label>
        <input v-model="val" @keydown.enter="onEnter" style="font-size:15px" />
        <div class="dialog-foot">
          <button class="btn btn-ghost" @click="cancel">取消</button>
          <button class="btn btn-primary" @click="ok">{{ props.okText }}</button>
        </div>`
    }
    openDialog(PromptDialog, { label, initial, title, okText, onClose: v => { closeDialog(); resolve(v) } })
  })
}

/** 动态渲染一个无样式弹窗内容组件（高级用法，暂时未用） */
export function renderDialogVNode (vnode) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  render(vnode, host)
  return { host, mount: () => {} }
}