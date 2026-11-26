import { useEffect, useRef, useState } from 'react';
import { BiomarkerEvidence, type AssayInput, type ValidationEvidence } from './biomarker-evidence';
import { CellOverlay } from './cell-overlay';
import { api, jsonBody } from './session';
import type { Viewport } from './tile-viewer';

type Marker = 'ki67' | 'er' | 'pr' | 'her2';
type Source = {
  id: string; marker: Marker; model: string; model_version: string; analysis_version: string;
  score_schema?: 'her2-intensity-v1' | 'her2-membrane-patterns-v1'; input_context?: AssayInput | null;
  checkpoint_sha256: string | null; default_threshold: number; dimensions: [number, number];
};
type Revision = { version: number; action: 'edit' | 'restore'; reason: string; created_at: string; actor: string | null; threshold: number };
type Aggregate = { kind: 'ki67' | 'allred'; percent: number; positive: number; total: number; score?: number; proportion?: number; intensity?: number } | { kind: 'her2-intensity-v1' | 'her2-membrane-patterns-v1'; value: number; unit: string | null };
type Details = {
  version: number; latest_version: number; threshold: number; counts: number[]; override_count: number;
  history: Revision[]; status: 'approval_required' | 'insufficient_cells' | 'source_replay_unverified' | 'edited_score_unverified' | 'available';
  evidence?: ValidationEvidence | null;
  count_basis: 'original' | 'review';
  approval: string | null; rule: string | null; aggregate: Aggregate | null;
};
type Point = [x: number, y: number, grade: number, id: number, confidence: number, original: number, reviewed: boolean];
type Cells = { points: Point[]; truncated: boolean };

const markers = { ki67: 'Ki-67', er: 'ER', pr: 'PR', her2: 'HER2' };
const stainingLabels = ['Negative', 'Weak (1+)', 'Moderate (2+)', 'Strong (3+)', 'Other / Excluded'];
const her2Labels = {
  'her2-intensity-v1': ['Intensity 0+', 'Intensity 1+', 'Intensity 2+', 'Intensity 3+'],
  'her2-membrane-patterns-v1': ['Absent', 'Partial Weak', 'Partial Strong', 'Complete Weak', 'Complete Strong'],
};
const classLabels = (source?: Source) => source?.score_schema ? her2Labels[source.score_schema] : stainingLabels;
const colors = ['#44c5e4', '#efdb57', '#f3904a', '#ff4078', '#ded9ec'];
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const defaultViewport = { x: 0, y: 0, width: 0, height: 0 };

function reviewKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, (value, index) => ([4, 6, 8, 10].includes(index) ? '-' : '') + value.toString(16).padStart(2, '0')).join('');
}

