import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Bell, ClipboardList, ScanLine } from 'lucide-react';
import { ImageViewport } from './image-viewport';
import { api, jsonBody } from './session';
import type { DemoCase } from './demo';

const kinds = { ai: 'PD-L1 Analysis', consult: 'Consultation' };
const statuses = { open: 'Awaiting Assignment', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed', failed: 'Failed', cancelled: 'Cancel' };
const actions = { assign: 'Assign Request', start: 'Start Processing', complete: 'Complete Request', fail: 'Record Failure', retry: 'Reopen Request', cancel: 'Cancel Request' };
const notices: Record<string, string> = {
  request_created: 'Create Request', request_assigned: 'Request Assigned', request_reassigned: 'Request Reassigned',
  request_started: 'Request Started', request_completed: 'Request Completed', request_failed: 'Request Failed',
  request_reopened: 'Request Reopened', request_cancelled: 'Cancel Request', assignment_removed: 'Request Assignment Ended',
};
type Kind = keyof typeof kinds;
type Status = keyof typeof statuses;
type Action = keyof typeof actions;
type Candidate = { id: string; name: string; username: string };
type Snapshot = { id: string; kind: 'original' | 'edited'; score_type: string; score_status: string;
  model: string | null; model_version: string | null; analysis_version: string | null };
type CaseRequest = {
  id: string; kind: Kind; status: Status; question: string; version: number; requested_by: string;
  assigned_to: string | null; assignee_name: string | null; scan_id: string | null;
  result_note: string | null; snapshot: Snapshot | null; updated_at: string;
};
type RequestDetail = CaseRequest & {
  case_id: string | null; case_number: string; actions: Action[]; candidates: Candidate[];
  history: { version: number; action: string; at: string; before: Status | null; after: Status }[];
  scan: { id: string; label: string; stain: string | null; format: 'NDPI' | 'SVS' } | null;
};
type Notice = { id: string; action: string; created_at: string; request_id: string | null; read_at: string | null };
type Inbox = { unread: number; items: Notice[] };
const pathFor = (org: string) => '/api/clinical/' + encodeURIComponent(org);
const time = (value: string) => new Date(value).toLocaleString('en-US');
const notificationEvent = 'mediauto-request-changed';
const changed = () => window.dispatchEvent(new Event(notificationEvent));

function useResource<T>(path: string | null) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ path, data }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setState({ path, error: error.message }); });
    return () => controller.abort();
  }, [path, revision]);
  return { ...(state?.path === path ? state : undefined), refresh };
}

