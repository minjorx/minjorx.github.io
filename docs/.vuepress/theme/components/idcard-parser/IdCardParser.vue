<script setup lang="ts">
import { ref, computed } from "vue";

// ---------- 算法常量 ----------

// 18 位身份证加权因子
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
// 校验码映射表（sum % 11 → 校验位）
const CHECK_CODES = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];

// 前 2 位 → 省/直辖市/自治区
const PROVINCE_MAP: Record<string, string> = {
  "11": "北京市",
  "12": "天津市",
  "13": "河北省",
  "14": "山西省",
  "15": "内蒙古自治区",
  "21": "辽宁省",
  "22": "吉林省",
  "23": "黑龙江省",
  "31": "上海市",
  "32": "江苏省",
  "33": "浙江省",
  "34": "安徽省",
  "35": "福建省",
  "36": "江西省",
  "37": "山东省",
  "41": "河南省",
  "42": "湖北省",
  "43": "湖南省",
  "44": "广东省",
  "45": "广西壮族自治区",
  "46": "海南省",
  "50": "重庆市",
  "51": "四川省",
  "52": "贵州省",
  "53": "云南省",
  "54": "西藏自治区",
  "61": "陕西省",
  "62": "甘肃省",
  "63": "青海省",
  "64": "宁夏回族自治区",
  "65": "新疆维吾尔自治区",
  "71": "台湾省",
  "81": "香港特别行政区",
  "82": "澳门特别行政区",
};

