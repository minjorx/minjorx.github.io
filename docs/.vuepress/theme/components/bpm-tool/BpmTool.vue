<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from "vue";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  CanvasRenderer,
]);

// ==================== 取数范围 ====================
// 智能：<=10s 全量 / <=30s 取最近 5s / <=60s 取最近 15s / 否则取最近 30s
type RangeKey = "auto" | "10s" | "30s" | "1m" | "all";
const rangeLabels: Record<RangeKey, string> = {
  auto: "智能",
  "10s": "最近 10s",
  "30s": "最近 30s",
  "1m": "最近 1 分钟",
  all: "全部",
};
const rangeOrder: RangeKey[] = ["auto", "10s", "30s", "1m", "all"];
const currentRange = ref<RangeKey>("auto");

function resolveRangeTaps(allTaps: number[]): number[] {
  if (allTaps.length === 0) return [];
  if (currentRange.value === "all") return allTaps;
  const now = allTaps[allTaps.length - 1];
  let windowMs: number;
  if (currentRange.value === "10s") windowMs = 10_000;
  else if (currentRange.value === "30s") windowMs = 30_000;
  else if (currentRange.value === "1m") windowMs = 60_000;
  else {
    // auto
    const span = now - allTaps[0];
    if (span <= 10_000) windowMs = span;
    else if (span <= 30_000) windowMs = 5_000;
    else if (span <= 60_000) windowMs = 15_000;
    else windowMs = 30_000;
  }
  const cutoff = now - windowMs;
  return allTaps.filter((t) => t >= cutoff);
}

const rangeHint = computed(() => {
  switch (currentRange.value) {
    case "auto":
      return "根据数据时长自动选最稳的窗口（≤10s 全量、≤30s 取 5s、≤1min 取 15s、更长取 30s）";
    case "10s":
      return "只统计最近 10 秒内的点击";
    case "30s":
      return "只统计最近 30 秒内的点击";
    case "1m":
      return "只统计最近 1 分钟内的点击";
    case "all":
      return "使用全部历史点击";
  }
});

// ==================== Tap 数据 ====================
// 保存全部点击（用于切范围重算 + 持久化），用 localStorage 跨刷新保留
const STORAGE_KEY = "bpm-tool:taps:v1";
const allTaps = ref<number[]>([]);

// 单次点击的瞬时记录（最近列表显示）
interface TapSample {
  index: number;
  timestamp: number;
  delta: number; // 与上一次点击的间隔（ms）
  bpmAtTap: number; // 点击当时的瞬时 BPM
}
const samples = ref<TapSample[]>([]);
const tapCount = ref(0);

// 防止 click 与 touch 重复触发
const lastTapAt = ref(0);
const TAP_DEBOUNCE = 60; // ms

// 防止穿透到滚动：pointerdown 起点距抬起点超过这个像素视为滚动
const TAP_MAX_DRIFT = 12; // px

// localStorage 节流：高频 tap 时合并写入，避免每次都 stringify 整个数组
let persistTimer: number | null = null;
function schedulePersist() {
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allTaps.value));
    } catch {
      /* 容量满，忽略 */
    }
  }, 800);
}

interface PointerTrace {
  startX: number;
  startY: number;
  startT: number;
  valid: boolean;
}
let pendingTrace: PointerTrace | null = null;

// ==================== 指标计算 ====================
const stats = reactive({
  bpm: 0, // 当前 BPM（基于当前范围）
  meanDelta: 0, // 平均间隔 ms
  stdDelta: 0, // 标准差 ms
  stability: 0, // 稳定性评分 0~100（CV 越小越高）
  minBpm: 0,
  maxBpm: 0,
  rangeMs: 0, // 当前窗口时间跨度
});

// 心率参考区间（成人静息）：60-100 BPM，对应 IBI 600-1000ms
// 用于在曲线上画一条参考色带，仅做参考
const RESTING_LOW_BPM = 60;
const RESTING_HIGH_BPM = 100;
const IBI_RESTING_LOW_MS = 60_000 / RESTING_LOW_BPM; // 1000ms
const IBI_RESTING_HIGH_MS = 60_000 / RESTING_HIGH_BPM; // 600ms

