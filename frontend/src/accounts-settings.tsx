import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { RegistrationRequests } from './registration-requests';
import { accountRoleLabels, api, jsonBody } from './session';
import type { User } from './session';
import { WorkspaceTabs } from './workspace-tabs';

type Access = Pick<User, 'id' | 'username' | 'display_name' | 'role'> & { active: boolean; version: number; can_manage: boolean };
type Audit = {
  id: string; occurred_at: string; actor: string | null; actor_id: string; username: string; reason: string | null;
  action: 'account_access_changed' | 'registration_approved' | 'registration_rejected' | 'workgroup_membership_changed';
  previous_role: User['role'] | null; role: User['role'] | null;
  previous_active: boolean | null; active: boolean | null;
  group_name: string | null; previous_member: boolean | null; member: boolean | null;
};
const pageSize = 30;
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const actions = { account_access_changed: 'Access Changed', registration_approved: 'Registration Approved',
  registration_rejected: 'Registration Rejected', workgroup_membership_changed: 'Workgroup Membership Changed' };
const accessState = (active: boolean) => active ? 'Active' : 'Disabled';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unable to load account information.';

function useAccountPage<Row>(path: string) {
  const [state, setState] = useState<{ path: string; page?: { rows: Row[]; has_more: boolean }; error?: string }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(undefined);
    api<{ rows: Row[]; has_more: boolean }>(path, { signal: controller.signal }).then((page) => {
      if (!controller.signal.aborted) setState({ path, page });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ path, error: errorText(error) });
    });
    return () => controller.abort();
  }, [path, revision]);
  return { ...(state?.path === path ? state : undefined), refresh: () => setRevision((value) => value + 1) };
}

function PageControls({ offset, hasMore, change }: { offset: number; hasMore: boolean; change: (offset: number) => void }) {
  if (!offset && !hasMore) return null;
  return <div className="actions">
    <button type="button" className="button secondary" disabled={!offset} onClick={() => change(offset - pageSize)}>Previous</button>
    <button type="button" className="button secondary" disabled={!hasMore} onClick={() => change(offset + pageSize)}>Next</button>
  </div>;
}

function AccountDirectory({ openLog }: { openLog: (username: string) => void }) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Access>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const { page, error, refresh } = useAccountPage<Access>('/api/auth/accounts?' + new URLSearchParams({ q: query, offset: String(offset) }));
  const accessForm = useRef<HTMLFormElement>(null);
  useEffect(() => { if (selected) accessForm.current?.focus(); }, [selected]);

  async function save(fields: FormData) {
    if (!selected || busy) return;
    setBusy(true); setFailure(''); setNotice('');
    try {
      const result = await api<Access>('/api/auth/accounts/' + selected.id + '/access', jsonBody('PATCH', {
        role: fields.get('role'), active: fields.get('active') === 'active', version: selected.version, reason: fields.get('reason'),
      }));
      setNotice(result.version === selected.version ? 'Account access is already set to these values.' : 'Account access updated.');
      setSelected(undefined);
      refresh();
    } catch (error) { setFailure(errorText(error)); }
    finally { setBusy(false); }
  }

  return <section className="detail-content registration-panel" aria-label="Account Directory">
    <div className="preview-label"><h2>Account Directory</h2>
      <button className="button secondary" type="button" disabled={busy} onClick={() => { setSelected(undefined); refresh(); }}>Refresh Accounts</button>
    </div>
    <form className="actions" onSubmit={(event) => {
      event.preventDefault();
      setSelected(undefined); setOffset(0); setQuery(String(new FormData(event.currentTarget).get('q') ?? '').trim());
    }}><label className="search-field"><Search size={15} aria-hidden="true" /><input name="q" aria-label="Search Accounts" placeholder="Name or username" maxLength={120} /></label>
      <button className="button secondary" disabled={busy}>Search</button></form>
    {notice && <p role="status">{notice}</p>}
    {error ? <p role="alert" className="form-error">{error}</p> : !page && <p role="status">Loading accounts…</p>}
    {page && (page.rows.length ? <div className="table-scroll"><table aria-label="Accounts">
      <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
      <tbody>{page.rows.map((account) => <tr key={account.id}>
        <td>{account.display_name}</td><td>{account.username}</td>
        <td>{accountRoleLabels[account.role]}</td><td>{accessState(account.active)}</td>
        <td><div className="actions">
          {account.can_manage ? <button className="button secondary" type="button" disabled={busy} aria-label={'Edit Access for ' + account.username}
            onClick={() => { setSelected(account); setFailure(''); }}>Edit Access</button> : <span className="muted">View only</span>}
          <button className="button secondary" type="button" disabled={busy} aria-label={'View Log for ' + account.username}
            onClick={() => openLog(account.username)}>View Log</button>
        </div></td>
      </tr>)}</tbody></table></div> : <p className="empty-inline">No accounts match the search.</p>)}
    {page && <PageControls offset={offset} hasMore={page.has_more} change={(value) => { setSelected(undefined); setOffset(value); }} />}
    {selected && <form ref={accessForm} tabIndex={-1} className="registration-decision" key={selected.id} aria-label="Edit Account Access" onSubmit={(event) => {
      event.preventDefault(); void save(new FormData(event.currentTarget));
    }}>
      <h3>Edit Access · {selected.display_name} ({selected.username})</h3>
      <p className="muted">Changing the role or status signs this account out of active sessions.</p>
      <label className="form-field">Account Role<select name="role" defaultValue={selected.role} required disabled={busy}>
        {(['doctor', 'labeler', 'viewer'] as const).map((role) => <option key={role} value={role}>{accountRoleLabels[role]}</option>)}
      </select></label>
      <label className="form-field">Account Status<select name="active" defaultValue={selected.active ? 'active' : 'disabled'} disabled={busy}>
        <option value="active">Active</option><option value="disabled">Disabled</option>
      </select></label>
      <label className="form-field">Reason for Change<input name="reason" required maxLength={240} disabled={busy} /></label>
      {failure && <p className="form-error" role="alert">{failure}</p>}
      <div className="actions"><button className="button primary" disabled={busy}>Save Access</button>
        <button className="button secondary" type="button" disabled={busy} onClick={() => setSelected(undefined)}>Cancel</button></div>
    </form>}
  </section>;
}