function ResourceStatus({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <div className="notice" role="alert">{error}
    <button type="button" className="button secondary" onClick={retry}>Reload</button></div>
    : <p role="status">Loading…</p>;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to process the request.';
}

function Candidates({ candidates, required = false, initial }: { candidates: Candidate[]; required?: boolean; initial?: string }) {
  return <label className="form-field">Request Assignee<select name="assignee" required={required} defaultValue={initial ?? ''}>
    <option value="">{required ? 'Select an assignee' : 'Assign later'}</option>
    {candidates.map(({ id, name, username }) => <option key={id} value={id}>{name} ({username})</option>)}
  </select></label>;
}

export function CaseRequests({ organization, item }: { organization: string; item: DemoCase }) {
  const path = pathFor(organization) + '/cases/' + item.recordId + '/requests';
  const resource = useResource<{ requests: CaseRequest[]; candidates: Record<Kind, Candidate[]> }>(path);
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<Kind>('consult');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submission = useRef<{ key: string; payload: string } | null>(null);
  const scans = item.slides.filter(({ wsi }) => wsi?.source === 'clinical');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const payload = { kind, question: fields.get('question'), scan_id: fields.get('scan') || null,
      assignee_id: fields.get('assignee') || null };
    const serialized = JSON.stringify(payload);
    if (submission.current?.payload !== serialized) submission.current = { payload: serialized, key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('') };
    setBusy(true); setError('');
    try {
      const result = await api<CaseRequest>(path, jsonBody('POST', payload, { 'Idempotency-Key': submission.current.key }));
      changed();
      location.hash = 'request/' + result.id;
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  if (!resource.data) return <ResourceStatus error={resource.error} retry={resource.refresh} />;
  return <section>
    <div className="preview-label"><h2>Analysis and Consultation Requests</h2>
      <button className="button secondary" onClick={() => setShowForm((value) => !value)} aria-expanded={showForm}>New Request</button></div>
    {showForm && <form className="request-form" onSubmit={(event) => void submit(event)}>
      <label className="form-field">Request Type<select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
        <option value="consult">Consultation</option><option value="ai">PD-L1 Analysis</option>
      </select></label>
      {kind === 'ai' && <p className="muted">Use this request to link an archived PD-L1 result.</p>}
      <label className="form-field">Target Scan<select name="scan" required={kind === 'ai'}>
        <option value="">{kind === 'ai' ? 'Select a scan' : 'None'}</option>
        {scans.map(({ id, label, stain, wsi }) => <option key={id} value={wsi?.id}>{label ?? id} · {stain} · {wsi?.format}</option>)}
      </select></label>
      {kind === 'ai' && scans.length === 0 && <p className="muted">Register a scan before creating an AI request.</p>}
      <Candidates key={kind} candidates={resource.data.candidates[kind]} />
      <label className="form-field">Request Details<textarea name="question" maxLength={2000} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy || (kind === 'ai' && !scans.length)}>Create Request</button>
    </form>}
    {resource.data.requests.length ? <ul className="request-list">{resource.data.requests.map((row) => <li key={row.id}>
      <a href={'#request/' + row.id}><strong>{kinds[row.kind]} · {statuses[row.status]}</strong><span>{row.question}</span></a>
      <small>{row.assignee_name ?? 'Unassigned'} · {time(row.updated_at)}</small>
    </li>)}</ul> : <p className="empty-inline">This case has no requests.</p>}
  </section>;
}

function SnapshotReference({ snapshot }: { snapshot: Snapshot }) {
  return <dl className="key-values request-snapshot">
    <div><dt>Archived Result</dt><dd>{snapshot.score_type} · {snapshot.kind === 'edited' ? 'User Edit' : 'Original'}</dd></div>
    <div><dt>Model</dt><dd>{snapshot.model ?? 'Not Recorded'} · {snapshot.model_version ?? 'Version not recorded'}</dd></div>
    <div><dt>Analysis Version</dt><dd>{snapshot.analysis_version ?? 'Not Recorded'}</dd></div>
    <div><dt>Snapshot ID</dt><dd>{snapshot.id}</dd></div>
  </dl>;
}

export function ReportDraftReferences({ organization, caseId }: { organization: string; caseId: string }) {
  const resource = useResource<CaseRequest[]>(pathFor(organization) + '/cases/' + caseId + '/report-draft-references');
  if (!resource.data) return <ResourceStatus error={resource.error} retry={resource.refresh} />;
  return <section><h2>Report Draft References</h2>
    {resource.data.length ? <ul className="request-list">{resource.data.map((row) => <li key={row.id}>
      <a href={'#request/' + row.id}><strong>{kinds[row.kind]} · Open Completed Request</strong><span>{row.question}</span></a>
      <small>{row.assignee_name ?? 'Unknown assignee'} · {time(row.updated_at)}</small>
      {row.result_note && <p className="request-text">{row.result_note}</p>}
      {row.snapshot && <SnapshotReference snapshot={row.snapshot} />}
      {row.snapshot && row.scan_id && <a className="button secondary" href={`#viewer/${caseId}/${row.scan_id}/${row.snapshot.id}`}>Open Result in WSI Viewer</a>}
    </li>)}</ul> : <p className="empty-inline">There are no completed requests to reference.</p>}
  </section>;
}

export function RequestPage({ organization, id }: { organization: string; id: string }) {
  const path = pathFor(organization) + '/requests/' + encodeURIComponent(id);
  const resource = useResource<RequestDetail>(path);
  const refreshRequest = resource.refresh;
  useEffect(() => {
    window.addEventListener(notificationEvent, refreshRequest);
    return () => window.removeEventListener(notificationEvent, refreshRequest);
  }, [refreshRequest]);
  const [action, setAction] = useState<Action>();
  const [showScan, setShowScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const row = resource.data;
  const isAiCompletion = action === 'complete' && row?.kind === 'ai';
  const snapshots = useResource<Snapshot[]>(isAiCompletion ? path + '/results' : null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || !action) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      await api(path, jsonBody('PATCH', { version: row.version, action, assignee_id: fields.get('assignee') || null,
        note: fields.get('note') || '', snapshot_id: fields.get('snapshot') || null }));
      setAction(undefined);
      changed();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  if (!row) return <ResourceStatus error={resource.error} retry={resource.refresh} />;
  return <>
    <a className="back-link" href={row.case_id ? `#case/${row.case_id}/requests` : '#worklist/all'}>{row.case_id ? 'Case Requests' : 'Worklist'}</a>
    <div className="page-heading"><div><h1>{kinds[row.kind]} Requests</h1><p>{row.case_number}</p></div>
      <button className="button secondary" onClick={() => { setAction(undefined); setError(''); resource.refresh(); }}>Refresh Request</button></div>
    <div className="detail-layout">
      <section className="panel detail-content">
        <h2>{statuses[row.status]}</h2><p className="request-text">{row.question}</p>
        <dl className="key-values"><div><dt>Requested By</dt><dd>{row.requested_by}</dd></div>
          <div><dt>Request Assignee</dt><dd>{row.assignee_name ?? 'Unassigned'}</dd></div></dl>
        {row.result_note && <p className="request-text">{row.result_note}</p>}
        {row.snapshot && <SnapshotReference snapshot={row.snapshot} />}
        {row.status === 'completed' && row.case_id &&
          <a className="button secondary" href={`#case/${row.case_id}/report`}><ClipboardList size={16} /> Open Report Draft References</a>}
        <div className="actions request-actions">
          {row.actions.map((key) => <button key={key} className="button secondary" disabled={busy}
            onClick={() => { setAction(key); setError(''); }}>{actions[key]}</button>)}
        </div>
        {action && row.actions.includes(action) && <form className="request-form" onSubmit={(event) => void submit(event)} key={action}>
          {action === 'assign' && <Candidates candidates={row.candidates} initial={row.assigned_to ?? undefined} required />}
          {isAiCompletion && (snapshots.data?.length ? <label className="form-field">Archived AI Result<select name="snapshot" required defaultValue="">
            <option value="">Select a result</option>{snapshots.data.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>
              {snapshot.score_type} · {snapshot.kind === 'edited' ? 'User Edit' : 'Original'} · {snapshot.analysis_version ?? 'Version not recorded'} · {snapshot.id.slice(0, 12)}
            </option>)}</select></label>
            : snapshots.data ? <div><p className="muted">No archived AI results are available for this scan.</p><button className="button secondary" type="button" onClick={snapshots.refresh}>Reload Archived Results</button></div>
              : <ResourceStatus error={snapshots.error} retry={snapshots.refresh} />)}
          {(action === 'complete' || action === 'fail') && <label className="form-field">
            {action === 'fail' ? 'Failure Reason' : row.kind === 'consult' ? 'Consultation Response' : 'Result Note (Optional)'}
            <textarea name="note" maxLength={2000} required={action === 'fail' || row.kind === 'consult'} /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="actions"><button className="button primary" disabled={busy || (isAiCompletion && !snapshots.data?.length)}>Save Action</button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setAction(undefined); setError(''); }}>Close</button></div>
        </form>}
      </section>
      <aside className="panel detail-content"><h2>Request History</h2>
        <ul className="timeline">{row.history.map((event) => <li key={event.version}><strong>{notices[event.action]}</strong>
          <p>{event.before && statuses[event.before] + ' → '}{statuses[event.after]} · {time(event.at)}</p></li>)}</ul>
      </aside>
    </div>
    {row.scan && <div className="request-scan">
      <button className="button secondary" onClick={() => setShowScan((value) => !value)}>
        <ScanLine size={16} /> {showScan ? 'Close Request Scan' : 'Open Request Scan'}</button>
      {showScan && <ImageViewport key={row.scan.id} scan={{ id: row.scan.id, source: 'clinical', format: row.scan.format }}
        label={row.scan.label} stain={row.scan.stain ?? 'Not Entered'} readOnlyEndpoint={path + '/wsi'} />}
    </div>}
  </>;
}