// 前缀（市/区）→ 名称。长前缀优先匹配。
const CITY_MAP: Record<string, string> = {
  // 北京
  "1101": "市辖区",
  "1102": "县",
  // 天津
  "1201": "市辖区",
  "1202": "县",
  // 河北
  "1301": "石家庄市",
  "1302": "唐山市",
  "1303": "秦皇岛市",
  "1304": "邯郸市",
  "1305": "邢台市",
  "1306": "保定市",
  "1307": "张家口市",
  "1308": "承德市",
  "1309": "沧州市",
  "1310": "廊坊市",
  "1311": "衡水市",
  // 山西
  "1401": "太原市",
  "1402": "大同市",
  "1403": "阳泉市",
  "1404": "长治市",
  "1405": "晋城市",
  "1406": "朔州市",
  "1407": "晋中市",
  "1408": "运城市",
  "1409": "忻州市",
  "1410": "临汾市",
  "1411": "吕梁市",
  // 内蒙古
  "1501": "呼和浩特市",
  "1502": "包头市",
  "1503": "乌海市",
  "1504": "赤峰市",
  "1505": "通辽市",
  "1506": "鄂尔多斯市",
  "1507": "呼伦贝尔市",
  "1508": "巴彦淖尔市",
  "1509": "乌兰察布市",
  // 辽宁
  "2101": "沈阳市",
  "2102": "大连市",
  "2103": "鞍山市",
  "2104": "抚顺市",
  "2105": "本溪市",
  "2106": "丹东市",
  "2107": "锦州市",
  "2108": "营口市",
  "2109": "阜新市",
  "2110": "辽阳市",
  "2111": "盘锦市",
  "2112": "铁岭市",
  "2113": "朝阳市",
  "2114": "葫芦岛市",
  // 吉林
  "2201": "长春市",
  "2202": "吉林市",
  "2203": "四平市",
  "2204": "辽源市",
  "2205": "通化市",
  "2206": "白山市",
  "2207": "松原市",
  "2208": "白城市",
  // 黑龙江
  "2301": "哈尔滨市",
  "2302": "齐齐哈尔市",
  "2303": "鸡西市",
  "2304": "鹤岗市",
  "2305": "双鸭山市",
  "2306": "大庆市",
  "2307": "伊春市",
  "2308": "佳木斯市",
  "2309": "七台河市",
  "2310": "牡丹江市",
  "2311": "黑河市",
  "2312": "绥化市",
  // 上海
  "3101": "市辖区",
  "3102": "县",
  // 江苏
  "3201": "南京市",
  "3202": "无锡市",
  "3203": "徐州市",
  "3204": "常州市",
  "3205": "苏州市",
  "3206": "南通市",
  "3207": "连云港市",
  "3208": "淮安市",
  "3209": "盐城市",
  "3210": "扬州市",
  "3211": "镇江市",
  "3212": "泰州市",
  "3213": "宿迁市",
  // 浙江
  "3301": "杭州市",
  "3302": "宁波市",
  "3303": "温州市",
  "3304": "嘉兴市",
  "3305": "湖州市",
  "3306": "绍兴市",
  "3307": "金华市",
  "3308": "衢州市",
  "3309": "舟山市",
  "3310": "台州市",
  "3311": "丽水市",
  // 安徽
  "3401": "合肥市",
  "3402": "芜湖市",
  "3403": "蚌埠市",
  "3405": "马鞍山市",
  "3407": "铜陵市",
  "3408": "安庆市",
  "3410": "黄山市",
  "3411": "滁州市",
  "3412": "阜阳市",
  "3413": "宿州市",
  "3415": "六安市",
  "3416": "亳州市",
  "3417": "池州市",
  "3418": "宣城市",
  // 福建
  "3501": "福州市",
  "3502": "厦门市",
  "3503": "莆田市",
  "3504": "三明市",
  "3505": "泉州市",
  "3506": "漳州市",
  "3507": "南平市",
  "3508": "宁德市",
  // 江西
  "3601": "南昌市",
  "3602": "景德镇市",
  "3603": "萍乡市",
  "3604": "九江市",
  "3605": "新余市",
  "3606": "鹰潭市",
  "3607": "赣州市",
  "3608": "吉安市",
  "3609": "宜春市",
  "3610": "抚州市",
  "3611": "上饶市",
  // 山东
  "3701": "济南市",
  "3702": "青岛市",
  "3703": "淄博市",
  "3704": "枣庄市",
  "3705": "东营市",
  "3706": "烟台市",
  "3707": "潍坊市",
  "3708": "济宁市",
  "3709": "泰安市",
  "3710": "威海市",
  "3711": "日照市",
  "3713": "临沂市",
  "3714": "德州市",
  "3715": "聊城市",
  "3716": "滨州市",
  "3717": "菏泽市",
  // 河南
  "4101": "郑州市",
  "4102": "开封市",
  "4103": "洛阳市",
  "4104": "平顶山市",
  "4105": "安阳市",
  "4106": "鹤壁市",
  "4107": "新乡市",
  "4108": "焦作市",
  "4109": "濮阳市",
  "4110": "许昌市",
  "4111": "漯河市",
  "4112": "三门峡市",
  "4113": "南阳市",
  "4114": "商丘市",
  "4115": "信阳市",
  "4116": "周口市",
  "4117": "驻马店市",
  // 湖北
  "4201": "武汉市",
  "4202": "黄石市",
  "4203": "十堰市",
  "4205": "宜昌市",
  "4206": "襄阳市",
  "4207": "鄂州市",
  "4208": "荆门市",
  "4209": "孝感市",
  "4210": "荆州市",
  "4211": "黄冈市",
  "4212": "咸宁市",
  "4213": "随州市",
  // 湖南
  "4301": "长沙市",
  "4302": "株洲市",
  "4303": "湘潭市",
  "4304": "衡阳市",
  "4305": "邵阳市",
  "4306": "岳阳市",
  "4307": "常德市",
  "4308": "张家界市",
  "4309": "益阳市",
  "4310": "郴州市",
  "4311": "永州市",
  "4312": "怀化市",
  "4313": "娄底市",
  // 广东
  "4401": "广州市",
  "4402": "韶关市",
  "4403": "深圳市",
  "4404": "珠海市",
  "4405": "汕头市",
  "4406": "佛山市",
  "4407": "江门市",
  "4408": "湛江市",
  "4409": "茂名市",
  "4412": "肇庆市",
  "4413": "惠州市",
  "4414": "梅州市",
  "4415": "汕尾市",
  "4416": "河源市",
  "4417": "阳江市",
  "4418": "清远市",
  "4419": "东莞市",
  "4420": "中山市",
  // 广西
  "4501": "南宁市",
  "4502": "柳州市",
  "4503": "桂林市",
  "4504": "梧州市",
  "4505": "北海市",
  "4506": "防城港市",
  "4507": "钦州市",
  "4508": "贵港市",
  "4509": "玉林市",
  // 海南
  "4601": "海口市",
  "4602": "三亚市",
  // 重庆
  "5001": "市辖区",
  "5002": "县",
  // 四川
  "5101": "成都市",
  "5103": "自贡市",
  "5104": "攀枝花市",
  "5105": "泸州市",
  "5106": "德阳市",
  "5107": "绵阳市",
  "5108": "广元市",
  "5109": "遂宁市",
  "5110": "内江市",
  "5111": "乐山市",
  "5113": "南充市",
  "5114": "眉山市",
  "5115": "宜宾市",
  "5116": "广安市",
  "5117": "达州市",
  "5118": "雅安市",
  "5119": "巴中市",
  "5120": "资阳市",
  // 贵州
  "5201": "贵阳市",
  "5202": "六盘水市",
  "5203": "遵义市",
  "5204": "安顺市",
  "5205": "毕节市",
  "5206": "铜仁市",
  // 云南
  "5301": "昆明市",
  "5303": "曲靖市",
  "5304": "玉溪市",
  "5305": "保山市",
  "5306": "昭通市",
  "5307": "丽江市",
  "5308": "普洱市",
  "5309": "临沧市",
  // 西藏
  "5401": "拉萨市",
  "5402": "日喀则市",
  // 陕西
  "6101": "西安市",
  "6102": "铜川市",
  "6103": "宝鸡市",
  "6104": "咸阳市",
  "6105": "渭南市",
  "6106": "延安市",
  "6107": "汉中市",
  "6108": "榆林市",
  "6109": "安康市",
  "6110": "商洛市",
  // 甘肃
  "6201": "兰州市",
  "6202": "嘉峪关市",
  "6203": "金昌市",
  "6204": "白银市",
  "6205": "天水市",
  "6206": "武威市",
  "6207": "张掖市",
  "6208": "平凉市",
  "6209": "酒泉市",
  "6210": "庆阳市",
  "6211": "定西市",
  "6212": "陇南市",
  // 青海
  "6301": "西宁市",
  // 宁夏
  "6401": "银川市",
  "6402": "石嘴山市",
  "6403": "吴忠市",
  "6404": "固原市",
  "6405": "中卫市",
  // 新疆
  "6501": "乌鲁木齐市",
  "6502": "克拉玛依市",
  "6504": "吐鲁番市",
  "6505": "哈密市",
};

