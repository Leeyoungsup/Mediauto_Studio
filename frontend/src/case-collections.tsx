import { useCallback, useEffect, useRef, useState } from 'react';
import { modelNames } from './analysis-execution';
import { api, auditAttemptId, jsonBody } from './session';

type Kind = 'personal' | 'shared' | 'board' | 'meeting';
type Role = 'owner' | 'editor' | 'viewer';
type Collection = { id: string; title: string; kind: Kind; parent_id: string | null; meeting_date: string | null; version: number; role: Role };
type Index = { collections: Collection[]; meetings: Collection[]; can_create_board: boolean };
type Member = { id: string; name: string; role: Exclude<Role, 'owner'> };
type Candidate = { id: string; name: string; username: string };
type Entry = { id: string; case_id: string; case_number: string; note: string; version: number; presented_at: string | null };
type Detail = Collection & { parent_title: string | null; entries: Entry[]; meetings: Collection[];
  can_manage_members: boolean; members: Member[]; candidates: Candidate[] };
type Links = { scans: { id: string; label: string; stain: string | null; format: string }[];
  requests: { id: string; kind: 'ai' | 'consult'; scan_id: string | null; snapshot: string | null }[];
  runs: { id: string; request_id: string; attempt: number; model: string; scan_id: string; snapshot: string | null }[]; has_approved_report: boolean };

const root = (organization: string) => '/api/clinical/' + encodeURIComponent(organization) + '/collections';
const href = (id: string) => '#collections/' + id;
const editable = (role: Role) => role === 'owner' || role === 'editor';
const roleLabel = (role: Role) => ({ owner: 'Owner', editor: 'Editor', viewer: 'Viewer' })[role];
const kindLabel = { personal: 'Personal Collection', shared: 'Shared Collection', board: 'Tumor Board', meeting: 'Board Meeting' };
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date));
const failureText = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

function useResource<T>(path: string, poll = false) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>();
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function load() {
      try {
        const data = await api<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ path, data });
      } catch (error) {
        if (!controller.signal.aborted) setState({ path, error: failureText(error) });
      } finally {
        if (poll && !controller.signal.aborted) timer = window.setTimeout(load, 4000);
      }
    }
    void load();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [path, revision, poll]);
  return { ...(state?.path === path ? state : undefined), reload };
}

function LoadStatus({ error, reload }: { error?: string; reload: () => void }) {
  return error ? <div className="notice" role="alert">{error}<button type="button" className="button secondary" onClick={reload}>Reload</button></div>
    : <p role="status">Loading…</p>;
}

function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (failure) { setError(failureText(failure)); }
    finally { setBusy(false); }
  }
  return { busy, error, perform };
}

export function AddCaseReference({ organization, record, onClose }: {
  organization: string; record: { id: string; title: string }; onClose: () => void;
}) {
  const resource = useResource<Index>(root(organization));
  const changes = useMutation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const boards = new Map(resource.data?.collections.filter((item) => item.kind === 'board').map((item) => [item.id, item.title]));
  const available = resource.data?.collections.filter((item) => item.kind !== 'board' && editable(item.role)) ?? [];
  const meetings = resource.data?.meetings.filter((item) => editable(item.role)) ?? [];
  return <dialog ref={dialog} aria-labelledby="collection-add-title" onCancel={onClose}>
    <div className="panel-title"><h2 id="collection-add-title">Add Case Reference</h2><button className="button secondary" onClick={onClose}>Close</button></div>
    <div className="dialog-content">
      <p>{record.title}</p>
      {!resource.data && <LoadStatus error={resource.error} reload={resource.reload} />}
      {resource.data && (available.length || meetings.length ? <form className="request-form" onSubmit={(event) => {
        event.preventDefault();
        void changes.perform(async () => {
          await api(root(organization) + '/' + destination + '/entries', jsonBody('POST', { case_id: record.id, note }));
          setSaved(destination);
        });
      }}>
        <label className="form-field">Add To<select value={destination} onChange={(event) => { setDestination(event.target.value); setSaved(''); }} required>
          <option value="">Select a collection or Board meeting</option>
          {available.length > 0 && <optgroup label="Collections">{available.map((item) =>
            <option key={item.id} value={item.id}>{item.title} · {kindLabel[item.kind]}</option>)}</optgroup>}
          {meetings.length > 0 && <optgroup label="Board Meetings">{meetings.map((item) =>
            <option key={item.id} value={item.id}>{boards.get(item.parent_id ?? '')} · {item.title} · {dateLabel(item.meeting_date!)}</option>)}</optgroup>}
        </select></label>
        <label className="form-field">Collection Note<textarea rows={3} maxLength={2000} value={note} onChange={(event) => { setNote(event.target.value); setSaved(''); }} /></label>
        <button className="button primary" disabled={changes.busy || !destination || !!saved}>Add Case Reference</button>
      </form> : <p>No writable collections or Board meetings are available. <a href="#collections" onClick={onClose}>Open Collections</a></p>)}
      {changes.error && <p className="form-error" role="alert">{changes.error}</p>}
      {saved && <p role="status">Case reference saved. <a href={href(saved)} onClick={onClose}>Open Destination</a></p>}
    </div>
  </dialog>;
}

