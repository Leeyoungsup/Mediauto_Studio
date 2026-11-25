import { useCallback, useEffect, useRef, useState } from 'react';
import { api, auditAttemptId, jsonBody } from './session';

export type Model = { key: string; name: string; version: string; markers: string[]; checkpoint: string | null };
export type Catalog = { models: Model[]; markers: Record<string, string> };
type Status = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type Run = { id: string; model: string; model_version: string; attempt: number; status: Status; origin: 'manual' | 'rule';
  scan_id: string; request_id: string; result: { kind: string; dimensions?: number[]; calibrated?: boolean;
    snapshot?: { id: string; kind: string; model: string; model_version: string; score_type: string; analysis_version: string } } | null;
  error: string | null; created_at: string; started_at?: string; finished_at?: string };
type Rule = { id: string; model: string; marker: string; active: boolean; version: number };
type Scan = { id: string; slide: string; marker: string; specimen_id: string; specimen: string };
type Interpretation = 'positive' | 'negative' | 'indeterminate' | 'uninterpretable';
type Review = { id: string; version: number; marker: string; specimen_id: string; scan_id: string; block_id: string;
  block_number: string; interpretation: Interpretation; rationale: string; reviewed_by: string; run_id: string | null; created_at: string };
type IhcData = { can_review: boolean; markers: Record<string, string>; scans: Scan[];
  blocks: { id: string; number: string; specimen_id: string }[]; runs: Run[]; history: Review[] };
type RunData = { runs: Run[]; can_manage: boolean; models: Model[] };
type RuleData = Catalog & { rules: Rule[] };
export const runStatuses = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
export const interpretations = { positive: 'Positive', negative: 'Negative', indeterminate: 'Indeterminate', uninterpretable: 'Uninterpretable' };
export const modelNames: Record<string, string> = { pdl1_cps_archive: 'PD-L1 CPS Archive Replay',
  pdl1_tps_archive: 'PD-L1 TPS Archive Replay', ihc_preflight: 'IHC Image Preflight' };
export const markerNames: Record<string, string> = { pdl1: 'PD-L1', er: 'ER', pr: 'PR', her2: 'HER2', ki67: 'Ki-67' };
export const runErrors: Record<string, string> = { archive_unavailable: 'No matching archived original is available for this model and scan.',
  model_unavailable: 'The pinned model version is unavailable.', scan_changed: 'The registered scan, stain, or QC status changed.',
  scan_unavailable: 'The scan could not be read.', timeout: 'The operation timed out.', worker_interrupted: 'The worker was interrupted.',
  adapter_error: 'The local adapter failed.' };
const message = (value: unknown) => value instanceof Error ? value.message : 'Unable to update analysis.';
const timestamp = (value: string) => new Date(value).toLocaleString('en-US');

function useData<T>(path: string, poll = false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    async function load() {
      try {
        const fetched = await api<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(fetched); setError(''); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(message(failure));
      } finally {
        if (poll && !controller.signal.aborted) timer = window.setTimeout(load, 1500);
      }
    }
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [path, revision, poll]);
  return { data, error, refresh };
}

function Problem({ error, retry }: { error: string; retry: () => void }) {
  return error ? <div className="notice" role="alert">{error}<button className="button secondary" onClick={retry}>Reload</button></div> : null;
}

