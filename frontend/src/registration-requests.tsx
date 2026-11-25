import { useEffect, useRef, useState } from 'react';
import { UserPlus, UsersRound } from 'lucide-react';
import { accountRoleLabels, api, jsonBody } from './session';

type StaffRole = 'doctor' | 'labeler' | 'viewer';
type Registration = {
  id: string; username: string; display_name: string; state: 'pending' | 'approved' | 'rejected';
  role: StaffRole | null; created_at: string; reviewed_at: string | null;
};
const staffRoles = ['doctor', 'labeler', 'viewer'] as const;
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const endpoint = '/api/auth/registration-requests';
const pageSize = 30;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

export function RegistrationRequests() {
  const [view, setView] = useState<'pending' | 'reviewed'>('pending');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ rows: Registration[]; has_more: boolean }>();
  const [selected, setSelected] = useState<Registration>();
  const [error, setError] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => setRevision((value) => value + 1);
  const decisionForm = useRef<HTMLFormElement>(null);
  useEffect(() => { if (selected) decisionForm.current?.focus(); }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    setPage(undefined);
    setError('');
    api<NonNullable<typeof page>>(endpoint + '?state=' + view + '&offset=' + offset, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setPage(value); })
      .catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [view, offset, revision]);

  async function decision(action: 'approve' | 'reject', fields?: FormData) {
    if (!selected || busy) return;
    setBusy(true);
    setDecisionError('');
    setNotice('');
    try {
      await api(endpoint + '/' + selected.id + '/decision', jsonBody('POST', action === 'approve'
        ? { action, role: fields?.get('role'), code: fields?.get('code') } : { action }));
      setSelected(undefined);
      setNotice(action === 'approve' ? 'Registration approved.' : 'Registration rejected.');
      if (page?.rows.length === 1 && offset) setOffset((value) => value - pageSize);
      reload();
    } catch (failure) { setDecisionError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <section className="panel detail-content registration-panel" aria-label="Account Registration Requests">
    <div className="preview-label"><div className="title-inline"><UsersRound size={19} aria-hidden="true" /><h2>Account Registration Requests</h2></div>
      <button type="button" className="button secondary" disabled={busy} onClick={() => { setSelected(undefined); reload(); }}>Refresh Requests</button>
    </div>
    <div className="actions" role="group" aria-label="Request Status">
      {(['pending', 'reviewed'] as const).map((state) => <button className="button secondary" type="button" key={state}
        aria-pressed={view === state} disabled={busy} onClick={() => { setView(state); setOffset(0); setSelected(undefined); setDecisionError(''); }}>
        {state === 'pending' ? 'Pending' : 'Reviewed'}
      </button>)}
    </div>
    {notice && <p role="status">{notice}</p>}
    {error ? <p role="alert" className="form-error">{error}</p> : !page && <p role="status">Loading requests…</p>}
    {page && (page.rows.length ? <div className="table-scroll"><table aria-label="Registration Requests">
      <thead><tr><th scope="col">Display Name</th><th scope="col">Username</th><th scope="col">Submitted</th>
        <th scope="col">Status</th><th scope="col">Role</th><th scope="col">Reviewed At</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{page.rows.map((row) => <tr key={row.id}>
        <td>{row.display_name}</td><td>{row.username}</td><td>{dateTime.format(new Date(row.created_at))}</td>
        <td>{row.state === 'pending' ? 'Pending' : row.state === 'approved' ? 'Approved' : 'Rejected'}</td>
        <td>{row.role ? accountRoleLabels[row.role] : '—'}</td><td>{row.reviewed_at ? dateTime.format(new Date(row.reviewed_at)) : '—'}</td>
        <td>{row.state === 'pending' && <button className="button secondary" type="button" disabled={busy}
          onClick={() => { setSelected(row); setDecisionError(''); }}>Review {row.username}</button>}</td>
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline">{view === 'pending' ? 'No pending registration requests.' : 'No reviewed registration requests.'}</p>)}
    {page && (offset > 0 || page.has_more) && <div className="actions">
      <button className="button secondary" disabled={offset === 0 || busy} onClick={() => { setSelected(undefined); setOffset(offset - pageSize); }}>Previous</button>
      <button className="button secondary" disabled={!page.has_more || busy} onClick={() => { setSelected(undefined); setOffset(offset + pageSize); }}>Next</button>
    </div>}
    {selected && <form ref={decisionForm} tabIndex={-1} className="registration-decision" aria-label="Review Registration" key={selected.id}
      onSubmit={(event) => { event.preventDefault(); void decision('approve', new FormData(event.currentTarget)); }}>
      <div className="title-inline"><UserPlus size={18} aria-hidden="true" /><h3>{selected.display_name} · {selected.username}</h3></div>
      <p className="muted">Verify the code shared by the applicant and choose their workspace role.</p>
      <label className="form-field">Account Role<select name="role" defaultValue="" required disabled={busy}>
        <option value="" disabled>Select a role</option>{staffRoles.map((role) => <option key={role} value={role}>{accountRoleLabels[role]}</option>)}
      </select></label>
      <label className="form-field">Applicant Confirmation Code<input name="code" autoComplete="off" required pattern="[A-Fa-f0-9]{20}" maxLength={20} disabled={busy} /></label>
      {decisionError && <p role="alert" className="form-error">{decisionError}</p>}
      <div className="actions">
        <button type="submit" className="button primary" disabled={busy}>Approve Account</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void decision('reject')}>Reject Request</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setSelected(undefined)}>Cancel</button>
      </div>
    </form>}
  </section>;
}
