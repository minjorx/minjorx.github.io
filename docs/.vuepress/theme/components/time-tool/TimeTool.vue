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

// 复制功能
const copiedKey = ref<string | null>(null);

async function copyText(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1500);
  } catch (e) {
    console.error('复制失败', e);
  }
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

function getDefaultDatetimeLocal() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const dateInputInit = ref(getDefaultDatetimeLocal());
const dateResult = ref<{ ms: string; s: string } | null>(null);

function convertDateToTs() {
  if (!dateInput.value) return;
  const d = new Date(dateInput.value);
  if (isNaN(d.getTime())) return;
  dateResult.value = {
    ms: d.getTime().toString(),
    s: Math.floor(d.getTime() / 1000).toString(),
  };
}

onMounted(() => {
  refreshNow();
  nowTimer = window.setInterval(refreshNow, 1000);
  dateInput.value = dateInputInit.value;
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
          <div class="value-row">
            <span class="value">{{ now.iso }}</span>
            <button
              class="copy-btn"
              :class="{ copied: copiedKey === 'iso' }"
              @click="copyText(now.iso, 'iso')"
              :title="copiedKey === 'iso' ? '已复制' : '复制'"
            >
              {{ copiedKey === 'iso' ? '✓' : '📋' }}
            </button>
          </div>
        </div>
        <div class="now-item">
          <span class="label">本地格式</span>
          <div class="value-row">
            <span class="value">{{ now.local }}</span>
            <button
              class="copy-btn"
              :class="{ copied: copiedKey === 'local' }"
              @click="copyText(now.local, 'local')"
              :title="copiedKey === 'local' ? '已复制' : '复制'"
            >
              {{ copiedKey === 'local' ? '✓' : '📋' }}
            </button>
          </div>
        </div>
        <div class="now-item">
          <span class="label">时间戳（毫秒）</span>
          <div class="value-row">
            <span class="value highlight">{{ now.ms }}</span>
            <button
              class="copy-btn"
              :class="{ copied: copiedKey === 'ms' }"
              @click="copyText(now.ms.toString(), 'ms')"
              :title="copiedKey === 'ms' ? '已复制' : '复制'"
            >
              {{ copiedKey === 'ms' ? '✓' : '📋' }}
            </button>
          </div>
        </div>
        <div class="now-item">
          <span class="label">时间戳（秒）</span>
          <div class="value-row">
            <span class="value highlight">{{ now.s }}</span>
            <button
              class="copy-btn"
              :class="{ copied: copiedKey === 's' }"
              @click="copyText(now.s.toString(), 's')"
              :title="copiedKey === 's' ? '已复制' : '复制'"
            >
              {{ copiedKey === 's' ? '✓' : '复制' }}
            </button>
          </div>
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
        <div class="result-row">
          <span class="label">UTC:</span>
          <span class="result-value">{{ tsResult.utc }}</span>
          <button
            class="copy-btn small"
            :class="{ copied: copiedKey === 'ts-utc' }"
            @click="copyText(tsResult.utc, 'ts-utc')"
            :title="copiedKey === 'ts-utc' ? '已复制' : '复制'"
          >
            {{ copiedKey === 'ts-utc' ? '✓' : '📋' }}
          </button>
        </div>
        <div class="result-row">
          <span class="label">本地:</span>
          <span class="result-value">{{ tsResult.local }}</span>
          <button
            class="copy-btn small"
            :class="{ copied: copiedKey === 'ts-local' }"
            @click="copyText(tsResult.local, 'ts-local')"
            :title="copiedKey === 'ts-local' ? '已复制' : '复制'"
          >
            {{ copiedKey === 'ts-local' ? '✓' : '📋' }}
          </button>
        </div>
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
        <div class="result-row">
          <span class="label">UTC:</span>
          <span class="result-value">{{ secResult.utc }}</span>
          <button
            class="copy-btn small"
            :class="{ copied: copiedKey === 'sec-utc' }"
            @click="copyText(secResult.utc, 'sec-utc')"
            :title="copiedKey === 'sec-utc' ? '已复制' : '复制'"
          >
            {{ copiedKey === 'sec-utc' ? '✓' : '📋' }}
          </button>
        </div>
        <div class="result-row">
          <span class="label">本地:</span>
          <span class="result-value">{{ secResult.local }}</span>
          <button
            class="copy-btn small"
            :class="{ copied: copiedKey === 'sec-local' }"
            @click="copyText(secResult.local, 'sec-local')"
            :title="copiedKey === 'sec-local' ? '已复制' : '复制'"
          >
            {{ copiedKey === 'sec-local' ? '✓' : '📋' }}
          </button>
        </div>
      </div>
    </div>

    <div class="tool-section">
      <h2>📌 日期 → 时间戳</h2>
      <div class="input-group">
        <input
          v-model="dateInput"
          type="datetime-local"
          @change="convertDateToTs"
          class="tool-input datetime-input"
        />
        <button @click="convertDateToTs" class="tool-btn">转换</button>
      </div>
      <div v-if="dateResult" class="result-box">
        <div class="result-row">
          <span class="label">毫秒:</span>
          <span class="result-value highlight">{{ dateResult.ms }}</span>
          <button
            class="copy-btn small"
            :class="{ copied: copiedKey === 'dt-ms' }"
            @click="copyText(dateResult.ms, 'dt-ms')"
            :title="copiedKey === 'dt-ms' ? '已复制' : '复制'"
          >
            {{ copiedKey === 'dt-ms' ? '✓' : '📋' }}
          </button>
        </div>
        <div class="result-row">
          <span class="label">秒:</span>
          <span class="result-value highlight">{{ dateResult.s }}</span>
          <button
            class="copy-btn small"
            :class="{ copied: copiedKey === 'dt-s' }"
            @click="copyText(dateResult.s, 'dt-s')"
            :title="copiedKey === 'dt-s' ? '已复制' : '复制'"
          >
            {{ copiedKey === 'dt-s' ? '✓' : '📋' }}
          </button>
        </div>
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

.value-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.now-item .value {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  font-family: monospace;
  word-break: break-all;
  flex: 1;
}

.now-item .value.highlight {
  color: var(--vp-c-brand-1);
}

.copy-btn {
  background: none;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  transition: all 0.2s;
  flex-shrink: 0;
}

.copy-btn:hover {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.copy-btn.copied {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.copy-btn.small {
  font-size: 11px;
  padding: 1px 5px;
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

.datetime-input {
  color-scheme: light dark;
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
  gap: 8px;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-box .label {
  color: var(--vp-c-text-2);
  font-weight: 600;
  min-width: 40px;
}

.result-value {
  flex: 1;
  word-break: break-all;
}

.result-value.highlight {
  color: var(--vp-c-brand-1);
}
</style>
