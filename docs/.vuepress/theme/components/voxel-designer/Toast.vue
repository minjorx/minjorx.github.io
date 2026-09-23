<script setup lang="ts">
import { ref } from 'vue'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

const toasts = ref<ToastItem[]>([])
let nextId = 0

function show(type: ToastType, message: string, options?: { duration?: number }) {
  const id = nextId++
  const item: ToastItem = { id, type, message }
  toasts.value.push(item)

  // error 类不自动消失
  if (type !== 'error') {
    const duration = options?.duration ?? (type === 'warning' ? 5000 : 3000)
    setTimeout(() => dismiss(id), duration)
  }
}

function dismiss(id: number) {
  const i = toasts.value.findIndex(t => t.id === id)
  if (i >= 0) toasts.value.splice(i, 1)
}

defineExpose({
  info: (msg: string) => show('info', msg),
  success: (msg: string) => show('success', msg),
  warning: (msg: string, opts?: { duration?: number }) => show('warning', msg, opts),
  error: (msg: string) => show('error', msg),
})
</script>

<template>
  <div class="toast-container">
    <div
      v-for="t in toasts"
      :key="t.id"
      :class="['toast', t.type]"
      @click="dismiss(t.id)"
    >
      <span class="toast-icon">
        <template v-if="t.type === 'success'">✓</template>
        <template v-else-if="t.type === 'warning'">⚠</template>
        <template v-else-if="t.type === 'error'">✕</template>
        <template v-else>ℹ</template>
      </span>
      <span class="toast-msg">{{ t.message }}</span>
    </div>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 9999;
  max-width: 320px;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  font-size: 13px;
  cursor: pointer;
  animation: slide-in 0.2s ease-out;
}
.toast.info    { background: #2196f3; color: white; }
.toast.success { background: #4caf50; color: white; }
.toast.warning { background: #ff9800; color: white; }
.toast.error   { background: #f44336; color: white; }
.toast-icon {
  font-weight: bold;
}
@keyframes slide-in {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
</style>