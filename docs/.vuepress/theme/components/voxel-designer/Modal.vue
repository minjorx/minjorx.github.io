<script setup lang="ts">
defineProps<{
  visible: boolean
  title?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function onBackdrop(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-backdrop" @click="onBackdrop" @keydown="onEsc" tabindex="-1">
        <div class="modal-card">
          <header v-if="title" class="modal-header">
            <h3>{{ title }}</h3>
            <button class="modal-close" @click="emit('close')">×</button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
}
.modal-card {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 8px;
  min-width: 360px;
  max-width: 90vw;
  max-height: 90vh;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--vp-c-bg-alt);
}
.modal-header h3 {
  margin: 0;
  font-size: 15px;
}
.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--vp-c-text-2);
  line-height: 1;
  padding: 0;
}
.modal-body {
  padding: 20px;
  overflow: auto;
}
.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--vp-c-bg-alt);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.15s;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
</style>