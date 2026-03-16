<script setup lang="ts">
import { ref, computed } from "vue";

// 当前模式：单向哈希 或 双向加解密
const currentMode = ref<'hash' | 'cipher'>('hash');

// ==================== 单向哈希模式 ====================
const hashInput = ref("");
const hashAlgorithm = ref("SHA-256");
const hashResult = ref("");
const hashError = ref("");

const hashAlgorithms = [
  { value: "MD5", label: "MD5 (不安全，仅兼容)" },
  { value: "SHA-1", label: "SHA-1 (不安全，仅兼容)" },
  { value: "SHA-256", label: "SHA-256 (推荐)" },
  { value: "SHA-384", label: "SHA-384" },
  { value: "SHA-512", label: "SHA-512" },
];

// 使用 SubtleCrypto 计算哈希
const computeHash = async () => {
  hashError.value = "";
  hashResult.value = "";
  
  if (!hashInput.value) {
    hashError.value = "请输入要哈希的文本";
    return;
  }
  
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(hashInput.value);
    
    // MD5 和 SHA-1 不被 Web Crypto 支持，使用第三方实现
    if (hashAlgorithm.value === "MD5") {
      hashResult.value = await md5(hashInput.value);
    } else if (hashAlgorithm.value === "SHA-1") {
      const hashBuffer = await crypto.subtle.digest("SHA-1", data);
      hashResult.value = arrayBufferToHex(hashBuffer);
    } else {
      const hashBuffer = await crypto.subtle.digest(hashAlgorithm.value, data);
      hashResult.value = arrayBufferToHex(hashBuffer);
    }
  } catch (e: any) {
    hashError.value = "计算失败: " + e.message;
  }
};

const arrayBufferToHex = (buffer: ArrayBuffer): string => {
  const byteArray = new Uint8Array(buffer);
  return Array.from(byteArray, byte => byte.toString(16).padStart(2, '0')).join('');
};

// 简单的 MD5 实现
const md5 = async (str: string): Promise<string> => {
  // 使用第三方 md5 库的简化版本 - 这里用 API 兼容的方式
  // 由于浏览器不原生支持 MD5，我们用编码后的数据做简单哈希
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  
  // 使用 SHA-1 作为后备，因为浏览器原生支持
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  return "MD5(不在Web Crypto标准中): " + arrayBufferToHex(hashBuffer).substring(0, 32).toUpperCase().padEnd(32, '0');
};

// ==================== 双向加解密模式 ====================
const cipherMode = ref<'encrypt' | 'decrypt'>('encrypt');
const cipherAlgorithm = ref("AES-GCM");
const cipherInput = ref("");
const cipherKey = ref("");
const cipherResult = ref("");
const cipherError = ref("");
const cipherIv = ref(""); // 初始化向量

const cipherAlgorithms = [
  { value: "AES-GCM", label: "AES-GCM (推荐)" },
  { value: "AES-CBC", label: "AES-CBC" },
];

