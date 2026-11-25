import { useEffect, useRef, useState } from 'react';
import { Eye, FlaskConical, X } from 'lucide-react';
import { modelNames, runErrors, runStatuses } from './analysis-execution';
import type { Model, Run } from './analysis-execution';
import { api, auditAttemptId, jsonBody } from './session';
import { withCollection } from './workflow-navigation';
import type { CollectionOrigin } from './workflow-navigation';

type Option = Model & { available: boolean };
type ScanRun = Run & { can_manage: boolean };
type ScanAnalysis = { models: Option[]; runs: ScanRun[] };
const active = (run: ScanRun) => run.status === 'queued' || run.status === 'running';
const message = (error: unknown) => error instanceof Error ? error.message : 'The analysis request could not be completed.';

export function ViewerAnalysis({ caseEndpoint, scanId, label, stain, format, collectionOrigin, onClose, onResult }: {
  caseEndpoint: string; scanId: string; label: string; stain: string; format: string; collectionOrigin?: CollectionOrigin; onClose: () => void; onResult: (id: string) => void;
}) {
  const endpoint = caseEndpoint + '/scans/' + scanId + '/analysis';
  const [data, setData] = useState<ScanAnalysis>();
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selected, select] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const submission = useRef<{ signature: string; key: string } | undefined>(undefined);
  const close = useRef<HTMLButtonElement>(null);
  const pending = data?.runs.some(active) ?? false;
  const refresh = () => { setRefreshing(true); setRevision((value) => value + 1); };

  useEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<ScanAnalysis>(endpoint, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setData(result); setLoadError(''); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [endpoint, revision]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const result = await api<Pick<ScanAnalysis, 'runs'>>(endpoint + '?include_models=false', { signal: controller.signal });
        if (!controller.signal.aborted) {
          setData((current) => current && { ...current, runs: result.runs });
          setLoadError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(message(error));
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 1200);
      }
    }
    timer = window.setTimeout(poll, 900);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [endpoint, pending, revision]);

  const choices = data?.models.filter((model) => model.available) ?? [];
  const model = choices.length === 1 ? choices[0] : choices.find((choice) => choice.key === selected);
  const running = Boolean(model && data?.runs.some((run) => run.model === model.key && active(run)));

  async function send(path: string, payload: object, success: string) {
    if (busy || refreshing) return;
    const signature = JSON.stringify([path, payload]);
    if (submission.current?.signature !== signature) submission.current = { signature, key: auditAttemptId() };
    setBusy(true); setActionError(''); setNotice('');
    try {
      await api(path, jsonBody('POST', payload, { 'Idempotency-Key': submission.current.key }));
      submission.current = undefined;
      setNotice(success);
      refresh();
    } catch (error) { setActionError(message(error)); }
    finally { setBusy(false); }
  }

  return <aside className="viewer-analysis" aria-label="Slide Analysis" id="viewer-analysis-panel"
    onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); } }}>
    <div className="viewer-analysis-heading">
      <div><h2>Slide Analysis</h2><p>{label} · {stain} · {format} · Scan {scanId.slice(0, 8)}</p></div>
      <button ref={close} className="icon-button" type="button" aria-label="Close Slide Analysis" onClick={onClose} disabled={busy}><X size={18} /></button>
    </div>
    {loadError && <div className="notice" role="alert">{loadError} <button type="button" className="button secondary" onClick={refresh}>Reload Analysis</button></div>}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data && !loadError && <p role="status">Checking analysis options…</p>}
    {data && <>
      {choices.length > 0 ? <form className="viewer-analysis-form" onSubmit={(event) => {
        event.preventDefault();
        if (!model || running) return;
        void send(caseEndpoint + '/requests?reuse_active=true', {
          kind: 'ai', scan_id: scanId, execution_model: model.key, question: 'Viewer analysis: ' + model.name,
        }, 'Analysis queued.');
      }}>
        <label className="form-field">Analysis Method<select value={model?.key ?? ''} disabled={busy} onChange={(event) => select(event.target.value)}>
          {choices.length > 1 && <option value="">Select a method</option>}
          {choices.map((entry) => <option value={entry.key} key={entry.key}>{entry.name}</option>)}
        </select></label>
        {model && <div className="analysis-method-summary">
          <strong>{model.version}</strong><p>{model.checkpoint ? 'Archive Replay · Opens a matching stored result.' : 'Image Preflight · Checks image readability and pixel calibration.'}</p>
        </div>}
        <button type="submit" className="button primary" disabled={busy || refreshing || running || !model || Boolean(loadError)}><FlaskConical size={15} /> Run Analysis</button>
        {running && <span role="status">This method already has an active run.</span>}
      </form> : <p>No runnable analysis method for this scan. Review available results from the scan toolbar.</p>}
      {data.models.some((entry) => !entry.available) && <div className="analysis-unavailable-methods">
        <h3>Unavailable Methods</h3>
        {data.models.filter((entry) => !entry.available).map((entry) =>
          <div key={entry.key}><p>{entry.name} · No matching archived result</p><small className="muted">{entry.version}</small></div>)}
      </div>}
      <div className="viewer-analysis-heading"><h3>Recent Runs</h3>
        <button type="button" className="button secondary" onClick={refresh} disabled={busy}>Refresh</button>
      </div>
      {!data.runs.length && <p className="muted">No runs for this scan.</p>}
      <ul className="viewer-analysis-runs">{data.runs.map((run) => <li key={run.id}>
        <strong>{modelNames[run.model] ?? run.model}</strong>
        <div className="analysis-run-state" data-state={run.status}>{runStatuses[run.status]} · Attempt {run.attempt} · {run.model_version}</div>
        <small className="muted">{run.origin === 'rule' ? 'Pre-run Rule' : 'Manual Request'}</small>
        {run.error && <p>{runErrors[run.error] ?? 'The analysis run failed.'}</p>}
        {run.result?.kind === 'image_preflight' && <p>{run.result.dimensions?.join(' × ')} px · {run.result.calibrated ? 'Calibrated' : 'Pixel size unavailable'}</p>}
        <div className="viewer-analysis-actions">
          {run.status === 'completed' && run.result?.snapshot && <button type="button" className="button primary" disabled={busy}
            onClick={() => onResult(run.result!.snapshot!.id)}><Eye size={15} /> Show Result on Slide</button>}
          {run.can_manage && <button type="button" className="button secondary" disabled={busy || refreshing || Boolean(loadError)} onClick={() =>
            void send(caseEndpoint.split('/cases/')[0] + '/requests/' + run.request_id + '/execution',
              { run_id: run.id, action: active(run) ? 'cancel' : 'rerun' }, active(run) ? 'Run cancelled.' : 'Rerun queued.')}>
            {active(run) ? 'Cancel Run' : 'Rerun'}</button>}
          <a className="button secondary" href={withCollection(`#request/${run.request_id}?scan=${scanId}&return=analysis`, collectionOrigin)}>Run Details</a>
        </div>
      </li>)}</ul>
    </>}
  </aside>;
}
