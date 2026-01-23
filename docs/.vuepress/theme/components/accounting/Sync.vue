<script setup lang="ts">
import { ref } from "vue";
import GiteeGistAPI from "../../../util/GiteeGistAPI"; // 保持原导入路径

// 同步状态
const isSyncing = ref(false);

// 从 URL 参数获取 code 并存储到 sessionStorage（逻辑复用）
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has("code")) {
  sessionStorage.setItem("gitee_code", urlParams.get("code")!);
  window.history.replaceState({}, document.title, window.location.pathname);
}

// 获取 Gitee Access Token（完全复用原逻辑）
const getAccessToken = async (): Promise<string> => {
  const storedCode = sessionStorage.getItem("gitee_code");
  const tokenInfo = JSON.parse(
    localStorage.getItem("gitee_token_info") || "{}"
  );

  if (
    tokenInfo.access_token &&
    tokenInfo.expires_at &&
    new Date().getTime() < tokenInfo.expires_at
  ) {
    return tokenInfo.access_token;
  }

  if (storedCode) {
    const CLIENT_ID =
      "0831108350aa6097852f13bff492c7ac4516b7deee8f64e81c13afbda4e469c6";
    const CLIENT_SECRET =
      "c021f23c8082e8de028b425f37e65afbb13226d0b082ea5fdeb50999768565a9";
    const REDIRECT_URI = encodeURIComponent(
      window.location.origin + window.location.pathname
    );

    const response = await fetch(`https://gitee.com/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=authorization_code&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&code=${storedCode}&redirect_uri=${REDIRECT_URI}`,
    });

    if (!response.ok) {
      throw new Error("Failed to get access token");
    }

    const tokenData = await response.json();
    const expiresAt = new Date().getTime() + 24 * 60 * 60 * 1000;
    localStorage.setItem(
      "gitee_token_info",
      JSON.stringify({
        access_token: tokenData.access_token,
        expires_at: expiresAt,
      })
    );

    return tokenData.access_token;
  }

  const CLIENT_ID =
    "0831108350aa6097852f13bff492c7ac4516b7deee8f64e81c13afbda4e469c6";
  const REDIRECT_URI = encodeURIComponent(
    window.location.origin + window.location.pathname
  );
  window.location.href = `https://gitee.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code`;
  return "";
};

// 初始化 IndexedDB（完全复用）
const initDB = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("AccountingDB", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("transactions")) {
        const store = db.createObjectStore("transactions", { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
  });
};

// 从 IndexedDB 加载所有交易数据
const loadAllTransactions = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["transactions"], "readonly");
    const store = transaction.objectStore("transactions");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// 将交易数据保存到 IndexedDB（去重合并）
const saveTransactionsToDB = async (newTransactions: any[]): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["transactions"], "readwrite");
    const store = transaction.objectStore("transactions");

    const getAllRequest = store.getAllKeys();
    getAllRequest.onsuccess = () => {
      const existingIds = new Set(getAllRequest.result as string[]);
      newTransactions.forEach((tx) => {
        if (existingIds.has(tx.id)) {
          store.put(tx);
        } else {
          store.add(tx);
        }
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
    getAllRequest.onerror = () => reject(getAllRequest.error);
  });
};

// 初始化 Gist - 查找或创建 "minjor-accounting" 代码片段
const initializeGist = async (): Promise<string> => {
  const token = await getAccessToken();
  if (!token) return "";

  const api = new GiteeGistAPI(token);

  const cachedGistInfo = localStorage.getItem("gitee_gist_info");
  if (cachedGistInfo) {
    const gistInfo = JSON.parse(cachedGistInfo);
    try {
      await api.getGist(gistInfo.id);
      return gistInfo.id;
    } catch (error) {
      console.log("缓存的 gist 已失效，重新查找或创建");
    }
  }

  let gistId = "";
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const gists = await api.getGists(page, 100);
      if (!gists || gists.length === 0) {
        hasMore = false;
        break;
      }
      for (const gist of gists) {
        if (
          gist.description === "minjor-accounting" &&
          gist.files &&
          gist.files["data.json"]
        ) {
          gistId = gist.id;
          hasMore = false;
          break;
        }
      }
      if (gists.length < 100) hasMore = false;
      else page++;
    }
  } catch (error) {
    console.error("获取 gist 列表失败:", error);
    throw error;
  }

  if (!gistId) {
    const newGist = await api.createGist("minjor-accounting", {
      "data.json": { content: "[]" },
    });
    gistId = newGist.id;
  }

  localStorage.setItem(
    "gitee_gist_info",
    JSON.stringify({ id: gistId, createdAt: new Date().toISOString() })
  );
  return gistId;
};

