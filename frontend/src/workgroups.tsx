import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, jsonBody } from './session';
import type { DemoCase } from './demo';

export const priorityLabels = { frozen: 'Frozen', urgent: 'Urgent', routine: 'Routine' };
export type Priority = keyof typeof priorityLabels;
export type Queue = { key: string; name: string; group_key?: string; priority?: Priority; subscribed: boolean };
export type AssignmentLoad = {
  assigned_to: string | null; name: string; cases: number; open_cases: number;
  in_review: number; completed: number; slides: number; frozen: number;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The workgroup request failed.';
}

export function QueueNavigation({ queues, active, isAdmin, onSelect, onChanged }: {
  queues: Queue[]; active?: string; isAdmin: boolean; onSelect: (value?: Queue) => void; onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function subscribe(queue: Queue) {
    setBusy(true); setError('');
    try {
      await api('/api/worklist/queues/' + encodeURIComponent(queue.key) + '/subscription',
        jsonBody('PUT', { subscribed: !queue.subscribed }));
      await onChanged();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <div className="queue-navigation">
    <div className="actions" role="group" aria-label="Work Queues">
      <details className="queue-menu">
        <summary className="button secondary">Global Views</summary>
        <div className="panel queue-menu-items">
          {queues.map((queue) => <div className="queue-menu-row" key={queue.key}>
            <button className="button secondary" onClick={(event) => { onSelect(queue); event.currentTarget.closest('details')!.open = false; }}>{queue.name}</button>
            <button className="button secondary" disabled={busy} onClick={() => void subscribe(queue)}
              aria-label={(queue.subscribed ? 'Unsubscribe from ' : 'Subscribe to ') + queue.name}>
              {queue.subscribed ? 'Unsubscribe' : 'Subscribe'}
            </button>
          </div>)}
          {isAdmin && <a className="button secondary" href="#settings/groups">Manage Workgroups</a>}
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
      </details>
      {queues.filter((queue) => queue.subscribed || queue.key === active).map((queue) =>
        <button key={queue.key} className="button secondary queue-pin" aria-pressed={queue.key === active} onClick={() => onSelect(queue)}>{queue.name}</button>)}
      {active && <button className="button secondary" onClick={() => onSelect()}>Clear Queue</button>}
    </div>
  </div>;
}

export function Workload({ rows }: { rows: AssignmentLoad[] }) {
  return <details className="workload-panel">
    <summary>Assignment Workload</summary>
    {rows.length ? <div className="table-scroll"><table>
      <thead><tr>{['Assignee', 'Cases', 'Open', 'In Review', 'Completed', 'Slide Records', 'Frozen'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.assigned_to ?? 'unassigned'}>
        <th scope="row">{row.name}</th><td>{row.cases}</td><td>{row.open_cases}</td><td>{row.in_review}</td>
        <td>{row.completed}</td><td>{row.slides}</td><td>{row.frozen}</td>
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline">No cases in this result set.</p>}
  </details>;
}

type Account = { id: string; name: string; role: string; active: boolean };
type Group = { key: string; name: string; version: number; members: string[] };
type Roster = { groups: Group[]; users: Account[] };
const rosterPath = '/api/worklist/workgroups';

export function WorkgroupSettings({ onChanged }: { onChanged: () => Promise<void> }) {
  const [roster, setRoster] = useState<Roster>();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const group = roster?.groups.find((row) => row.key === key) ?? roster?.groups[0];
  useEffect(() => {
    const controller = new AbortController();
    api<Roster>(rosterPath, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setRoster(data);
    }).catch((failure) => { if (!controller.signal.aborted) setError(errorText(failure)); });
    return () => controller.abort();
  }, []);

  async function change(path: string, method: string, payload: object, createdKey?: string) {
    setBusy(true); setError('');
    try {
      await api(path, jsonBody(method, payload));
      setRoster(await api<Roster>(rosterPath));
      if (createdKey) setKey(createdKey);
      await onChanged();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const newKey = String(fields.get('key') ?? '');
    void change(rosterPath, 'POST', Object.fromEntries(fields), newKey);
  }

  function membership(userId: string, member: boolean) {
    if (group) void change(`${rosterPath}/${group.key}/members/${userId}`, 'PUT', { version: group.version, member });
  }

  return <>
    <div className="page-heading"><h1>Workgroups</h1><a className="button secondary" href="#settings">Back to Settings</a></div>
    {error && <p role="alert" className="notice">{error}<button className="button secondary" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      api<Roster>(rosterPath).then(setRoster).catch((failure) => setError(errorText(failure))).finally(() => setBusy(false));
    }}>Reload Roster</button></p>}
    {roster && <div className="workgroup-settings">
      <section className="panel detail-content">
        <h2>Group Membership</h2>
        <label className="form-field">Workgroup<select aria-label="Workgroup" value={group?.key ?? ''} onChange={(event) => setKey(event.target.value)}>
          {roster.groups.map((row) => <option value={row.key} key={row.key}>{row.name}</option>)}
        </select></label>
        <form className="actions" onSubmit={(event) => {
          event.preventDefault();
          membership(String(new FormData(event.currentTarget).get('account')), true);
        }}>
          <label className="form-field">Eligible Account<select aria-label="Eligible Account" name="account" required defaultValue="">
            <option value="" disabled>Select an account</option>
            {roster.users.filter((account) => account.active && !group?.members.includes(account.id)).map((account) =>
              <option key={account.id} value={account.id}>{account.name} ({account.role})</option>)}
          </select></label>
          <button className="button primary" disabled={busy}>Add Member</button>
        </form>
        {group?.members.length ? <ul className="group-members">{roster.users.filter((account) => group.members.includes(account.id)).map((account) =>
          <li key={account.id}><span>{account.name} · {account.role}{!account.active && ' · Inactive'}</span><button className="button secondary" disabled={busy}
            aria-label={'Remove Member ' + account.name} onClick={() => membership(account.id, false)}>Remove</button></li>)}</ul>
          : <p className="empty-inline">No members assigned.</p>}
      </section>
      <form className="panel detail-content" onSubmit={create}>
        <h2>New Workgroup</h2>
        <label className="form-field">Group Name<input name="name" required maxLength={80} /></label>
        <label className="form-field">Group Key<input name="key" required maxLength={48} placeholder="gastrointestinal" /></label>
        <div><button className="button primary" disabled={busy}>Create Workgroup</button></div>
      </form>
    </div>}
  </>;
}

export function CaseRouting({ item, editable, organization, queues, onChanged }: {
  item: DemoCase; editable: boolean; organization: string; queues: Queue[]; onChanged: () => void;
}) {
  const data = item.worklist;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groups = queues.filter((queue) => queue.group_key);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      await api('/api/clinical/' + encodeURIComponent(organization) + '/cases/' + item.recordId + '/classification',
        jsonBody('PATCH', { group_key: fields.get('workgroup') || null, priority: fields.get('priority') || null,
          reason: fields.get('reason'), version: item.version }));
      onChanged();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <details className="case-routing">
    <summary>Workgroup and Priority</summary>
    <dl className="key-values">
      <div><dt>Workgroup</dt><dd>{data?.group_name ?? 'Unclassified'}</dd></div>
      <div><dt>Priority</dt><dd>{data?.priority ? priorityLabels[data.priority] : 'Not Set'}</dd></div>
      <div><dt>Priority Source</dt><dd>{data?.priority_source === 'manual' ? 'Manual Classification' : 'Not Recorded'}</dd></div>
    </dl>
    {editable && item.status !== 'Review Complete' && (!data?.group_key || groups.some((group) => group.group_key === data.group_key))
      && <form key={item.version} onSubmit={(event) => void save(event)}>
        <label className="form-field">Case Workgroup<select aria-label="Case Workgroup" name="workgroup" defaultValue={data?.group_key ?? ''}>
          <option value="">Unclassified</option>{groups.map((group) => <option key={group.key} value={group.group_key}>{group.name}</option>)}
        </select></label>
        <label className="form-field">Case Priority<select aria-label="Case Priority" name="priority" defaultValue={data?.priority ?? ''}>
          <option value="">Not Set</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="form-field">Classification Reason<input name="reason" maxLength={240} required /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button className="button secondary" disabled={busy}>Save Classification</button>
      </form>}
  </details>;
}
