<script setup lang="ts">
import { ref, onMounted, computed, nextTick, onUnmounted } from "vue";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  CalendarComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// 注册 ECharts 所需组件
echarts.use([
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  CalendarComponent,
  CanvasRenderer,
]);

// 数据状态
const transactions = ref<any[]>([]);
const loading = ref(true);
const selectedTags = ref<string[]>([]); // 改为数组支持多选

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
const currentYearIncome = computed(() => {
  const currentYear = new Date().getFullYear();
  return transactions.value
    .filter(
      (tx) =>
        tx.type === "income" &&
        new Date(tx.timestamp).getFullYear() === currentYear
    )
    .reduce((sum, tx) => sum + tx.amount, 0);
});

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

// 计算周平均收入（最近 4 周）
const weeklyAvgIncome = computed(() => {
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const weeklyData: Record<string, { income: number; expense: number }> = {};

  // 初始化每周数据 - 找到最近的周一作为起始点
  const today = new Date();
  const currentDayOfWeek = today.getDay(); // 0=周日，1-6=周一到周六
  const daysToLastMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1; // 距离上个周一的天数

  // 从上个周一开始，往前推 4 周
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - daysToLastMonday - 21); // 回到 3 周前的周一

  for (let i = 0; i < 4; i++) {
    const weekDate = new Date(weekStart);
    weekDate.setDate(weekStart.getDate() + i * 7);
    const weekKey = `${weekDate.getFullYear()}-${String(
      weekDate.getMonth() + 1
    ).padStart(2, "0")}-${String(weekDate.getDate()).padStart(2, "0")}`;
    weeklyData[weekKey] = { income: 0, expense: 0 };
  }

  // 填充实际数据
  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp);
    if (txDate >= fourWeeksAgo) {
      // 计算该日期所在周的周一
      const dayOfWeek = txDate.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStartForTx = new Date(txDate);
      weekStartForTx.setDate(txDate.getDate() - daysToMonday);
      const weekKey = `${weekStartForTx.getFullYear()}-${String(
        weekStartForTx.getMonth() + 1
      ).padStart(2, "0")}-${String(weekStartForTx.getDate()).padStart(2, "0")}`;

      if (weeklyData[weekKey]) {
        if (tx.type === "income") {
          weeklyData[weekKey].income += tx.amount;
        } else {
          weeklyData[weekKey].expense += tx.amount;
        }
      }
    }
  });

  // 计算平均值
  const weeks = Object.values(weeklyData);
  console.log(weeks);
  return weeks.reduce((sum, w) => sum + w.income, 0) / 4;
});

const weeklyAvgExpense = computed(() => {
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const weeklyData: Record<string, { income: number; expense: number }> = {};

  // 初始化每周数据 - 找到最近的周一作为起始点
  const today = new Date();
  const currentDayOfWeek = today.getDay(); // 0=周日，1-6=周一到周六
  const daysToLastMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1; // 距离上个周一的天数

  // 从上个周一开始，往前推 4 周
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - daysToLastMonday - 21); // 回到 3 周前的周一

  for (let i = 0; i < 4; i++) {
    const weekDate = new Date(weekStart);
    weekDate.setDate(weekStart.getDate() + i * 7);
    const weekKey = `${weekDate.getFullYear()}-${String(
      weekDate.getMonth() + 1
    ).padStart(2, "0")}-${String(weekDate.getDate()).padStart(2, "0")}`;
    weeklyData[weekKey] = { income: 0, expense: 0 };
  }

  // 填充实际数据
  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp);
    if (txDate >= fourWeeksAgo) {
      // 计算该日期所在周的周一
      const dayOfWeek = txDate.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStartForTx = new Date(txDate);
      weekStartForTx.setDate(txDate.getDate() - daysToMonday);
      const weekKey = `${weekStartForTx.getFullYear()}-${String(
        weekStartForTx.getMonth() + 1
      ).padStart(2, "0")}-${String(weekStartForTx.getDate()).padStart(2, "0")}`;

      if (weeklyData[weekKey]) {
        if (tx.type === "income") {
          weeklyData[weekKey].income += tx.amount;
        } else {
          weeklyData[weekKey].expense += tx.amount;
        }
      }
    }
  });

  // 计算平均值
  const weeks = Object.values(weeklyData);
  return weeks.reduce((sum, w) => sum + w.expense, 0) / 4;
});