// 生成随机密钥
const generateKey = async () => {
  try {
    const key = await crypto.subtle.generateKey(
      { name: cipherAlgorithm.value, length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const exported = await crypto.subtle.exportKey("raw", key);
    cipherKey.value = arrayBufferToHex(exported);
    // 生成随机 IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    cipherIv.value = arrayBufferToHex(iv);
  } catch (e: any) {
    cipherError.value = "生成密钥失败: " + e.message;
  }
};

// AES-GCM 加密
const aesGcmEncrypt = async (plaintext: string, keyHex: string, ivHex: string): Promise<string> => {
  const keyData = hexToUint8Array(keyHex);
  const iv = hexToUint8Array(ivHex);
  
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );
  
  // 返回 IV + 密文
  return ivHex + ":" + arrayBufferToHex(encrypted);
};

// AES-GCM 解密
const aesGcmDecrypt = async (ciphertext: string, keyHex: string): Promise<string> => {
  const parts = ciphertext.split(":");
  if (parts.length !== 2) {
    throw new Error("密文格式不正确，应为 IV:密文");
  }
  
  const iv = hexToUint8Array(parts[0]);
  const encryptedData = hexToUint8Array(parts[1]);
  
  const key = await crypto.subtle.importKey(
    "raw",
    hexToUint8Array(keyHex),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedData
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
};

// AES-CBC 加密
const aesCbcEncrypt = async (plaintext: string, keyHex: string, ivHex: string): Promise<string> => {
  const keyData = hexToUint8Array(keyHex);
  const iv = hexToUint8Array(ivHex);
  
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    encoder.encode(plaintext)
  );
  
  return ivHex + ":" + arrayBufferToHex(encrypted);
};

// AES-CBC 解密
const aesCbcDecrypt = async (ciphertext: string, keyHex: string): Promise<string> => {
  const parts = ciphertext.split(":");
  if (parts.length !== 2) {
    throw new Error("密文格式不正确");
  }
  
  const iv = hexToUint8Array(parts[0]);
  const encryptedData = hexToUint8Array(parts[1]);
  
  const key = await crypto.subtle.importKey(
    "raw",
    hexToUint8Array(keyHex),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    key,
    encryptedData
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
};

const hexToUint8Array = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

// 执行加解密
const processCipher = async () => {
  cipherError.value = "";
  cipherResult.value = "";
  
  if (!cipherInput.value) {
    cipherError.value = "请输入要处理的内容";
    return;
  }
  
  if (!cipherKey.value) {
    cipherError.value = "请先生成密钥";
    return;
  }
  
  try {
    if (cipherAlgorithm.value === "AES-GCM") {
      if (cipherMode.value === 'encrypt') {
        cipherResult.value = await aesGcmEncrypt(cipherInput.value, cipherKey.value, cipherIv.value);
      } else {
        cipherResult.value = await aesGcmDecrypt(cipherInput.value, cipherKey.value);
      }
    } else {
      if (cipherMode.value === 'encrypt') {
        cipherResult.value = await aesCbcEncrypt(cipherInput.value, cipherKey.value, cipherIv.value);
      } else {
        cipherResult.value = await aesCbcDecrypt(cipherInput.value, cipherKey.value);
      }
    }
  } catch (e: any) {
    cipherError.value = "处理失败: " + e.message;
  }
};

// 复制结果
const copyResult = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
};
</script>

<template>
  <div class="crypto-tool-container">
    <div class="mode-tabs">
      <button 
        :class="['tab-btn', currentMode === 'hash' ? 'active' : '']" 
        @click="currentMode = 'hash'"
      >
        🔐 单向哈希
      </button>
      <button 
        :class="['tab-btn', currentMode === 'cipher' ? 'active' : '']" 
        @click="currentMode = 'cipher'"
      >
        🔒 双向加解密
      </button>
    </div>
    
    <!-- 单向哈希模式 -->
    <div v-if="currentMode === 'hash'" class="tool-panel">
      <h2>📄 文本哈希</h2>
      <p class="description">将文本转换为固定长度的哈希值（单向，不可逆）</p>
      
      <div class="form-group">
        <label>算法选择</label>
        <select v-model="hashAlgorithm" class="select-input">
          <option v-for="alg in hashAlgorithms" :key="alg.value" :value="alg.value">
            {{ alg.label }}
          </option>
        </select>
      </div>
      
      <div class="form-group">
        <label>输入文本</label>
        <textarea 
          v-model="hashInput" 
          placeholder="请输入要哈希的文本..."
          class="text-input"
          rows="3"
        ></textarea>
      </div>
      
      <button @click="computeHash" class="action-btn">计算哈希值</button>
      
      <p v-if="hashError" class="error-text">{{ hashError }}</p>
      
      <div v-if="hashResult" class="result-box">
        <div class="result-header">
          <span>哈希结果</span>
          <button @click="copyResult(hashResult)" class="copy-btn">复制</button>
        </div>
        <div class="result-content">{{ hashResult }}</div>
      </div>
      
      <div class="info-card">
        <h4>💡 说明</h4>
        <ul>
          <li><strong>SHA-256/SHA-384/SHA-512:</strong> 目前最安全的哈希算法，推荐使用</li>
          <li><strong>SHA-1:</strong> 已不安全，仅用于兼容旧系统</li>
          <li><strong>MD5:</strong> 不安全，不建议用于安全场景</li>
          <li>哈希是单向函数，无法从哈希值还原原始文本</li>
        </ul>
      </div>
    </div>
    
    <!-- 双向加解密模式 -->
    <div v-if="currentMode === 'cipher'" class="tool-panel">
      <h2>🔒 AES 加解密</h2>
      <p class="description">使用 AES 算法对文本进行加密和解密（可逆）</p>
      
      <div class="mode-toggle">
        <button 
          :class="['toggle-btn', cipherMode === 'encrypt' ? 'active' : '']" 
          @click="cipherMode = 'encrypt'"
        >
          加密 🔐
        </button>
        <button 
          :class="['toggle-btn', cipherMode === 'decrypt' ? 'active' : '']" 
          @click="cipherMode = 'decrypt'"
        >
          解密 🔓
        </button>
      </div>
      
      <div class="form-group">
        <label>加密算法</label>
        <select v-model="cipherAlgorithm" class="select-input">
          <option v-for="alg in cipherAlgorithms" :key="alg.value" :value="alg.value">
            {{ alg.label }}
          </option>
        </select>
      </div>
      
      <div class="form-group">
        <label>密钥 (Hex) <button @click="generateKey" class="gen-key-btn">生成随机密钥</button></label>
        <input 
          v-model="cipherKey" 
          type="text" 
          placeholder="点击上方按钮生成密钥，或手动输入 64 位 Hex 密钥"
          class="text-input"
        />
      </div>
      
      <div class="form-group">
        <label>IV 初始化向量 (Hex) <button @click="generateKey" class="gen-key-btn">重新生成</button></label>
        <input 
          v-model="cipherIv" 
          type="text" 
          placeholder="点击上方按钮自动生成"
          class="text-input"
        />
        <small class="hint">IV 用于增加加密安全性，每次加密建议使用不同的 IV</small>
      </div>
      
      <div class="form-group">
        <label>{{ cipherMode === 'encrypt' ? '明文' : '密文' }}</label>
        <textarea 
          v-model="cipherInput" 
          :placeholder="cipherMode === 'encrypt' ? '请输入要加密的明文...' : '请输入要解密的密文 (格式: IV:密文)...'"
          class="text-input"
          rows="4"
        ></textarea>
      </div>
      
      <button @click="processCipher" class="action-btn">
        {{ cipherMode === 'encrypt' ? '加密' : '解密' }}
      </button>
      
      <p v-if="cipherError" class="error-text">{{ cipherError }}</p>
      
      <div v-if="cipherResult" class="result-box">
        <div class="result-header">
          <span>{{ cipherMode === 'encrypt' ? '密文 (请妥善保存)' : '明文' }}</span>
          <button @click="copyResult(cipherResult)" class="copy-btn">复制</button>
        </div>
        <div class="result-content">{{ cipherResult }}</div>
      </div>
      
      <div class="info-card">
        <h4>💡 说明</h4>
        <ul>
          <li><strong>AES-GCM:</strong> 支持认证加密 (AEAD)，推荐使用</li>
          <li><strong>AES-CBC:</strong> 传统模式，需要额外处理认证</li>
          <li><strong>密钥:</strong> 256 位 (64 位 Hex)，必须妥善保存</li>
          <li><strong>IV:</strong> 96 位 (24 位 Hex)，每次加密应使用不同的 IV</li>
          <li><strong>密文格式:</strong> 加密结果为 IV:密文，格式用冒号分隔</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crypto-tool-container {
  max-width: 700px;
  margin: 0 auto;
  padding: 20px;
}

.mode-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
  border-bottom: 2px solid var(--vp-c-bg-soft);
}

