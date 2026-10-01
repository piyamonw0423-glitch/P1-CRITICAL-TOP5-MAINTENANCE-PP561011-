import { iso, today0 } from './dates.js';

export const STORAGE_KEY = 'p1dash.v2';
export const PLANT_IDS = [5, 10, 6, 11];
// Each plant keeps two ranked lists; the first TOP_N open jobs of each are shown, the rest fold away.
export const TOP_N = 5;
// Safety cap on jobs per plant (both lists together), enforced in the UI, every store, the server and Excel import.
export const MAX_JOBS_PER_PLANT = 30;
export const LISTS = [
  { k: 'risk', label: 'ความเสี่ยงเครื่องจักร (BD)', tab: 'ความเสี่ยง BD' },
  { k: 'daily', label: 'งานประจำวัน', tab: 'งานประจำวัน' },
];
// Jobs saved before the lists existed belong to the machine-risk list.
export const listOf = (j) => (j?.list === 'daily' ? 'daily' : 'risk');

export const DONE = 'oklch(0.62 0.16 150)';
export const DOING = 'oklch(0.8 0.15 80)';
export const STUCK = 'oklch(0.6 0.21 25)';
export const NAVY = 'oklch(0.27 0.07 258)';

export const PLANT_META = {
  5: { color: 'oklch(0.52 0.17 255)', tint: 'oklch(0.95 0.03 255)', dark: 'oklch(0.42 0.15 255)' },
  10: { color: 'oklch(0.63 0.19 45)', tint: 'oklch(0.95 0.04 55)', dark: 'oklch(0.5 0.16 45)' },
  6: { color: 'oklch(0.55 0.14 160)', tint: 'oklch(0.95 0.035 160)', dark: 'oklch(0.44 0.12 160)' },
  11: { color: 'oklch(0.5 0.19 295)', tint: 'oklch(0.95 0.03 295)', dark: 'oklch(0.42 0.17 295)' },
};

export const BLOCK = {
  part: { label: 'รออะไหล่', solid: 'oklch(0.6 0.19 42)', fg: 'white' },
  permit: { label: 'รอ Permit', solid: 'oklch(0.78 0.15 80)', fg: 'oklch(0.3 0.07 65)', text: 'oklch(0.55 0.13 70)' },
  manpower: { label: 'ขาดกำลังคน', solid: 'oklch(0.55 0.19 300)', fg: 'white' },
  shutdown: { label: 'รอหยุดเครื่อง', solid: 'oklch(0.45 0.05 258)', fg: 'white' },
  vendor: { label: 'รอผู้รับเหมา', solid: 'oklch(0.55 0.16 250)', fg: 'white' },
  budget: { label: 'รออนุมัติงบ', solid: 'oklch(0.55 0.1 195)', fg: 'white' },
  none: { label: 'ไม่ติดปัญหา', solid: 'oklch(0.93 0.06 150)', fg: 'oklch(0.42 0.12 150)' },
};

export const STATUS = {
  done: { label: 'เสร็จแล้ว', bg: 'oklch(0.93 0.06 150)', fg: 'oklch(0.42 0.12 150)' },
  doing: { label: 'กำลังทำ', bg: 'oklch(0.95 0.08 85)', fg: 'oklch(0.45 0.1 65)' },
  pending: { label: 'ยังไม่เริ่ม', bg: 'oklch(0.94 0.05 25)', fg: 'oklch(0.5 0.19 25)' },
};

export const FILTERS = [
  { k: 'all', label: 'ทั้งหมด 4 โรง', ids: [5, 10, 6, 11] },
  { k: '5-10', label: 'กลุ่ม 1 · โรง 5 + 10', ids: [5, 10] },
  { k: '6-11', label: 'กลุ่ม 2 · โรง 6 + 11', ids: [6, 11] },
  { k: '5', label: 'โรงไฟฟ้า 5', ids: [5] },
  { k: '10', label: 'โรงไฟฟ้า 10', ids: [10] },
  { k: '6', label: 'โรงไฟฟ้า 6', ids: [6] },
  { k: '11', label: 'โรงไฟฟ้า 11', ids: [11] },
];

export const GROUPS = [
  { k: '5-10', title: 'กลุ่ม 1 · โรงไฟฟ้า 5 และ 10', ids: [5, 10] },
  { k: '6-11', title: 'กลุ่ม 2 · โรงไฟฟ้า 6 และ 11', ids: [6, 11] },
];