// 计算月平均收入（最近 12 个月，从第一个有数据的月份开始）
const monthlyAvgIncome = computed(() => {
  if (transactions.value.length === 0) return 0;

  // 找到最早的交易记录日期
  const earliestTxDate = transactions.value.reduce((earliest, tx) => {
    const txDate = new Date(tx.timestamp);
    return txDate < earliest ? txDate : earliest;
  }, new Date());

  // 计算从最早交易月份到现在的月份数（最多 12 个月）
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - earliestTxDate.getFullYear()) * 12 +
    (now.getMonth() - earliestTxDate.getMonth());

  const actualMonths = Math.min(monthsDiff + 1, 12); // +1 是因为包含当月

  // 从当前月份往前推 actualMonths 个月
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - (actualMonths - 1));
  startDate.setDate(1); // 设置为当月 1 号

  const monthlyData: Record<string, { income: number; expense: number }> = {};

  // 初始化每月数据
  const currentDate = new Date(startDate);
  while (currentDate <= now) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;
    monthlyData[monthKey] = { income: 0, expense: 0 };
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  // 填充实际数据
  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp);
    const txYear = txDate.getFullYear();
    const txMonth = String(txDate.getMonth() + 1).padStart(2, "0");
    const txMonthStr = `${txYear}-${txMonth}`;

    if (monthlyData[txMonthStr]) {
      if (tx.type === "income") {
        monthlyData[txMonthStr].income += tx.amount;
      } else {
        monthlyData[txMonthStr].expense += tx.amount;
      }
    }
  });

  // 计算平均值
  const months = Object.values(monthlyData);
  return months.reduce((sum, m) => sum + m.income, 0) / actualMonths;
});

const monthlyAvgExpense = computed(() => {
  if (transactions.value.length === 0) return 0;

  // 找到最早的交易记录日期
  const earliestTxDate = transactions.value.reduce((earliest, tx) => {
    const txDate = new Date(tx.timestamp);
    return txDate < earliest ? txDate : earliest;
  }, new Date());

  // 计算从最早交易月份到现在的月份数（最多 12 个月）
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - earliestTxDate.getFullYear()) * 12 +
    (now.getMonth() - earliestTxDate.getMonth());

  const actualMonths = Math.min(monthsDiff + 1, 12); // +1 是因为包含当月

  // 从当前月份往前推 actualMonths 个月
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - (actualMonths - 1));
  startDate.setDate(1); // 设置为当月 1 号

  const monthlyData: Record<string, { income: number; expense: number }> = {};

  // 初始化每月数据
  const currentDate = new Date(startDate);
  while (currentDate <= now) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;
    monthlyData[monthKey] = { income: 0, expense: 0 };
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  // 填充实际数据
  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp);
    const txYear = txDate.getFullYear();
    const txMonth = String(txDate.getMonth() + 1).padStart(2, "0");
    const txMonthStr = `${txYear}-${txMonth}`;

    if (monthlyData[txMonthStr]) {
      if (tx.type === "income") {
        monthlyData[txMonthStr].income += tx.amount;
      } else {
        monthlyData[txMonthStr].expense += tx.amount;
      }
    }
  });

  // 计算平均值
  const months = Object.values(monthlyData);
  return months.reduce((sum, m) => sum + m.expense, 0) / actualMonths;
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