export function useIhcResults(endpoint: string, ready: boolean, view?: Viewport) {
  const [list, setList] = useState<{ endpoint: string; results: Source[]; can_review: boolean }>();
  const [data, setData] = useState<{ key: string; details: Details }>();
  const [overlay, setOverlay] = useState<{ key: string; cells: Cells }>();
  const [sourceId, setSourceId] = useState('');
  const [version, setVersion] = useState<number>();
  const [enabled, setEnabled] = useState(true);
  const [listError, setListError] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [overlayError, setOverlayError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Point>();
  const [decision, setDecision] = useState<{ id: number; grade: string }>();
  const results = list?.endpoint === endpoint ? list.results : undefined;
  const source = results?.find((item) => item.id === sourceId) ?? results?.[0];
  const base = source && endpoint + '/ihc/' + source.id;
  const detailKey = base && base + (version === undefined ? '' : '?version=' + version);
  const details = data?.key === detailKey ? data?.details : undefined;
  const { x, y, width, height } = view ?? defaultViewport;
  const left = Math.max(0, Math.floor(x / 512) * 512);
  const top = Math.max(0, Math.floor(y / 512) * 512);
  const right = Math.min(source?.dimensions[0] ?? 0, Math.ceil((x + width) / 512) * 512);
  const bottom = Math.min(source?.dimensions[1] ?? 0, Math.ceil((y + height) / 512) * 512);
  const cellKey = base && details && `${base}/cells?version=${details.version}&left=${left}&top=${top}&right=${right}&bottom=${bottom}`;
  const cells = enabled && overlay?.key === cellKey ? overlay?.cells : undefined;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setListError(false);
    api<{ results: Source[]; can_review: boolean }>(endpoint + '/ihc', { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setList({ ...response, endpoint }); })
      .catch(() => { if (!controller.signal.aborted) setListError(true); });
    return () => controller.abort();
  }, [endpoint, ready, attempt]);

  useEffect(() => {
    if (!ready || !detailKey) return;
    const controller = new AbortController();
    setDetailsError(false);
    api<Details>(detailKey, { signal: controller.signal })
      .then((details) => { if (!controller.signal.aborted) setData({ key: detailKey, details }); })
      .catch(() => { if (!controller.signal.aborted) setDetailsError(true); });
    return () => controller.abort();
  }, [ready, detailKey, attempt]);

  useEffect(() => {
    if (!ready || !enabled || !cellKey || left >= right || top >= bottom) return;
    const controller = new AbortController();
    setOverlayError(false);
    const timer = window.setTimeout(() => {
      api<Cells>(cellKey, { signal: controller.signal })
        .then((cells) => { if (!controller.signal.aborted) setOverlay({ key: cellKey, cells }); })
        .catch(() => { if (!controller.signal.aborted) setOverlayError(true); });
    }, 100);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [ready, enabled, cellKey, left, top, right, bottom, attempt]);

  function resetSelection() {
    setPicking(false);
    setPicked(undefined);
    setDecision(undefined);
  }

  function pickAt(x: number, y: number) {
    if (!view || !cells) return;
    let nearest: Point | undefined;
    let distance = 9;
    for (const point of cells.points) {
      const current = Math.hypot(point[0] - x, point[1] - y) * view.zoom;
      if (current < distance) { nearest = point; distance = current; }
    }
    if (nearest) setPicked(nearest);
    return nearest;
  }

  const visible = (cells?.points ?? []).filter(([px, py]) => px >= x && px < x + width && py >= y && py < y + height);
  return { source, results, details, base, cells, visible, picking, pickAt, picked, setPicking, setPicked, decision, setDecision,
    canReview: list?.endpoint === endpoint && list.can_review && version === undefined,
    enabled, version, failed: listError || detailsError || overlayError,
    setEnabled(value: boolean) { resetSelection(); setEnabled(value); },
    selectSource(id: string) { resetSelection(); setVersion(undefined); setSourceId(id); },
    selectVersion(value?: number) { resetSelection(); setVersion(value); },
    reload() { setAttempt((n) => n + 1); },
  };
}

type IhcState = ReturnType<typeof useIhcResults>;

export function IhcOverlay({ state, view, mpp }: { state: IhcState; view?: Viewport; mpp?: number | null }) {
  if (!state.source) return null;
  const { decision, picked } = state;
  const previewGrade = picked && decision && decision.id === picked[3] && decision.grade !== ''
    ? decision.grade === 'original' ? picked[5] : Number(decision.grade)
    : undefined;
  return <CellOverlay view={view} points={state.cells?.points} colors={colors}
    label={markers[state.source.marker] + ' Cell Overlay'} selected={picked} previewGrade={previewGrade} mpp={mpp} />;
}

export function IhcCellMenu({ state, close, x, y }: { state: IhcState; close: () => void; x: number; y: number }) {
  const cell = state.picked;
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { menu.current?.focus({ preventScroll: true }); }, []);
  if (!cell || !state.canReview) return null;
  const grades = classLabels(state.source);
  function choose(grade: string) {
    if (cell) state.setDecision({ id: cell[3], grade });
    close();
  }
  return <div className="ihc-cell-menu" role="group" aria-label="Edit Cell on Slide" ref={menu} tabIndex={-1}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (/^[1-5]$/.test(event.key) && Number(event.key) <= grades.length) {
        event.preventDefault();
        choose(String(Number(event.key) - 1));
      }
    }}
    style={{ left: x, top: y }}>
    <header><strong>Cell {cell[3] + 1}</strong><button type="button" className="icon-button" aria-label="Close Cell Menu" onClick={close}>×</button></header>
    <small>Original {grades[cell[5]]}</small>
    {grades.map((label, grade) => <button key={label} type="button" className="button secondary"
      aria-keyshortcuts={String(grade + 1)} onClick={() => choose(String(grade))}><i style={{ background: colors[grade] }} />{label}</button>)}
    {cell[6] && <button type="button" className="button secondary" onClick={() => choose('original')}>Clear User Decision</button>}
  </div>;
}

function Score({ details }: { details: Details }) {
  const score = details.aggregate;
  if (!score) {
    const status = {
      approval_required: 'Aggregation Approval Required',
      insufficient_cells: 'Insufficient Tumor Cells for Approved Aggregation',
      source_replay_unverified: 'Score unavailable. Stored detection confidence does not reproduce the original cell counts.',
      edited_score_unverified: 'Edited HER2 Score Unverified',
      available: 'Score Unavailable',
    };
    return <p role="status">{status[details.status]}</p>;
  }
  if ('value' in score) return <div className="ihc-score">
    <strong>{score.kind === 'her2-intensity-v1' ? 'HER2 Weighted Intensity' : 'HER2 Composite'} · {score.value}{score.unit === 'percent' ? '%' : ''}</strong>
    <small>Archived Model Output · {details.evidence?.reference}</small>
  </div>;
  return <div className="ihc-score">
    <strong>{score.kind === 'ki67' ? `Ki-67 Index · ${number.format(score.percent)}%` : `Allred Score · ${score.score}/8`}</strong>
    <span>{number.format(score.positive)} / {number.format(score.total)} included tumor cells
      {score.kind === 'allred' && ` · ${number.format(score.percent)}% positive · Proportion ${score.proportion} · Intensity ${score.intensity}`}</span>
    <small>{details.rule} · {details.approval}</small>
  </div>;
}

