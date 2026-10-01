// Duplicate Top 5 jobs: same WO number, or (without a WO) same plant + issue text.
import { normWo } from './cmms.js';

export const jobKey = (j) => (j.wo && normWo(j.wo)) || `${j.plant}|${String(j.issue || '').trim().toLowerCase()}`;

/** Another job (not `job` itself) that already uses the same WO number, if any. */
export const sameWo = (jobs, job) => job.wo && jobs.find((j) => j.id !== job.id && j.wo && normWo(j.wo) === normWo(job.wo));

const filled = (j) => ['action', 'owner', 'team', 'note'].filter((f) => String(j[f] || '').trim()).length;

/**
 * Groups of duplicate jobs with the one to keep: most photos, then highest progress,
 * then most details filled in, then the higher priority (lower rank).
 * Returns [{ key, keep, remove: [] }] for groups with more than one job.
 */
export function findDuplicates(jobs) {
  const groups = new Map();
  jobs.forEach((j) => { const k = jobKey(j); (groups.get(k) || groups.set(k, []).get(k)).push(j); });
  return [...groups.entries()].filter(([, g]) => g.length > 1).map(([key, g]) => {
    const sorted = [...g].sort((a, b) => (b.photos?.length || 0) - (a.photos?.length || 0)
      || (b.progress || 0) - (a.progress || 0) || filled(b) - filled(a) || (a.rank || 99) - (b.rank || 99));
    return { key, keep: sorted[0], remove: sorted.slice(1) };
  });
}