// 获取所有唯一标签
const allTags = computed(() => {
  const tagSet = new Set<string>();
  transactions.value.forEach((tx) => {
    if (tx.tags && Array.isArray(tx.tags)) {
      tx.tags.forEach((tag: string) => tagSet.add(tag));
    }
  });
  return ["全部", ...Array.from(tagSet).sort()];
});

// 按标签筛选的月度数据（支持多选）
const taggedMonthlyStats = computed(() => {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);

  const monthsInRange: string[] = [];
  const currentDate = new Date(twelveMonthsAgo);
  while (currentDate <= new Date()) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    monthsInRange.push(`${year}-${month}`);
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  const monthlyData: any = {};
  monthsInRange.forEach((month) => {
    monthlyData[month] = { income: 0, expense: 0 };
  });

  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp);
    const txYear = txDate.getFullYear();
    const txMonth = String(txDate.getMonth() + 1).padStart(2, "0");
    const txMonthStr = `${txYear}-${txMonth}`;

    // 标签筛选逻辑（支持多选）
    if (selectedTags.value.length > 0 && !selectedTags.value.includes("全部")) {
      if (
        !tx.tags ||
        !tx.tags.some((tag: string) => selectedTags.value.includes(tag))
      ) {
        return;
      }
    }

    if (new Date(txMonthStr) >= twelveMonthsAgo) {
      if (tx.type === "income") {
        monthlyData[txMonthStr].income += tx.amount;
      } else if (tx.type === "expense") {
        monthlyData[txMonthStr].expense += tx.amount;
      }
    }
  });

  return Object.entries(monthlyData)
    .map(([month, data]: [string, any]) => ({
      month,
      income: data.income,
      expense: data.expense,
      net: data.income - data.expense,
    }))
    .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
});

// 日历热力图数据（支持指定月份）
const currentCalendarMonth = ref(new Date()); // 当前展示的月份

const calendarHeatmapData = computed(() => {
  const year = currentCalendarMonth.value.getFullYear();
  const month = currentCalendarMonth.value.getMonth();

  // 获取当月第一天
  const startDate = new Date(year, month, 1);
  // 获取当月最后一天
  const endDate = new Date(year, month + 1, 0);

  const heatmapData: any[] = [];
  const dailyNet: Record<string, number> = {};

  // 计算每日净支出（收入 - 支出）
  transactions.value.forEach((tx) => {
    const txDate = new Date(tx.timestamp);
    if (txDate >= startDate && txDate <= endDate) {
      // 修复时区问题：使用本地日期格式而不是 ISO 字符串
      const dateKey = `${txDate.getFullYear()}-${String(
        txDate.getMonth() + 1
      ).padStart(2, "0")}-${String(txDate.getDate()).padStart(2, "0")}`;
      if (!dailyNet[dateKey]) {
        dailyNet[dateKey] = 0;
      }
      if (tx.type === "income") {
        dailyNet[dateKey] += tx.amount; // 收入增加（正数）
      } else {
        dailyNet[dateKey] -= tx.amount; // 支出增加（负数）
      }
    }
  });

  // 转换为热力图格式
  Object.entries(dailyNet).forEach(([date, net]) => {
    heatmapData.push([date, net]);
  });

  return heatmapData.sort((a, b) => a[0].localeCompare(b[0]));
});

