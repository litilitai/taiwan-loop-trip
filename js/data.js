// 逆時針環島：依序走過 10 個城市（cost 為每人門票／體驗的粗估，單位 NT$）
// q（選填）：Google 地圖搜尋用的關鍵字；名稱容易搜到別處時才需要填，沒填就用 name
const CITIES = [
  { name: '台北', spots: [
    { name: '台北 101 觀景台', cost: 600 },
    { name: '故宮博物院', cost: 350 },
    { name: '士林夜市', cost: 0 }
  ]},
  { name: '九份／東北角', spots: [
    { name: '九份老街', cost: 0 },
    { name: '野柳地質公園', cost: 120 }
  ]},
  { name: '宜蘭', spots: [
    { name: '礁溪溫泉', q: '礁溪溫泉公園', cost: 300 },
    { name: '傳統藝術中心', q: '國立傳統藝術中心 宜蘭', cost: 200 },
    { name: '羅東夜市', cost: 0 }
  ]},
  { name: '花蓮', spots: [
    { name: '太魯閣國家公園', cost: 0 },
    { name: '七星潭海岸', cost: 0 },
    { name: '東大門夜市', cost: 0 }
  ]},
  { name: '台東', spots: [
    { name: '池上伯朗大道', cost: 0 },
    { name: '三仙台', cost: 0 },
    { name: '鐵花村音樂聚落', cost: 0 }
  ]},
  { name: '墾丁', spots: [
    { name: '鵝鑾鼻燈塔', cost: 60 },
    { name: '白沙灣', q: '墾丁 白沙灣', cost: 0 },
    { name: '墾丁大街', cost: 0 }
  ]},
  { name: '高雄', spots: [
    { name: '駁二藝術特區', cost: 0 },
    { name: '蓮池潭龍虎塔', cost: 0 },
    { name: '六合夜市', cost: 0 }
  ]},
  { name: '台南', spots: [
    { name: '安平古堡', cost: 70 },
    { name: '赤崁樓', cost: 70 },
    { name: '神農街', q: '台南 神農街', cost: 0 }
  ]},
  { name: '嘉義／阿里山', spots: [
    { name: '阿里山森林遊樂區', cost: 300 },
    { name: '奮起湖老街', cost: 0 }
  ]},
  { name: '台中', spots: [
    { name: '彩虹眷村', cost: 0 },
    { name: '高美濕地', cost: 0 },
    { name: '逢甲夜市', cost: 0 }
  ]}
];

// 路線圖用：城市經緯度（side 為文字標籤在圓點的左或右）
const CITY_MAP = {
  '台北':         { lon: 121.56, lat: 25.04, side: 'l' },
  '九份／東北角': { lon: 121.84, lat: 25.11, side: 'r' },
  '宜蘭':         { lon: 121.76, lat: 24.75, side: 'r' },
  '花蓮':         { lon: 121.60, lat: 23.98, side: 'r' },
  '台東':         { lon: 121.15, lat: 22.76, side: 'r' },
  '墾丁':         { lon: 120.80, lat: 21.95, side: 'r' },
  '高雄':         { lon: 120.30, lat: 22.62, side: 'l' },
  '台南':         { lon: 120.21, lat: 23.00, side: 'l' },
  '嘉義／阿里山': { lon: 120.45, lat: 23.48, side: 'l' },
  '台中':         { lon: 120.68, lat: 24.14, side: 'l' }
};

// 台灣本島簡化輪廓（[經度, 緯度]，順時針）
const TAIWAN_OUTLINE = [
  [121.55, 25.30], [122.00, 25.13], [121.85, 24.95], [121.87, 24.58],
  [121.62, 24.10], [121.50, 23.50], [121.40, 23.10], [121.20, 22.75],
  [120.90, 22.35], [120.85, 21.90], [120.70, 22.05], [120.60, 22.30],
  [120.30, 22.60], [120.10, 22.95], [120.15, 23.35], [120.20, 23.70],
  [120.20, 24.10], [120.60, 24.45], [120.95, 24.85], [121.20, 25.05],
  [121.50, 25.28]
];

// 每人每天餐飲、每人每晚住宿（以兩人一房估算），依預算等級 0／1／2
const FOOD_PER_DAY = [500, 900, 1600];
const LODGING_PER_NIGHT = [600, 1400, 3000];

// 交通估算；total 回傳整趟「每人」費用
const TRANSPORT = {
  train: {
    label: '火車／大眾運輸',
    total: (days, people) => 2800 + days * 250 // 環島火車票約 2800 + 每日市區交通
  },
  car: {
    label: '自駕租車',
    // 每台車每天：租車 1800 + 油 600 + 高速公路／停車 400，一台坐 4 人
    total: (days, people) => Math.ceil(people / 4) * 2800 * days / people
  },
  scooter: {
    label: '機車',
    total: (days, people) => 450 * days, // 租車 + 油，每人每天
    minDays: 7,
    warn: '機車環島建議至少 7 天，且要注意山路與天候安全。'
  },
  bike: {
    label: '單車',
    total: (days, people) => 150 * days + 800, // 補給 + 租車／運送
    minDays: 10,
    warn: '單車環島全程約 900 公里，建議至少 10 天，並提前做好體能準備。'
  }
};
