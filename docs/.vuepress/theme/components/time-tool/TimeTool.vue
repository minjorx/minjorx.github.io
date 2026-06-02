<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from "vue";

const now = reactive({
  iso: '',
  local: '',
  ms: 0,
  s: 0,
});

let nowTimer: number | null = null;

function refreshNow() {
  const d = new Date();
  now.iso = d.toISOString();
  now.local = d.toLocaleString('zh-CN');
  now.ms = d.getTime();
  now.s = Math.floor(d.getTime() / 1000);
}

// 毫秒时间戳 → 日期
const tsInput = ref("");
const tsResult = ref<{ utc: string; local: string } | null>(null);

function convertTsToDate() {
  if (!tsInput.value.trim()) return;
  const ms = parseInt(tsInput.value.trim(), 10);
  if (isNaN(ms)) return;
  const d = new Date(ms);
  tsResult.value = {
    utc: d.toISOString(),
    local: d.toLocaleString('zh-CN'),
  };
}

// 秒时间戳 → 日期
const secInput = ref("");
const secResult = ref<{ utc: string; local: string } | null>(null);

function convertSecToDate() {
  if (!secInput.value.trim()) return;
  const s = parseInt(secInput.value.trim(), 10);
  if (isNaN(s)) return;
  const d = new Date(s * 1000);
  secResult.value = {
    utc: d.toISOString(),
    local: d.toLocaleString('zh-CN'),
  };
}

// 日期 → 时间戳
const dateInput = ref("");
const dateResult = ref<{ ms: string; s: string } | null>(null);

function convertDateToTs() {
  if (!dateInput.value.trim()) return;
  const d = new Date(dateInput.value.trim());
  if (isNaN(d.getTime())) return;
  dateResult.value = {
    ms: d.getTime().toString(),
    s: Math.floor(d.getTime() / 1000).toString(),
  };
}

onMounted(() => {
  refreshNow();
  nowTimer = window.setInterval(refreshNow, 1000);
});

onUnmounted(() => {
  if (nowTimer !== null) clearInterval(nowTimer);
});
</script>

<template>
  <div class="time-tool-container">
    <div class="tool-section">
      <h2>⏱ 当前时间</h2>
      <div class="now-grid">
        <div class="now-item">
          <span class="label">ISO 格式</span>
          <span class="value">{{ now.iso }}</span>
        </div>
        <div class="now-item">
          <span class="label">本地格式</span>
          <span class="value">{{ now.local }}</span>
        </div>
        <div class="now-item">
          <span class="label">时间戳（毫秒）</span>
          <span class="value highlight">{{ now.ms }}</span>
        </div>
        <div class="now-item">
          <span class="label">时间戳（秒）</span>
          <span class="value highlight">{{ now.s }}</span>
        </div>
      </div>
    </div>

    <div class="tool-section">
      <h2>📌 时间戳（毫秒）→ 日期</h2>
      <div class="input-group">
        <input
          v-model="tsInput"
          type="text"
          placeholder="输入毫秒时间戳，如 1748843200000"
          @keyup.enter="convertTsToDate"
          class="tool-input"
        />
        <button @click="convertTsToDate" class="tool-btn">转换</button>
      </div>
      <div v-if="tsResult" class="result-box">
        <div><span class="label">UTC:</span> {{ tsResult.utc }}</div>
        <div><span class="label">本地:</span> {{ tsResult.local }}</div>
      </div>
    </div>

    <div class="tool-section">
      <h2>📌 秒时间戳 → 日期</h2>
      <div class="input-group">
        <input
          v-model="secInput"
          type="text"
          placeholder="输入秒时间戳，如 1748843200"
          @keyup.enter="convertSecToDate"
          class="tool-input"
        />
        <button @click="convertSecToDate" class="tool-btn">转换</button>
      </div>
      <div v-if="secResult" class="result-box">
        <div><span class="label">UTC:</span> {{ secResult.utc }}</div>
        <div><span class="label">本地:</span> {{ secResult.local }}</div>
      </div>
    </div>

    <div class="tool-section">
      <h2>📌 日期 → 时间戳</h2>
      <div class="input-group">
        <input
          v-model="dateInput"
          type="text"
          placeholder="输入日期时间，如 2026-01-01T12:00:00"
          @keyup.enter="convertDateToTs"
          class="tool-input"
        />
        <button @click="convertDateToTs" class="tool-btn">转换</button>
      </div>
      <div v-if="dateResult" class="result-box">
        <div><span class="label">毫秒:</span> {{ dateResult.ms }}</div>
        <div><span class="label">秒:</span> {{ dateResult.s }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.time-tool-container {
  max-width: 700px;
  margin: 0 auto;
  padding: 20px;
}

.tool-section {
  margin-bottom: 32px;
  padding: 20px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.tool-section h2 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: var(--vp-c-brand-1);
}

.now-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.now-item {
  background: var(--vp-c-bg);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.now-item .label {
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.now-item .value {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  font-family: monospace;
  word-break: break-all;
}

.now-item .value.highlight {
  color: var(--vp-c-brand-1);
}

.input-group {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.tool-input {
  flex: 1;
  padding: 10px 14px;
  font-size: 14px;
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  font-family: monospace;
  transition: border-color 0.2s;
}

.tool-input:focus {
  border-color: var(--vp-c-brand-2);
}

.tool-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  background: var(--vp-c-brand-1);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.tool-btn:hover {
  background: var(--vp-c-brand-2);
}

.result-box {
  background: var(--vp-c-bg);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 14px;
  font-family: monospace;
  color: var(--vp-c-text-1);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-box .label {
  color: var(--vp-c-text-2);
  font-weight: 600;
  margin-right: 4px;
}
</style>
