<script setup lang="ts">
import { ref, computed } from "vue";

const ipInput = ref("");
const errorMsg = ref("");
const result = ref<any>(null);

// IPv4 格式校验
const isValidIPv4 = (ip: string): boolean => {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return false;
  
  const parts = ip.split(".");
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
};

// 判断是否为私有 IP
const isPrivateIP = (ip: string): boolean => {
  const parts = ip.split(".").map(Number);
  
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  
  return false;
};

// 获取 IP 类别
const getIPClass = (ip: string): { class: string; description: string } => {
  const firstOctet = parseInt(ip.split(".")[0], 10);
  
  if (firstOctet >= 0 && firstOctet <= 127) {
    return { class: "A", description: "Class A (0.x.x.x - 127.x.x.x)" };
  } else if (firstOctet >= 128 && firstOctet <= 191) {
    return { class: "B", description: "Class B (128.x.x.x - 191.x.x.x)" };
  } else if (firstOctet >= 192 && firstOctet <= 223) {
    return { class: "C", description: "Class C (192.x.x.x - 223.x.x.x)" };
  } else if (firstOctet >= 224 && firstOctet <= 239) {
    return { class: "D", description: "Class D - Multicast (224.x.x.x - 239.x.x.x)" };
  } else {
    return { class: "E", description: "Class E - Reserved (240.x.x.x - 255.x.x.x)" };
  }
};

// 获取默认子网掩码
const getDefaultSubnetMask = (ipClass: string): string => {
  switch (ipClass) {
    case "A":
      return "255.0.0.0 (/8)";
    case "B":
      return "255.255.0.0 (/16)";
    case "C":
      return "255.255.255.0 (/24)";
    case "D":
    case "E":
      return "N/A (无默认子网掩码)";
    default:
      return "N/A";
  }
};

// 获取特殊标识
const getSpecialFlags = (ip: string): string[] => {
  const flags: string[] = [];
  const parts = ip.split(".").map(Number);
  
  // 回环地址 127.0.0.0/8
  if (parts[0] === 127) {
    flags.push("回环地址 (Loopback)");
  }
  
  // 多播地址 224.0.0.0/4
  if (parts[0] >= 224 && parts[0] <= 239) {
    flags.push("多播地址 (Multicast)");
  }
  
  // 保留地址 240.0.0.0/4
  if (parts[0] >= 240 && parts[0] <= 255) {
    flags.push("保留地址 (Reserved for Future Use)");
  }
  
  // 0.0.0.0 (当前网络)
  if (ip === "0.0.0.0") {
    flags.push("当前网络 (This host on this network) - RFC 6890");
  }
  
  // 255.255.255.255 (受限广播)
  if (ip === "255.255.255.255") {
    flags.push("受限广播 (Limited Broadcast) - RFC 6890");
  }
  
  // 169.254.0.0/16 (链路本地)
  if (parts[0] === 169 && parts[1] === 254) {
    flags.push("链路本地地址 (Link-Local) - RFC 3927");
  }
  
  // 100.64.0.0/10 (运营商级 NAT)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    flags.push("运营商级 NAT (Shared Address Space) - RFC 6598");
  }
  
  // 192.0.0.0/24 (IETF Protocol)
  if (parts[0] === 192 && parts[1] === 0) {
    flags.push("IETF 协议保留 (IETF Protocol Assignments) - RFC 6890");
  }
  
  // 192.0.2.0/24 (TEST-NET-1)
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) {
    flags.push("文档示例网络 (TEST-NET-1) - RFC 5737");
  }
  
  // 198.51.100.0/24 (TEST-NET-2)
  if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) {
    flags.push("文档示例网络 (TEST-NET-2) - RFC 5737");
  }
  
  // 203.0.113.0/24 (TEST-NET-3)
  if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) {
    flags.push("文档示例网络 (TEST-NET-3) - RFC 5737");
  }
  
  return flags;
};

// 查询 IP 信息
const lookupIP = () => {
  errorMsg.value = "";
  result.value = null;
  
  const ip = ipInput.value.trim();
  
  if (!ip) {
    errorMsg.value = "请输入 IPv4 地址";
    return;
  }
  
  if (!isValidIPv4(ip)) {
    errorMsg.value = "请输入合法的 IPv4 地址 (如 192.168.1.1)";
    return;
  }
  
  const ipClass = getIPClass(ip);
  const isPrivate = isPrivateIP(ip);
  const subnetMask = getDefaultSubnetMask(ipClass.class);
  const specialFlags = getSpecialFlags(ip);
  
  result.value = {
    ip,
    isPrivate,
    class: ipClass.class,
    classDescription: ipClass.description,
    subnetMask,
    specialFlags,
    networkPrefix: ip.split(".").slice(0, ipClass.class === "A" ? 1 : ipClass.class === "B" ? 2 : 3).join(".")
  };
};