// 上传数据到 Gitee
const uploadToGitee = async () => {
  isSyncing.value = true;
  try {
    const gistId = await initializeGist();
    if (!gistId) {
      alert("获取 Gitee 代码片段失败");
      return;
    }

    const token = await getAccessToken();
    if (!token) return;

    const api = new GiteeGistAPI(token);
    const localTxs = await loadAllTransactions();
    await api.updateGist(gistId, {
      files: {
        "data.json": {
          content: JSON.stringify(localTxs),
        },
      },
    });

    alert("数据已成功上传到 Gitee");
  } catch (error) {
    console.error("上传到 Gitee 失败:", error);
    alert("上传失败: " + (error as Error).message);
  } finally {
    isSyncing.value = false;
  }
};

// 从 Gitee 下载数据（去重合并）
const downloadFromGitee = async () => {
  isSyncing.value = true;
  try {
    const gistId = await initializeGist();
    if (!gistId) {
      alert("获取 Gitee 代码片段失败");
      return;
    }

    const token = await getAccessToken();
    if (!token) return;

    const api = new GiteeGistAPI(token);
    const gist = await api.getGist(gistId);
    const jsonData = gist.files["data.json"].content;
    const remoteTransactions = JSON.parse(jsonData);
    await saveTransactionsToDB(remoteTransactions);

    alert("数据已成功从 Gitee 下载并合并");
  } catch (error) {
    console.error("从 Gitee 下载失败:", error);
    alert("下载失败: " + (error as Error).message);
  } finally {
    isSyncing.value = false;
  }
};

// 从本地 JSON 文件导入数据（去重合并）
const uploadFromLocal = async () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  const filePromise = new Promise<File | null>((resolve) => {
    input.onchange = (event) => {
      const target = event.target as HTMLInputElement;
      resolve(target.files?.[0] || null);
    };
  });

  input.click();

  const file = await filePromise;

  // 用户取消了选择
  if (!file) {
    return; // 直接退出，不显示 loading，也不报错
  }

  // 用户选择了文件，现在才开始"同步"
  isSyncing.value = true;
  try {
    const content = await file.text();
    const importedTransactions = JSON.parse(content);
    await saveTransactionsToDB(importedTransactions);

    alert(`成功导入 ${importedTransactions.length} 条记录`);
  } catch (error) {
    console.error("从本地导入失败:", error);
    alert("导入失败: " + (error as Error).message);
  } finally {
    isSyncing.value = false;
  }
};

