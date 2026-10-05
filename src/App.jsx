import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Dashboard from './views/Dashboard.jsx';
import Extracts from './views/Extracts.jsx';
import Position from './views/Position.jsx';
import Exceptions from './views/Exceptions.jsx';
import Pack from './views/Pack.jsx';
import Intelligence from './views/Intelligence.jsx';
import Rail from './components/Rail.jsx';
import { IconGrid, IconAlert, IconDoc, IconClock, IconSpark } from './components/Icons.jsx';
import { fmtStamp } from './lib/format.js';

/** Per-period views, reached from the rail's Reports menu. */
const VIEWS = [
  { id: 'position', label: 'SLA Status', icon: IconGrid },
  { id: 'exceptions', label: 'SLA exceptions', icon: IconAlert },
  { id: 'pack', label: 'Governance pack', icon: IconDoc },
];

/**
 * Screens are addressable: "#dashboard", "#data-sources", "#2026-08/exceptions", with a
 * trailing "/intel" opening the intelligence panel over whatever is underneath.
 */
function parseHash() {
  const raw = window.location.hash.replace('#', '');
  const intel = raw === 'intelligence' || raw.endsWith('/intel');
  const [a, route] = raw.replace(/\/intel$/, '').split('/');
  const b = route === 'status' ? 'position' : route;
  if (/^\d{4}-\d{2}$/.test(a)) return { page: 'month', month: a, view: VIEWS.some((v) => v.id === b) ? b : 'position', intel };
  if (a === 'data-sources' || a === 'extracts') return { page: 'extracts', month: null, view: 'position', intel };
  return { page: 'dashboard', month: null, view: 'position', intel };
}