function computeStats(taps: number[]) {
  if (taps.length < 2) {
    stats.bpm = 0;
    stats.meanDelta = 0;
    stats.stdDelta = 0;
    stats.stability = 0;
    stats.minBpm = 0;
    stats.maxBpm = 0;
    stats.rangeMs = taps.length === 1 ? 0 : 0;
    return;
  }
  const deltas: number[] = [];
  const instBpm: number[] = [];
  for (let i = 1; i < taps.length; i++) {
    const d = taps[i] - taps[i - 1];
    if (d > 0) {
      deltas.push(d);
      instBpm.push(60_000 / d);
    }
  }
  if (deltas.length === 0) {
    stats.bpm = 0;
    return;
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance = deltas.reduce((acc, d) => acc + (d - mean) ** 2, 0) / deltas.length;
  const std = Math.sqrt(variance);
  const cv = std / mean; // 变异系数，越小越稳
  // 映射到 0~100：CV=0 → 100，CV=0.3 → 0
  const stability = Math.max(0, Math.min(100, Math.round((1 - cv / 0.3) * 100)));

  stats.bpm = Math.round((60_000 / mean) * 10) / 10; // 保留 1 位小数
  stats.meanDelta = Math.round(mean);
  stats.stdDelta = Math.round(std);
  stats.stability = stability;
  stats.minBpm = Math.round(Math.min(...instBpm) * 10) / 10;
  stats.maxBpm = Math.round(Math.max(...instBpm) * 10) / 10;
  stats.rangeMs = taps[taps.length - 1] - taps[0];
}

// 心率区间参考（仅展示用，不做"快/慢"判断）
const restingHint = computed(() => {
  if (stats.bpm <= 0) return null;
  if (stats.bpm < RESTING_LOW_BPM) {
    return { text: "低于成人静息心率下界（运动员 / 睡眠中常见）", tone: "good" as const };
  }
  if (stats.bpm <= RESTING_HIGH_BPM) {
    return { text: "落在成人静息心率参考范围内（60-100）", tone: "good" as const };
  }
  if (stats.bpm <= 120) {
    return { text: "略高于静息范围（紧张 / 活动后常见）", tone: "ok" as const };
  }
  return { text: "明显高于静息范围（运动 / 测量节奏过快）", tone: "off" as const };
});

// ==================== 图表 ====================
const chartDom = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function buildChartOption(taps: number[]) {
  const data: [number, number][] = [];
  for (let i = 1; i < taps.length; i++) {
    data.push([i, taps[i] - taps[i - 1]]);
  }

  // 静息心率参考区间：60-100 BPM 对应 IBI 600-1000ms
  // 注意 Y 轴 IBI 是反向的：1000ms(慢)在下，600ms(快)在上
  const markLines: any[] = [
    {
      yAxis: IBI_RESTING_LOW_MS,
      label: {
        formatter: "60 BPM",
        color: "#10b981",
        fontSize: 11,
        position: "insideStartTop",
      },
      lineStyle: { color: "#10b981", type: "dashed", width: 1, opacity: 0.5 },
    },
    {
      yAxis: IBI_RESTING_HIGH_MS,
      label: {
        formatter: "100 BPM",
        color: "#10b981",
        fontSize: 11,
        position: "insideStartBottom",
      },
      lineStyle: { color: "#10b981", type: "dashed", width: 1, opacity: 0.5 },
    },
  ];

  return {
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    tooltip: {
      trigger: "axis",
      formatter: (params: any[]) => {
        if (!params.length) return "";
        const p = params[0];
        const idx = p.data[0];
        const ibi = Math.round(p.data[1]);
        const inst = Math.round((60_000 / ibi) * 10) / 10;
        return `第 ${idx} 拍<br/>间隔 ${ibi} ms<br/>瞬时 ${inst} BPM`;
      },
    },
    xAxis: {
      type: "value",
      name: "拍号",
      nameLocation: "middle",
      nameGap: 22,
      minInterval: 1,
      axisLine: { lineStyle: { color: getCss("--vp-c-divider") } },
      axisLabel: { color: getCss("--vp-c-text-2") },
      splitLine: { lineStyle: { color: getCss("--vp-c-bg-alt") } },
    },
    yAxis: {
      type: "value",
      name: "IBI (ms)",
      nameLocation: "middle",
      nameGap: 40,
      axisLine: { lineStyle: { color: getCss("--vp-c-divider") } },
      axisLabel: { color: getCss("--vp-c-text-2") },
      splitLine: { lineStyle: { color: getCss("--vp-c-bg-alt") } },
    },
    series: [
      {
        type: "line",
        name: "间隔",
        data,
        smooth: false,
        symbol: "circle",
        symbolSize: 6,
        showSymbol: data.length <= 60,
        lineStyle: { color: getCss("--vp-c-brand-1"), width: 2 },
        itemStyle: { color: getCss("--vp-c-brand-1") },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: hexToRgba(getCss("--vp-c-brand-1"), 0.25) },
              { offset: 1, color: hexToRgba(getCss("--vp-c-brand-1"), 0) },
            ],
          },
        },
        markLine: {
          symbol: "none",
          data: markLines,
          animation: false,
        },
      },
    ],
  };
}

