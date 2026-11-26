import { useEffect, useMemo, useState } from 'react';
import { BiomarkerEvidence, type AssayInput, type ValidationEvidence } from './biomarker-evidence';
import { CellOverlay } from './cell-overlay';
import { api } from './session';
import type { Viewport } from './tile-viewer';

type Point = [x: number, y: number, category: number];
type Cells = { points: Point[]; truncated: boolean };
type Audit = { action: string; actor: string; occurred_at: string; source: 'ims' | 'exported'; reference?: string };
type ScoreStatus = 'archived' | 'native' | 'validated_original' | 'validated_pair' | 'input_unverified' | 'invalid_saved_score' | 'edited_score_unverified';
type Comparison = {
  status: 'available' | 'validation_required' | 'insufficient_scores';
  pair: { cps_snapshot_id: string; tps_snapshot_id: string; reference: string; reviewed_by: string;
    cps_reference: string; tps_reference: string; reference_results_verified: boolean } | null;
};
type Result = {
  id: string; kind: 'original' | 'edited'; original_id: string | null; variant: 'Stomach' | 'Lung';
  score_type: 'CPS' | 'TPS'; score: number | null; score_status: ScoreStatus; counts: Record<string, number>;
  classes: Record<string, { label: string; color: string }>; point_count: number; dimensions: [number, number];
  model: string | null; model_version: string | null; architecture: string | null; model_bytes: number | null;
  model_mtime_ns: string | null; analysis_version: string | null; source_digest: string; editor: string | null;
  input_context?: AssayInput | null; evidence?: ValidationEvidence | null;
  contract: { schema: string | null; model: string | null; native_histology: string[] };
  saved_at: string | null; audit: Audit[]; checkpoint_sha256?: string | null;
};

const typeLabel = { original: 'Original', edited: 'User Edit' };
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const rangeSize = 512;