export default function App() {
  const initial = parseHash();
  const [boot, setBoot] = useState(null);
  const [page, setPage] = useState(initial.page);
  const [month, setMonth] = useState(initial.month);
  const [view, setView] = useState(initial.view);
  const [intelOpen, setIntelOpen] = useState(initial.intel);
  const [analysis, setAnalysis] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const notify = useCallback((message, bad = false) => {
    setToast({ message, bad });
    setTimeout(() => setToast(null), 3600);
  }, []);

  const loadBoot = useCallback(async () => {
    const b = await api.bootstrap();
    setBoot(b);
    return b;
  }, []);

  useEffect(() => {
    loadBoot().catch((e) => setError(e.message));
  }, [loadBoot]);

  useEffect(() => {
    const apply = () => {
      const h = parseHash();
      setPage(h.page);
      setMonth(h.month);
      if (h.page === 'month') setView(h.view);
      setIntelOpen(h.intel);
    };
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  useEffect(() => {
    const base = page === 'month' ? `${month}/${view === 'position' ? 'status' : view}` : page === 'extracts' ? 'data-sources' : page;
    const want = `#${intelOpen ? (page === 'month' ? `${base}/intel` : 'intelligence') : base}`;
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
  }, [page, month, view, intelOpen]);

  useEffect(() => {
    if (page !== 'month' || !month) return setAnalysis(null);
    let cancelled = false;
    setAnalysis(null);
    api.analysis(month)
      .then((a) => !cancelled && setAnalysis(a))
      .catch((e) => !cancelled && notify(e.message, true));
    return () => { cancelled = true; };
  }, [page, month, notify, boot?.snapshot?.generated_at]);

  const openMonth = useCallback((key, preferred) => {
    setPage('month');
    setMonth(key);
    if (preferred) setView(preferred);
  }, []);

  const showDashboard = useCallback(() => { setPage('dashboard'); setMonth(null); }, []);
  const showExtracts = useCallback(() => { setPage('extracts'); setMonth(null); }, []);

  if (error) {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="empty-icon"><IconAlert size={26} /></div>
        <h3>Cannot reach the API</h3>
        <p>{error}. Start it with <code>npm run dev</code> and reload.</p>
      </div>
    );
  }
  if (!boot) return <div className="empty" style={{ paddingTop: 140 }}><span className="spinner" /></div>;

  const snapshot = boot.snapshot;
  const activeMonth = boot.months.find((m) => m.month === month);
  const currentView = VIEWS.find((v) => v.id === view);
  const title = page === 'dashboard' ? 'Governance dashboard' : page === 'extracts' ? 'Data Sources' : currentView?.label;

  return (
    <div className="app">
      <Rail
        boot={boot}
        page={page}
        month={month}
        view={view}
        views={VIEWS}
        analysis={analysis}
        onOpenMonth={openMonth}
        onDashboard={showDashboard}
        onExtracts={showExtracts}
        onSelectView={setView}
      />

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{title}</h1>
            {page === 'month' && (
              <span className="topbar-sub">
                {activeMonth?.label ?? month}
                {activeMonth?.partial && ' · incomplete period'}
              </span>
            )}
          </div>
          <div className="stamp">
            <IconClock />
            {snapshot ? (
              <span>
                Data source as of <b>{snapshot.as_of_label}</b> · built {fmtStamp(snapshot.generated_at)}
              </span>
            ) : (
              <span>No data sources loaded</span>
            )}
          </div>
        </header>

        <div className="page">
          {page === 'month' && activeMonth && view !== 'pack' && (
            <div className="row wrap no-print" style={{ justifyContent: 'space-between', gap: 12 }}>
              <span className="tiny muted">Review and export this month’s findings for sharing.</span>
              <button className="btn btn-soft btn-sm" onClick={() => setView('pack')}>
                <IconDoc /> Governance pack
              </button>
            </div>
          )}
          {page === 'dashboard' && <Dashboard boot={boot} onOpenMonth={openMonth} onExtracts={showExtracts} />}

          {page === 'extracts' && <Extracts boot={boot} onChanged={loadBoot} toast={notify} onOpenDashboard={showDashboard} />}

          {page === 'month' && !activeMonth && (
            <div className="card empty">
              <div className="empty-icon"><IconAlert size={26} /></div>
              <h3>No pack for {month}</h3>
              <p>The loaded data sources contain no measured policies for this period.</p>
            </div>
          )}
          {page === 'month' && activeMonth && !analysis && (
            <div className="empty" style={{ paddingTop: 60 }}><span className="spinner" /></div>
          )}
          {page === 'month' && analysis && view === 'position' && <Position analysis={analysis} slas={boot.slas} />}
          {page === 'month' && analysis && view === 'exceptions' && <Exceptions analysis={analysis} slas={boot.slas} />}
          {page === 'month' && analysis && view === 'pack' && <Pack analysis={analysis} slas={boot.slas} />}

          {page === 'month' && analysis && (
            <div className="row no-print" style={{ justifyContent: 'space-between', paddingTop: 4 }}>
              <span className="tiny muted">
                Built from {analysis.sources.length} data source file{analysis.sources.length === 1 ? '' : 's'} as of{' '}
                {analysis.as_of_label} · every figure calculated by rule from the records, not inferred
              </span>
              <button className="btn btn-ghost btn-sm" onClick={showExtracts}>Manage data sources</button>
            </div>
          )}
        </div>
      </main>

      {/* Intelligence entry point — docked to the right edge, hidden while the panel is open. */}
      <button
        className={`intel-dock no-print${intelOpen ? ' is-hidden' : ''}`}
        onClick={() => setIntelOpen(true)}
        title="Open operational intelligence"
      >
        <span className="intel-dock-icon"><IconSpark size={16} /></span>
        <span style={{ textAlign: 'left' }}>
          <span className="intel-dock-label" style={{ display: 'block' }}>Intelligence</span>
          <span className="intel-dock-sub">Trends · causes · backlog</span>
        </span>
      </button>

      <Intelligence open={intelOpen} onClose={() => setIntelOpen(false)} version={snapshot?.generated_at} />

      {toast && <div className={`toast${toast.bad ? ' is-bad' : ''}`}>{toast.message}</div>}
    </div>
  );
}
