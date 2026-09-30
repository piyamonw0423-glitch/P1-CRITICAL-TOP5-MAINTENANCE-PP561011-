import { useEffect, useMemo, useState } from 'react';
import { EditBar, Header } from './components/Header.jsx';
import { FilterSelect, Highlights, KpiRow } from './components/Summary.jsx';
import PlantCard from './components/PlantCard.jsx';
import { BlockerSummary, TrendPanel } from './components/Insights.jsx';
import { ImpactModal, JobModal, Lightbox } from './components/Modals.jsx';
import { FILTERS, SEED, commitData, loadData } from './lib/data.js';
import { iso, today0 } from './lib/dates.js';
import { dashboardView } from './lib/view.js';

// The selected view lives in ?view= so a filtered dashboard can be bookmarked or shared.
const readView = () => {
  const v = new URLSearchParams(window.location.search).get('view');
  return FILTERS.some((f) => f.k === v) ? v : 'all';
};

export default function App() {
  const [data, setData] = useState(loadData);
  const [editMode, setEditMode] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'job', job } | { type: 'plant', pid }
  const [lightbox, setLightbox] = useState(null);
  const [filter, setFilter] = useState(readView);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (filter === 'all') url.searchParams.delete('view');
    else url.searchParams.set('view', filter);
    window.history.replaceState(null, '', url);
  }, [filter]);

  const t = today0();
  const tKey = iso(t);
  // Recompute when the calendar day rolls over (t is derived from tKey).
  const view = useMemo(() => dashboardView(data, filter, t), [data, filter, tKey]);

  const commit = (next) => {
    const { next: saved, ok } = commitData(next);
    if (!ok) alert('พื้นที่จัดเก็บในเครื่องเต็ม กรุณาลบรูปเก่าบางรูป หรือส่งออกไฟล์เก็บไว้ก่อน');
    setData(saved);
    setModal(null);
  };

  const openNew = (pid) => {
    const e = new Date(t);
    e.setDate(e.getDate() + 7);
    const rank = data.jobs.filter((j) => j.plant === pid).length + 1;
    setModal({
      type: 'job',
      job: { id: null, plant: pid, rank, issue: '', action: '', owner: '', team: '', start: iso(t), end: iso(e), progress: 0, status: 'pending', blocker: 'none', note: '', photos: [] },
    });
  };

  const saveJob = (job) => {
    const exists = data.jobs.some((j) => j.id === job.id);
    commit({ ...data, jobs: exists ? data.jobs.map((j) => (j.id === job.id ? job : j)) : data.jobs.concat([job]) });
  };

  const deleteJob = (id) => {
    if (confirm('ลบงานนี้?')) commit({ ...data, jobs: data.jobs.filter((j) => j.id !== id) });
  };

  const saveImpact = (pid, impact) => commit({ ...data, plants: { ...data.plants, [pid]: { ...data.plants[pid], impact } } });

  const exportData = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `P1-dashboard-${iso(t)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importFile = (f) =>
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt);
        if (!Array.isArray(d.jobs)) throw new Error('missing jobs');
        commit({ plants: {}, history: [], ...d });
      } catch {
        alert('ไฟล์ไม่ถูกต้อง');
      }
    });

  const resetData = () => {
    if (confirm('คืนค่าข้อมูลตัวอย่าง? ข้อมูลที่แก้ไขจะหายไป')) commit(SEED());
  };

  const scopeLabel = view.ids.length === 4 ? 'ทั้ง 4 โรง' : ` · ${view.filter.label}`;

  return (
    <div className="app">
      <Header now={now} updatedAt={data.updatedAt} editMode={editMode} onToggleEdit={() => setEditMode((v) => !v)} />
      {editMode && <EditBar onExport={exportData} onImportFile={importFile} onReset={resetData} />}

      <main className="main">
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
      </main>

      <footer className="app-footer">
        <span className="app-footer-quote">“ซ่อมให้ทัน ลดความเสี่ยง รักษาความพร้อมของโรงไฟฟ้า”</span>
        <span className="app-footer-note">% สำเร็จ = งานเสร็จ ÷ งาน P1 ทั้งหมดของโรง · ค้าง = ยังไม่เริ่ม หรือ เกินกำหนด</span>
      </footer>

      {modal?.type === 'job' && (
        <JobModal initial={modal.job} onSave={saveJob} onDelete={() => deleteJob(modal.job.id)} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'plant' && (
        <ImpactModal pid={modal.pid} impact={data.plants[modal.pid]?.impact || []} onSave={(impact) => saveImpact(modal.pid, impact)} onClose={() => setModal(null)} />
      )}
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