export function usePdl1(endpoint: string, ready: boolean, view: Viewport | undefined, initialSnapshot?: string) {
  const [data, setData] = useState<{ results: Result[]; comparison: Comparison }>();
  const results = data?.results;
  const [selected, selectResult] = useState(initialSnapshot ?? '');
  const [pinned, setPinned] = useState(initialSnapshot);
  const requested = pinned ?? initialSnapshot;
  function setSelected(id: string) {
    setPinned(undefined);
    selectResult(id);
  }
  function openSnapshot(id: string) {
    setPinned(id);
    selectResult(id);
    setEnabled(true);
    setAttempt((count) => count + 1);
  }
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(false);
  const [overlayError, setOverlayError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [overlay, setOverlay] = useState<{ id: string; cells: Cells }>();
  const result = results?.find((item) => item.id === selected);
  const width = result?.dimensions[0] ?? 0;
  const height = result?.dimensions[1] ?? 0;
  const snapStart = (value: number) => Math.max(0, Math.floor(value / rangeSize) * rangeSize);
  const left = view ? snapStart(view.x) : 0;
  const top = view ? snapStart(view.y) : 0;
  const right = view ? Math.min(width, Math.ceil((view.x + view.width) / rangeSize) * rangeSize) : 0;
  const bottom = view ? Math.min(height, Math.ceil((view.y + view.height) / rangeSize) * rangeSize) : 0;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setError(false);
    api<NonNullable<typeof data>>(endpoint + '/pdl1', { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response);
        const entries = response.results;
        selectResult((id) => entries.some((entry) => entry.id === id) ? id : requested ?? entries[0]?.id ?? '');
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [endpoint, ready, attempt, requested]);

  useEffect(() => {
    if (!ready || !selected || !enabled || left >= right || top >= bottom) return;
    const controller = new AbortController();
    setOverlayError(false);
    const query = new URLSearchParams({ left: String(left), top: String(top), right: String(right), bottom: String(bottom) });
    const timer = window.setTimeout(() => {
      api<Cells>(`${endpoint}/pdl1/${selected}/cells?${query}`, { signal: controller.signal })
        .then((cells) => { if (!controller.signal.aborted) setOverlay({ id: selected, cells }); })
        .catch(() => { if (!controller.signal.aborted) { setOverlay(undefined); setOverlayError(true); } });
    }, 100);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [endpoint, ready, selected, enabled, left, top, right, bottom, attempt]);

  return { results, result, referenceMissing: Boolean(requested && selected === requested && results && !result), comparison: data?.comparison, selected, setSelected, openSnapshot, enabled, setEnabled, error, overlayError,
    retry: () => setAttempt((count) => count + 1), cells: ready && enabled && overlay?.id === selected ? overlay.cells : undefined };
}

type Pdl1State = ReturnType<typeof usePdl1>;

export function Pdl1Overlay({ view, result, cells, mpp }: { view?: Viewport; result?: Result; cells?: Cells; mpp?: number | null }) {
  const colors = useMemo(() => Object.fromEntries(Object.entries(result?.classes ?? {})
    .map(([key, value]) => [key, value.color])), [result]);
  return <CellOverlay view={view} colors={colors} points={result ? cells?.points : undefined} label="PD-L1 Cell Overlay" mpp={mpp} />;
}

const scoreStatusLabel: Record<ScoreStatus, string> = {
  archived: 'Archived Score · Input Details Unverified',
  native: 'Original Saved Score',
  validated_original: 'Original Linked to Reference Result',
  validated_pair: 'Saved Score Linked to Validation Evidence',
  input_unverified: 'Input or Combination Requires Validation',
  invalid_saved_score: 'Saved Score Unavailable',
  edited_score_unverified: 'Edited Score Unverified',
};

export function Pdl1Badge({ state }: { state: Pdl1State }) {
  const { result, results, comparison } = state;
  if (!result) return null;
  const pair = comparison?.pair;
  const ids = pair ? [pair.cps_snapshot_id, pair.tps_snapshot_id] : [];
  const pairResults = ids.map((id) => results?.find((item) => item.id === id));
  const shown = ids.includes(result.id) && pairResults.every((item) => item?.score != null)
    ? pairResults as Result[] : [result];
  return <aside className="pdl1-score" aria-label="PD-L1 Score Card">
    {shown.map((item) => <div key={item.id}>
      <span>PD-L1 · {item.score_type} · {typeLabel[item.kind]}</span>
      <strong>{item.score == null ? '—' : number.format(item.score) + (item.score_type === 'TPS' ? '%' : '')}</strong>
      <small>{scoreStatusLabel[item.score_status]}</small>
    </div>)}
  </aside>;
}

export function Pdl1Panel({ state, reportHref, onSlide }: { state: Pdl1State; reportHref?: string; onSlide: () => void }) {
  const { results, result, selected, setSelected, enabled, setEnabled, error, overlayError, retry, cells, comparison, referenceMissing } = state;
  return <section className="pdl1-panel" aria-label="PD-L1 Results">
    <div className="pdl1-heading"><h2>PD-L1</h2>
      <div className="actions">
        {result && <label className="pdl1-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Cell Overlay</label>}
        <button type="button" className="button secondary" onClick={onSlide}>Return to WSI</button>
      </div>
    </div>
    {error ? <div role="alert">Unable to load PD-L1 results. <button className="button secondary" onClick={retry}>Reload</button></div>
      : !results ? <p role="status">Checking PD-L1 results…</p>
      : referenceMissing ? <div role="alert">Unable to open the referenced PD-L1 result.
        {results[0] && <button className="button secondary" onClick={() => setSelected(results[0].id)}>View Other Results</button>}</div>
      : !result ? <p>There are no PD-L1 results linked to this scan.</p>
      : <>
        {reportHref && <div className="actions"><a className="button secondary" href={reportHref}>Open Report Draft</a></div>}
        <label className="form-field">Result Version<select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {results.map((entry) => <option key={entry.id} value={entry.id}>{entry.score_type} · {typeLabel[entry.kind]}{entry.editor ? ` · ${entry.editor}` : ''} · {entry.id.slice(0, 8)}</option>)}
        </select></label>
        {comparison?.status === 'validation_required' && <p role="status">Displaying CPS and TPS together requires verified input conditions and validation evidence for this scan.</p>}
        {comparison?.status === 'insufficient_scores' && <p>No pair of results meets the requirements for combined display.</p>}
        {comparison?.pair && <details className="pdl1-audit"><summary>Combined Display Validation Evidence</summary>
          <p>{comparison.pair.reference} · Reviewed by {comparison.pair.reviewed_by}</p>
          <p>CPS Reference {comparison.pair.cps_reference} · TPS Reference {comparison.pair.tps_reference}</p>
          <p>{comparison.pair.reference_results_verified ? 'Both reference results verified' : 'Comparison record linked'} · Cell markers follow the selected result</p>
        </details>}
        <BiomarkerEvidence input={result.input_context} evidence={result.evidence}
          schema={result.contract.schema ?? 'Unsupported Schema'} model={result.contract.model ?? undefined}
          scope={result.contract.native_histology.map((value) => value === 'nsclc' ? 'Non-Small Cell Lung Cancer' : 'Gastric Adenocarcinoma').join(', ') || 'Unavailable'} />
        <div className="pdl1-metadata">
          <dl className="key-values"><div><dt>Model</dt><dd>{result.model ?? 'No record'}</dd></div>
            <div><dt>Model Version</dt><dd>{result.model_version ?? 'No record'}</dd></div>
            {result.architecture && <div><dt>Architecture</dt><dd>{result.architecture}</dd></div>}
            {result.model_mtime_ns && <div><dt>Weights File Record</dt><dd title={result.model_mtime_ns}>{date.format(new Date(Number(result.model_mtime_ns) / 1e6))}{result.model_bytes ? ` · ${number.format(result.model_bytes)} B` : ''}</dd></div>}
            {result.checkpoint_sha256 && <div><dt>Checkpoint SHA-256</dt><dd title={result.checkpoint_sha256}>{result.checkpoint_sha256.slice(0, 12)}</dd></div>}
            <div><dt>Saved Analysis Version</dt><dd>{result.analysis_version ?? 'No record'}</dd></div>
            <div><dt>Result Fingerprint</dt><dd title={result.source_digest}>{result.source_digest.slice(0, 12)}</dd></div>
            {result.original_id && <div><dt>Linked Original</dt><dd>{result.original_id.slice(0, 12)}{' '}
              {results.some((item) => item.id === result.original_id) && <button type="button" className="button secondary"
                onClick={() => setSelected(result.original_id!)}>View Original</button>}</dd></div>}
            {result.editor && <div><dt>Edited By · Saved At</dt><dd>{result.editor} · {result.saved_at ? date.format(new Date(result.saved_at)) : 'No record'}</dd></div>}
          </dl>
        </div>
        <ul className="pdl1-legend">{Object.entries(result.classes).map(([key, item]) => <li key={key}><i style={{ background: item.color }} />
          <span>{item.label}{key in result.counts && ` · ${number.format(result.counts[key])}`}</span>
        </li>)}</ul>
        {enabled && cells?.truncated && <p role="status">Only some cell markers are visible in this area. Zoom in to see more.</p>}
        {enabled && overlayError && <p role="alert">Unable to load cell markers. <button className="button secondary" onClick={retry}>Reload</button></p>}
        <details className="pdl1-audit"><summary>Audit History</summary>
          {result.audit.filter((entry) => entry.source === 'exported').length === 0 && <p>No source audit history is available.</p>}
          <ul className="timeline">{result.audit.map((entry, index) => <li key={`${entry.occurred_at}-${index}`}>
            <strong>{entry.action === 'snapshot_imported' ? 'IMS Read-Only Import' : entry.action}</strong>
            <span> · {entry.actor} · {date.format(new Date(entry.occurred_at))}{entry.reference ? ` · ${entry.reference}` : ''}</span>
          </li>)}</ul>
        </details>
      </>}
  </section>;
}