// ---------- 类型定义 ----------

interface ParsedIdCard {
  raw: string;             // 原始输入
  valid: boolean;          // 校验是否通过
  errMsg?: string;         // 错误原因
  region: string;          // 省/市
  province: string;
  city: string;
  birth: string;           // YYYY-MM-DD
  age: number;
  gender: string;          // 男 / 女
}

// ---------- 工具方法 ----------

function calcAge(birth: Date, now = new Date()): number {
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function lookupRegion(regionCode: string): { province: string; city: string } {
  const provinceCode = regionCode.slice(0, 2);
  const province = PROVINCE_MAP[provinceCode] ?? "未知地区";
  // 优先尝试 6/5/4 位前缀匹配
  let city = "—";
  for (const len of [6, 5, 4]) {
    const key = regionCode.slice(0, len);
    if (CITY_MAP[key]) {
      city = CITY_MAP[key];
      break;
    }
  }
  return { province, city };
}

// 18 位身份证校验
function validate18(id: string): { ok: boolean; reason?: string } {
  if (!/^\d{17}[\dXx]$/.test(id)) return { ok: false, reason: "格式：18 位，前 17 位为数字，最后一位为数字或 X" };

  // 出生日期校验
  const year = parseInt(id.slice(6, 10), 10);
  const month = parseInt(id.slice(10, 12), 10);
  const day = parseInt(id.slice(12, 14), 10);
  const birth = new Date(year, month - 1, day);
  if (
    birth.getFullYear() !== year ||
    birth.getMonth() + 1 !== month ||
    birth.getDate() !== day
  ) {
    return { ok: false, reason: "出生日期无效" };
  }
  if (year < 1900 || year > new Date().getFullYear()) {
    return { ok: false, reason: "出生年份超出合理范围" };
  }

  // 加权校验
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(id[i], 10) * WEIGHTS[i];
  const expected = CHECK_CODES[sum % 11];
  const actual = id[17].toUpperCase();
  if (expected !== actual) return { ok: false, reason: `校验码错误（应为 ${expected}）` };

  return { ok: true };
}

// 15 位旧版身份证校验（无校验位）
function validate15(id: string): { ok: boolean; reason?: string } {
  if (!/^\d{15}$/.test(id)) return { ok: false, reason: "格式：15 位数字" };
  const year = 1900 + parseInt(id.slice(6, 8), 10);
  const month = parseInt(id.slice(8, 10), 10);
  const day = parseInt(id.slice(10, 12), 10);
  const birth = new Date(year, month - 1, day);
  if (
    birth.getFullYear() !== year ||
    birth.getMonth() + 1 !== month ||
    birth.getDate() !== day
  ) {
    return { ok: false, reason: "出生日期无效" };
  }
  return { ok: true };
}

function parseOne(raw: string): ParsedIdCard {
  const id = raw.trim();
  if (!id) {
    return { raw, valid: false, errMsg: "空", region: "", province: "", city: "", birth: "", age: 0, gender: "" };
  }

  let regionCode = "";
  let birthStr = "";
  let year = 0, month = 0, day = 0;
  let genderDigit = 0;
  let validation: { ok: boolean; reason?: string };

  if (id.length === 18) {
    validation = validate18(id);
    regionCode = id.slice(0, 6);
    birthStr = `${id.slice(6, 10)}-${id.slice(10, 12)}-${id.slice(12, 14)}`;
    year = parseInt(id.slice(6, 10), 10);
    month = parseInt(id.slice(10, 12), 10);
    day = parseInt(id.slice(12, 14), 10);
    genderDigit = parseInt(id[16], 10);
  } else if (id.length === 15) {
    validation = validate15(id);
    regionCode = id.slice(0, 6);
    year = 1900 + parseInt(id.slice(6, 8), 10);
    month = parseInt(id.slice(8, 10), 10);
    day = parseInt(id.slice(10, 12), 10);
    birthStr = `${year}-${id.slice(8, 10)}-${id.slice(10, 12)}`;
    genderDigit = parseInt(id[14], 10);
  } else {
    return {
      raw, valid: false, errMsg: "长度应为 15 或 18 位",
      region: "", province: "", city: "", birth: "", age: 0, gender: "",
    };
  }

  if (!validation.ok) {
    return {
      raw, valid: false, errMsg: validation.reason,
      region: "", province: "", city: "", birth: "", age: 0, gender: "",
    };
  }

  const { province, city } = lookupRegion(regionCode);
  const age = calcAge(new Date(year, month - 1, day));
  const region = city === "—" ? province : `${province} ${city}`;

  return {
    raw: id,
    valid: true,
    region,
    province,
    city,
    birth: birthStr,
    age,
    gender: genderDigit % 2 === 1 ? "男" : "女",
  };
}

// ---------- 响应式状态 ----------

const idInput = ref("");
const copiedKey = ref<string | null>(null);

const rows = computed<ParsedIdCard[]>(() => {
  // 支持换行 / 逗号 / 空格 / 分号分隔
  const list = idInput.value
    .split(/[\n,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.map(parseOne);
});

const validCount = computed(() => rows.value.filter((r) => r.valid).length);
const invalidCount = computed(() => rows.value.filter((r) => !r.valid && r.raw).length);

function clearAll() {
  idInput.value = "";
}

function fillSamples() {
  idInput.value = [
    "11010519491231002X",  // 北京 市辖区 女 1949-12-31（合法）
    "310115199003078888",  // 上海 市辖区 女 1990-03-07（末位故意错误 → 非法）
    "440307199201011237",  // 深圳 男 1992-01-01（合法）
    "510104198507231236",  // 成都 男 1985-07-23（合法）
  ].join("\n");
}

async function copyText(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1500);
  } catch (e) {
    console.error("复制失败", e);
  }
}

const csvText = computed(() => {
  const header = "身份证号,有效性,省,市,出生日期,年龄,性别";
  const lines = rows.value
    .filter((r) => r.raw)
    .map((r) => {
      if (!r.valid) return `${r.raw},错误: ${r.errMsg},,,,,`;
      return [r.raw, "有效", r.province, r.city === "—" ? "" : r.city, r.birth, r.age, r.gender].join(",");
    });
  return [header, ...lines].join("\n");
});

async function copyCsv() {
  if (!csvText.value) return;
  await copyText(csvText.value, "csv");
}
</script>

<template>
  <div class="idcard-parser-container">
    <div class="tool-section">
      <h2>🆔 身份证解析</h2>
      <p class="description">
        每行一个身份证号，支持 18 位（校验位）和 15 位旧版格式；自动校验、解析地区 / 出生日期 / 性别 / 年龄。
      </p>

      <div class="input-actions">
        <button class="action-btn" @click="fillSamples">填入示例</button>
        <button class="action-btn" @click="clearAll">清空</button>
        <button
          class="action-btn copy"
          :class="{ copied: copiedKey === 'csv' }"
          :disabled="!rows.length"
          @click="copyCsv"
        >
          {{ copiedKey === "csv" ? "已复制 CSV" : "复制结果 (CSV)" }}
        </button>
      </div>

      <textarea
        v-model="idInput"
        class="id-input"
        rows="6"
        placeholder="请输入身份证号，每行一个&#10;例如：&#10;11010519491231002X&#10;44030719900228001X"
        spellcheck="false"
      ></textarea>

      <div v-if="idInput.trim()" class="stat-bar">
        共 <strong>{{ rows.length }}</strong> 条，
        有效 <strong class="ok">{{ validCount }}</strong> 条，
        无效 <strong class="err">{{ invalidCount }}</strong> 条
      </div>
    </div>

    <div v-if="rows.some((r) => r.raw)" class="tool-section">
      <h2>📋 解析结果</h2>
      <div class="table-wrap">
        <table class="result-table">
          <thead>
            <tr>
              <th>身份证号</th>
              <th>地区</th>
              <th>出生日期</th>
              <th>年龄</th>
              <th>性别</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, idx) in rows.filter((x) => x.raw)" :key="idx" :class="{ 'row-invalid': !r.valid }">
              <td class="cell-mono">{{ r.raw }}</td>
              <td>{{ r.valid ? r.region : "—" }}</td>
              <td>{{ r.valid ? r.birth : "—" }}</td>
              <td>{{ r.valid ? r.age : "—" }}</td>
              <td>{{ r.valid ? r.gender : "—" }}</td>
              <td>
                <span v-if="r.valid" class="badge badge-ok">有效</span>
                <span v-else class="badge badge-err" :title="r.errMsg">无效</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="info-note">
      <h4>📚 算法说明</h4>
      <ul>
        <li><strong>结构</strong>：18 位身份证 = 6 位地址码 + 8 位出生日期（YYYYMMDD）+ 3 位顺序码 + 1 位校验码</li>
        <li><strong>校验位</strong>：前 17 位分别乘以权重 <code>7 9 10 5 8 4 2 1 6 3 7 9 10 5 8 4 2</code>，求和取模 11，对照 <code>1 0 X 9 8 7 6 5 4 3 2</code></li>
        <li><strong>性别</strong>：第 17 位（顺序码最后一位），奇数男、偶数女</li>
        <li><strong>地区</strong>：基于 GB/T 2260 行政区划代码（前 4 位匹配市/区，省份兜底）</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.idcard-parser-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
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

