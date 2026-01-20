<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from "vue";

// 数据状态
const message = ref("记账本");
const amountInput = ref("");
const selectedType = ref<"expense" | "income" | null>(null);
const selectedTags = ref<string[]>([]); // 当前选择的标签
const tagsInput = ref("");
const recentTags = ref<string[]>([]);
const transactions = ref<any[]>([]);
const sessionLatestId = ref<number | null>(null); // 新增：记录本次会话最新一次新增数据的ID
const sessionState = ref<"未录入" | "录入中" | "已录入">("未录入"); // 本次会话状态

// 计算属性：判断交易项是否为本次会话最新记录
const isSessionLatest = (id: number) => {
  return sessionLatestId.value !== null && id === sessionLatestId.value;
};

// 计算属性：合并最近常用标签和上一次新增记录的标签
const combinedTags = computed(() => {
  let allTags = [...recentTags.value]; // 最近常用标签

  // 如果存在上一次新增记录，则获取其标签并添加到前面
  if (sessionLatestId.value) {
    const latestTx = transactions.value.find(
      (tx) => tx.id === sessionLatestId.value
    );
    if (latestTx && latestTx.tags && Array.isArray(latestTx.tags)) {
      // 合并标签集合，去重
      const combinedSet = new Set([...latestTx.tags, ...recentTags.value]);
      return Array.from(combinedSet);
    }
  }

  return allTags;
});

// 数字键盘输入
const handleNumberInput = (num: string) => {
  if (num === ".") {
    if (!amountInput.value.includes(".")) {
      amountInput.value += num;
    }
  } else {
    amountInput.value += num;
  }

  // 如果正在输入数字，说明处于录入中状态
  if (amountInput.value && !selectedType.value) {
    sessionState.value = "录入中";
  }
};

// 处理小数点
const handleDecimal = () => {
  if (!amountInput.value.includes(".")) {
    amountInput.value += ".";
  }

  // 如果正在输入数字，说明处于录入中状态
  if (amountInput.value && !selectedType.value) {
    sessionState.value = "录入中";
  }
};

// 输入清除
const handleClear = () => {
  amountInput.value = "";
  selectedType.value = null;
  selectedTags.value = []; // 清除标签选择
  sessionState.value = "未录入"; // 重置会话状态
};

// 选择收支类型
const selectType = async (type: "expense" | "income") => {
  if (!amountInput.value || parseFloat(amountInput.value) <= 0) return;

  selectedType.value = type;

  // 自动滚动到底部标签区域
  await nextTick();
  const tagSection = document.getElementById("tag-section");
  if (tagSection) {
    tagSection.scrollIntoView({ behavior: "smooth" });
  }

  // 保存交易到 IndexedDB
  saveTransaction(parseFloat(amountInput.value), type);
};

