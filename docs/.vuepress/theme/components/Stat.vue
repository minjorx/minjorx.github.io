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
const showMenu = ref(false);

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

// 加载所有交易数据
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
        text: "最近30天支出趋势",
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
        data: ["支出"],
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
        text: "最近12个月支出汇总",
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
        data: ["支出"],
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

// 下拉菜单功能
const toggleMenu = () => {
  showMenu.value = !showMenu.value;
};

const closeMenu = () => {
  showMenu.value = false;
};

// 模拟云同步功能
const syncFromCloud = () => {
  console.log("从云同步数据");
  // 实际项目中这里会调用API进行数据同步
  alert("已从云端同步数据");
  closeMenu();
};

// 模拟本地上传功能
const uploadFromLocal = () => {
  console.log("从本地上传数据");
  // 实际项目中这里会打开文件选择器上传数据
  alert("已从本地上传数据");
  closeMenu();
};

// 模拟下载到本地功能
const downloadToLocal = () => {
  console.log("下载数据到本地");
  // 实际项目中这里会导出数据为JSON或其他格式
  alert("已下载数据到本地");
  closeMenu();
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

  // 监听点击事件来关闭菜单
  document.addEventListener("click", (event) => {
    const menuButton = document.querySelector(".menu-button");
    const menuDropdown = document.querySelector(".menu-dropdown");

    if (
      menuButton &&
      !menuButton.contains(event.target as Node) &&
      menuDropdown &&
      !menuDropdown.contains(event.target as Node)
    ) {
      closeMenu();
    }
  });
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
</script>

<template>
  <div class="stat-page">
    <header class="page-header">
      <h1>统计</h1>
      <!-- 下拉菜单 -->
      <div class="menu-container">
        <button class="menu-button" @click.stop="toggleMenu">
          <span class="menu-icon">⋮</span>
        </button>

        <div v-if="showMenu" class="menu-dropdown">
          <ul class="menu-list">
            <li @click="syncFromCloud" class="menu-item">
              <span class="menu-item-icon">☁️</span>
              <span>从云同步</span>
            </li>
            <li @click="uploadFromLocal" class="menu-item">
              <span class="menu-item-icon">📤</span>
              <span>从本地上传</span>
            </li>
            <li @click="downloadToLocal" class="menu-item">
              <span class="menu-item-icon">📥</span>
              <span>下载到本地</span>
            </li>
          </ul>
        </div>
      </div>
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

.menu-container {
  position: relative;
  display: inline-block;
}

.menu-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  transition: background-color 0.2s;
  font-size: 1.5rem;
}

.menu-button:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.menu-icon {
  display: block;
}

.menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background-color: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 200px;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.menu-item:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.dark .menu-item:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.menu-item-icon {
  margin-right: 12px;
  font-size: 1.2rem;
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
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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
  }

  .metrics-section {
    flex-direction: column;
    gap: 15px;
  }

  .metric-card {
    min-width: 100%;
  }
}
</style>