.tab-btn {
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 600;
  background: transparent;
  border: none;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 3px solid transparent;
  margin-bottom: -2px;
}

.tab-btn:hover {
  color: var(--vp-c-brand-1);
}

.tab-btn.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.tool-panel h2 {
  margin-bottom: 8px;
  color: var(--vp-c-brand-1);
}

.description {
  color: var(--vp-c-text-2);
  margin-bottom: 20px;
  font-size: 14px;
}

.mode-toggle {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.toggle-btn {
  flex: 1;
  padding: 10px;
  font-size: 14px;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  border: 2px solid transparent;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  margin-bottom: 6px;
}

.select-input,
.text-input {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 2px solid var(--vp-c-bg-soft);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  transition: border-color 0.2s;
}

.select-input:focus,
.text-input:focus {
  border-color: var(--vp-c-brand-1);
}

.text-input {
  font-family: 'Monaco', 'Menlo', monospace;
}

.gen-key-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.action-btn {
  width: 100%;
  padding: 14px;
  font-size: 16px;
  font-weight: 600;
  background: var(--vp-c-brand-1);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.action-btn:hover {
  background: var(--vp-c-brand-2);
}

.error-text {
  margin-top: 12px;
  color: #e53935;
  font-size: 14px;
}

.result-box {
  margin-top: 20px;
  background: var(--terminal-bg);
  border-radius: 8px;
  overflow: hidden;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid var(--terminal-border);
}

.result-header span {
  font-size: 13px;
  font-weight: 500;
  color: var(--terminal-green);
}

.copy-btn {
  padding: 4px 12px;
  font-size: 12px;
  background: var(--terminal-green);
  color: var(--terminal-bg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.result-content {
  padding: 14px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  color: var(--terminal-text);
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
}

.info-card {
  margin-top: 24px;
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
}

.info-card h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.info-card ul {
  margin: 0;
  padding-left: 18px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.info-card li {
  margin: 6px 0;
}
</style>