// 获取日历展示数据（按周分组）
const calendarWeekData = computed(() => {
  const year = currentCalendarMonth.value.getFullYear();
  const month = currentCalendarMonth.value.getMonth();

  // 获取当月第一天和最后一天
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // 找到第一个周一（如果 1 号不是周一，则从上一个月的日期开始）
  const startDay = new Date(firstDay);
  // 修正：getDay() 返回 0 表示周日，需要转换为上周一
  const dayOfWeek = firstDay.getDay();
  const daysToPrevMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startDay.setDate(firstDay.getDate() - daysToPrevMonday);

  const weeks: any[] = [];
  let currentWeek: any[] = [];

  // 遍历所有日期
  const currentDate = new Date(startDay);
  while (currentDate <= lastDay || currentWeek.length > 0) {
    // 修复时区问题：使用本地日期格式而不是 ISO 字符串
    const dateStr = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1
    ).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
    const dayOfMonth = currentDate.getDate();
    const dayOfWeek = currentDate.getDay();

    // 查找当天的数据（使用本地日期字符串匹配）
    const dayData = calendarHeatmapData.value.find((d) => d[0] === dateStr);
    const netValue = dayData ? dayData[1] : 0;

    // 将 JavaScript 的星期 (0=周日，1-6=周一到周六) 转换为热力图的列索引 (0=周一，6=周日)
    const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    currentWeek.push({
      date: dateStr,
      day: dayOfMonth,
      value: netValue,
      isCurrentMonth: currentDate.getMonth() === month,
      dayIndex: dayIndex, // 添加 dayIndex 用于热力图定位
    });

    // 周日为一周的结束
    if (dayOfWeek === 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    // 如果已经过了当月最后一天且当前周为空，则退出
    if (currentDate > lastDay && currentWeek.length === 0) {
      break;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // 处理最后一周（如果还有剩余天数）
  if (currentWeek.length > 0) {
    // 补齐最后一周到 7 天
    const lastWeek = currentWeek;
    const remainingDays = 7 - lastWeek.length;
    for (let i = 1; i <= remainingDays; i++) {
      const nextDate = new Date(lastWeek[lastWeek.length - 1].date);
      nextDate.setDate(nextDate.getDate() + i);
      const dateStr = `${nextDate.getFullYear()}-${String(
        nextDate.getMonth() + 1
      ).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`;
      lastWeek.push({
        date: dateStr,
        day: nextDate.getDate(),
        value: 0,
        isCurrentMonth: nextDate.getMonth() === month,
        dayIndex: (lastWeek.length + i - 1) % 7,
      });
    }
    weeks.push(lastWeek);
  }

  return weeks;
});

// 图表实例
let monthlyTaggedChartInstance: echarts.ECharts | null = null;
let calendarChartInstance: echarts.ECharts | null = null;

// 渲染按标签筛选的月度图表
const renderMonthlyTaggedChart = () => {
  if (!monthlyTaggedChartInstance) {
    const chartDom = document.getElementById("monthly-tagged-chart");
    if (chartDom) {
      monthlyTaggedChartInstance = echarts.init(chartDom, undefined, {
        renderer: "canvas",
      });
    }
  }

  if (monthlyTaggedChartInstance) {
    const option = {
      title: {
        text: `月度收支${
          selectedTags.value.length > 0 && !selectedTags.value.includes("全部")
            ? `(${selectedTags.value.join(", ")})`
            : ""
        }`,
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
            const value = param.value as number;
            result +=
              param.marker +
              (param.seriesName === "收入" ? "+" : "-") +
              value.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              }) +
              "<br/>";
          });
          // 添加净值
          const monthData = taggedMonthlyStats.value.find(
            (m) => m.month === params[0].name
          );
          if (monthData) {
            result += `<br/>${monthData.net.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}`;
          }
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
        outerBounds: 0,
      },
      xAxis: [
        {
          type: "category",
          data: taggedMonthlyStats.value.map((item) => item.month),
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
            formatter: "{value}",
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
          data: taggedMonthlyStats.value.map((item) => item.income),
        },
        {
          name: "支出",
          type: "bar",
          color: "#f06292",
          emphasis: {
            focus: "series",
          },
          data: taggedMonthlyStats.value.map((item) => item.expense),
        },
      ],
    };

    monthlyTaggedChartInstance.setOption(option);
  }
};