.description {
  color: var(--vp-c-text-2);
  font-size: 13px;
  margin: 0 0 14px 0;
  line-height: 1.6;
}

.input-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 6px 14px;
  font-size: 13px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: var(--vp-c-brand-soft);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.copy {
  margin-left: auto;
}

.action-btn.copy.copied {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.id-input {
  width: 100%;
  padding: 12px 14px;
  font-size: 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  resize: vertical;
  min-height: 120px;
  line-height: 1.6;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.id-input:focus {
  border-color: var(--vp-c-brand-2);
}

.stat-bar {
  margin-top: 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.stat-bar strong {
  color: var(--vp-c-text-1);
  font-weight: 700;
  margin: 0 2px;
}

.stat-bar strong.ok { color: #2e7d32; }
.stat-bar strong.err { color: #c62828; }

.table-wrap {
  width: 100%;
  overflow-x: auto;
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  background: var(--vp-c-bg);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.result-table th,
.result-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--vp-c-bg-alt);
  white-space: nowrap;
}

.result-table th {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
  font-size: 12px;
}

.result-table tbody tr:hover {
  background: var(--vp-c-bg-alt);
}

.result-table tbody tr:last-child td {
  border-bottom: none;
}

.result-table tbody tr.row-invalid {
  background: rgba(198, 40, 40, 0.04);
}

.result-table tbody tr.row-invalid:hover {
  background: rgba(198, 40, 40, 0.08);
}

.cell-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.5px;
}

.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.badge-ok {
  background: rgba(46, 125, 50, 0.12);
  color: #2e7d32;
}

.badge-err {
  background: rgba(198, 40, 40, 0.12);
  color: #c62828;
  cursor: help;
}

.info-note {
  padding: 16px;
  background: var(--vp-c-bg-alt);
  border-radius: 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.info-note h4 {
  margin: 0 0 8px 0;
  color: var(--vp-c-text-1);
  font-size: 14px;
}

.info-note ul {
  margin: 0;
  padding-left: 20px;
  line-height: 1.8;
}

.info-note code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: var(--vp-c-bg);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--vp-c-text-1);
}

@media (max-width: 640px) {
  .idcard-parser-container { padding: 12px; }
  .result-table { font-size: 12px; }
  .result-table th, .result-table td { padding: 8px; }
}
</style>