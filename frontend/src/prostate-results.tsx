import { useEffect, useRef, useState } from 'react';
import { api } from './session';
import type { Viewport } from './tile-viewer';
import type { Point } from './viewer-tools';

type Kind = 'tissue' | 'tumor' | 'pni';
type Region = { id: string; kind: Kind; points: Point[] };
type Output = 'core_length' | 'tumor_length' | 'grade_group' | 'pni';
type Length = { value: number; unit: 'mm' | 'um'; mm: number; method: keyof typeof methods };
type Finding = {
  status: 'verified' | 'unsupported' | 'not_reported' | 'unverified';
  value: Length | number | keyof typeof pniLabels | null;
  evidence: { reference: string; review_version: string; reviewed_by: string; reviewed_at: string } | null;
};
type CoreLevel = { core_id: string; level_id: string; regions: Region[]; findings: Record<Output, Finding> };
type Analysis = {
  id: string; schema_version: string; analysis_version: string; analyzed_at: string;
  input: { organ: string; specimen_type: string; stain: string; protocol: string };
  model: { name: string; version: string; checkpoint_sha256: string };
  capabilities: string[]; core_levels: CoreLevel[];
};
type Feed = { status: 'available' | 'not_linked' | 'stain_unverified'; results: Analysis[] };

const regions = { tissue: 'Tissue', tumor: 'Tumor', pni: 'PNI' };
const fields: Record<Output, string> = { core_length: 'Core Length', tumor_length: 'Tumor Length', grade_group: 'Grade Group', pni: 'PNI' };
const statusLabels = { unsupported: 'Model Does Not Support This Output', not_reported: 'No Output for This Core and Level',
  unverified: 'Reference Verification Required', verified: '' };
const methods = { single_focus: 'Single Focus', continuous_span: 'Continuous Span', sum_of_foci: 'Sum of Foci', core_axis: 'Core Axis' };
const pniLabels = { present: 'Present', not_identified: 'Not Identified', indeterminate: 'Indeterminate' };
const number = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function useProstateResults(endpoint: string, active: boolean) {
  const [feed, setFeed] = useState<{ endpoint: string; data: Feed }>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [analysisId, setAnalysisId] = useState('');
  const [rowIndex, setRowIndex] = useState(0);
  const [regionId, setRegionId] = useState('');
  const [overlay, setOverlay] = useState(true);
  const data = feed?.endpoint === endpoint ? feed.data : undefined;
  const analysis = data?.results.find((model) => model.id === analysisId) ?? data?.results[0];
  const row = analysis?.core_levels[rowIndex] ?? analysis?.core_levels[0];

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError(false);
    api<Feed>(endpoint + '/prostate', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setFeed({ endpoint, data }); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [endpoint, active, attempt]);

  return { data, analysis, row, rowIndex, error, overlay, regionId, setOverlay, setRegionId,
    chooseAnalysis(id: string) { setAnalysisId(id); setRowIndex(0); setRegionId(''); },
    chooseRow(index: number) { setRowIndex(index); setRegionId(''); },
    refresh() { setFeed(undefined); setRegionId(''); setAttempt((current) => current + 1); },
  };
}

type State = ReturnType<typeof useProstateResults>;

export function ProstateOverlay({ state, view }: { state: State; view?: Viewport }) {
  if (!view || !state.overlay || !state.row?.regions.length) return null;
  return <svg className="prostate-overlay" aria-label="Prostate AI Regions"
    viewBox={`0 0 ${view.width * view.zoom} ${view.height * view.zoom}`}>
    {state.row.regions.map((region) => <polygon key={region.id} data-region={region.id}
      className={`prostate-region-${region.kind}${region.id === state.regionId ? ' is-selected' : ''}`}
      points={region.points.map(([x, y]) => `${(x - view.x) * view.zoom},${(y - view.y) * view.zoom}`).join(' ')}>
      <title>{regions[region.kind]} · {region.id}</title>
    </polygon>)}
  </svg>;
}

function FindingValue({ finding }: { finding: Finding }) {
  if (finding.value === null) return <span>{statusLabels[finding.status]}</span>;
  if (typeof finding.value === 'number') return <span>{finding.value}</span>;
  if (typeof finding.value === 'string') return <span>{pniLabels[finding.value]}</span>;
  return <span>{number.format(finding.value.mm)} mm · {methods[finding.value.method]}
    {finding.value.unit === 'um' && ` · Source ${number.format(finding.value.value)} µm`}</span>;
}