// 渲染日历热力图（使用自定义布局）
const renderCalendarChart = () => {
  if (!calendarChartInstance) {
    const chartDom = document.getElementById("calendar-chart");
    if (chartDom) {
      calendarChartInstance = echarts.init(chartDom, undefined, {
        renderer: "canvas",
      });
    }
  }

  if (calendarChartInstance) {
    const year = currentCalendarMonth.value.getFullYear();
    const month = currentCalendarMonth.value.getMonth() + 1;
    const weeks = calendarWeekData.value;

    const option = {
      tooltip: {
        formatter: function (params: any) {
          if (!params.data || !params.data.date) {
            return "";
          }
          const date = params.data.date;
          const value = params.data.value[2]; // 获取数组中的第三个元素（净支出值）
          const count = Math.abs(value).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          });
          if (value === 0) {
            return `${date}<br/>`;
          }
          return `${date}<br/>` + `${value >= 0 ? "+" : "-"}${count}`;
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max: 1,
        inRange: {
          color: "#ffffff",
        },
      },
      grid: {
        left: "5%",
        right: "5%",
        top: "15%",
        bottom: "15%",
      },
      xAxis: [
        {
          type: "category",
          data: ["一", "二", "三", "四", "五", "六", "日"],
          position: "top",
          axisLabel: {
            fontSize: 12,
            fontWeight: "bold",
          },
          axisTick: {
            show: false,
          },
          axisLine: {
            show: false,
          },
        },
      ],
      yAxis: [
        {
          type: "category",
          data: [],
          axisLabel: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          axisLine: {
            show: false,
          },
        },
      ],
      series: [
        {
          name: "每日收支",
          type: "heatmap",
          data: (() => {
            const heatmapData: any[] = [];
            weeks.forEach((week, weekIndex) => {
              week.forEach((day: any) => {
                heatmapData.push({
                  value: [
                    day.dayIndex,
                    weeks.length - 1 - weekIndex,
                    day.value,
                  ], // 反转周次索引，使第一周显示在顶部
                  date: day.date,
                  day: day.day,
                  isCurrentMonth: day.isCurrentMonth,
                });
              });
            });
            return heatmapData;
          })(),
          label: {
            show: true,
            formatter: function (params: any) {
              const day = params.data.day;
              const value = params.data.value[2];
              if (value === 0) {
                return `{day|${day}}`;
              }
              return `{day|${day}}\n{value|${value >= 0 ? "+" : "-"}${Math.abs(
                value
              ).toFixed(2)}}`;
            },
            rich: {
              day: {
                fontSize: 11,
                fontWeight: "bold",
                align: "center",
                lineHeight: 14,
              },
              value: {
                fontSize: 10,
                align: "center",
                lineHeight: 12,
              },
            },
          },
          itemStyle: {
            borderColor: "#ccc",
            borderWidth: 1,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
        },
      ],
    };

    calendarChartInstance.setOption(option);
  }
};

// 重新调整图表大小
const resizeCharts = () => {
  if (monthlyTaggedChartInstance) {
    monthlyTaggedChartInstance.resize();
  }
  if (calendarChartInstance) {
    calendarChartInstance.resize();
  }
};

onMounted(async () => {
  await loadAllTransactions();
  loading.value = false;

  // 等待 DOM 更新后再渲染图表
  await nextTick();

  // 初始化当前月份状态并渲染图表
  currentCalendarMonth.value = new Date();
  renderMonthlyTaggedChart();
  renderCalendarChart();

  // 监听窗口大小变化
  window.addEventListener("resize", resizeCharts);
});

