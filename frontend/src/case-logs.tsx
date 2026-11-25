import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from './session';

type LogEntry = {
  id: string; occurred_at: string; actor: string; actor_name?: string; action: string; entity: string; target_id: string;
  result: 'success' | 'failed' | 'denied'; status_code?: number; reason?: string;
  before: Record<string, unknown>; after: Record<string, unknown>;
};
type LogResult = { rows: LogEntry[]; has_more: boolean; actors: [string, string][]; actions: string[]; entities: string[] };
type Applied = Record<'actor' | 'action' | 'entity' | 'result' | 'target_id', string>;
const emptyFilters: Applied = { actor: '', action: '', entity: '', result: '', target_id: '' };
const timestamp = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
const resultLabels = { success: 'Succeeded', failed: 'Failed', denied: 'Denied' };
const names: Record<string, string> = {
  case_opened: 'Opened Case', scan_viewed: 'Viewed Scan', annotation_registered: 'Created Annotation',
  annotation_updated: 'Updated Annotation', annotation_deleted: 'Deleted Annotation',
  attachment_opened: 'Opened Attachment', patient_history_opened: 'Opened Clinical Record',
  assigned: 'Assigned Case', reassigned: 'Reassigned Case', registered: 'Registered',
};
const title = (value: string) => names[value] ?? value.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');

export function CaseLogsDialog({ endpoint, onClose }: { endpoint: string; onClose: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = modal.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={modal} className="case-logs-dialog patient-history-dialog" aria-labelledby="case-logs-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="panel-title"><h2 id="case-logs-title">Case Logs</h2>
      <button className="icon-button" type="button" aria-label="Close Case Logs" onClick={onClose}><X size={18} /></button></div>
    <div className="dialog-content"><CaseLogs endpoint={endpoint} /></div>
  </dialog>;
}

export function CaseLogs({ endpoint }: { endpoint: string }) {
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [pages, setPages] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<LogResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const cursor = pages.at(-1) ?? '';

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(Object.entries(applied).filter(([, value]) => value));
    if (cursor) {
      const [time, id] = cursor.split('|');
      params.set('before_at', time);
      params.set('before_id', id);
    }
    setError('');
    setLoading(true);
    api<LogResult>(endpoint + '?' + params, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, applied, cursor, attempt]);

  const options: Record<'actor' | 'action' | 'entity' | 'result', [string, string][]> = {
    actor: data?.actors ?? [], action: data?.actions.map((action) => [action, title(action)]) ?? [],
    entity: data?.entities.map((entity) => [entity, title(entity)]) ?? [],
    result: Object.entries(resultLabels),
  };
  const last = data?.rows.at(-1);

  function search(filters: Applied) {
    setApplied(filters);
    setPages([]);
    setAttempt((value) => value + 1);
  }

  return <section className="case-logs" aria-label="Case Log Entries">
    <form className="case-log-filters" onSubmit={(event) => { event.preventDefault(); search({ ...draft, target_id: draft.target_id.trim() }); }}>
      {(['actor', 'action', 'entity', 'result'] as const).map((field) => <label className="form-field" key={field}>
        {field === 'actor' ? 'User' : title(field)}
        <select value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}>
          <option value="">All</option>
          {options[field].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>)}
      <label className="form-field">Target ID<input value={draft.target_id} maxLength={36} placeholder="UUID"
        pattern="[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
        onChange={(event) => setDraft({ ...draft, target_id: event.target.value })} /></label>
      <div className="actions">
        <button className="button primary" type="submit">Apply Filters</button>
        <button type="button" className="button secondary" onClick={() => { setDraft(emptyFilters); search(emptyFilters); }}>Clear Filters</button>
        <button type="button" className="button secondary" onClick={() => search(applied)}>Refresh Logs</button>
      </div>
    </form>
    {error ? <p role="alert" className="form-error">{error}</p> : loading ? <p role="status">Loading case logs…</p>
      : data?.rows.length ? <>
        <div className="case-log-table"><table>
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Result</th><th>Details</th></tr></thead>
          <tbody>{data.rows.map((entry) => <tr key={entry.id}>
            <td><time dateTime={entry.occurred_at}>{timestamp.format(new Date(entry.occurred_at))}</time></td>
            <td>{entry.actor_name ?? entry.actor}</td>
            <td>{title(entry.action)}</td>
            <td>{title(entry.entity)} <small title={entry.target_id}>{entry.target_id.slice(0, 8)}</small></td>
            <td>{resultLabels[entry.result]}{entry.status_code ? ` · HTTP ${entry.status_code}` : ''}</td>
            <td><details><summary>View Details</summary><dl>
              <div><dt>Target ID</dt><dd>{entry.target_id}</dd></div>
              {entry.reason && <div><dt>Reason</dt><dd>{entry.reason}</dd></div>}
              {Object.keys(entry.before).length > 0 && <div><dt>Before</dt><dd><pre>{JSON.stringify(entry.before, null, 2)}</pre></dd></div>}
              {Object.keys(entry.after).length > 0 && <div><dt>After</dt><dd><pre>{JSON.stringify(entry.after, null, 2)}</pre></dd></div>}
            </dl></details></td>
          </tr>)}</tbody>
        </table></div>
        <div className="actions">
          <button className="button secondary" type="button" disabled={!pages.length} onClick={() => setPages(pages.slice(0, -1))}>Previous Page</button>
          <button className="button secondary" type="button" disabled={!data.has_more || !last} onClick={() => {
            if (last) setPages([...pages, `${last.occurred_at}|${last.id}`]);
          }}>Next Page</button>
        </div>
      </> : <p className="empty-inline">No case logs match these filters.</p>}
  </section>;
}
