<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  parseJwt,
  verifyHsSignature,
  checkExpiry,
  formatTimestamp,
  timeAgo,
  type ParsedJwt,
  type ExpiryInfo,
} from './lib/jwt'

// ==================== 状态 ====================
const tokenInput = ref('')
const parsed = ref<ParsedJwt | null>(null)
const secretInput = ref('')
const verifyResult = ref<{ valid: boolean; error?: string } | null>(null)
const verifying = ref(false)

// ==================== 派生 ====================
const expiry = computed<ExpiryInfo | null>(() => {
  if (!parsed.value?.valid) return null
  return checkExpiry(parsed.value.payload)
})

// 时间戳辅助显示
const expDisplay = computed(() => {
  if (!parsed.value?.payload?.exp) return null
  return {
    ts: parsed.value.payload.exp,
    text: formatTimestamp(parsed.value.payload.exp),
    ago: timeAgo(parsed.value.payload.exp),
  }
})
const nbfDisplay = computed(() => {
  if (!parsed.value?.payload?.nbf) return null
  return {
    ts: parsed.value.payload.nbf,
    text: formatTimestamp(parsed.value.payload.nbf),
    ago: timeAgo(parsed.value.payload.nbf),
  }
})
const iatDisplay = computed(() => {
  if (!parsed.value?.payload?.iat) return null
  return {
    ts: parsed.value.payload.iat,
    text: formatTimestamp(parsed.value.payload.iat),
    ago: timeAgo(parsed.value.payload.iat),
  }
})

// ==================== 操作 ====================
function doParse() {
  parsed.value = null
  verifyResult.value = null
  const result = parseJwt(tokenInput.value)
  parsed.value = result
}

function doClear() {
  tokenInput.value = ''
  parsed.value = null
  verifyResult.value = null
  secretInput.value = ''
}

async function doVerify() {
  if (!parsed.value?.valid) {
    verifyResult.value = { valid: false, error: '请先正确解析 JWT' }
    return
  }
  if (!secretInput.value) {
    verifyResult.value = { valid: false, error: '请输入 secret' }
    return
  }
  verifying.value = true
  try {
    verifyResult.value = await verifyHsSignature(tokenInput.value, secretInput.value)
  } finally {
    verifying.value = false
  }
}

// 填入示例
const exampleJwt = ref('')
function loadExample(kind: 'hs256' | 'expired' | 'no-exp') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  let payload: any
  switch (kind) {
    case 'hs256':
      payload = b64u(JSON.stringify({
        sub: '1234567890', name: 'Alice', admin: true,
        iat: now, exp: now + 3600,
      }))
      break
    case 'expired':
      payload = b64u(JSON.stringify({
        sub: '1234567890', name: 'Bob',
        iat: now - 7200, exp: now - 3600,
      }))
      break
    case 'no-exp':
      payload = b64u(JSON.stringify({
        sub: '1234567890', name: 'Carol',
        iat: now,
      }))
      break
  }
  // 演示用假签名
  const sig = b64u(String('demo-signature'))
  exampleJwt.value = `${header}.${payload}.${sig}`
  tokenInput.value = exampleJwt.value
  doParse()
}

function b64u(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function copyTo(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {})
}
</script>