// 组件卸载时清理事件监听器
onUnmounted(() => {
  if (monthlyTaggedChartInstance) {
    monthlyTaggedChartInstance.dispose();
  }
  if (calendarChartInstance) {
    calendarChartInstance.dispose();
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

function formatDate(timestamp: number) {
  // 假设 item.timestamp 是一个有效的时间戳（毫秒）
  const date = new Date(timestamp);

  // 如果 timestamp 可能不是毫秒，请根据情况转换
  // 例如，如果是秒，则 new Date(timestamp * 1000);

  const year = String(date.getFullYear()).slice(-2); // 获取年份后两位
  const month = String(date.getMonth() + 1).padStart(2, "0"); // getMonth() 从 0 开始，需 +1
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// 切换标签筛选（支持多选）
const toggleTagFilter = (tag: string) => {
  const index = selectedTags.value.indexOf(tag);

  if (index > -1) {
    // 已选中则取消选中
    selectedTags.value.splice(index, 1);
  } else {
    // 未选中则添加
    if (tag === "全部") {
      // 点击"全部"时，清空其他选择
      selectedTags.value = ["全部"];
    } else {
      // 点击其他标签时，移除"全部"
      if (selectedTags.value.includes("全部")) {
        selectedTags.value = selectedTags.value.filter((t) => t !== "全部");
      }
      selectedTags.value.push(tag);
    }
  }

  setTimeout(() => {
    renderMonthlyTaggedChart();
  }, 0);
};

// 切换到上一个月
const prevMonth = () => {
  const newDate = new Date(currentCalendarMonth.value);
  newDate.setMonth(newDate.getMonth() - 1);
  currentCalendarMonth.value = newDate;
  setTimeout(() => {
    renderCalendarChart();
  }, 0);
};

// 切换到下一个月
const nextMonth = () => {
  const newDate = new Date(currentCalendarMonth.value);
  newDate.setMonth(newDate.getMonth() + 1);
  currentCalendarMonth.value = newDate;
  setTimeout(() => {
    renderCalendarChart();
  }, 0);
};

// 切换到当前月
const goToCurrentMonth = () => {
  currentCalendarMonth.value = new Date();
  setTimeout(() => {
    renderCalendarChart();
  }, 0);
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
      <div class="metric-card">
        <h3>今年收支</h3>
        <p class="metric-value positive">+{{ currentYearIncome.toFixed(2) }}</p>
        <p class="metric-value negative">
          -{{ currentYearExpense.toFixed(2) }}
        </p>
      </div>

      <div class="metric-card">
        <h3>周平均收支</h3>
        <p class="metric-value positive">+{{ weeklyAvgIncome.toFixed(2) }}</p>
        <p class="metric-value negative">-{{ weeklyAvgExpense.toFixed(2) }}</p>
      </div>

      <div class="metric-card">
        <h3>月平均收支</h3>
        <p class="metric-value positive">+{{ monthlyAvgIncome.toFixed(2) }}</p>
        <p class="metric-value negative">-{{ monthlyAvgExpense.toFixed(2) }}</p>
      </div>
    </section>

    <!-- 日历热力图（移到标签筛选之前） -->
    <section class="calendar-stats-section">
      <div class="calendar-header">
        <button class="month-nav-btn" @click="prevMonth">‹ 上月</button>
        <span class="current-month-display">
          {{ currentCalendarMonth.getFullYear() }}年{{
            String(currentCalendarMonth.getMonth() + 1).padStart(2, "0")
          }}月
        </span>
        <button class="month-nav-btn" @click="nextMonth">下月 ›</button>
        <button class="today-btn" @click="goToCurrentMonth">今天</button>
      </div>
      <div id="calendar-chart" style="height: 400px; width: 100%"></div>
    </section>

    <!-- 标签筛选器 -->
    <section class="filter-section">
      <div class="filter-label">按标签筛选：</div>
      <div class="tag-filters">
        <button
          v-for="tag in allTags"
          :key="tag"
          :class="[
            'tag-filter-btn',
            selectedTags.includes(tag) ? 'active' : '',
          ]"
          @click="toggleTagFilter(tag)"
        >
          {{ tag }}
        </button>
      </div>
    </section>

    <!-- 按标签筛选的月度统计 -->
    <section class="monthly-tagged-stats-section">
      <div id="monthly-tagged-chart" style="height: 400px; width: 100%"></div>
    </section>

    <!-- 分页表格 -->
    <section class="table-section">
      <h2>交易记录</h2>
      <table class="transaction-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>类型</th>
            <th>金额</th>
            <!-- 新增金额列 -->
            <th>标签</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in currentData" :key="item.id">
            <td>{{ formatDate(item.timestamp) }}</td>
            <td>
              <span :class="['type-tag', item.type]">{{
                item.type === "income" ? "收入" : "支出"
              }}</span>
            </td>
            <td>{{ item.amount.toFixed(2) }}</td>
            <!-- 显示金额 -->
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
  background-color: rgba(0, 0, 0, 0.1);
}

.metrics-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 30px;
}

.metric-card {
  padding: 15px;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  text-align: center;
  background: white;
}

.metric-card h3 {
  margin: 0 0 10px 0;
  font-size: 0.9rem;
  color: #666;
}

.metric-value {
  font-size: 1.3rem;
  font-weight: bold;
  margin: 5px 0;
  color: #2e7d32a1;
}

.metric-value.positive {
  color: #2e7d32a1;
}

.metric-value.negative {
  color: #c6282880;
}

.filter-section {
  margin-bottom: 30px;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.filter-label {
  font-size: 0.95rem;
  font-weight: bold;
  margin-bottom: 10px;
  color: #555;
}

.tag-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag-filter-btn {
  padding: 6px 12px;
  border: 1px solid #dddddd7e;
  background-color: rgba(255, 255, 255, 0.466);
  cursor: pointer;
  border-radius: 20px;
  font-size: 0.85rem;
  transition: all 0.2s;
  color: #666;
}

.tag-filter-btn:hover {
  background-color: #f5f5f57e;
  border-color: #4caf50;
}

.tag-filter-btn.active {
  background-color: #4caf50;
  color: white;
  border-color: #4caf50;
  box-shadow: 0 2px 6px rgba(76, 175, 80, 0.3);
}

.calendar-stats-section,
.monthly-tagged-stats-section {
  margin-bottom: 40px;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.calendar-header {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  margin-bottom: 15px;
}

.month-nav-btn {
  padding: 6px 12px;
  background-color: rgba(76, 175, 80, 0.1);
  border: 1px solid #4caf50;
  color: #4caf50;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.month-nav-btn:hover {
  background-color: #4caf50;
  color: white;
}

.today-btn {
  padding: 6px 12px;
  background-color: rgba(76, 175, 80, 0.1);
  border: 1px solid #4caf50;
  color: #4caf50;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.today-btn:hover {
  background-color: #4caf50;
  color: white;
}

.current-month-display {
  font-size: 1.1rem;
  font-weight: bold;
  color: #333;
  min-width: 150px;
  text-align: center;
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.623);
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
  background-color: #f5f5f5a9;
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
  color: #2e7d32a1;
}

.type-tag.expense {
  background-color: #ffebee81;
  color: #c6282880;
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
  border: 1px solid #dddddd7e;
  background-color: rgba(255, 255, 255, 0.466);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background-color: #f5f5f57e;
}

.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination-info {
  font-size: 0.9rem;
  color: #66666671;
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
    flex-direction: row;
    gap: 15px;
  }

  .metrics-section {
    flex-direction: column;
    gap: 12px;
  }

  .metric-card {
    min-width: 100%;
    padding: 12px 10px;
  }

  .metric-card h3 {
    font-size: 0.85rem;
  }

  .metric-value {
    font-size: 1.2rem;
  }

  .filter-section {
    padding: 12px;
  }

  .filter-label {
    font-size: 0.9rem;
  }

  .tag-filters {
    gap: 6px;
  }

  .tag-filter-btn {
    padding: 5px 10px;
    font-size: 0.8rem;
  }

  .calendar-stats-section,
  .monthly-tagged-stats-section {
    padding: 10px;
  }

  .calendar-header {
    flex-wrap: wrap;
    gap: 10px;
  }

  .month-nav-btn {
    padding: 5px 10px;
    font-size: 0.85rem;
  }

  .today-btn {
    padding: 5px 10px;
    font-size: 0.8rem;
  }

  .current-month-display {
    font-size: 1rem;
    min-width: 120px;
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
