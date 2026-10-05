import { useEffect, useRef, useState } from 'react';
import { TEAMS, wlOptions } from '../lib/cmms.js';

/** Selected codes → button text, e.g. "WL5112, WL5121 (MECH)" or "ทุก WO_Worklocation". */
export const wlLabel = (value) => (value.length ? value.join(', ') : 'ทุก WO_Worklocation');
export const toggleWl = (value, code) => (value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);

/** Multi-select filter by WO_Worklocation code, grouped by team; [] = all. A team box ticks all its codes. */
export default function WlSelect({ value, onChange, seen = [] }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const opts = wlOptions(seen);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const setTeam = (codes, on) => onChange(on ? [...new Set([...value, ...codes])] : value.filter((c) => !codes.includes(c)));
  return (
    <div className="wl-pick" ref={box}>
      <button type="button" className="rep-select rep-wl" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="wl-pick-text">{wlLabel(value)}</span> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="wl-pop" role="group" aria-label="เลือก WO_Worklocation (เลือกได้หลายรหัส)">
          <label className="wl-row wl-all">
            <input type="checkbox" checked={!value.length} onChange={() => onChange([])} /> ทุก WO_Worklocation
          </label>
          {TEAMS.map((t) => {
            const mine = opts.filter((o) => o.team === t.k).map((o) => o.code);
            if (!mine.length) return null;
            const all = mine.every((c) => value.includes(c));
            const some = !all && mine.some((c) => value.includes(c));
            return (
              <div key={t.k} className="wl-group">
                <label className="wl-row wl-team">
                  <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some; }} onChange={() => setTeam(mine, !all)} /> {t.label}
                </label>
                {mine.map((c) => (
                  <label key={c} className="wl-row wl-code">
                    <input type="checkbox" checked={value.includes(c)} onChange={() => onChange(toggleWl(value, c))} /> {c}
                  </label>
                ))}
              </div>
            );
          })}
          <button type="button" className="fold-more" onClick={() => setOpen(false)}>ตกลง</button>
        </div>
      )}
    </div>
  );
}
