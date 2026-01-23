<script setup lang="ts">
import { ref, onMounted, computed, nextTick, onUnmounted } from "vue";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// 注册ECharts所需组件
echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

// 数据状态
const transactions = ref<any[]>([]);
const loading = ref(true);

// 分页状态
const currentPage = ref(1);
const pageSize = ref(10);
const total = computed(() => transactions.value.length);

// 计算当前页的数据
const currentData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return transactions.value.slice(start, end);
});

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

// 从 IndexedDB 加载所有交易数据
const loadAllTransactions = async () => {
  try {
    const db = await initDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["transactions"], "readonly");
      const store = transaction.objectStore("transactions");
      const index = store.index("timestamp");

      const request = index.getAll();

      request.onsuccess = () => {
        const result = request.result;

        // 对结果进行排序，最新的在前面
        transactions.value = result.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        resolve();
      };

      request.onerror = () => {
        console.error("获取交易数据失败:", request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("加载交易数据失败:", error);
  }
};

// 计算指标
const currentYearExpense = computed(() => {
  const currentYear = new Date().getFullYear();
  return transactions.value
    .filter(
      (tx) =>
        tx.type === "expense" &&
        new Date(tx.timestamp).getFullYear() === currentYear
    )
    .reduce((sum, tx) => sum + tx.amount, 0);
});

// 计算最近一个月的每日数据
const dailyStats = computed(() => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // 创建日期范围内的所有日期
  const datesInRange: string[] = [];
  for (
    let d = new Date(thirtyDaysAgo);
    d <= new Date();
    d.setDate(d.getDate() + 1)
  ) {
    datesInRange.push(new Date(d).toISOString().split("T")[0]);
  }

  // 初始化每日统计数据
  const dailyData: any = {};
  datesInRange.forEach((date) => {
    dailyData[date] = { income: 0, expense: 0 };
  });

  // 填充实际数据
  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp).toISOString().split("T")[0];
    if (txDate >= thirtyDaysAgo.toISOString().split("T")[0]) {
      if (tx.type === "income") {
        dailyData[txDate].income += tx.amount;
      } else if (tx.type === "expense") {
        dailyData[txDate].expense += tx.amount;
      }
    }
  });

  // 转换为数组并按日期排序
  return Object.entries(dailyData)
    .map(([date, data]: [string, any]) => ({
      date,
      income: data.income,
      expense: data.expense,
      total: data.income + data.expense,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
});

// 计算最近一年的每月数据
const monthlyStats = computed(() => {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);

  // 创建月份范围
  const monthsInRange: string[] = [];
  const currentDate = new Date(twelveMonthsAgo);
  while (currentDate <= new Date()) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    monthsInRange.push(`${year}-${month}`);
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  // 初始化每月统计数据
  const monthlyData: any = {};
  monthsInRange.forEach((month) => {
    monthlyData[month] = { income: 0, expense: 0 };
  });

  // 填充实际数据
  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp);
    const txYear = txDate.getFullYear();
    const txMonth = String(txDate.getMonth() + 1).padStart(2, "0");
    const txMonthStr = `${txYear}-${txMonth}`;

    if (new Date(txMonthStr) >= twelveMonthsAgo) {
      if (tx.type === "income") {
        monthlyData[txMonthStr].income += tx.amount;
      } else if (tx.type === "expense") {
        monthlyData[txMonthStr].expense += tx.amount;
      }
    }
  });

  // 转换为数组并按月份排序
  return Object.entries(monthlyData)
    .map(([month, data]: [string, any]) => ({
      month,
      income: data.income,
      expense: data.expense,
      total: data.income + data.expense,
    }))
    .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
});

// 图表实例
let dailyChartInstance: echarts.ECharts | null = null;
let monthlyChartInstance: echarts.ECharts | null = null;

