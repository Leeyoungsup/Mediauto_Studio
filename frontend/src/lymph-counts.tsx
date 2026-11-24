import { useEffect, useState } from 'react';
import { api, auditAttemptId, jsonBody } from './session';

type Count = { id: string; version: number; positive: number; total: number; reason: string | null; created_at: string };
type CountData = { specimen: string; history: Count[] };
const dates = new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' });

export function LymphCounts({ endpoint }: { endpoint: string }) {
  const path = endpoint + '/lymph-node-counts';
  const [data, setData] = useState<CountData>();
  const [positive, setPositive] = useState(0);
  const [total, setTotal] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const current = data?.history[0];

  useEffect(() => {
    const controller = new AbortController();
    api<CountData>(path, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      setPositive(result.history[0]?.positive ?? 0);
      setTotal(result.history[0]?.total ?? 0);
      setReason('');
      setError('');
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [path, revision]);

  return <details className="viewer-record-panel lymph-counts">
    <summary>Lymph Node Count{current && ` · ${current.positive} / ${current.total}`}</summary>
    {error && <p role="alert" className="form-error">{error} <button className="button secondary" type="button"
      onClick={() => setRevision(revision + 1)}>Reload Count</button></p>}
    {notice && <p role="status">{notice}</p>}
    {data && <>
      <p>Specimen {data.specimen} · Manual Positive / Total</p>
      <form aria-label="Lymph Node Count" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true); setError(''); setNotice('');
        try {
          const result = await api<Count>(path, jsonBody('PUT', { version: current?.version ?? 0, positive, total,
            reason: current ? reason.trim() : null }, { 'X-Audit-Attempt': auditAttemptId() }));
          setData({ ...data, history: [result, ...data.history.filter((row) => row.id !== result.id)] });
          setNotice(current ? 'Lymph node count corrected. The new version is available in Result Evidence.' : 'Lymph node count saved. It is available in Result Evidence.');
          setReason('');
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save the count.'); }
        finally { setBusy(false); }
      }}>
        <div className="actions">
          <label className="form-field">Positive<input aria-label="Positive" type="number" required min={0} max={total} value={Number.isNaN(positive) ? '' : positive}
            onChange={(event) => setPositive(event.target.valueAsNumber)} /></label>
          <label className="form-field">Total<input aria-label="Total" type="number" required min={positive || 0} max={10000} value={Number.isNaN(total) ? '' : total}
            onChange={(event) => setTotal(event.target.valueAsNumber)} /></label>
        </div>
        {current && <label className="form-field">Count Correction Reason<input required maxLength={240} value={reason}
          onChange={(event) => setReason(event.target.value)} /></label>}
        <button className="button secondary" disabled={busy || !!current && (!reason.trim() || positive === current.positive && total === current.total)}>
          {current ? 'Save Count Correction' : 'Save Lymph Node Count'}
        </button>
      </form>
      {data.history.length > 0 && <ul className="timeline">{data.history.map((row) => <li key={row.id}>
        <strong>Version {row.version} · {row.positive} / {row.total}</strong> · {dates.format(new Date(row.created_at))}
        {row.reason && <p>{row.reason}</p>}
      </li>)}</ul>}
    </>}
  </details>;
}