// 删除交易记录
const deleteTransaction = async (id: number) => {
  try {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["transactions"], "readwrite");
      const store = transaction.objectStore("transactions");

      const request = store.delete(id);

      request.onsuccess = () => {
        // 从本地状态中移除
        const index = transactions.value.findIndex((tx) => tx.id === id);
        if (index > -1) {
          transactions.value.splice(index, 1);
        }
        // 如果删除的是本次会话最新记录，则清空sessionLatestId
        if (sessionLatestId.value === id) {
          sessionLatestId.value = null;
          sessionState.value = "未录入"; // 删除后回到未录入状态
        }
        resolve();
      };

      request.onerror = () => {
        console.error("删除交易失败:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("删除交易失败:", error);
  }
};

// 保存交易到 IndexedDB
const saveTransaction = async (amount: number, type: "expense" | "income") => {
  try {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["transactions"], "readwrite");
      const store = transaction.objectStore("transactions");

      const newTransaction = {
        id: Date.now(),
        amount,
        type,
        tags: [...selectedTags.value], // 使用当前选择的标签
        timestamp: new Date().toISOString(),
      };

      const request = store.add(newTransaction);

      request.onsuccess = () => {
        // 添加到本地状态
        transactions.value.unshift(newTransaction);

        // 设置本次会话最新记录ID
        sessionLatestId.value = newTransaction.id;

        // 限制交易记录数量
        if (transactions.value.length > 100) {
          transactions.value = transactions.value.slice(0, 100);
        }

        // 更新最近使用的标签
        updateRecentTags(selectedTags.value);

        // 清除输入
        amountInput.value = "";
        selectedType.value = null;

        // 更新会话状态为已录入
        sessionState.value = "已录入";

        resolve();
      };

      request.onerror = () => {
        console.error("保存交易失败:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("保存交易失败:", error);
  }
};

// 更新交易标签
const updateTransactionTags = async (id: number, newTags: string[]) => {
  try {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["transactions"], "readwrite");
      const store = transaction.objectStore("transactions");

      const request = store.get(id);

      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          data.tags = newTags;

          const updateRequest = store.put(data);
          updateRequest.onsuccess = () => {
            // 更新本地状态
            const index = transactions.value.findIndex((tx) => tx.id === id);
            if (index > -1) {
              transactions.value[index].tags = newTags;
            }

            // 更新最近使用的标签
            updateRecentTags(newTags);

            resolve();
          };

          updateRequest.onerror = () => {
            console.error("更新标签失败:", updateRequest.error);
            reject(updateRequest.error);
          };
        } else {
          reject(new Error("未找到交易记录"));
        }
      };

      request.onerror = () => {
        console.error("获取交易记录失败:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("更新标签失败:", error);
  }
};

// 初始化 IndexedDB
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

// 加载历史数据
const loadHistory = async () => {
  try {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["transactions"], "readonly");
      const store = transaction.objectStore("transactions");
      const index = store.index("timestamp");

      // 获取最近7天的数据
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();
      const request = index.getAll(IDBKeyRange.lowerBound(sevenDaysAgo));

      request.onsuccess = () => {
        const result = request.result;
        console.log("获取到的交易数据:", result);

        // 对结果进行排序，最新的在前面
        transactions.value = result.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // 获取最近100次中的Top10标签
        const allTags: Record<string, number> = {};
        result.forEach((tx) => {
          if (tx.tags && Array.isArray(tx.tags)) {
            tx.tags.forEach((tag: string) => {
              allTags[tag] = (allTags[tag] || 0) + 1;
            });
          }
        });

        // 获取出现次数最多的10个标签
        recentTags.value = Object.entries(allTags)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map((item) => item[0]);

        resolve();
      };

      request.onerror = () => {
        console.error("获取交易数据失败:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("加载历史数据失败:", error);
  }
};

// 更新最近使用的标签
const updateRecentTags = (newTags: string[]) => {
  newTags.forEach((tag) => {
    const index = recentTags.value.indexOf(tag);
    if (index !== -1) {
      recentTags.value.splice(index, 1); // 移除已存在的
    }
    recentTags.value.unshift(tag); // 添加到开头

    // 限制最多10个标签
    if (recentTags.value.length > 10) {
      recentTags.value.pop();
    }
  });
};

// 切换标签选择
const toggleTag = (tag: string) => {
  if (sessionState.value === "录入中") {
    // 录入中：选择的标签是要保存的记录的标签
    const index = selectedTags.value.indexOf(tag);
    if (index > -1) {
      selectedTags.value.splice(index, 1);
    } else {
      selectedTags.value.push(tag);
    }
  } else if (sessionState.value === "已录入" && sessionLatestId.value) {
    // 已录入：点击的标签用于更新上次录入数据的标签
    const latestTx = transactions.value.find(
      (tx) => tx.id === sessionLatestId.value
    );
    if (latestTx) {
      const updatedTags = [...latestTx.tags];
      const index = updatedTags.indexOf(tag);

      if (index > -1) {
        // 如果标签已在记录中，则移除
        updatedTags.splice(index, 1);
      } else {
        // 如果标签不在记录中，则添加
        updatedTags.push(tag);
      }

      // 更新交易记录的标签
      updateTransactionTags(sessionLatestId.value, updatedTags);
    }
  } else if (sessionState.value === "未录入") {
    // 未录入：可以选择标签，但不影响任何交易记录
    const index = selectedTags.value.indexOf(tag);
    if (index > -1) {
      selectedTags.value.splice(index, 1);
    } else {
      selectedTags.value.push(tag);
    }
  }
};

// 添加新标签
const addNewTag = () => {
  if (tagsInput.value.trim()) {
    if (!recentTags.value.includes(tagsInput.value.trim())) {
      recentTags.value.unshift(tagsInput.value.trim());
      if (recentTags.value.length > 10) {
        recentTags.value.pop();
      }
    }

    if (sessionState.value === "录入中") {
      // 录入中：添加的标签是要保存的记录的标签
      if (!selectedTags.value.includes(tagsInput.value.trim())) {
        selectedTags.value.push(tagsInput.value.trim());
      }
    } else if (sessionState.value === "已录入" && sessionLatestId.value) {
      // 已录入：添加的标签添加到上次录入的记录
      const latestTx = transactions.value.find(
        (tx) => tx.id === sessionLatestId.value
      );
      if (latestTx && !latestTx.tags.includes(tagsInput.value.trim())) {
        const updatedTags = [...latestTx.tags, tagsInput.value.trim()];
        updateTransactionTags(sessionLatestId.value, updatedTags);
      }
    }

    tagsInput.value = "";
  }
};

onMounted(async () => {
  // 初始化数据库并加载历史数据
  await initDB();
  await loadHistory();
});
</script>

<template>
  <div
    class="accounting-app"
    style="user-select: none; -webkit-user-select: none"
  >
    <!-- 显示当前输入金额 -->
    <div class="amount-display">
      <div class="type-indicator-container">
        <span v-if="selectedType === 'expense'" class="type-indicator expense"
          >支出</span
        >
        <span v-if="selectedType === 'income'" class="type-indicator income"
          >收入</span
        >
      </div>
      <div class="current-amount">{{ amountInput || "0" }}</div>
    </div>

    <!-- 数字键盘 -->
    <div class="number-pad">
      <div
        v-for="num in [
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
          '7',
          '8',
          '9',
          '.',
          '0',
          'C',
        ]"
        :key="num"
        class="number-btn"
        @click="
          num === 'C'
            ? handleClear()
            : num === '.'
            ? handleDecimal()
            : handleNumberInput(num)
        "
      >
        {{ num }}
      </div>
    </div>

    <!-- 收支类型按钮 -->
    <div class="type-buttons">
      <button
        class="type-btn expense-btn"
        @click="selectType('expense')"
        :disabled="!amountInput || parseFloat(amountInput) <= 0"
      >
        支出 (-)
      </button>
      <button
        class="type-btn income-btn"
        @click="selectType('income')"
        :disabled="!amountInput || parseFloat(amountInput) <= 0"
      >
        收入 (+)
      </button>
    </div>

    <!-- 标签选择区域 -->
    <div id="tag-section" class="tag-section">
      <h3>标签</h3>
      <div class="recent-tags">
        <span
          v-for="tag in combinedTags"
          :key="tag"
          class="tag-item"
          :class="{
            active:
              sessionState === '录入中'
                ? selectedTags.includes(tag)
                : sessionState === '已录入' && sessionLatestId
                ? transactions
                    .find((tx) => tx.id === sessionLatestId)
                    ?.tags?.includes(tag)
                : selectedTags.includes(tag),
          }"
          @click="toggleTag(tag)"
        >
          {{ tag }}
        </span>
      </div>

      <div class="add-tag-section">
        <input
          v-model="tagsInput"
          placeholder="输入新标签"
          @keyup.enter="addNewTag"
        />
        <button @click="addNewTag">+</button>
      </div>
    </div>

    <!-- 交易历史 -->
    <div class="transaction-history">
      <h3>最近交易</h3>
      <div
        v-for="tx in transactions.slice(0, 10)"
        :key="tx.id"
        class="transaction-item"
        :class="{ 'session-latest': isSessionLatest(tx.id) }"
      >
        <div class="transaction-content">
          <span :class="tx.type === 'expense' ? 'expense' : 'income'">
            {{ tx.type === "expense" ? "-" : "+" }}{{ tx.amount }}
          </span>
          <span class="tags-list">
            {{ tx.tags.join(", ") }}
          </span>
        </div>
        <div class="transaction-footer">
          <span class="time">{{
            new Date(tx.timestamp).toLocaleTimeString()
          }}</span>
          <button class="delete-btn" @click="deleteTransaction(tx.id)">
            ×
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.vp-home-box {
  padding: 0px !important;
}
</style>