function AuditLog({ initialUsername }: { initialUsername: string }) {
  const [username, setUsername] = useState(initialUsername);
  const [offset, setOffset] = useState(0);
  const { page, error, refresh } = useAccountPage<Audit>('/api/auth/account-audit?' + new URLSearchParams({ username, offset: String(offset) }));
  function access(role: Audit['role'], active: Audit['active']) {
    if (!role || active === null) return '—';
    return accountRoleLabels[role] + ' · ' + accessState(active);
  }
  function membership(group: string, member: boolean | null) {
    return group + ' · ' + (member ? 'Member' : 'Not a Member');
  }
  return <section className="detail-content registration-panel" aria-label="Account Audit Log">
    <div className="preview-label"><div><h2>Account Audit Log</h2><p className="muted">Registration decisions, access changes, and workgroup membership.</p></div>
      <button className="button secondary" type="button" onClick={refresh}>Refresh Log</button>
    </div>
    <form className="actions" onSubmit={(event) => {
      event.preventDefault();
      setOffset(0); setUsername(String(new FormData(event.currentTarget).get('username') ?? '').trim());
    }}><label className="search-field"><Search size={15} aria-hidden="true" />
        <input name="username" aria-label="Filter by Username" placeholder="Exact username" defaultValue={initialUsername} maxLength={80} />
      </label><button className="button secondary">Apply Filter</button></form>
    {error ? <p role="alert" className="form-error">{error}</p> : !page && <p role="status">Loading account audit…</p>}
    {page && (page.rows.length ? <div className="table-scroll"><table aria-label="Account Audit Events">
      <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Account</th><th scope="col">Administrator</th>
        <th scope="col">Before</th><th scope="col">After</th><th scope="col">Reason</th></tr></thead>
      <tbody>{page.rows.map((row) => <tr key={row.id}><td>{dateTime.format(new Date(row.occurred_at))}</td><td>{actions[row.action]}</td>
        <td>{row.username}</td><td>{row.actor || row.actor_id}</td>
        <td>{row.group_name ? membership(row.group_name, row.previous_member) : access(row.previous_role, row.previous_active)}</td>
        <td>{row.group_name ? membership(row.group_name, row.member) : access(row.role, row.active)}</td><td>{row.reason || '—'}</td>
      </tr>)}</tbody></table></div> : <p className="empty-inline">No account events match the filter.</p>)}
    {page && <PageControls offset={offset} hasMore={page.has_more} change={setOffset} />}
  </section>;
}

const tabs = [
  { key: 'directory', label: 'Directory and Access', icon: ShieldCheck },
  { key: 'requests', label: 'Registration Requests', icon: UserPlus },
  { key: 'audit', label: 'Audit Log', icon: ClipboardList },
] as const;
export type AccountTab = typeof tabs[number]['key'];

export function accountSettingsHref(tab: AccountTab) {
  return tab === 'directory' ? '#settings/accounts' : '#settings/accounts/' + tab;
}

export function AccountsSettings({ tab }: { tab: AccountTab }) {
  const [auditUsername, setAuditUsername] = useState('');
  useEffect(() => {
    if (tab !== 'audit') setAuditUsername('');
  }, [tab]);

  return <div className="panel accounts-settings">
    <WorkspaceTabs label="Account Administration" tabs={tabs} active={tab}
      onSelect={(next) => {
        if (tab !== next) location.hash = accountSettingsHref(next);
      }} panelId="accounts-panel" />
    <div id="accounts-panel" role="tabpanel" aria-labelledby={'accounts-panel-tab-' + tab}>
      {tab === 'directory' && <AccountDirectory openLog={(username) => { setAuditUsername(username); location.hash = accountSettingsHref('audit'); }} />}
      {tab === 'requests' && <RegistrationRequests />}
      {tab === 'audit' && <AuditLog initialUsername={auditUsername} />}
    </div>
  </div>;
}