<template>
  <div class="jwt-tool-container">
    <!-- 输入区 -->
    <div class="input-section">
      <div class="input-header">
        <h2>JWT 解析</h2>
        <div class="input-actions">
          <button class="action-btn" @click="doParse">解析</button>
          <button class="action-btn" @click="doClear">清空</button>
          <span class="action-sep">|</span>
          <button class="action-btn small" @click="loadExample('hs256')">示例：有效</button>
          <button class="action-btn small" @click="loadExample('expired')">示例：已过期</button>
          <button class="action-btn small" @click="loadExample('no-exp')">示例：永不过期</button>
        </div>
      </div>
      <textarea
        v-model="tokenInput"
        class="jwt-input"
        rows="5"
        placeholder="粘贴 JWT 字符串（格式：header.payload.signature）"
        spellcheck="false"
      ></textarea>
      <div v-if="parsed && !parsed.valid" class="error-bar">
        解析失败：{{ parsed.error }}
      </div>
    </div>

    <!-- 状态栏（过期 / 验证） -->
    <div v-if="parsed?.valid" class="status-section">
      <div
        class="status-card"
        :class="{
          ok: expiry?.status === 'valid',
          warn: expiry?.status === 'not-yet-valid' || expiry?.status === 'no-exp',
          err: expiry?.status === 'expired',
        }"
      >
        <span class="status-icon">
          {{ expiry?.status === 'valid' ? '✓' : expiry?.status === 'expired' ? '✗' : '⚠' }}
        </span>
        <div class="status-content">
          <div class="status-title">过期状态：{{
            expiry?.status === 'valid' ? '有效'
            : expiry?.status === 'expired' ? '已过期'
            : expiry?.status === 'not-yet-valid' ? '尚未生效'
            : expiry?.status === 'no-exp' ? '无 exp 字段'
            : '未知'
          }}</div>
          <div class="status-detail">{{ expiry?.message }}</div>
        </div>
      </div>
    </div>

    <!-- 验证区 -->
    <div v-if="parsed?.valid" class="verify-section">
      <h3>签名验证（HS256 / HS384 / HS512）</h3>
      <div class="verify-row">
        <input
          v-model="secretInput"
          type="text"
          class="secret-input"
          placeholder="输入 HMAC secret / 共享密钥"
          @keyup.enter="doVerify"
        />
        <button class="action-btn" :disabled="verifying" @click="doVerify">
          {{ verifying ? '验证中…' : '验证签名' }}
        </button>
      </div>
      <div v-if="verifyResult" class="verify-result" :class="verifyResult.valid ? 'ok' : 'err'">
        <span class="status-icon">{{ verifyResult.valid ? '✓' : '✗' }}</span>
        <span>{{ verifyResult.valid ? '签名验证通过' : (verifyResult.error || '签名验证失败') }}</span>
      </div>
    </div>

    <!-- Header + Payload 双栏 -->
    <div v-if="parsed?.valid && parsed.header" class="result-section">
      <div class="result-grid">
        <div class="result-card">
          <div class="result-header">
            <h3>Header</h3>
            <span class="result-meta">alg = {{ parsed.header.alg }}</span>
          </div>
          <pre class="result-json">{{ JSON.stringify(parsed.header, null, 2) }}</pre>
        </div>
        <div class="result-card">
          <div class="result-header">
            <h3>Payload</h3>
            <button class="action-btn small" @click="copyTo(JSON.stringify(parsed.payload, null, 2))">
              复制
            </button>
          </div>
          <pre class="result-json">{{ JSON.stringify(parsed.payload, null, 2) }}</pre>
        </div>
      </div>
    </div>

    <!-- 时间戳面板 -->
    <div v-if="parsed?.valid && (expDisplay || nbfDisplay || iatDisplay)" class="time-section">
      <h3>时间戳</h3>
      <div class="time-grid">
        <div v-if="iatDisplay" class="time-card">
          <div class="time-label">iat（签发）</div>
          <div class="time-value">{{ iatDisplay.text }}</div>
          <div class="time-ago">{{ iatDisplay.ago }}</div>
        </div>
        <div v-if="nbfDisplay" class="time-card">
          <div class="time-label">nbf（生效）</div>
          <div class="time-value">{{ nbfDisplay.text }}</div>
          <div class="time-ago">{{ nbfDisplay.ago }}</div>
        </div>
        <div v-if="expDisplay" class="time-card">
          <div class="time-label">exp（过期）</div>
          <div class="time-value">{{ expDisplay.text }}</div>
          <div class="time-ago">{{ expDisplay.ago }}</div>
        </div>
      </div>
    </div>

    <!-- Signature 原始 -->
    <div v-if="parsed?.valid && parsed.signature" class="sig-section">
      <h3>Signature（Base64URL）</h3>
      <pre class="sig-value">{{ parsed.signature }}</pre>
    </div>

    <!-- 底部信息 -->
    <div class="info-section">
      <h4>关于</h4>
      <p>
        JWT 由 <code>header.payload.signature</code> 三段 Base64URL 编码组成。
        本工具支持解析、过期检查、HS256/HS384/HS512 签名验证。
        其他算法（RS256/ES256 等非对称算法）暂不支持。
      </p>
    </div>
  </div>
