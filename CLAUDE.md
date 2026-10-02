# CLAUDE.md

P1 Maintenance Dashboard: one-page Top 5 Priority-1 repair tracker for power plants 5, 10, 6, 11 (Thai UI).
Full system doc, work log and roadmap: `docs/SYSTEM.md` (Thai). User-facing guide: `README.md`.

## Stack & builds
- React 19 + Vite 8, no router, plain CSS (`src/styles.css`, oklch tokens matching the Claude Design source in `project/`).
- One UI, three data backends chosen at build time by `__BACKEND__` (see `src/lib/store.js`):
  - `npm run build` → `local` (localStorage) → GitHub Pages via `.github/workflows/deploy.yml` (pushes `dist/` to `gh-pages`).
  - `npm run build:server` → `api` → Cloudflare Worker (`worker/index.js`, `wrangler.jsonc`) or Node (`server/index.js`).
  - `npm run build:artifact` → `artifact` → single file for the claude.ai artifact (React 18 UMD from cdnjs).
- Server logic shared by Worker and Node: `server/core.js` (validation + Postgres, one `docs` table) and `server/api.js` (router + permissions).

## Production
- Cloudflare Worker `p1-critical-top5-maintenance-pp561011` at `https://p1-critical-top5-maintenance-pp561011.piyamon-w0423.workers.dev/`,
  auto-deployed by Workers Builds on push to `main`. `wrangler.jsonc` runs `npm run build:server` before deploy (the dashboard's default
  `npm run build` would ship the localStorage build) and sets `keep_vars: true`.
- Secrets in the Cloudflare dashboard: `DATABASE_URL` (Neon pooled URL), `EDIT_PASSWORD`; optional `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `EDITOR_EMAILS`.
- DB: Neon Postgres (Singapore). Worker connects via `@neondatabase/serverless` WebSocket, falls back to `pg` TCP; hard timeouts via `within()`
  because pg timers do not fire on workerd. First connection creates the table and seeds 20 sample jobs once (`meta/seeded`); older DBs get the 6 extra samples removed once (`meta/trim5`).

## Conventions
- WO Backlog: CMMS "List of Work Orders" export parsed in the browser (`src/lib/cmms.js`), stored as one snapshot doc `backlog/current`,
  shown in `components/Backlog.jsx`; Top 5 jobs link to it by WO number. Uploads merge by WO (`mergeBacklog`: new + changed
  status, keeps prevStatus/statusSince/changedAt/seenAt; missing WOs kept and flagged unless removed).
- Daily CMMS report: every backlog upload folds `dayEvents` (new / started = into APPR·INPRG·REWORK or Actual Start = today / finished / closed, as [wo, plant, team]) and `openSnapshot` (per "plant|team" open + age buckets) into `stats/<YYYY-MM-DD>` via `foldDayStats` (unions by WO, so repeated uploads in a day never double count). Server does it inside `saveBacklog`; local/artifact stores do it client-side. The CMMS export drops closed WOs, so with `MISSING_IS_CLOSED` (cmms.js, true) a WO present in the previous file but missing from the new one counts as CLOSED: listed in `assumed` and in `closed` (undone via `back` if it reappears the same day); `effGroup(r, latest)` treats missing rows as closed everywhere; `closedStatus` = closed from Status column L. Event tuples carry [wo, plant, team, at, mid] (mid = 1 if after the day's first upload; for new WOs = "แทรกระหว่างวัน"); `statTotals` gives `inserted`, `roundTotals` the per-upload breakdown. Upload option "Baseline" (`baseline: YYYY-MM-DD`) wipes `stats` and writes `baselineStats` for that day (file name date via `dateFromFileName`). Team = `teamOf(WO_Worklocation)`: WL5112 MECH, WL5115 ELEC, WL5118 AUTO, WL5122/WL5123 EMER. UI `components/Report.jsx`, API `GET /api/stats`.
- LINE (`server/line.js`, optional secrets `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TO`, `LINE_CHANNEL_SECRET`): summary push after every `PUT /api/backlog` (response `line: sent|failed|off`, never fails the upload), `POST /api/line/test`, webhook `POST /api/line/webhook` (signature-checked, skips Access; replies to "สรุป"/"id" — replies cost no quota), cron reminders 09:45/16:15 Thai Mon–Sat in `wrangler.jsonc` → `scheduled()` → `remindIfNoUpload`. `LINE_API_BASE` overrides the API host for local mock tests.
- One Top 5 job per WO number (form, stores, server `duplicate_wo`); "ลบงานซ้ำ" uses `findDuplicates` in `src/lib/dedupe.js`. Status groups are the team's (see docs/SYSTEM.md §8.1).
- No `EDIT_PASSWORD` (and no Access editor list) → API is view-only (`setup: 'no_password'`) unless `ALLOW_OPEN_EDIT=true`.
- Two ranked lists per plant (`LISTS`/`listOf` in `src/lib/data.js`: job `list` = `risk` (BD, default for old jobs) | `daily`); each shows the first `TOP_N`=5 open jobs by rank, extras/done fold away. ▲▼ or drag (pointer events on the rank badge / ⠿ grip, mouse + touch) save the list order via `reorderJobs` (`POST /api/jobs/rank`).
- Safety cap `MAX_JOBS_PER_PLANT`=30 (both lists), enforced in UI, all stores, server (`plant_full`) and Excel import.
- Dates are `YYYY-MM-DD` strings; "today" is Thai time (UTC+7). Job buckets: done / stuck (pending or overdue) / doing.
- Imports without a `photos` key must keep existing photos (all three backends honour this); `replace: true` deletes jobs not imported.
- Error details returned to the browser must never contain the database URL (see `reason()` in worker, api.js).
- Commit messages end with the Co-Authored-By / Claude-Session lines used in history.

## Testing locally
- Worker end-to-end: start a throwaway Postgres, write `.dev.vars` (`DATABASE_URL=...`, `EDIT_PASSWORD=...`), `npx wrangler dev`, drive with Playwright
  (`executablePath: '/opt/pw-browsers/chromium'`). Never commit `.dev.vars`.
- The cloud dev sandbox cannot reach `*.workers.dev` or `neon.tech`; verify production through Cloudflare's GitHub check runs and user screenshots.