function ReviewForm({ state, details, onPickStart }: { state: IhcState; details: Details; onPickStart: () => void }) {
  const [threshold, setThreshold] = useState(String(details.threshold));
  const { decision, setDecision } = state;
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<{ body: string; key: string }>(undefined);
  const grades = classLabels(state.source);
  const picked = state.picked;
  const grade = decision && decision.id === picked?.[3] ? decision.grade : '';
  const changed = threshold !== '' && Number(threshold) !== details.threshold;
  const restoreAvailable = details.override_count > 0 || details.threshold !== state.source?.default_threshold;

  async function save(action: 'edit' | 'restore') {
    const body = { action, reason: reason.trim(), expected_version: details.latest_version,
      ...(action === 'edit' && changed ? { threshold: Number(threshold) } : {}),
      ...(action === 'edit' && picked && grade !== '' ? { changes: { [picked[3]]: grade === 'original' ? null : Number(grade) } } : {}) };
    const key = JSON.stringify(body);
    if (request.current?.body !== key) request.current = { body: key, key: reviewKey() };
    setError('');
    setBusy(true);
    try {
      await api(state.base + '/revisions', jsonBody('POST', { ...body, request_key: request.current.key }));
      state.selectVersion(undefined);
      setReason('');
      setDecision(undefined);
      state.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save IHC review.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="ihc-review-form" onSubmit={(event) => { event.preventDefault(); void save('edit'); }}>
    <label className="form-field">Minimum Detection Confidence
      <input type="number" min="0" max="1" step="any" value={threshold} required disabled={busy} onChange={(event) => setThreshold(event.target.value)} />
    </label>
    <div className="ihc-cell-actions">
      <button type="button" className="button secondary" aria-pressed={state.picking} disabled={!state.enabled || busy}
        onClick={() => { if (!state.picking) onPickStart(); state.setPicking(!state.picking); }}>
        {state.picking ? 'Stop Picking Cells' : 'Pick Cell on Slide'}
      </button>
      <label className="form-field">Visible Cell
        <select value={picked?.[3] ?? ''} disabled={!state.enabled || busy} onChange={(event) => {
          state.setPicked(state.visible.find((point) => String(point[3]) === event.target.value)); setDecision(undefined);
        }}>
          <option value="">Choose a Cell</option>
          {picked && !state.visible.slice(0, 100).some((cell) => cell[3] === picked[3]) && <option value={picked[3]}>Cell {picked[3] + 1}</option>}
          {state.visible.slice(0, 100).map((cell) => <option value={cell[3]} key={cell[3]}>Cell {cell[3] + 1} · {grades[cell[2]]}</option>)}
        </select>
      </label>
      {picked && <div><small>Cell {picked[3] + 1} · Original {grades[picked[5]]} · Confidence {picked[4].toFixed(4)}</small>
        <label className="form-field">User Cell Grade
          <select key={picked[3]} value={grade} disabled={busy} onChange={(event) => setDecision({ id: picked[3], grade: event.target.value })}>
            <option value="">Keep {grades[picked[2]]}</option>
            {grades.map((value, index) => <option key={value} value={index}>{value}</option>)}
            {picked[6] && <option value="original">Clear User Decision</option>}
          </select>
        </label>{grade !== '' && <small role="status">Pending Cell Edit · Save IHC Review to record it.</small>}</div>}
    </div>
    {state.picking && <p role="status">Select a marked cell on the slide. Zoom in to distinguish nearby markers.</p>}
    <label className="form-field">Review Reason
      <input value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} required disabled={busy} />
    </label>
    <div className="ihc-cell-actions">
      <button className="button primary" disabled={busy || !reason.trim() || (!changed && !(picked && grade !== ''))}>Save IHC Review</button>
      <button type="button" className="button secondary" disabled={busy || !restoreAvailable || !reason.trim()} onClick={() => void save('restore')}>Restore Original</button>
    </div>
    {error && <p className="notice" role="alert">{error} <button className="button secondary" type="button" onClick={state.reload}>Reload Review</button></p>}
  </form>;
}

export function IhcPanel({ state, readOnly, onPickStart, showEmpty, caseRequestsHref, onSlide }: {
  state: IhcState; readOnly: boolean; onPickStart: () => void; showEmpty?: boolean; caseRequestsHref?: string; onSlide: () => void;
}) {
  const { source, details } = state;
  const grades = classLabels(source);
  if (!source && !state.failed && !showEmpty) return null;
  return <section className="pdl1-panel ihc-panel" aria-label="IHC Results">
    <div className="pdl1-heading"><h2>{source ? markers[source.marker] + ' Results' : 'IHC Results'}</h2>
      <div className="actions">
        {source && <label className="pdl1-toggle"><input type="checkbox" checked={state.enabled} onChange={(event) => state.setEnabled(event.target.checked)} /> IHC Cell Overlay</label>}
        <button type="button" className="button secondary" onClick={onSlide}>Return to WSI</button>
      </div>
    </div>
    {state.failed && <p className="notice" role="alert">Unable to load IHC results or cell markers. <button className="button secondary" onClick={state.reload}>Retry IHC</button></p>}
    {!source && !state.failed && (state.results ? <p>No IHC result is linked to this scan.</p> : <p role="status">Checking IHC results…</p>)}
    {source && caseRequestsHref && <div className="actions"><a className="button secondary" href={caseRequestsHref}>IHC Review and Best Block</a></div>}
    {source && <div className="ihc-controls">
      {(state.results?.length ?? 0) > 1 && <label className="form-field">IHC Source Analysis
        <select value={source.id} onChange={(event) => state.selectSource(event.target.value)}>
          {state.results?.map((item) => <option value={item.id} key={item.id}>{markers[item.marker]} · {item.analysis_version} · {item.id.slice(0, 8)}</option>)}
        </select></label>}
      <label className="form-field">IHC Result Version
        <select value={state.version ?? 'latest'} onChange={(event) => state.selectVersion(event.target.value === 'latest' ? undefined : Number(event.target.value))}
          disabled={!details}>
          <option value="latest">Latest{details ? ' · ' + (details.latest_version ? 'Revision ' + details.latest_version : 'Original') : ''}</option>
          <option value={0}>Original</option>
          {details?.history.map((row) => <option value={row.version} key={row.version}>Revision {row.version} · {row.action === 'restore' ? 'Restored Original' : 'User Review'}</option>)}
        </select></label>
    </div>}
    {source && !details && !state.failed && <p role="status">Loading IHC result…</p>}
    {source && details && <>
      <Score details={details} />
      {source.score_schema && <BiomarkerEvidence input={source.input_context} evidence={details.evidence}
        schema={source.score_schema} scope="Invasive Breast Carcinoma with a Verified HER2 Assay and Analysis Region" />}
      <p>{details.count_basis === 'original' ? 'Archived Counts' : 'Recount from Stored Detections'} · Confidence threshold {details.threshold}
        {' · '}{details.override_count} user decisions</p>
      {source.score_schema === 'her2-intensity-v1' && <p>Archived Intensity Classes</p>}
      {source.score_schema === 'her2-membrane-patterns-v1' && <p>Membrane Staining Patterns</p>}
      <ul className="pdl1-legend" aria-label="Included IHC Cell Counts">{grades.map((grade, index) =>
        <li key={grade}><i style={{ background: colors[index] }} />{grade} · {number.format(details.counts[index])}</li>)}</ul>
      {details.status === 'source_replay_unverified' && <p>Markers near the stored confidence cutoff may differ from the original count.</p>}
      {state.cells?.truncated && <p role="status">Cell display is limited in this area. Zoom in for additional markers.</p>}
      <details className="pdl1-audit"><summary>Model and Source</summary>
        <p>{source.model} · {source.model_version}</p><p>Analysis {source.analysis_version}</p>
        <p className="ihc-digest">Source {source.id}</p>
        {source.checkpoint_sha256 && <p className="ihc-digest">Checkpoint {source.checkpoint_sha256}</p>}
      </details>
      {details.history.length > 0 && <details className="pdl1-audit"><summary>IHC Review History</summary>
        <ol className="timeline">{details.history.map((row) => <li key={row.version}>
          <strong>Revision {row.version} · {row.action === 'restore' ? 'Restored Original' : 'User Review'}</strong>
          <p>{row.actor ?? 'Former User'} · {date.format(new Date(row.created_at))} · Confidence {row.threshold}</p>
          <p className="audit-reason">{row.reason}</p>
        </li>)}</ol></details>}
      {state.canReview && !readOnly && <ReviewForm key={source.id + ':' + details.version} state={state} details={details} onPickStart={onPickStart} />}
    </>}
  </section>;
}
