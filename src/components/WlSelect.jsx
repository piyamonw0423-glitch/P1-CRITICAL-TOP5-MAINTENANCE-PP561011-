import { TEAMS, wlOptions } from '../lib/cmms.js';

/** Drop-down filter by WO_Worklocation code (grouped by team); '' = all. */
export default function WlSelect({ value, onChange, seen = [] }) {
  const opts = wlOptions(seen);
  return (
    <select className="rep-select rep-wl" value={value} onChange={(e) => onChange(e.target.value)} aria-label="กรองตาม WO_Worklocation">
      <option value="">ทุก WO_Worklocation</option>
      {TEAMS.map((t) => {
        const mine = opts.filter((o) => o.team === t.k);
        return mine.length ? (
          <optgroup key={t.k} label={t.label}>
            {mine.map((o) => <option key={o.code} value={o.code}>{o.code} ({t.label})</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}
