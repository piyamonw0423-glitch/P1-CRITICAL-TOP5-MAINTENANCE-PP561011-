export const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Parse 'YYYY-MM-DD' as a local-midnight Date. */
export const pd = (s) => {
  const [y, m, d] = (s || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const thD = (d) => `${d.getDate()} ${TH_M[d.getMonth()]}`;
export const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const range = (a, b) => {
  const x = pd(a), y = pd(b);
  return x.getMonth() === y.getMonth() ? `${x.getDate()}–${thD(y)}` : `${thD(x)}–${thD(y)}`;
};
export const today0 = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};
export const daysBetween = (a, b) => Math.round((b - a) / 864e5);