// 渲染每日图表
const renderDailyChart = () => {
  if (!dailyChartInstance) {
    const chartDom = document.getElementById("daily-chart");
    if (chartDom) {
      dailyChartInstance = echarts.init(chartDom, undefined, {
        renderer: "canvas",
      });
    }
  }

  if (dailyChartInstance) {
    const option = {
      title: {
        text: "最近30天收支趋势",
        left: "center",
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        formatter: function (params: any[]) {
          let result = params[0].name + "<br/>";
          params.forEach((param) => {
            result +=
              param.marker +
              param.seriesName +
              ": ¥" +
              param.value.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              }) +
              "<br/>";
          });
          return result;
        },
      },
      legend: {
        data: ["收入", "支出"],
        top: "10%",
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        top: "20%",
        containLabel: true,
      },
      xAxis: [
        {
          type: "category",
          data: dailyStats.value.map((item) => item.date),
          axisTick: {
            alignWithLabel: true,
          },
          axisLabel: {
            rotate: 45,
            fontSize: 10,
          },
        },
      ],
      yAxis: [
        {
          type: "value",
          name: "金额 (¥)",
          position: "left",
          axisLabel: {
            formatter: "¥{value}",
          },
        },
      ],
      series: [
        {
          name: "收入",
          type: "bar",
          color: "#4caf50",
          emphasis: {
            focus: "series",
          },
          data: dailyStats.value.map((item) => item.income),
        },
        {
          name: "支出",
          type: "bar",
          color: "#f06292",
          emphasis: {
            focus: "series",
          },
          data: dailyStats.value.map((item) => item.expense),
        },
      ],
    };

    dailyChartInstance.setOption(option);
  }
};

// 渲染每月图表
const renderMonthlyChart = () => {
  if (!monthlyChartInstance) {
    const chartDom = document.getElementById("monthly-chart");
    if (chartDom) {
      monthlyChartInstance = echarts.init(chartDom, undefined, {
        renderer: "canvas",
      });
    }
  }

  if (monthlyChartInstance) {
    const option = {
      title: {
        text: "最近12个月收支汇总",
        left: "center",
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        formatter: function (params: any[]) {
          let result = params[0].name + "<br/>";
          params.forEach((param) => {
            result +=
              param.marker +
              param.seriesName +
              ": ¥" +
              param.value.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              }) +
              "<br/>";
          });
          return result;
        },
      },
      legend: {
        data: ["收入", "支出"],
        top: "10%",
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        top: "20%",
        containLabel: true,
      },
      xAxis: [
        {
          type: "category",
          data: monthlyStats.value.map((item) => item.month),
          axisTick: {
            alignWithLabel: true,
          },
          axisLabel: {
            fontSize: 10,
          },
        },
      ],
      yAxis: [
        {
          type: "value",
          name: "金额 (¥)",
          position: "left",
          axisLabel: {
            formatter: "¥{value}",
          },
        },
      ],
      series: [
        {
          name: "收入",
          type: "bar",
          color: "#4caf50",
          emphasis: {
            focus: "series",
          },
          data: monthlyStats.value.map((item) => item.income),
        },
        {
          name: "支出",
          type: "bar",
          color: "#f06292",
          emphasis: {
            focus: "series",
          },
          data: monthlyStats.value.map((item) => item.expense),
        },
      ],
    };

    monthlyChartInstance.setOption(option);
  }
};

// 重新调整图表大小
const resizeCharts = () => {
  if (dailyChartInstance) {
    dailyChartInstance.resize();
  }
  if (monthlyChartInstance) {
    monthlyChartInstance.resize();
  }
};

onMounted(async () => {
  await loadAllTransactions();
  loading.value = false;

  // 等待DOM更新后再渲染图表
  await nextTick();

  renderDailyChart();
  renderMonthlyChart();

  // 监听窗口大小变化
  window.addEventListener("resize", resizeCharts);
});

// 组件卸载时清理事件监听器
onUnmounted(() => {
  if (dailyChartInstance) {
    dailyChartInstance.dispose();
  }
  if (monthlyChartInstance) {
    monthlyChartInstance.dispose();
  }
  window.removeEventListener("resize", resizeCharts);
});

// 返回上一页
const goBack = () => {
  window.location.href = "./accounting";
};

// 切换页码
const changePage = (page: number) => {
  currentPage.value = page;
};

// 格式化标签为字符串
const formatTags = (tags: string[]) => {
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return "-";
  }
  return tags.join(", ");
};
</script>