export function CollectionWorkspace({ organization, selected }: { organization: string; selected?: string }) {
  const endpoint = root(organization);
  const index = useResource<Index>(endpoint, true);
  return <>
    <div className="page-heading"><div><h1>Collections and Tumor Board</h1></div></div>
    <div className="collection-layout">
      <aside className="panel detail-content" aria-label="Collection List">
        {!index.data ? <LoadStatus error={index.error} reload={index.reload} /> : <>
          {(['personal', 'shared', 'board'] as const).map((kind) => <section key={kind}>
            <h2>{kind === 'board' ? 'Tumor Boards' : kind === 'personal' ? 'Personal Collections' : 'Shared Collections'}</h2>
            {index.data!.collections.some((item) => item.kind === kind) ?
              <ul className="collection-list">{index.data!.collections.filter((item) => item.kind === kind).map((item) => <li key={item.id}>
                <a href={href(item.id)} aria-current={item.id === selected ? 'page' : undefined}>{item.title}</a>
              </li>)}</ul> : <p className="muted">Empty</p>}
          </section>)}
          <CreateCollection endpoint={endpoint} canBoard={index.data.can_create_board} reload={index.reload} />
        </>}
      </aside>
      {selected && <CollectionContent key={selected} path={endpoint + '/' + selected} onIndexChange={index.reload} />}
    </div>
  </>;
}

function CreateCollection({ endpoint, canBoard, reload }: { endpoint: string; canBoard: boolean; reload: () => void }) {
  const changes = useMutation();
  const submission = useRef<{ payload: string; key: string }>(undefined);
  return <details className="collection-create"><summary>New Collection or Board</summary>
    <form className="request-form" aria-label="Create Collection" onSubmit={(event) => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      const payload = JSON.stringify(fields);
      if (payload !== submission.current?.payload) submission.current = { payload, key: auditAttemptId() };
      void changes.perform(async () => {
        const record = await api<Collection>(endpoint, jsonBody('POST', fields, { 'Idempotency-Key': submission.current!.key }));
        submission.current = undefined; reload(); location.hash = href(record.id);
      });
    }}>
      <label className="form-field">Collection Type<select name="kind"><option value="personal">Personal Collection</option>
        <option value="shared">Shared Collection</option>{canBoard && <option value="board">Tumor Board</option>}</select></label>
      <label className="form-field">Collection Name<input name="title" required maxLength={100} /></label>
      {changes.error && <p role="alert" className="form-error">{changes.error}</p>}
      <button className="button primary" disabled={changes.busy}>Create Collection</button>
    </form>
  </details>;
}

function CollectionContent({ path, onIndexChange }: { path: string; onIndexChange: () => void }) {
  const resource = useResource<Detail>(path, true);
  const data = resource.data;
  if (!data) return <section className="panel detail-content"><LoadStatus error={resource.error} reload={resource.reload} /></section>;
  return <section className="panel detail-content" aria-label="Collection Detail">
    {data.parent_id && <a className="back-link" href={href(data.parent_id)}>{data.parent_title}</a>}
    <div className="preview-label"><h2>{data.title}</h2><small>{kindLabel[data.kind]} · {roleLabel(data.role)}</small></div>
    {data.meeting_date && <p><time dateTime={data.meeting_date}>{dateLabel(data.meeting_date)}</time></p>}
    {data.can_manage_members && <Membership path={path} data={data} reload={resource.reload} />}
    {data.kind === 'board' ? <BoardMeetings path={path} data={data} reload={() => { resource.reload(); onIndexChange(); }} /> : <>
      <div className="preview-label"><h3>{data.kind === 'meeting' ? 'Meeting Agenda' : 'Case References'}</h3>
        {editable(data.role) && <a href="#worklist/all">Add Cases from Worklist</a>}</div>
      {data.entries.length ? <ol className="collection-entries">{data.entries.map((item, index) => <CollectionItem key={item.id}
        entry={item} node={data} path={path + '/entries/' + item.id} first={index === 0} last={index === data.entries.length - 1}
        reload={resource.reload} />)}</ol> : <p>No accessible case references.</p>}
    </>}
  </section>;
}