<style scoped>
.accounting-app {
  max-width: 360px;
  margin: 0 auto;
  padding: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
    Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  background-color: #f5f5f5;
  min-height: 100vh;
  box-sizing: border-box;
  width: 100%;
}

.amount-display {
  text-align: center;
  margin-bottom: 15px;
  padding: 12px;
  background: #ffffff;
  border-radius: 10px;
  color: #333;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  border: 1px solid #e0e0e0;
}

.current-amount {
  font-size: 2rem;
  font-weight: bold;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Courier New", monospace;
  color: #333;
}

.type-indicator-container {
  margin-bottom: 6px;
}

.type-indicator {
  display: inline-block;
  font-size: 0.9rem;
  padding: 3px 8px;
  border-radius: 15px;
  font-weight: 600;
}

.type-indicator.expense {
  background-color: #ffebee;
  color: #d32f2f;
}

.type-indicator.income {
  background-color: #e8f5e9;
  color: #388e3c;
}

.number-pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 15px;
}

.number-btn {
  background-color: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.number-btn:active {
  background-color: #f5f5f5;
  transform: scale(0.95);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
}

.type-buttons {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
}

.type-btn {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.15s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.type-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.expense-btn {
  background-color: #f44336;
  color: white;
}

.income-btn {
  background-color: #4caf50;
  color: white;
}

.type-btn:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.type-btn:not(:disabled):active {
  transform: translateY(0);
}

.tag-section {
  margin-top: 18px;
  padding-top: 15px;
  border-top: 1px solid #e0e0e0;
  background-color: white;
  padding: 15px;
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
}

.tag-section h3 {
  margin-top: 0;
  margin-bottom: 10px;
  color: #333;
  font-size: 1.1rem;
}

.recent-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
  min-height: 36px;
}

.tag-item {
  padding: 4px 8px;
  background-color: #f5f5f5;
  border-radius: 15px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  border: 1px solid #e0e0e0;
  font-size: 0.8rem;
}

.tag-item:hover {
  background-color: #e0e0e0;
}

.tag-item.active {
  background-color: #2196f3;
  color: white;
  border-color: #1976d2;
}

.add-tag-section {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.add-tag-section input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 0.8rem;
  transition: border-color 0.15s ease;
}

.add-tag-section input:focus {
  outline: none;
  border-color: #2196f3;
  box-shadow: 0 0 0 1px rgba(33, 150, 243, 0.2);
}

.add-tag-section button {
  padding: 6px 10px;
  background-color: #2196f3;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.15s ease;
}

.add-tag-section button:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(33, 150, 243, 0.3);
}