<template>
  <div class="stat-page app">
    <header class="page-header">
      <h1>统计</h1>
      <button class="sync-button" @click="goBack">返回</button>
    </header>

    <!-- 指标卡片 -->
    <section class="metrics-section">
      <div class="metric-card expense">
        <h3>今年支出</h3>
        <p class="metric-value">¥{{ currentYearExpense.toFixed(2) }}</p>
      </div>
    </section>

    <!-- 最近一月统计 -->
    <section class="daily-stats-section">
      <div id="daily-chart" style="height: 400px; width: 100%"></div>
    </section>

    <!-- 最近一年统计 -->
    <section class="monthly-stats-section">
      <div id="monthly-chart" style="height: 400px; width: 100%"></div>
    </section>

    <!-- 分页表格 -->
    <section class="table-section">
      <h2>交易记录</h2>
      <table class="transaction-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>类型</th>
            <th>标签</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in currentData" :key="item.id">
            <td>{{ new Date(item.timestamp).toLocaleString() }}</td>
            <td>
              <span :class="['type-tag', item.type]">{{
                item.type === "income" ? "收入" : "支出"
              }}</span>
            </td>
            <td>{{ formatTags(item.tags) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 分页控件 -->
      <div class="pagination">
        <button
          @click="changePage(currentPage - 1)"
          :disabled="currentPage === 1"
          class="pagination-btn"
        >
          上一页
        </button>

        <span class="pagination-info">
          第 {{ currentPage }} 页，共 {{ Math.ceil(total / pageSize) }} 页
        </span>

        <button
          @click="changePage(currentPage + 1)"
          :disabled="currentPage >= Math.ceil(total / pageSize)"
          class="pagination-btn"
        >
          下一页
        </button>
      </div>
    </section>

    <!-- 加载提示 -->
    <div v-if="loading" class="loading">正在加载统计数据...</div>
  </div>
</template>

<style>
.vp-home-box {
  padding: 0px !important;
}
</style>
<style scoped>
.stat-page {
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
  margin: 0;
  font-size: 1.8rem;
}

.sync-button {
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.5);
  font-size: 1rem;
  transition: background-color 0.2s;
}

.sync-button:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.metrics-section {
  display: flex;
  gap: 20px;
  margin-bottom: 30px;
  flex-wrap: wrap;
}

.metric-card {
  flex: 1;
  min-width: 200px;
  padding: 20px;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  text-align: center;
}

.metric-card h3 {
  margin: 0 0 10px 0;
  font-size: 1rem;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: bold;
  margin: 0;
}

.metric-value.negative {
  color: #ad1457;
}

.daily-stats-section,
.monthly-stats-section {
  margin-bottom: 40px;
  padding: 0px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.table-section {
  margin-top: 20px;
}

.table-section h2 {
  margin-bottom: 15px;
  font-size: 1.4rem;
}

.transaction-table {
  width: 100%;
  border-collapse: collapse;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  overflow: hidden;
}

.transaction-table th,
.transaction-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

.transaction-table th {
  background-color: #f5f5f5;
  font-weight: bold;
}

.type-tag {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: bold;
}

.type-tag.income {
  background-color: #e8f5e9;
  color: #2e7d32;
}

.type-tag.expense {
  background-color: #ffebee;
  color: #c62828;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 20px;
  gap: 15px;
}

.pagination-btn {
  padding: 8px 15px;
  border: 1px solid #ddd;
  background-color: white;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background-color: #f5f5f5;
}

.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination-info {
  font-size: 0.9rem;
  color: #666;
}

.loading {
  text-align: center;
  padding: 40px;
  font-size: 1.1rem;
}

/* 响应式设计 */
@media (max-width: 720px) {
  .stat-page {
    padding: 8px;
  }

  .page-header {
    padding: 0 10px;
    flex-direction: column;
    gap: 15px;
  }

  .metrics-section {
    flex-direction: column;
    gap: 15px;
  }

  .metric-card {
    min-width: 100%;
  }

  .transaction-table {
    font-size: 0.85rem;
  }

  .transaction-table th,
  .transaction-table td {
    padding: 8px 6px;
  }

  .pagination {
    flex-direction: column;
    gap: 10px;
  }

  .pagination-btn {
    width: 100px;
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