// 实时校验输入
const handleInput = () => {
  if (ipInput.value && !isValidIPv4(ipInput.value.trim())) {
    errorMsg.value = "格式不正确，请输入合法的 IPv4 地址";
  } else {
    errorMsg.value = "";
  }
};
</script>

<template>
  <div class="ip-lookup-container">
    <div class="input-section">
      <h2>🔍 IP 信息查询</h2>
      <p class="description">输入 IPv4 地址，查询其本地网络属性（纯前端计算，无需外部 API）</p>
      
      <div class="input-group">
        <input
          v-model="ipInput"
          type="text"
          placeholder="请输入 IPv4 地址，如 192.168.1.1"
          @input="handleInput"
          @keyup.enter="lookupIP"
          class="ip-input"
        />
        <button @click="lookupIP" class="lookup-btn">查询</button>
      </div>
      
      <p v-if="errorMsg" class="error-message">{{ errorMsg }}</p>
    </div>
    
    <div v-if="result" class="result-section">
      <div class="result-card">
        <div class="result-header">
          <span class="ip-display">{{ result.ip }}</span>
          <span :class="['badge', result.isPrivate ? 'private' : 'public']">
            {{ result.isPrivate ? '🏠 私有 IP' : '🌐 公有 IP' }}
          </span>
        </div>
        
        <div class="result-grid">
          <div class="result-item">
            <span class="label">IP 类别</span>
            <span class="value">{{ result.classDescription }}</span>
          </div>
          
          <div class="result-item">
            <span class="label">默认子网掩码</span>
            <span class="value">{{ result.subnetMask }}</span>
          </div>
          
          <div class="result-item">
            <span class="label">网络前缀</span>
            <span class="value">{{ result.networkPrefix }}.x{{ result.class === 'A' ? '.x.x' : result.class === 'B' ? '.x' : '' }}</span>
          </div>
        </div>
        
        <div v-if="result.specialFlags.length > 0" class="special-flags">
          <span class="label">特殊标识</span>
          <div class="flags-list">
            <span v-for="flag in result.specialFlags" :key="flag" class="flag-tag">
              {{ flag }}
            </span>
          </div>
        </div>
      </div>
      
      <div class="info-note">
        <h4>📋 RFC 1918 私有地址范围</h4>
        <ul>
          <li>10.0.0.0 - 10.255.255.255 (/8)</li>
          <li>172.16.0.0 - 172.31.255.255 (/12)</li>
          <li>192.168.0.0 - 192.168.255.255 (/16)</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ip-lookup-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.input-section {
  text-align: center;
}

.input-section h2 {
  margin-bottom: 8px;
  color: var(--vp-c-brand-1);
}

.description {
  color: var(--vp-c-text-2);
  margin-bottom: 20px;
  font-size: 14px;
}

.input-group {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.ip-input {
  flex: 1;
  padding: 12px 16px;
  font-size: 16px;
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  transition: border-color 0.2s;
}

.ip-input:focus {
  border-color: var(--vp-c-brand-2);
}

.lookup-btn {
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 600;
  background: var(--vp-c-brand-1);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.lookup-btn:hover {
  background: var(--vp-c-brand-2);
}

.error-message {
  color: #e53935;
  font-size: 14px;
  margin-top: 8px;
}

.result-section {
  margin-top: 24px;
}

.result-card {
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vp-c-bg-alt);
}

.ip-display {
  font-size: 20px;
  font-weight: 700;
  font-family: monospace;
  color: var(--vp-c-text-1);
}

.badge {
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
}

.badge.private {
  background: rgba(76, 175, 80, 0.15);
  color: #388e3c;
}

.badge.public {
  background: rgba(33, 150, 243, 0.15);
  color: #1976d2;
}

.result-grid {
  display: grid;
  gap: 12px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
}

.result-item .label {
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.result-item .value {
  color: var(--vp-c-text-1);
  font-weight: 500;
  font-size: 14px;
}

.special-flags {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-bg-alt);
}

.special-flags .label {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 14px;
  margin-bottom: 8px;
}

.flags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.flag-tag {
  display: inline-block;
  padding: 4px 10px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-radius: 4px;
  font-size: 12px;
}

.info-note {
  margin-top: 20px;
  padding: 16px;
  background: var(--vp-c-bg-alt);
  border-radius: 8px;
  font-size: 13px;
}

.info-note h4 {
  margin: 0 0 8px 0;
  color: var(--vp-c-text-1);
  font-size: 14px;
}

.info-note ul {
  margin: 0;
  padding-left: 20px;
  color: var(--vp-c-text-2);
}

.info-note li {
  margin: 4px 0;
}
</style>