</template>

<style scoped>
.jwt-tool-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px;
}

.input-section,
.status-section,
.verify-section,
.result-section,
.time-section,
.sig-section,
.info-section {
  margin-bottom: 20px;
  padding: 16px 20px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.input-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.input-header h2 {
  margin: 0;
  font-size: 16px;
  color: var(--vp-c-brand-1);
}

.input-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.action-sep {
  color: var(--vp-c-text-3);
  margin: 0 4px;
}

.action-btn {
  padding: 5px 14px;
  font-size: 13px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.action-btn:hover:not(:disabled) {
  background: var(--vp-c-brand-soft);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn.small {
  padding: 4px 10px;
  font-size: 12px;
}

.jwt-input {
  width: 100%;
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 6px;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
}
.jwt-input:focus {
  border-color: var(--vp-c-brand-2);
}

.error-bar {
  margin-top: 8px;
  padding: 6px 10px;
  background: rgba(244, 67, 54, 0.1);
  color: #c62828;
  border-radius: 4px;
  font-size: 13px;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 8px;
  border-left: 4px solid #888;
  background: var(--vp-c-bg);
}
.status-card.ok { border-left-color: #2e7d32; }
.status-card.warn { border-left-color: #f9a825; }
.status-card.err { border-left-color: #c62828; }

.status-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-weight: bold;
  font-size: 16px;
  color: white;
  flex-shrink: 0;
}
.status-card.ok .status-icon { background: #2e7d32; }
.status-card.warn .status-icon { background: #f9a825; }
.status-card.err .status-icon { background: #c62828; }

.status-title { font-weight: 600; font-size: 14px; }
.status-detail { font-size: 12px; color: var(--vp-c-text-2); margin-top: 2px; }

.verify-row {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.secret-input {
  flex: 1;
  padding: 8px 12px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  outline: none;
}
.secret-input:focus { border-color: var(--vp-c-brand-1); }

.verify-result {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.verify-result.ok { background: rgba(46, 125, 50, 0.1); color: #2e7d32; }
.verify-result.err { background: rgba(198, 40, 40, 0.1); color: #c62828; }

.result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 720px) {
  .result-grid { grid-template-columns: 1fr; }
}

.result-card {
  background: var(--vp-c-bg);
  border-radius: 8px;
  padding: 12px 16px;
  border: 1px solid var(--vp-c-bg-alt);
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.result-header h3 {
  margin: 0;
  font-size: 14px;
  color: var(--vp-c-brand-1);
}
.result-meta {
  font-size: 12px;
  color: var(--vp-c-text-3);
  font-family: ui-monospace, monospace;
}

.result-json {
  margin: 0;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  border-radius: 4px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}

.time-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 720px) {
  .time-grid { grid-template-columns: 1fr; }
}

.time-card {
  background: var(--vp-c-bg);
  border-radius: 6px;
  padding: 10px 14px;
  border-left: 3px solid var(--vp-c-brand-1);
}
.time-label {
  font-size: 11px;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.time-value {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--vp-c-text-1);
}
.time-ago {
  font-size: 11px;
  color: var(--vp-c-text-2);
  margin-top: 2px;
}

.sig-value {
  margin: 0;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  border-radius: 4px;
  overflow-x: auto;
  word-break: break-all;
}

.info-section h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.info-section p {
  margin: 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
.info-section code {
  font-family: ui-monospace, monospace;
  background: var(--vp-c-bg);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}
</style>
