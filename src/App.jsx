import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditBar, Header } from './components/Header.jsx';
import { FilterSelect, Highlights, KpiRow } from './components/Summary.jsx';
import PlantCard from './components/PlantCard.jsx';
import { BlockerSummary, TrendPanel } from './components/Insights.jsx';
import { ImpactModal, JobModal, Lightbox } from './components/Modals.jsx';
import { ConfirmDialog, PasswordDialog, Toast } from './components/Feedback.jsx';
import { EmptyState, StatusPanel } from './components/States.jsx';
import { FILTERS } from './lib/data.js';
import { iso, today0 } from './lib/dates.js';
import { dashboardView } from './lib/view.js';
import { readLocalBackup, useDashboardStore } from './lib/store.js';

// The selected view lives in ?view= so a filtered dashboard can be bookmarked or shared.
const readView = () => {
  let v = null;
  try { v = new URLSearchParams(window.location.search).get('view'); } catch { /* no query access */ }
  return FILTERS.some((f) => f.k === v) ? v : 'all';
};

const ERROR_TEXT = {
  invalid_argument: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลในหน้านี้ ขอสิทธิ์ผู้แก้ไขจากเจ้าของหน้า',
  quota_exceeded: 'พื้นที่จัดเก็บเต็ม กรุณาลบรูปเก่าบางรูปแล้วลองใหม่',
  resource_exhausted: 'บันทึกถี่เกินไป รอสักครู่แล้วลองใหม่',
  bad_request: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง ตรวจสอบช่องที่กรอกแล้วลองใหม่',
  wrong_key: 'รหัสผ่านทีมไม่ถูกต้องหรือถูกเปลี่ยนแล้ว กดอัปเดตงานประจำวันแล้วใส่รหัสใหม่',
  read_only: 'บัญชีนี้ดูได้อย่างเดียว ขอสิทธิ์แก้ไขจากผู้ดูแลแดชบอร์ด',
};
const errorText = (e) => ERROR_TEXT[e?.code] || `บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่${e?.detail ? ` (${e.detail})` : ''}`;

