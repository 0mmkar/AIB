import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { SourceChip } from '../components/Chips.jsx';
import { QualityPanel } from './Position.jsx';
import { IconCloud, IconCheck, IconCircleDash, IconX, IconInfo } from '../components/Icons.jsx';
import { styleFor, styleForExtract } from '../lib/sources.js';
import { fmtBytes, fmtCount, fmtStamp } from '../lib/format.js';

const PHASES = ['Reading columns', 'Identifying the data source', 'Scoring every service level', 'Building the monthly packs'];

/**
 * The data sources. The source files are one snapshot covering many months, so they are
 * loaded here once and every month's pack is rebuilt from them — there is no per-month upload.
 */
export default function Extracts({ boot, onChanged, toast, onOpenDashboard }) {
  const [data, setData] = useState(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async () => setData(await api.extracts()), []);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load, toast]);

  useEffect(() => {
    if (!pending.length) return;
    const t = setInterval(() => {
      setPending((rows) => rows.map((r) => ({ ...r, phase: Math.min(PHASES.length - 1, r.phase + 1) })));
    }, 380);
    return () => clearInterval(t);
  }, [pending.length]);

  async function run(action, label) {
    setBusy(true);
    try {
      const res = await action();
      await Promise.all([load(), onChanged()]);
      return res;
    } catch (err) {
      toast(err.message, true);
      return null;
    } finally {
      setBusy(false);
      setPending([]);
      if (label) toast(label);
    }
  }

  async function send(files) {
    const list = [...files].filter((f) => /\.(xlsx|csv)$/i.test(f.name));
    if (!list.length) return toast('Only .csv and .xlsx data sources can be loaded', true);
    setPending(list.map((f, i) => ({ tempId: `${Date.now()}-${i}`, name: f.name, size: f.size, phase: 0 })));
    const res = await run(() => api.upload(list));
    if (!res) return;
    if (res.skipped?.length) toast(`${res.skipped[0].filename}: ${res.skipped[0].error}`, true);
    else if (res.added.length) toast(`${res.added.length} data source${res.added.length === 1 ? '' : 's'} loaded — packs rebuilt`);
  }

  if (!data) return <div className="empty" style={{ paddingTop: 60 }}><span className="spinner" /></div>;

  const { extracts, slots, snapshot } = data;
  const present = slots.filter((s) => s.present).length;

  return (
    <div className="ingest-grid">
      {/* ------------------------------------------------------------ intake */}
      <div className="card card-pad">
        <div
          className={`dropzone${over ? ' is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
          onClick={() => fileInput.current?.click()}
        >
          <div className="dropzone-icon"><IconCloud /></div>
          <div className="dropzone-title">Drop data sources here</div>
          <div className="dropzone-hint">
            .csv or .xlsx, in any order. Each file is identified from its columns; a newer file for the same
            data source replaces the older one, and every monthly pack is rebuilt.
          </div>
          <span className="btn btn-primary btn-sm" style={{ marginTop: 4 }}>Browse files</span>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".xlsx,.csv"
            style={{ display: 'none' }}
            onChange={(e) => { send(e.target.files); e.target.value = ''; }}
          />
        </div>

        <div className="expected">
          <div className="expected-head">Data sources received · {present} of {slots.length}</div>
          {slots.map((s) => {
            const st = styleFor(s.id);
            return (
              <div key={s.id} className={`expected-row ${s.present ? 'is-present' : 'is-missing'}`} title={s.filename ?? 'Not supplied'}>
                <span className="src-mark" style={{ background: s.present ? st.colour : '#d7d3ea' }}>{st.mark}</span>
                <span className="name">{s.label}</span>
                <span className="expected-tick" style={{ color: s.present ? st.colour : 'var(--ink-4)' }}>
                  {s.present ? <IconCheck size={15} /> : <IconCircleDash size={15} />}
                </span>
              </div>
            );
          })}
        </div>

        <div className="row wrap" style={{ marginTop: 18, gap: 8 }}>
          <button className="btn btn-soft btn-sm" onClick={() => run(() => api.loadBundled(), 'Delivered data sources reloaded')} disabled={busy}>
            Reload delivered data sources
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.rebuild(), 'All packs rebuilt')} disabled={busy || !extracts.length}>
            Rebuild packs
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- the extract set */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Loaded data sources</h2>
            <div className="sub">
              {snapshot
                ? `As of ${snapshot.as_of_label} · ${snapshot.months.length} reporting periods (${snapshot.months[0]} to ${snapshot.months[snapshot.months.length - 1]}) · ${fmtCount(snapshot.measured)} policies measured`
                : 'No data sources loaded yet'}
            </div>
          </div>
          {snapshot && (
            <button className="btn btn-primary" onClick={onOpenDashboard}>Open dashboard</button>
          )}
        </div>

        <div className="file-list">
          {pending.map((p) => (
            <div key={p.tempId} className="file-row is-working">
              <span className="src-mark" style={{ background: 'var(--ink-4)', width: 34, height: 34 }}>··</span>
              <div className="file-main">
                <div className="file-name-line">
                  <span className="file-name">{p.name}</span>
                  {p.size != null && <span className="file-meta">{fmtBytes(p.size)}</span>}
                </div>
                <div className="file-why"><span className="phase-text">{PHASES[p.phase]}…</span></div>
              </div>
              <div className="file-actions"><span className="spinner" /></div>
            </div>
          ))}

          {!pending.length && !extracts.length && (
            <div className="empty">
              <div className="empty-icon"><IconCloud size={30} /></div>
              <h3>No data sources loaded</h3>
              <p>
                Drop the data sources on the left, or reload the delivered set. EBQ feeds 23B NUL and UL Step 1,
                CANREVEXT feeds 23C, WITHDRAWALEXT feeds UL Step 2, and the two WRKFLWEXT files feed 23A, UL Steps 2–3,
                23C and 23E.
              </p>
            </div>
          )}

          {extracts.map((e) => {
            const st = styleForExtract(e);
            const slotLabels = e.covers.map((c) => slots.find((s) => s.id === c)?.label ?? c);
            return (
              <div key={e.id} className="file-row">
                <span className="src-mark" style={{ background: st.colour, width: 34, height: 34, fontSize: 12 }}>{st.mark}</span>
                <div className="file-main">
                  <div className="file-name-line">
                    <span className="file-name" title={e.filename}>{e.filename}</span>
                    <SourceChip sourceId={e.covers.length === 1 ? e.covers[0] : e.kind} label={slotLabels.join(' + ')} />
                  </div>
                  <div className="file-why">
                    <span className="muted">{fmtCount(e.records)} records · header on row {e.headerRow} · {e.columns} columns · {fmtBytes(e.bytes)}</span>
                    {e.title && <span className="why-chip">{e.title}</span>}
                    <span className="muted">· loaded {fmtStamp(e.uploadedAt)}</span>
                  </div>
                </div>
                <div className="file-actions">
                  <button className="icon-btn" onClick={() => run(() => api.removeExtract(e.id), `${e.filename} removed — packs rebuilt`)} disabled={busy} title="Remove data source">
                    <IconX />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {snapshot && (
          <div className="card-pad" style={{ borderTop: '1px solid var(--line-2)' }}>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <IconInfo />
              <span className="tiny muted">
                Data source date <b style={{ color: 'var(--ink)' }}>{snapshot.as_of_label}</b>, read from the content: {snapshot.as_of_source}.
                Open policies are judged overdue against it.
              </span>
            </div>
            <QualityPanel flags={snapshot.quality} slas={boot.slas} emptyText="No issues found in the data sources." />
          </div>
        )}
      </div>
    </div>
  );
}