// 导出数据到本地 JSON 文件
const downloadToLocal = async () => {
  isSyncing.value = true;
  try {
    const transactions = await loadAllTransactions();
    const jsonContent = JSON.stringify(transactions, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `accounting-data-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    alert(`数据已导出，共 ${transactions.length} 条记录`);
  } catch (error) {
    console.error("导出到本地失败:", error);
    alert("导出失败: " + (error as Error).message);
  } finally {
    isSyncing.value = false;
  }
};

// 返回上一页
const goBack = () => {
  // window.history.back();
  // 固定跳转到 ./accounting
  window.location.href = "./accounting";
};
</script>

<template>
  <div class="sync-page app">
    <header class="page-header">
      <h1>数据同步</h1>
      <button class="back-button" @click="goBack">返回</button>
    </header>

    <div class="sync-actions">
      <button @click="uploadToGitee" :disabled="isSyncing" class="sync-btn">
        上传到 Gitee
      </button>
      <button @click="downloadFromGitee" :disabled="isSyncing" class="sync-btn">
        从 Gitee 下载
      </button>
      <button @click="uploadFromLocal" :disabled="isSyncing" class="sync-btn">
        从本地 JSON 导入
      </button>
      <button @click="downloadToLocal" :disabled="isSyncing" class="sync-btn">
        导出到本地 JSON
      </button>
      <div class="action-description">
        <p>
          <strong>上传到 Gitee：</strong>将本地数据库中的所有数据上传到 Gitee
          代码片段。
        </p>
        <p>
          <strong>数据同步逻辑：</strong>完全替换 Gitee
          上的数据，不会保留原有的数据。
        </p>
        <p>
          <strong>限制：</strong>需要有效的 Gitee 授权，仅支持上传 JSON
          格式数据。
        </p>
      </div>

      <div class="action-description">
        <p>
          <strong>从 Gitee 下载：</strong>从 Gitee
          代码片段下载数据并合并到本地数据库。
        </p>
        <p>
          <strong>数据同步逻辑：</strong>智能合并，相同 ID
          的记录会被更新，新记录会被添加，不会重复。
        </p>
        <p>
          <strong>限制：</strong>需要有效的 Gitee 授权，仅支持 JSON 格式数据。
        </p>
      </div>

      <div class="action-description">
        <p>
          <strong>从本地 JSON 导入：</strong>选择本地 JSON
          文件导入数据到本地数据库。
        </p>
        <p>
          <strong>数据同步逻辑：</strong>智能合并，相同 ID
          的记录会被更新，新记录会被添加，不会重复。
        </p>
        <p>
          <strong>限制：</strong>仅支持 JSON 格式文件，需要符合数据结构要求。
        </p>
      </div>

      <div class="action-description">
        <p>
          <strong>导出到本地 JSON：</strong>将本地数据库中的所有数据导出为 JSON
          文件。
        </p>
        <p>
          <strong>数据同步逻辑：</strong
          >完整导出本地所有数据，不会影响原有数据。
        </p>
        <p>
          <strong>限制：</strong>导出的文件格式为 JSON，可用于备份或迁移数据。
        </p>
      </div>
    </div>

    <div v-if="isSyncing" class="loading">正在同步数据...</div>
  </div>
</template>

<style scoped>
.sync-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 4px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
    Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  min-height: 100vh;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: center;
  margin-bottom: 30px;
}

.page-header h1 {
  margin-left: 20px;
  margin: 0;
  font-size: 1.8rem;
}

.back-button {
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.5);
  font-size: 1rem;
  transition: background-color 0.2s;
}

.back-button:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.sync-actions {
  display: grid;
  gap: 16px;
  max-width: 600px;
  margin: 0 auto;
}

.sync-btn {
  padding: 14px 20px;
  font-size: 1rem;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: background-color 0.2s;
  text-align: center;
}

.sync-btn:hover:not(:disabled) {
  background-color: rgba(0, 0, 0, 0.05);
}

.sync-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-description {
  padding: 12px;
  background-color: #f9f9f9;
  border-radius: 8px;
  border-left: 4px solid #409eff;
  margin-bottom: 20px;
}

.action-description p {
  margin: 8px 0;
  line-height: 1.5;
}

.action-description strong {
  color: #333;
}

.loading {
  text-align: center;
  padding: 40px;
  font-size: 1.1rem;
}

/* 响应式设计 */
@media (max-width: 720px) {
  .sync-page {
    padding: 8px;
  }

  .page-header {
    padding: 0 10px;
  }

  .sync-actions {
    max-width: 100%;
  }

  .action-description {
    padding: 10px;
    font-size: 0.9rem;
  }
}
.app {
  max-width: 720px;
  margin: 0 auto;
  padding: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
    Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  /* background-color: #f5f5f5; */
  min-height: 100vh;
  box-sizing: border-box;
  width: 100%;
}

@media (max-width: 720px) {
  .app {
    width: 100%;
    max-width: 100%;
    padding: 8px;
    margin: 0;
  }
}
@media (max-width: 320px) {
  .app {
    width: 100%;
    max-width: 100%;
    padding: 0px;
    margin: 0;
  }
}
</style>