function getCss(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "#3eaf7c";
}

function hexToRgba(input: string, alpha: number): string {
  const c = input.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const v =
      hex.length === 3
        ? hex.split("").map((ch) => parseInt(ch + ch, 16))
        : [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${alpha})`;
  }
  // 兜底
  return c;
}

function refreshChart() {
  if (!chart) return;
  const taps = resolveRangeTaps(allTaps.value);
  chart.setOption(buildChartOption(taps), { notMerge: true });
}

function ensureChart() {
  if (!chartDom.value) return;
  if (chart) return;
  chart = echarts.init(chartDom.value, undefined, { renderer: "canvas" });
  refreshChart();
}

// ==================== 点击 / 节拍 ====================
function registerTap() {
  const now = performance.now();
  if (now - lastTapAt.value < TAP_DEBOUNCE) return; // 防止重复
  lastTapAt.value = now;

  allTaps.value.push(now);
  tapCount.value++;

  // 持久化（debounce 800ms 合并写入，避免高频 tap 时反复 stringify 整个数组）
  schedulePersist();

  // 计算本拍的指标
  const ts = allTaps.value;
  const idx = ts.length - 1;
  const delta = idx > 0 ? ts[idx] - ts[idx - 1] : 0;
  const bpmAtTap = delta > 0 ? 60_000 / delta : 0;

  samples.value.push({
    index: idx + 1,
    timestamp: Date.now(),
    delta: Math.round(delta),
    bpmAtTap: Math.round(bpmAtTap * 10) / 10,
  });
  if (samples.value.length > 500) {
    samples.value = samples.value.slice(-500);
  }

  recompute();

  // 脉冲反馈：递增 pulse 触发 ripple DOM 重挂，从而重启动画
  pulse.value++;
}

function recompute() {
  const taps = resolveRangeTaps(allTaps.value);
  computeStats(taps);
  refreshChart();
}

// ==================== UI 状态 ====================
const pulse = ref(0); // 每次 tap +1，用于驱动 CSS 动画
const copied = ref(false);

async function copyBpm() {
  if (stats.bpm <= 0) return;
  try {
    await navigator.clipboard.writeText(stats.bpm.toString());
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* ignore */
  }
}

function resetTaps() {
  allTaps.value = [];
  samples.value = [];
  tapCount.value = 0;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  recompute();
}

// ==================== 指针处理（防穿透到滚动）===================
// iOS Safari 上 @touchstart.prevent 会阻断后续合成 click，所以这里不调 preventDefault。
// 改用 pointerdown 记录起点，click 统一处理 tap，移动端阈值放宽到 18px。
function onPointerDown(e: PointerEvent) {
  pendingTrace = {
    startX: e.clientX,
    startY: e.clientY,
    startT: performance.now(),
    valid: true,
  };
}

function onPointerMove(e: PointerEvent) {
  if (!pendingTrace) return;
  const dx = e.clientX - pendingTrace.startX;
  const dy = e.clientY - pendingTrace.startY;
  if (Math.hypot(dx, dy) > TAP_MAX_DRIFT) {
    pendingTrace.valid = false;
  }
}

function onPointerUp(_e: PointerEvent) {
  // 这里不消费 pendingTrace —— 把 trace 留给 click 处理
  // 也不在 pointerup 阶段直接注册 tap，避免与 click 双重触发
}

function onClick(_e: MouseEvent) {
  // 桌面：pendingTrace 通常是 null（没触发 pointer 事件），走 fallback 注册
  // 移动：pendingTrace 由 pointerdown 设置，pointerup 不消费，由这里统一注册
  const trace = pendingTrace;
  pendingTrace = null;

  if (trace) {
    if (!trace.valid) return;
    // 再校验一次时长
    if (performance.now() - trace.startT > 1500) return;
  }
  registerTap();
}

const chartStyle = computed(() => ({ width: "100%", height: "260px" }));

// ==================== 生命周期 ====================
let resizeListener: (() => void) | null = null;

onMounted(() => {
  // 恢复历史
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as number[];
      if (Array.isArray(arr) && arr.every((n) => typeof n === "number")) {
        // 只保留最近 1 小时的数据，避免无限增长
        const cutoff = performance.now() - 3_600_000;
        allTaps.value = arr.filter((t) => t >= cutoff);
      }
    }
  } catch {
    /* ignore */
  }
  tapCount.value = allTaps.value.length;

  nextTick(() => {
    ensureChart();
    recompute();
  });

  resizeListener = () => chart?.resize();
  window.addEventListener("resize", resizeListener);
});

onUnmounted(() => {
  if (resizeListener) window.removeEventListener("resize", resizeListener);
  chart?.dispose();
  chart = null;
});

// 监听范围变化 → 重算
function onRangeChange(k: RangeKey) {
  currentRange.value = k;
  recompute();
}
</script>

<template>
  <div class="bpm-tool-container">
    <!-- 取数范围 -->
    <div class="tool-section">
      <h2>🎯 取数范围</h2>
      <div class="range-tabs">
        <button
          v-for="k in rangeOrder"
          :key="k"
          :class="['range-btn', currentRange === k ? 'active' : '']"
          @click="onRangeChange(k)"
        >
          {{ rangeLabels[k] }}
        </button>
      </div>
      <p class="range-hint">{{ rangeHint }}</p>
    </div>

    <!-- 点击区 + 大 BPM -->
    <div class="tool-section tap-section">
      <div
        class="tap-target"
        role="button"
        aria-label="点击或轻拍来测心率"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="pendingTrace = null"
        @click="onClick"
      >
        <div class="tap-hint">TAP</div>
        <div class="tap-sub">用手指感受心跳节奏，每跳轻点一次</div>
        <!-- 用 :key="pulse" 每次重挂元素来确保动画从头开始播放 -->
        <div :key="pulse" class="tap-ripple"></div>
      </div>

      <div class="bpm-display" :class="{ active: stats.bpm > 0 }">
        <div class="bpm-value">
          {{ stats.bpm > 0 ? stats.bpm.toFixed(1) : "—" }}
        </div>
        <div class="bpm-unit">次 / 分钟</div>
      </div>

      <p
        v-if="restingHint"
        class="bpm-hint"
        :class="`tone-${restingHint.tone}`"
      >
        {{ restingHint.text }}
      </p>
      <p v-else class="bpm-hint muted">
        至少点击 2 次开始计算；建议连续轻点 10-15 次获得稳定的平均值。
      </p>

      <div class="bpm-meta">
        <div class="meta-item">
          <span class="meta-label">点击数</span>
          <span class="meta-value">{{ tapCount }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">平均间隔</span>
          <span class="meta-value">{{ stats.meanDelta || "—" }} ms</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">稳定性</span>
          <span
            class="meta-value"
            :class="{
              tonePerfect: stats.stability >= 85,
              toneGood: stats.stability >= 65 && stats.stability < 85,
              toneOff: stats.stability > 0 && stats.stability < 65,
            }"
          >
            {{ stats.stability > 0 ? `${stats.stability}%` : "—" }}
          </span>
        </div>
      </div>

      <div class="quick-actions">
        <button class="ghost-btn" @click="resetTaps" :disabled="tapCount === 0">
          清空数据
        </button>
        <button
          class="ghost-btn"
          @click="copyBpm"
          :disabled="stats.bpm <= 0"
          :class="{ copied }"
        >
          {{ copied ? "已复制" : "复制 BPM" }}
        </button>
      </div>
    </div>

    <!-- 曲线 -->
    <div class="tool-section">
      <h2>📈 间隔曲线（IBI）</h2>
      <p class="section-desc">
        纵轴为相邻两次点击的间隔（毫秒）。曲线越水平、越落在两条绿色虚线之间，心率越稳。
      </p>
      <div ref="chartDom" :style="chartStyle"></div>
      <div class="range-readout">
        <span>本窗口：{{ tapCount > 0 ? `共 ${tapCount} 次点击` : "暂无数据" }}</span>
        <span v-if="stats.minBpm > 0 && stats.maxBpm > 0">
          瞬时 BPM 区间：{{ stats.minBpm }} ~ {{ stats.maxBpm }}
        </span>
      </div>
    </div>

    <!-- 最近点击列表 -->
    <div v-if="samples.length > 0" class="tool-section">
      <h2>📝 最近点击</h2>
      <div class="sample-list">
        <div
          v-for="s in samples.slice(-12).reverse()"
          :key="s.timestamp"
          class="sample-row"
        >
          <span class="sample-index">#{{ s.index }}</span>
          <span class="sample-delta">{{ s.delta }} ms</span>
          <span class="sample-bpm">{{ s.bpmAtTap }} BPM</span>
          <span class="sample-time">{{ new Date(s.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bpm-tool-container {
  max-width: 720px;
  margin: 0 auto;
  padding: 20px;
  /* 整个工具页禁用文本选择 / 长按菜单 —— 交互页面，文字选中无意义且容易误触 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
  /* 禁止长按高亮 / iOS 灰底 */
  -webkit-tap-highlight-color: transparent;
}

/* 全局：所有 button 元素禁用长按高亮 + 选中 + focus 框 */
.bpm-tool-container button {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
.bpm-tool-container button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.tool-section {
  margin-bottom: 24px;
  padding: 20px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.tool-section h2 {
  margin: 0 0 12px 0;
  font-size: 16px;
  color: var(--vp-c-brand-1);
}

.section-desc {
  margin: 0 0 12px 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.5;
}

/* ===== 范围选择 ===== */
.range-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.range-btn {
  flex: 1 1 auto;
  min-width: 76px;
  padding: 8px 12px;
  font-size: 13px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
}

.range-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.range-btn.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.range-hint {
  margin: 0;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

/* ===== Tap 区 ===== */
.tap-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.tap-target {
  position: relative;
  width: min(280px, 70vw);
  height: min(280px, 70vw);
  border-radius: 50%;
  background: linear-gradient(
    135deg,
    var(--vp-c-brand-1),
    var(--vp-c-brand-2)
  );
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* user-select / tap-highlight 由容器继承 */
  touch-action: manipulation;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  transition: transform 0.08s ease;
  overflow: hidden;
  /* 去掉点击后浏览器的浅蓝色 focus outline 框 */
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.tap-target:active {
  transform: scale(0.97);
}

/* 键盘聚焦时给一个柔和的品牌色环作为可访问性提示（视觉上不破坏） */
.tap-target:focus-visible {
  box-shadow: 0 0 0 4px var(--vp-c-brand-soft), 0 8px 24px rgba(0, 0, 0, 0.18);
}

.tap-hint {
  font-size: 56px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 4px;
  line-height: 1;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}

.tap-sub {
  margin-top: 10px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
}

.tap-ripple {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  animation: tap-ripple 0.5s ease-out;
}

/* 关键：动画结束后回归空 box-shadow，避免旧元素残留 80px 透明阴影 */
@keyframes tap-ripple {
  0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7); }
  99% { box-shadow: 0 0 0 80px rgba(255, 255, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
}

/* ===== BPM 数字 ===== */
.bpm-display {
  margin-top: 24px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--vp-c-text-2);
  transition: color 0.2s;
}

.bpm-display.active {
  color: var(--vp-c-brand-1);
}

.bpm-value {
  font-size: 72px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -2px;
}

.bpm-unit {
  font-size: 20px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

/* ===== Meta ===== */
.bpm-meta {
  display: flex;
  gap: 20px;
  margin-top: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

.meta-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 90px;
}

.meta-label {
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.meta-value {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-1);
}

/* ===== 按钮 ===== */
.quick-actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

.ghost-btn {
  padding: 8px 16px;
  font-size: 13px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
}

.ghost-btn:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.ghost-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ghost-btn.copied {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

/* ===== Tone（统一色调）===== */
.tone-perfect {
  color: #10b981;
}
.tone-good {
  color: #3b82f6;
}
.tone-ok {
  color: #f59e0b;
}
.tone-off {
  color: #ef4444;
}

/* ===== 心率提示行 ===== */
.bpm-hint {
  margin: 12px 0 0 0;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}
.bpm-hint.muted {
  color: var(--vp-c-text-3);
}

/* ===== 区间提示 ===== */
.range-readout {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--vp-c-text-3);
  flex-wrap: wrap;
  gap: 6px;
}

/* ===== 最近点击 ===== */
.sample-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sample-row {
  display: grid;
  grid-template-columns: 48px 1fr 1fr 1fr;
  align-items: center;
  padding: 8px 10px;
  background: var(--vp-c-bg);
  border-radius: 6px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.sample-index {
  color: var(--vp-c-text-3);
  font-weight: 600;
}

.sample-delta {
  color: var(--vp-c-text-2);
}

.sample-bpm {
  color: var(--vp-c-text-1);
  font-weight: 600;
}

.sample-time {
  text-align: right;
  color: var(--vp-c-text-3);
  font-size: 12px;
}

/* ===== 响应式 ===== */
@media (max-width: 540px) {
  .tool-section {
    padding: 16px;
  }
  .tap-target {
    width: min(220px, 60vw);
    height: min(220px, 60vw);
  }
  .tap-hint {
    font-size: 42px;
  }
  .bpm-value {
    font-size: 56px;
  }
  .bpm-unit {
    font-size: 16px;
  }
  .bpm-meta {
    gap: 12px;
  }
  .sample-row {
    grid-template-columns: 40px 1fr 1fr 1fr;
    font-size: 12px;
  }
}
</style>