.transaction-history {
  margin-top: 18px;
  background-color: white;
  padding: 15px;
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
}

.transaction-history h3 {
  margin-top: 0;
  margin-bottom: 10px;
  color: #333;
  font-size: 1.1rem;
}

.transaction-item {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
  transition: background-color 0.15s ease;
}

.transaction-item:last-child {
  border-bottom: none;
}

.transaction-item:hover {
  background-color: #fafafa;
}

.transaction-item.session-latest {
  background-color: #fffde7;
  border-radius: 6px;
  padding: 8px 10px;
  margin: -2px -10px;
  border-left: 3px solid #ffc107;
}

.transaction-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.transaction-item .expense {
  color: #d32f2f;
  font-weight: 600;
  font-size: 1rem;
}

.transaction-item .income {
  color: #388e3c;
  font-weight: 600;
  font-size: 1rem;
}

.tags-list {
  flex: 1;
  margin: 0 8px;
  color: #666;
  font-size: 0.8rem;
  word-break: break-all;
}

.transaction-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.7rem;
  color: #999;
}

.time {
  color: #999;
}

.delete-btn {
  background-color: #f44336;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.15s ease;
  font-weight: 600;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-btn:hover {
  background-color: #d32f2f;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(244, 67, 54, 0.3);
}

.delete-btn:active {
  transform: translateY(0);
}

/* 响应式设计 */
@media (max-width: 720px) {
  .accounting-app {
    width: 100%;
    max-width: 100%;
    /* padding: 8px; */
    margin: 0;
  }

  .number-pad {
    gap: 4px;
  }

  .number-btn {
    height: 44px;
    font-size: 1.1rem;
  }

  .current-amount {
    font-size: 1.8rem;
  }

  .type-buttons {
    gap: 6px;
  }

  .type-btn {
    padding: 10px;
    font-size: 0.9rem;
  }

  .tag-section,
  .transaction-history {
    padding: 12px;
  }

  .tag-section h3,
  .transaction-history h3 {
    font-size: 1rem;
  }

  .tag-item {
    font-size: 0.75rem;
    padding: 3px 6px;
  }

  .add-tag-section input {
    font-size: 0.75rem;
  }

  .add-tag-section button {
    font-size: 0.85rem;
    padding: 5px 8px;
  }

  .transaction-item .expense,
  .transaction-item .income {
    font-size: 0.9rem;
  }

  .tags-list {
    font-size: 0.75rem;
  }

  .transaction-footer {
    font-size: 0.65rem;
  }
}

@media (max-width: 320px) {
  .accounting-app {
    width: 100%;
    max-width: 100%;
    padding: 0px;
    margin: 0;
  }
  .number-btn {
    height: 40px;
    font-size: 1rem;
  }

  .current-amount {
    font-size: 1.6rem;
  }

  .type-btn {
    padding: 8px;
    font-size: 0.85rem;
  }
}
</style>
