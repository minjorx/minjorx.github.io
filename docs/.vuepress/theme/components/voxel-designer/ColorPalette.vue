<script setup lang="ts">
import { computed } from 'vue'
import { PRESET_PALETTE } from './lib/preset-palette'

const props = defineProps<{
  currentColor: number
}>()

const emit = defineEmits<{
  (e: 'select', value: number): void
}>()

const cols = 8
const rows = computed(() => Math.ceil(PRESET_PALETTE.length / cols))

function isSelected(value: number): boolean {
  return value === props.currentColor
}

function selectColor(value: number) {
  emit('select', value)
}
</script>

<template>
  <div class="palette-grid" :style="{ '--cols': cols }">
    <button
      v-for="entry in PRESET_PALETTE"
      :key="entry.value"
      class="palette-swatch"
      :class="{ selected: isSelected(entry.value) }"
      :style="{ background: '#' + entry.value.toString(16).padStart(4, '0').slice(0, 6) }"
      :title="entry.name"
      @click="selectColor(entry.value)"
    ></button>
  </div>
</template>

<style scoped>
.palette-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 4px;
}
.palette-swatch {
  width: 100%;
  aspect-ratio: 1;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s, border-color 0.1s;
}
.palette-swatch:hover {
  transform: scale(1.1);
  border-color: rgba(255, 255, 255, 0.5);
}
.palette-swatch.selected {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 1px white;
  transform: scale(1.05);
}
</style>