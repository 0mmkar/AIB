import Logo from '../components/Logo.jsx';
import { Status } from '../components/Chips.jsx';
import { SlaTable, QualityPanel, DriversPanel } from './Position.jsx';
import { IconDownload } from '../components/Icons.jsx';
import { fmtRate, fmtTarget, fmtGap, fmtCount, fmtStamp, fmtBytes } from '../lib/format.js';
import { POLICY_COUNT_NOTE } from '../lib/customerCopy.js';

/**
 * The governance pack. Rendered as a document rather than a dashboard and styled for print,
 * so "export" is the browser's own PDF engine — real page breaks, vector text, selectable
 * content. Every sentence in it is composed from the computed figures.
 */
export default function Pack({ analysis, slas }) {
  const { results, summary: s, quality, quality_summary: qs, sources } = analysis;
  const headline = results.filter((r) => !r.parent);
  const failing = results.filter((r) => r.status === 'FAIL');
  const failingHeadline = headline.filter((r) => r.status === 'FAIL');
  const serious = qs.red + qs.amber;

  return (
    <div className="card pack-page" style={{ padding: '34px 38px' }}>
      <div className="row wrap no-print" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <span className="tiny muted">Choose “Save as PDF” in the print window to download and share this report.</span>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <IconDownload /> Export as PDF
        </button>
      </div>

      {/* ---------------------------------------------------------- masthead */}
      <div style={{ borderBottom: '2px solid var(--violet)', paddingBottom: 16, marginBottom: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <Logo height={34} plate={false} />
            <div style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--violet-700)', fontWeight: 700, marginTop: 12 }}>
              Service Governance · Schedule 23
            </div>
            <h1 style={{ fontSize: 25, marginTop: 7 }}>Monthly SLA Governance Pack</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 5 }}>
              Reporting period: <b style={{ color: 'var(--ink)' }}>{analysis.label}</b>
              {analysis.partial && <> · <b style={{ color: '#c9741a' }}>incomplete at the data source date</b></>}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>
            <div>Data source as of <b style={{ color: 'var(--ink)' }}>{analysis.as_of_label}</b></div>
            <div>{sources.length} data source files · {fmtCount(s.measured)} policies measured</div>
            <div>Generated {fmtStamp(analysis.generated_at)} · supersedes prior builds</div>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- executive summary */}
      <Section title="1. Executive summary">
        <p style={{ fontSize: 13, lineHeight: 1.72, color: 'var(--ink-2)' }}>
          Of the {s.total} Schedule 23 service levels for {analysis.label}, <b>{s.pass}</b> met target
          {failingHeadline.length > 0 ? (
            <>
              {' '}and <b style={{ color: 'var(--red)' }}>{failingHeadline.length} missed</b>:{' '}
              {failingHeadline.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && (i === failingHeadline.length - 1 ? ' and ' : ', ')}
                  {r.label} at {fmtRate(r.rateCompleted)} against {fmtRate(r.target, 0)}
                </span>
              ))}.
            </>
          ) : (
            <>; none missed.</>
          )}{' '}
          {s.noData > 0 && <>{s.noData} had no completed policies, so no rate and no verdict. </>}
          Of {fmtCount(s.measured)} policies measured, {fmtCount(s.missed)} missed their deadline and{' '}
          {fmtCount(s.openPastDeadline)} were still open past it on {analysis.as_of_label}; those open policies sit outside the
          pass/fail rate but are listed as exceptions.{' '}
          {analysis.partial && <>The period was still running when the data source snapshot was taken, so its figures will move. </>}
          {serious > 0 && <>{serious} data-quality finding{serious === 1 ? '' : 's'} affect the evidence and are set out in section 4.</>}
        </p>

        <div className="stat-row" style={{ marginTop: 16 }}>
          <Tile label="Met target" value={s.pass} colour="var(--green)" />
          <Tile label="Missed target" value={s.fail} colour="var(--red)" />
          <Tile label="Policies measured" value={fmtCount(s.measured)} colour="var(--ink)" />
          <Tile label="Missed policies" value={fmtCount(s.missed)} colour="var(--red)" />
          <Tile label="Open overdue" value={fmtCount(s.openPastDeadline)} colour="#c9741a" />
        </div>
      </Section>

      {/* --------------------------------------------------- full sla position */}
      <Section title="2. SLA Status">
        <SlaTable results={results} slas={slas} compact />
        <p className="tiny muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Rate (completed) = met ÷ (met + missed), and decides pass or fail. Rate incl. open also counts policies open past
          their deadline at the data source date as not met. 23B UL is the combined result of Steps 1–3.
          {' '}{POLICY_COUNT_NOTE}
        </p>
      </Section>

      {/* ------------------------------------------------------- exceptions */}
      <Section title="3. Exceptions">
        {failing.length === 0 ? (
          <p className="tiny muted">No service level missed target in this period.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Service level</th><th className="num">Target</th><th className="num">Rate</th><th className="num">Gap</th><th className="num">Missed</th><th className="num">Open overdue</th><th>Status</th></tr>
            </thead>
            <tbody>
              {failing.map((r) => (
                <tr key={r.id}>
                  <td className="metric-name">{r.parent && <span className="child-mark">↳</span>}{r.label} · {r.name}</td>
                  <td className="num muted">{fmtTarget(r.target)}</td>
                  <td className="num" style={{ color: 'var(--red)' }}>{fmtRate(r.rateCompleted)}</td>
                  <td className="num" style={{ color: 'var(--red)' }}>{fmtGap(r.rateCompleted, r.target)}</td>
                  <td className="num">{fmtCount(r.missed)}</td>
                  <td className="num">{fmtCount(r.openPastDeadline)}</td>
                  <td><Status status={r.status} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {analysis.drivers?.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="tiny" style={{ fontWeight: 650, marginBottom: 8, color: 'var(--ink-2)' }}>Where failures concentrate</div>
            <DriversPanel drivers={analysis.drivers} slas={slas} limit={3} />
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------- data quality */}
      <Section title="4. Data quality and evidence gaps">
        <QualityPanel flags={quality} slas={slas} emptyText="No data-quality issues were found in the evidence." />
      </Section>

      {/* ------------------------------------------------- evidence appendix */}
      <Section title="5. Evidence — data source files used">
        <table className="table">
          <thead>
            <tr><th>File as received</th><th>Identified as</th><th className="num">Records</th><th>Feeds</th><th>Loaded</th></tr>
          </thead>
          <tbody>
            {sources.map((f) => (
              <tr key={f.id}>
                <td>
                  <div className="file-name" style={{ maxWidth: 300 }}>{f.filename}</div>
                  <div className="metric-sub">{fmtBytes(f.bytes)} · header on row {f.headerRow}</div>
                </td>
                <td className="tiny">{f.label}{f.kind === 'workflow' ? ` (${f.covers.map((c) => c.replace('workflow-', '')).join(' + ')} policies)` : ''}</td>
                <td className="num">{fmtCount(f.records)}</td>
                <td className="tiny muted">{[...new Set(slas.filter((d) => d.sources?.includes(f.kind) && !d.parts).map((d) => d.label))].join(', ')}</td>
                <td className="tiny muted">{fmtStamp(f.uploadedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny muted" style={{ marginTop: 14, lineHeight: 1.6 }}>
          Each file was identified from its own columns. Every figure in this pack is calculated by the Schedule 23 rules in
          SLA_Expected_Results.xlsx — business days, Irish public holidays, the 15:00 cut-off and the 48-hour cancellation
          limit — from the records in these files. No figure is model-generated.
        </p>
      </Section>

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 26, paddingTop: 14, fontSize: 10.5, color: 'var(--ink-4)', lineHeight: 1.6 }}>
        AIB Life · SLA Governance Pack · {analysis.label} · Data source as of {analysis.as_of_label} · generated {fmtStamp(analysis.generated_at)}.
        This pack replaces any previously generated version for this reporting period.
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 26, breakInside: 'avoid' }}>
      <h2 style={{ fontSize: 14, marginBottom: 12, color: 'var(--violet-700)' }}>{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, value, colour }) {
  return (
    <div className="stat" style={{ padding: '13px 15px' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: colour, fontSize: 23 }}>{value}</div>
    </div>
  );
}