export function ModelRuns({ endpoint, caseId, onChanged }: { endpoint: string; caseId: string | null; onChanged: () => void }) {
  const resource = useData<RunData>(endpoint, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastStatus = useRef<string | undefined>(undefined);
  const submission = useRef<{ payload: string; key: string } | undefined>(undefined);
  const latest = resource.data?.runs[0];

  useEffect(() => {
    if (!latest) return;
    const state = latest.id + ':' + latest.status;
    if (lastStatus.current && lastStatus.current !== state) onChanged();
    lastStatus.current = state;
  }, [latest, onChanged]);

  async function act(run: Run, action: 'cancel' | 'rerun') {
    const payload = { run_id: run.id, action };
    const serialized = JSON.stringify(payload);
    if (submission.current?.payload !== serialized) submission.current = { payload: serialized, key: auditAttemptId() };
    setBusy(true); setError('');
    try {
      await api(endpoint, jsonBody('POST', payload, { 'Idempotency-Key': submission.current.key }));
      submission.current = undefined;
      resource.refresh(); onChanged();
    } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }

  return <section className="panel detail-content model-runs" aria-label="Model Runs">
    <h2>Model Runs</h2>
    <Problem error={resource.error || error} retry={resource.refresh} />
    {!resource.data && !resource.error && <p role="status">Loading model runs…</p>}
    {resource.data && <ul className="timeline">{resource.data.runs.map((run) => <li key={run.id}>
      <h3>{modelNames[run.model] ?? run.model} · {run.model_version}</h3>
      <p>Attempt {run.attempt} · {runStatuses[run.status]} · {run.origin === 'rule' ? 'Pre-run Rule' : 'Requested'} · {timestamp(run.created_at)}</p>
      {run.error && <p className="muted">{runErrors[run.error] ?? 'The model run failed.'}</p>}
      {run.result?.kind === 'image_preflight' && <p>Image preflight complete · {run.result.dimensions?.join(' × ')} px · {run.result.calibrated ? 'Calibrated' : 'Pixel size unavailable'}</p>}
      {run.result?.snapshot && <p>Archived original · {run.result.snapshot.model} · {run.result.snapshot.model_version ?? 'Model Version Unavailable'} · {run.result.snapshot.analysis_version ?? 'Analysis Version Unavailable'}</p>}
      {caseId && run.result?.snapshot && <a className="button secondary" href={`#viewer/${caseId}/${run.scan_id}/${run.result.snapshot.id}`}>Open Pinned Result in WSI</a>}
      {resource.data?.can_manage && run.id === latest?.id && (
        run.status === 'queued' || run.status === 'running' ? <button className="button secondary" disabled={busy}
          onClick={() => void act(run, 'cancel')}>Cancel Model Run</button> :
        <button className="button secondary" disabled={busy} onClick={() => void act(run, 'rerun')}>Rerun Pinned Model</button>)}
    </li>)}</ul>}
  </section>;
}

export function AnalysisSettings({ organization }: { organization: string }) {
  const endpoint = `/api/clinical/${encodeURIComponent(organization)}/analysis-rules`;
  const resource = useData<RuleData>(endpoint);
  const [model, setModel] = useState('');
  const [marker, setMarker] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const selected = resource.data?.models.find((item) => item.key === model);
  async function save(ruleModel: string, ruleMarker: string, active: boolean, version: number) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(endpoint, jsonBody('PUT', { model: ruleModel, marker: ruleMarker, active, version }));
      setNotice(active ? 'Pre-run rule enabled.' : 'Pre-run rule disabled.');
      resource.refresh();
    } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }
  return <section className="panel detail-content" aria-label="Analysis Pre-run Rules">
    <h2>Analysis Pre-run Rules</h2>
    <p>Enabled rules queue one local job per registered, QC-passed scan and model before case review starts. Archived replay and preflight run on this server.</p>
    <Problem error={resource.error || error} retry={resource.refresh} />
    {notice && <p role="status">{notice}</p>}
    {resource.data && <>
      <form aria-label="Add Analysis Rule" className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(model, marker, true, 0); }}>
        <label className="form-field">Rule Model<select value={model} onChange={(event) => { setModel(event.target.value); setMarker(''); }} required>
          <option value="">Select a model</option>{resource.data.models.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}
        </select></label>
        <label className="form-field">Rule Marker<select value={marker} onChange={(event) => setMarker(event.target.value)} required>
          <option value="">Select a marker</option>{selected?.markers.map((value) => <option key={value} value={value}>{markerNames[value]}</option>)}
        </select></label>
        <button className="button primary" disabled={busy || !marker || resource.data.rules.some((rule) => rule.model === model && rule.marker === marker)}>Enable Pre-run Rule</button>
      </form>
      <ul className="timeline">{resource.data.rules.map((rule) => <li key={rule.id}>
        <div>{modelNames[rule.model]} · {markerNames[rule.marker]} · {rule.active ? 'Enabled' : 'Disabled'}</div>
        <button className="button secondary" disabled={busy} onClick={() => void save(rule.model, rule.marker, !rule.active, rule.version)}>
          {rule.active ? 'Disable Rule' : 'Enable Rule'}</button>
      </li>)}</ul>
    </>}
  </section>;
}