function Membership({ path, data, reload }: { path: string; data: Detail; reload: () => void }) {
  const changes = useMutation();
  const [user, setUser] = useState('');
  const [role, setRole] = useState('viewer');
  const name = (value: string) => data.kind === 'board' ? (value === 'editor' ? 'Coordinator' : 'Participant') : (value === 'editor' ? 'Editor' : 'Viewer');
  function save(userId: string, nextRole: string | null) {
    void changes.perform(async () => { await api(path + '/members/' + userId, jsonBody('PUT', { role: nextRole })); reload(); });
  }
  return <details className="collection-create"><summary>{data.kind === 'board' ? 'Manage Participants' : 'Manage Members'}</summary>
    <form className="request-form" aria-label="Collection Membership" onSubmit={(event) => { event.preventDefault(); save(user, role); }}>
      <label className="form-field">Member<select value={user} onChange={(event) => setUser(event.target.value)} required>
        <option value="">Select a member</option>{data.candidates.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.username})</option>)}
      </select></label>
      <label className="form-field">Member Role<select value={role} onChange={(event) => setRole(event.target.value)}>
        <option value="viewer">{name('viewer')}</option><option value="editor">{name('editor')}</option>
      </select></label>
      <button className="button secondary" disabled={changes.busy || !user}>Save Member</button>
    </form>
    {changes.error && <p role="alert" className="form-error">{changes.error}</p>}
    <ul className="timeline">{data.members.map((item) => <li key={item.id}>{item.name} · {name(item.role)}
      <button className="button secondary" disabled={changes.busy} onClick={() => save(item.id, null)}>Revoke {item.name}</button>
    </li>)}</ul>
  </details>;
}

function BoardMeetings({ path, data, reload }: { path: string; data: Detail; reload: () => void }) {
  const changes = useMutation();
  const submission = useRef<{ payload: string; key: string }>(undefined);
  return <section aria-label="Board Meetings">
    <h3>Board Meetings</h3>
    {editable(data.role) && <details className="collection-create"><summary>New Board Meeting</summary>
      <form className="request-form" aria-label="Create Board Meeting" onSubmit={(event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        const payload = JSON.stringify(fields);
        if (payload !== submission.current?.payload) submission.current = { payload, key: auditAttemptId() };
        void changes.perform(async () => {
          const record = await api<Collection>(path + '/meetings', jsonBody('POST', fields, { 'Idempotency-Key': submission.current!.key }));
          submission.current = undefined; reload(); location.hash = href(record.id);
        });
      }}>
        <label className="form-field">Meeting Title<input name="title" required maxLength={100} /></label>
        <label className="form-field">Meeting Date<input name="meeting_date" type="date" required /></label>
        {changes.error && <p role="alert" className="form-error">{changes.error}</p>}
        <button className="button primary" disabled={changes.busy}>Create Board Meeting</button>
      </form>
    </details>}
    {data.meetings.length ? <ul className="timeline">{data.meetings.map((item) => <li key={item.id}>
      <a href={href(item.id)}>{item.title}</a> · {dateLabel(item.meeting_date!)}
    </li>)}</ul> : <p className="muted">No meetings scheduled.</p>}
  </section>;
}