export function RequestInbox({ organization }: { organization: string }) {
  const path = pathFor(organization) + '/request-notifications';
  const { data, error, refresh } = useResource<Inbox>(path);
  const [readError, setReadError] = useState('');
  useEffect(() => {
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener(notificationEvent, refresh);
    return () => { clearInterval(timer); window.removeEventListener(notificationEvent, refresh); };
  }, [refresh]);

  async function mark(item: Notice, navigate: boolean) {
    setReadError('');
    try {
      if (!item.read_at) await api(path + '/' + item.id + '/read', { method: 'POST' });
      if (navigate && item.request_id) location.hash = 'request/' + item.request_id;
      changed();
      return true;
    } catch (failure) { setReadError(errorText(failure)); return false; }
  }
  return <details className="request-inbox" onToggle={(event) => { if (event.currentTarget.open) refresh(); }}>
    <summary className="button secondary"><Bell size={16} /> Request Notifications{data?.unread ? ` (${data.unread})` : ''}</summary>
    <section className="panel request-inbox-panel" aria-label="Request Inbox">
      <button className="button secondary" onClick={refresh}>Refresh Notifications</button>
      {readError && <p className="form-error" role="alert">{readError}</p>}
      {data ? data.items.length ? <ul className="request-list">{data.items.map((item) => <li key={item.id}>
        <strong>{notices[item.action]}{!item.read_at && ' · Unread'}</strong><small>{time(item.created_at)}</small>
        {item.request_id ? <button className="button secondary" onClick={(event) => {
          const inbox = event.currentTarget.closest('details');
          void mark(item, true).then((ok) => { if (ok && inbox) inbox.open = false; });
        }}>Open Request</button> : !item.read_at && <button className="button secondary" onClick={() => void mark(item, false)}>Mark as Read</button>}
      </li>)}</ul> : <p className="empty-inline">No request notifications.</p> : <ResourceStatus error={error} retry={refresh} />}
    </section>
  </details>;
}