export default function App() {
  const store = useDashboardStore();
  const { data, status, canWrite } = store;
  const [editMode, setEditMode] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'job', job } | { type: 'plant', pid }
  const [lightbox, setLightbox] = useState(null);
  const [filter, setFilter] = useState(readView);
  const [now, setNow] = useState(() => new Date());
  const [ask, setAsk] = useState(null); // { message, confirmLabel, onConfirm }
  const [toast, setToast] = useState(null); // { text, error? }
  const [busy, setBusy] = useState(false);
  const [backup] = useState(readLocalBackup);
  const [askKey, setAskKey] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== 'connecting') return undefined;
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, [status]);

  // After saving, briefly highlight the job and bring it into view so the change is easy to spot.
  useEffect(() => {
    if (!flashId) return undefined;
    const raf = requestAnimationFrame(() => document.getElementById(`job-${flashId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    const t = setTimeout(() => setFlashId(null), 3000);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [flashId]);
  const clearToast = useCallback(() => setToast(null), []);
  const closeAsk = useCallback(() => setAsk(null), []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (filter === 'all') url.searchParams.delete('view');
      else url.searchParams.set('view', filter);
      window.history.replaceState(null, '', url);
    } catch { /* sandboxed frames may refuse history updates */ }
  }, [filter]);

  // Leave edit mode if the platform says this viewer cannot write.
  useEffect(() => { if (canWrite === false) setEditMode(false); }, [canWrite]);

  const t = today0();
  const tKey = iso(t);
  // Recompute when the calendar day rolls over (t is derived from tKey).
  const view = useMemo(() => dashboardView(data, filter, t), [data, filter, tKey]);

  // Run a store write; close dialogs and toast on success, keep the form open on failure.
  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      setModal(null);
      setAsk(null);
      setToast({ text: okText });
    } catch (e) {
      setAsk(null);
      setToast({ text: errorText(e), error: true });
      if (e?.code === 'wrong_key') setAskKey(true);
    } finally {
      setBusy(false);
    }
  };

  const openNew = (pid) => {
    const e = new Date(t);
    e.setDate(e.getDate() + 7);
    const rank = data.jobs.filter((j) => j.plant === pid).length + 1;
    setModal({
      type: 'job',
      job: { id: null, wo: '', plant: pid, rank, issue: '', action: '', owner: '', team: '', start: iso(t), end: iso(e), progress: 0, status: 'pending', blocker: 'none', note: '', photos: [] },
    });
  };

  const deleteJob = (id) => setAsk({
    message: 'ลบงานนี้? ลบแล้วกู้คืนไม่ได้',
    confirmLabel: 'ลบงาน',
    onConfirm: () => run(() => store.deleteJob(id), 'ลบงานแล้ว'),
  });

  const exportData = async () => {
    const filename = `P1-dashboard-${iso(t)}.json`;
    // Photos served by link (server builds) are embedded so the file is a complete backup.
    const embed = async (ph) => {
      if (ph.src.startsWith('data:')) return { src: ph.src, date: ph.date };
      const blob = await (await fetch(ph.src)).blob();
      const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      return { src, date: ph.date };
    };
    let full = data;
    try {
      full = { ...data, jobs: await Promise.all(data.jobs.map(async (j) => ({ ...j, photos: await Promise.all((j.photos || []).map(embed)) }))) };
    } catch {
      setToast({ text: 'โหลดรูปบางรูปไม่สำเร็จ ไฟล์ที่ส่งออกจะไม่มีรูป', error: true });
      full = { ...data, jobs: data.jobs.map((j) => ({ ...j, photos: (j.photos || []).filter((ph) => ph.src.startsWith('data:')) })) };
    }
    const json = JSON.stringify(full, null, 2);
    // Inside a claude.ai artifact, downloads go through the viewer's save prompt.
    const downloads = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (downloads) {
      try {
        await downloads.save({ filename, data: json });
        setToast({ text: `ส่งออกไฟล์ ${filename} แล้ว` });
      } catch (e) {
        if (e?.code !== 'declined') setToast({ text: 'ส่งออกไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง', error: true });
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importParsed = (d) => run(() => store.importData(d), `นำเข้า ${d.jobs.length} งานแล้ว`);

  const importFile = (f) =>
    f.text().then((txt) => {
      let d;
      try {
        d = JSON.parse(txt);
        if (!Array.isArray(d.jobs)) throw new Error('missing jobs');
      } catch {
        setToast({ text: 'ไฟล์ไม่ถูกต้อง ต้องเป็นไฟล์ .json ที่ส่งออกจากแดชบอร์ดนี้', error: true });
        return;
      }
      setAsk({
        message: `นำเข้า ${d.jobs.length} งานจากไฟล์? งานที่มีรหัสเดียวกันจะถูกแทนที่`,
        confirmLabel: 'นำเข้า',
        onConfirm: () => importParsed(d),
      });
    });

  const resetData = store.resetSample
    ? () => setAsk({
      message: 'คืนค่าข้อมูลตัวอย่าง? ข้อมูลที่แก้ไขในเครื่องนี้จะหายไป',
      confirmLabel: 'คืนค่าข้อมูล',
      onConfirm: () => run(store.resetSample, 'คืนค่าข้อมูลตัวอย่างแล้ว'),
    })
    : null;

  const scopeLabel = view.ids.length === 4 ? 'ทั้ง 4 โรง' : ` · ${view.filter.label}`;
  const ready = status === 'ready';
  const empty = ready && data.jobs.length === 0;

  return (
    <div className="app">
      <Header
        now={now}
        updatedAt={data.updatedAt}
        updatedBy={store.whoUpdated}
        editMode={editMode}
        canEdit={ready && canWrite !== false}
        readOnly={ready && canWrite === false}
        onToggleEdit={() => {
          if (!editMode && store.needsKey) setAskKey(true);
          else setEditMode((v) => !v);
        }}
      />
      {editMode && <EditBar shared={store.shared} onExport={exportData} onImportFile={importFile} onReset={resetData} />}

      <main className="main">
        {status === 'connecting' && (
          <StatusPanel
            title="กำลังโหลดข้อมูลล่าสุด…"
            text={slow ? 'กำลังเชื่อมต่อฐานข้อมูล ถ้าไม่มีคนใช้มาสักพัก ครั้งแรกอาจใช้เวลา 5–20 วินาที' : undefined}
          />
        )}
        {status === 'unavailable' && (
          <StatusPanel
            title="ยังเปิดข้อมูลแดชบอร์ดไม่ได้"
            text={store.unavailableText}
          />
        )}
        {empty && (
          <EmptyState
            canWrite={canWrite !== false}
            backupCount={backup?.jobs.length || 0}
            busy={busy}
            onStart={() => { if (store.needsKey) { setAskKey(true); return; } setEditMode(true); openNew(5); }}
            onMigrate={() => importParsed(backup)}
            onImportFile={importFile}
          />
        )}

        {ready && !empty && (
          <>
            <FilterSelect value={filter} color={view.color} onChange={setFilter} />

            <div className="summary">
              <KpiRow kpi={view.kpi} />
              <Highlights items={view.highlights} />
            </div>

            <div className="groups">
              {view.groups.map((g) => (
                <section key={g.k} className="group">
                  <div className="group-head">
                    <h2 className="group-title">{g.title}</h2>
                    <span className="group-note">{g.note}</span>
                  </div>
                  <div className="group-plants">
                    {g.plants.map((p) => (
                      <PlantCard
                        key={p.id}
                        p={p}
                        edit={editMode}
                        flashId={flashId}
                        onEditJob={(job) => setModal({ type: 'job', job })}
                        onAddJob={() => openNew(p.id)}
                        onEditImpact={() => setModal({ type: 'plant', pid: p.id })}
                        onPhoto={setLightbox}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="insights">
              <BlockerSummary items={view.blockers} scopeLabel={scopeLabel} />
              <TrendPanel hist={view.history} />
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        <span className="app-footer-quote">“ซ่อมให้ทัน ลดความเสี่ยง รักษาความพร้อมของโรงไฟฟ้า”</span>
        <span className="app-footer-note">% สำเร็จ = งานเสร็จ ÷ งาน P1 ทั้งหมดของโรง · ค้าง = ยังไม่เริ่ม หรือ เกินกำหนด</span>
      </footer>

      {modal?.type === 'job' && (
        <JobModal
          initial={modal.job}
          busy={busy}
          onSave={async (job) => {
            await run(() => store.saveJob(job), job.status === 'done' ? 'บันทึกแล้ว · งานที่เสร็จแล้วย้ายไปอยู่ท้ายรายการของโรง' : 'บันทึกแล้ว');
            setFlashId(job.id);
          }}
          onDelete={() => deleteJob(modal.job.id)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'plant' && (
        <ImpactModal
          pid={modal.pid}
          busy={busy}
          impact={data.plants[modal.pid]?.impact || []}
          onSave={(impact) => run(() => store.saveImpact(modal.pid, impact), 'บันทึกแล้ว')}
          onClose={() => setModal(null)}
        />
      )}
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
      {ask && <ConfirmDialog {...ask} busy={busy} onCancel={closeAsk} />}
      {askKey && (
        <PasswordDialog
          onCancel={() => setAskKey(false)}
          onSubmit={async (key) => {
            try {
              await store.unlock(key);
              setAskKey(false);
              setEditMode(true);
              return '';
            } catch (e) {
              return e?.code === 'wrong_key' ? 'รหัสผ่านไม่ถูกต้อง' : errorText(e);
            }
          }}
        />
      )}
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