export function IhcReviews({ endpoint, caseId }: { endpoint: string; caseId: string }) {
  const resource = useData<IhcData>(endpoint);
  const [scanId, setScan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submission = useRef<{ payload: string; key: string } | undefined>(undefined);
  const data = resource.data;
  const selected = data?.scans.find((scan) => scan.id === scanId);
  const current = selected && data?.history.find((review) => review.specimen_id === selected.specimen_id && review.marker === selected.marker);
  const blocks = selected ? data?.blocks.filter((block) => block.specimen_id === selected.specimen_id) ?? [] : [];
  const runs = selected ? data?.runs.filter((run) => run.scan_id === selected.id) ?? [] : [];

  return <section className="panel detail-content ihc-reviews" aria-label="IHC Review">
    <h2>IHC Review and Best Block</h2>
    <Problem error={resource.error || error} retry={resource.refresh} />
    {notice && <p role="status">{notice}</p>}
    {data?.can_review && <label className="form-field">IHC Scan<select value={scanId} onChange={(event) => setScan(event.target.value)}>
      <option value="">Select an IHC scan</option>{data.scans.map((scan) => <option key={scan.id} value={scan.id}>{scan.specimen} · {scan.slide} · {markerNames[scan.marker]}</option>)}
    </select></label>}
    {selected && !blocks.length && <p>Register a block for this specimen in Case Editor.</p>}
    {selected && blocks.length > 0 && <form key={selected.id + ':' + (current?.version ?? 0)} className="request-form" aria-label="Record IHC Review"
      onSubmit={async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const payload = { scan_id: selected.id, version: current?.version ?? 0, interpretation: fields.get('interpretation'),
          block_id: fields.get('block'), run_id: fields.get('run') || null, rationale: fields.get('rationale') };
        const serialized = JSON.stringify(payload);
        if (submission.current?.payload !== serialized) submission.current = { payload: serialized, key: auditAttemptId() };
        setBusy(true); setError(''); setNotice('');
        try {
          await api(endpoint, jsonBody('POST', payload, { 'Idempotency-Key': submission.current.key }));
          submission.current = undefined;
          setNotice('IHC review saved to Result Evidence.'); resource.refresh();
        } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
      }}>
      <label className="form-field">Interpretation<select name="interpretation" defaultValue={current?.interpretation ?? ''} required>
        <option value="">Select an interpretation</option>{Object.entries(interpretations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="form-field">Best Block<select name="block" required defaultValue={current?.block_id ?? ''}>
        <option value="">Select a block</option>{blocks.map((block) => <option key={block.id} value={block.id}>{block.number}</option>)}
      </select></label>
      <label className="form-field">Completed Model Run<select name="run" defaultValue={runs.some((run) => run.id === current?.run_id) ? current?.run_id ?? '' : ''}>
        <option value="">None</option>{runs.map((run) => <option key={run.id} value={run.id}>{modelNames[run.model]} · {run.model_version} · Attempt {run.attempt}</option>)}
      </select></label>
      <label className="form-field">Review Rationale<textarea name="rationale" maxLength={240} required /></label>
      <button className="button primary" disabled={busy}>{current ? 'Save IHC Review Revision' : 'Save IHC Review'}</button>
    </form>}
    {!!data?.history.length && <ul className="timeline">{data.history.map((review) => <li key={review.id}>
      <strong>{markerNames[review.marker]} · {interpretations[review.interpretation]} · Best Block {review.block_number} · Version {review.version}</strong>
      <p>{review.rationale} · {timestamp(review.created_at)}</p>
      <a href={`#viewer/${caseId}/${review.scan_id}`}>Open IHC Slide</a>
    </li>)}</ul>}
    {data && !data.history.length && <p className="muted">No IHC reviews recorded.</p>}
  </section>;
}