function CollectionItem({ entry: serverEntry, node, path, first, last, reload }: {
  entry: Entry; node: Detail; path: string; first: boolean; last: boolean; reload: () => void;
}) {
  const changes = useMutation();
  const [draft, setDraft] = useState<{ note: string; version: number }>();
  const [linksOpen, setLinksOpen] = useState(false);
  const [committed, setCommitted] = useState<Entry>();
  const entry = committed && committed.version > serverEntry.version ? committed : serverEntry;
  const canEdit = editable(node.role);
  function apply(action: () => Promise<void>) { void changes.perform(async () => { await action(); reload(); }); }
  function move(direction: 'earlier' | 'later') {
    apply(async () => { await api(path + '/move', jsonBody('POST', { direction, version: node.version })); });
  }
  return <li className="collection-entry">
    <div className="preview-label"><a href={`#case/${entry.case_id}`}><strong>{entry.case_number}</strong></a>
      {node.kind === 'meeting' && <span className="count">{entry.presented_at ? 'Presented' : 'Pending'}</span>}</div>
    {entry.note && <p className="collection-note">{entry.note}</p>}
    {entry.presented_at && <small>{new Date(entry.presented_at).toLocaleString('en-US')}</small>}
    <div className="actions">
      <button className="button secondary" aria-expanded={linksOpen} onClick={() => setLinksOpen(!linksOpen)}>Slides and Completed Results</button>
      {canEdit && <>
        <button className="button secondary" disabled={changes.busy || first} onClick={() => move('earlier')}>Move Earlier</button>
        <button className="button secondary" disabled={changes.busy || last} onClick={() => move('later')}>Move Later</button>
        <button className="button secondary" disabled={changes.busy} onClick={() => setDraft({ note: entry.note, version: entry.version })}>Edit Note</button>
        {node.kind === 'meeting' && <button className="button secondary" disabled={changes.busy} onClick={() => apply(async () => {
          setCommitted(await api<Entry>(path, jsonBody('PATCH', { version: entry.version, note: entry.note, presented: !entry.presented_at })));
        })}>{entry.presented_at ? 'Clear Presented' : 'Mark Presented'}</button>}
        <button className="button secondary" disabled={changes.busy} onClick={() => {
          if (window.confirm('Remove this case reference?')) apply(async () => { await api(path + '?version=' + entry.version, { method: 'DELETE' }); });
        }}>Remove Reference</button>
      </>}
    </div>
    {changes.error && <p className="form-error" role="alert">{changes.error}</p>}
    {draft && canEdit && <form className="request-form" onSubmit={(event) => {
      event.preventDefault();
      apply(async () => {
        setCommitted(await api<Entry>(path, jsonBody('PATCH', draft))); setDraft(undefined);
      });
    }}>
      <label className="form-field">Edit Collection Note<textarea rows={3} maxLength={2000} value={draft.note}
        onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
      <div className="actions"><button className="button primary" disabled={changes.busy}>Save Note</button>
        <button className="button secondary" type="button" onClick={() => setDraft(undefined)}>Close Note</button></div>
    </form>}
    {linksOpen && <CaseReferenceLinks path={path + '/links'} caseId={entry.case_id} />}
  </li>;
}

function CaseReferenceLinks({ path, caseId }: { path: string; caseId: string }) {
  const resource = useResource<Links>(path, true);
  if (!resource.data) return <LoadStatus error={resource.error} reload={resource.reload} />;
  const { scans, requests, runs, has_approved_report: report } = resource.data;
  return <div className="collection-links">
    <section><h4>WSI</h4>{scans.length ? <ul>{scans.map((item) => <li key={item.id}>
      <a href={`#viewer/${caseId}/${item.id}`}>{item.label} · {item.format}{item.stain ? ' · ' + item.stain : ''}</a></li>)}</ul> : <p>No viewable scans.</p>}</section>
    <section><h4>Completed Results</h4>{requests.length || runs.length || report ? <ul>
      {requests.map((item) => <li key={item.id}><a href={'#request/' + item.id}>{item.kind === 'consult' ? 'Completed Consultation' : 'Completed AI Request'}</a>
        {item.snapshot && item.scan_id && <> · <a href={`#viewer/${caseId}/${item.scan_id}/${item.snapshot}`}>Open Archived Result in WSI</a></>}</li>)}
      {runs.map((item) => <li key={item.id}><a href={'#request/' + item.request_id}>{modelNames[item.model] ?? 'Model Run'} · Attempt {item.attempt}</a>
        {item.snapshot && <> · <a href={`#viewer/${caseId}/${item.scan_id}/${item.snapshot}`}>Open Run Result in WSI</a></>}</li>)}
      {report && <li><a href={`#case/${caseId}/report`}>Approved Case Report</a></li>}
    </ul> : <p>No completed results.</p>}</section>
  </div>;
}
