<script setup lang="ts">
import { computed } from 'vue'
import { TEMPLATES, type Template } from './lib/templates'

const props = defineProps<{
  currentTemplateId: string | null
  params: Record<string, number>
}>()

const emit = defineEmits<{
  (e: 'select', template: Template): void
  (e: 'param-change', key: string, value: number): void
}>()

function selectTemplate(t: Template) {
  emit('select', t)
}

function onParamChange(key: string, e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(v)) emit('param-change', key, v)
}

const currentTemplate = computed(() =>
  TEMPLATES.find(t => t.id === props.currentTemplateId) ?? null,
)
</script>

<template>
  <div class="templates-section">
    <div class="template-buttons">
      <button
        v-for="t in TEMPLATES"
        :key="t.id"
        class="template-btn"
        :class="{ selected: currentTemplateId === t.id }"
        :title="t.name"
        @click="selectTemplate(t)"
      >
        <span class="icon">{{ t.icon }}</span>
        <span class="name">{{ t.name }}</span>
      </button>
    </div>
    <div v-if="currentTemplate?.params" class="params">
      <label v-for="(p, key) in currentTemplate.params" :key="key" class="param-row">
        <span class="param-label">{{ p.label }}</span>
        <input
          type="number"
          :min="p.min"
          :max="p.max"
          :value="params[key] ?? p.default"
          @change="onParamChange(key, $event)"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.template-buttons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 12px;
}
.template-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  color: var(--vp-c-text-1);
  transition: all 0.15s;
}
.template-btn:hover {
  border-color: var(--vp-c-brand-1);
}
.template-btn.selected {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.icon {
  font-size: 18px;
  line-height: 1;
}
.name {
  font-size: 11px;
}
.params {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.param-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.param-row input {
  width: 60px;
  padding: 2px 6px;
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 12px;
}
</style>