/** Bucket used for KPIs: done / doing / stuck (not started or past due). */
export const bucket = (j, t) => {
  if (j.status === 'done') return 'done';
  const [y, m, d] = (j.end || '').split('-').map(Number);
  if (j.status === 'pending' || new Date(y, (m || 1) - 1, d || 1) < t) return 'stuck';
  return 'doing';
};
export const counts = (jobs, t) => {
  const c = { done: 0, doing: 0, stuck: 0 };
  jobs.forEach((j) => c[bucket(j, t)]++);
  return c;
};

let _id = 100;
// Sample WO numbers use the placeholder format WO-P<plant>-<seq>; replace them with the real work-order numbers.
const J = (plant, rank, issue, action, owner, team, start, end, progress, status, blocker, note) => ({ id: 'j' + (_id++), wo: `WO-P${plant}-${String(rank).padStart(3, '0')}`, plant, rank, issue, action, owner, team, start, end, progress, status, blocker, note });
export const SEED = () => ({
  updatedAt: new Date().toISOString(),
  plants: {
    5: { impact: ['เสี่ยงลดกำลังผลิต ~30 MW หาก BFP B ไม่พร้อม', 'ประสิทธิภาพ Boiler ลดจาก Air Preheater รั่ว'] },
    10: { impact: ['เสี่ยง Trip จาก Generator Transformer', 'Coal Mill C ไม่พร้อม ผลิตได้ไม่เต็มกำลัง'] },
    6: { impact: ['กระทบการเดินเครื่อง GT หาก Combustor ผิดปกติ', 'เสี่ยงไฟดับบัส 6.9 kV'] },
    11: { impact: ['เสี่ยงต้องลดโหลด Steam Turbine', 'Economizer รั่วต่อเนื่อง สูญเสียน้ำ'] },
  },
  jobs: [
    J(5, 1, 'Boiler Feed Pump B สั่นสูงเกินเกณฑ์', 'เปลี่ยน Bearing + Alignment ใหม่', 'สมชาย ก.', 'เครื่องกล', '2026-10-01', '2026-10-10', 60, 'doing', 'part', 'Bearing จากผู้ผลิตยังไม่ถึง คาดส่ง 5 ต.ค.'),
    J(5, 2, 'Air Preheater Seal รั่ว', 'เปลี่ยน Radial Seal ทั้งชุด', 'วิชัย ส.', 'ทีม Boiler', '2026-09-20', '2026-10-05', 35, 'doing', 'shutdown', 'ต้องลดโหลด รอศูนย์ควบคุมอนุมัติช่วงเวลา'),
    J(5, 3, 'ID Fan A Bearing อุณหภูมิสูง 92°C', 'ตรวจ Lube Oil + เปลี่ยน Oil Cooler', 'ประยุทธ ม.', 'เครื่องกล', '2026-09-25', '2026-10-03', 80, 'doing', 'none', ''),
    J(5, 4, 'HP Bypass Control Valve ค้าง', 'Overhaul Actuator และ Positioner', 'นภา ร.', 'C&I', '2026-09-28', '2026-10-12', 20, 'doing', 'vendor', 'ออก PO แล้ว รอผู้รับเหมาเข้าหน้างาน'),
    J(5, 5, 'Condenser Vacuum ต่ำกว่าเกณฑ์', 'Helium Leak Test หาจุดรั่ว', 'อนันต์ พ.', 'Performance', '2026-09-15', '2026-09-30', 100, 'done', 'none', ''),
    J(10, 1, 'Generator Transformer ค่า DGA สูงผิดปกติ', 'Oil Filtering + ทดสอบ DGA ซ้ำ', 'ธนพล จ.', 'ไฟฟ้า', '2026-09-22', '2026-10-08', 45, 'doing', 'vendor', 'รถ Filter ของผู้รับเหมาติดคิวงานโรงอื่น'),
    J(10, 2, 'Coal Mill C ลูกบดสึก', 'เปลี่ยน Grinding Roller', 'สุริยา ท.', 'เครื่องกล', '2026-10-01', '2026-10-20', 10, 'pending', 'part', 'Roller ยังไม่ถึง (Lead time 6 สัปดาห์)'),
    J(10, 3, 'DCS Controller สำรองไม่ Sync', 'Update Firmware + ทดสอบ Redundancy', 'พรทิพย์ น.', 'C&I', '2026-09-20', '2026-09-29', 70, 'doing', 'shutdown', 'ทดสอบ Switch-over ได้เฉพาะตอนหยุดเครื่อง'),
    J(10, 4, 'Cooling Water Pump 2 Seal รั่ว', 'เปลี่ยน Mechanical Seal', 'กิตติ ว.', 'เครื่องกล', '2026-09-26', '2026-10-02', 90, 'doing', 'none', ''),
    J(10, 5, 'Soot Blower 12 ติดขัด', 'ซ่อม Gearbox และ Lance', 'ชาตรี บ.', 'ทีม Boiler', '2026-09-29', '2026-10-10', 0, 'pending', 'budget', 'รออนุมัติ PR ค่าอะไหล่ Gearbox'),
    J(6, 1, 'Gas Turbine Exhaust Temp Spread สูง', 'Borescope ตรวจ Combustor', 'ณัฐวุฒิ ศ.', 'GT Team', '2026-09-24', '2026-10-06', 55, 'doing', 'permit', 'รอ Permit เข้าพื้นที่อับอากาศ (Confined Space)'),
    J(6, 2, 'Circuit Breaker 6.9 kV Trip ไม่ทราบสาเหตุ', 'ทดสอบ Protection Relay และ Timing', 'อรุณ ช.', 'ไฟฟ้า', '2026-09-18', '2026-09-27', 60, 'doing', 'vendor', 'รอผู้เชี่ยวชาญ Relay จากผู้ผลิต'),
    J(6, 3, 'HRSG HP Drum Level Transmitter แกว่ง', 'เปลี่ยน Transmitter + Calibrate', 'ศิริพร ล.', 'C&I', '2026-09-27', '2026-10-01', 85, 'doing', 'none', ''),
    J(6, 4, 'Inlet Air Filter อุดตัน ΔP สูง', 'เปลี่ยน Filter Cartridge 50%', 'วีระ ด.', 'GT Team', '2026-10-01', '2026-10-07', 15, 'pending', 'part', 'Cartridge ส่งมาไม่ครบ ขาด 120 ชิ้น'),
    J(6, 5, 'Fuel Gas Filter ΔP สูง', 'เปลี่ยน Filter Element', 'มานพ ย.', 'เครื่องกล', '2026-09-20', '2026-09-28', 100, 'done', 'none', ''),
    J(11, 1, 'Steam Turbine Bearing 3 Vibration สูง', 'Balancing + ตรวจ Alignment', 'ปิยะ ห.', 'เครื่องกล', '2026-09-15', '2026-09-28', 40, 'doing', 'shutdown', 'ต้องหยุดเครื่อง ≥3 วัน ยังไม่ได้ช่วงเวลา'),
    J(11, 2, 'Economizer Tube รั่ว', 'เชื่อมซ่อม + ตรวจ NDT', 'สมศักดิ์ อ.', 'ทีม Boiler', '2026-09-26', '2026-10-04', 65, 'doing', 'manpower', 'ช่างเชื่อม Certified ไม่พอ (ได้ 2 จาก 4 คน)'),
    J(11, 3, 'Feedwater Heater 6 Level Control ผิดปกติ', 'ตรวจ Level Switch + Drain Valve', 'จิราพร ค.', 'C&I', '2026-09-23', '2026-09-29', 75, 'doing', 'part', 'รอ Valve Trim สำรองจากคลัง'),
    J(11, 4, 'Cooling Tower Fan 4 Gearbox เสียงดัง', 'เปลี่ยน Gearbox', 'บุญมี ส.', 'เครื่องกล', '2026-10-01', '2026-10-15', 0, 'pending', 'budget', 'รออนุมัติงบซื้อ Gearbox ใหม่'),
    J(11, 5, 'Battery Charger 220 VDC Alarm', 'เปลี่ยน Rectifier Module', 'ธีระ ป.', 'ไฟฟ้า', '2026-09-29', '2026-10-03', 50, 'doing', 'none', ''),
  ],
  history: [
    { date: '2026-09-09', done: 1, doing: 11, stuck: 8 },
    { date: '2026-09-16', done: 1, doing: 12, stuck: 7 },
    { date: '2026-09-23', done: 2, doing: 11, stuck: 7 },
  ],
});

export const loadData = () => {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && Array.isArray(s.jobs)) return s;
  } catch { /* fall through to seed */ }
  return SEED();
};

/** Stamp today's snapshot into history, persist, and return the new data. Returns null if storage is full. */
export const commitData = (data) => {
  const t = today0(), d = iso(t);
  const c = counts(data.jobs, t);
  const p = Object.fromEntries(PLANT_IDS.map((id) => [id, counts(data.jobs.filter((j) => j.plant === id), t)]));
  const history = (data.history || [])
    .filter((x) => x.date !== d)
    .concat([{ date: d, ...c, p }])
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);
  const next = { ...data, history, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { next, ok: false };
  }
  return { next, ok: true };
};