export function ProstatePanel({ state, canNavigate, focus }: { state: State; canNavigate: boolean; focus: (points: Point[]) => void }) {
  const { data, analysis, row } = state;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  return <section className="pdl1-panel prostate-panel" tabIndex={-1} ref={panel} aria-label="Prostate AI Results">
    <div className="pdl1-heading"><h2>Prostate AI Results</h2>
      <div className="actions">
        {row && <label className="pdl1-toggle"><input type="checkbox" checked={state.overlay}
          onChange={(event) => state.setOverlay(event.target.checked)} /> Region Overlay</label>}
        {data && <button type="button" className="button secondary" onClick={state.refresh}>Refresh Prostate Results</button>}
      </div>
    </div>
    {state.error ? <p role="alert">Unable to verify prostate AI results for this scan.
      {' '}<button type="button" className="button secondary" onClick={state.refresh}>Retry Prostate Results</button></p>
      : !data ? <p role="status">Loading prostate AI results…</p>
      : data.status === 'stain_unverified' ? <p>Prostate AI requires a registered H&amp;E scan.</p>
      : !analysis ? <p>No prostate AI results linked to this scan.</p>
      : row && <>
        <div className="ihc-controls">
          {data.results.length > 1 && <label className="form-field">Prostate Analysis
            <select value={analysis.id} onChange={(event) => state.chooseAnalysis(event.target.value)}>
              {data.results.map((item) => <option key={item.id} value={item.id}>
                {item.model.name} · {item.analysis_version} · {item.id.slice(0, 8)}</option>)}
            </select></label>}
          <label className="form-field">Core and Level
            <select value={state.rowIndex < analysis.core_levels.length ? state.rowIndex : 0}
              onChange={(event) => state.chooseRow(Number(event.target.value))}>
              {analysis.core_levels.map((item, index) => <option key={item.core_id + ':' + item.level_id} value={index}>
                Core {item.core_id} · Level {item.level_id}</option>)}
            </select>
          </label>
          <button type="button" className="button secondary" disabled={!canNavigate || !row.regions.length}
            onClick={() => { state.setOverlay(true); state.setRegionId(''); focus(row.regions.flatMap((region) => region.points)); }}>
            Focus Core and Level
          </button>
        </div>
        <dl className="key-values prostate-findings">
          {(Object.keys(fields) as Output[]).map((key) => <div key={key}><dt>{fields[key]}</dt><dd>
            <FindingValue finding={row.findings[key]} />
            {row.findings[key].evidence && <small>{row.findings[key].evidence.reference} · Review {row.findings[key].evidence.review_version}</small>}
          </dd></div>)}
        </dl>
        <div className="prostate-region-controls">
          {(Object.keys(regions) as Kind[]).map((kind) => {
            const matching = row.regions.filter((region) => region.kind === kind);
            if (!matching.length) return <p key={kind}>{regions[kind]} regions · {analysis.capabilities.includes(kind + '_region')
              ? 'No Output for This Core and Level' : 'Model Does Not Support This Output'}</p>;
            return <div key={kind} className="actions">{matching.map((region) => <button key={region.id} type="button"
              className="button secondary" disabled={!canNavigate} aria-pressed={state.regionId === region.id}
              onClick={() => { state.setRegionId(region.id); state.setOverlay(true); focus(region.points); }}>
              {regions[kind]} · {region.id}
            </button>)}</div>;
          })}
        </div>
        <details className="pdl1-audit"><summary>Model and Evidence Versions</summary>
          <dl className="key-values">
            <div><dt>Input</dt><dd>Prostate Needle Biopsy · H&amp;E · {analysis.input.protocol}</dd></div>
            <div><dt>Model</dt><dd>{analysis.model.name} · {analysis.model.version}</dd></div>
            <div><dt>Analysis</dt><dd>{analysis.analysis_version} · {date.format(new Date(analysis.analyzed_at))}</dd></div>
            <div><dt>Output Schema</dt><dd>{analysis.schema_version}</dd></div>
            <div><dt>Checkpoint SHA-256</dt><dd>{analysis.model.checkpoint_sha256}</dd></div>
            <div><dt>Archive SHA-256</dt><dd>{analysis.id}</dd></div>
            {(Object.keys(fields) as Output[]).map((key) => {
              const evidence = row.findings[key].evidence;
              return evidence && <div key={key}><dt>{fields[key]} Reference</dt><dd>{evidence.reference} · Review {evidence.review_version}
                {' · '}{evidence.reviewed_by} · {date.format(new Date(evidence.reviewed_at))}</dd></div>;
            })}
          </dl>
        </details>
      </>}
  </section>;
}
