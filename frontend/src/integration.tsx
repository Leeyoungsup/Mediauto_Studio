import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { sexLabels } from './worklist-filters';
import type { DemoCase } from './demo';
import { api, jsonBody } from './session';

const channels = ['emr', 'lis'] as const;
type Channel = typeof channels[number];
const labels = {
  not_configured: 'Not Configured', configured: 'Connection not checked', disabled: 'Disabled',
  connected: 'Connected', degraded: 'Connection Unavailable',
};
type Connection = {
  channel: Channel; mode: 'not_configured' | 'disabled' | 'mock'; scenario: 'normal' | 'unavailable' | 'timeout';
  state: keyof typeof labels; version: number; last_success_at: string | null;
};
export type IntegrationStatus = Record<Channel, Connection>;
type Message = { id: string; channel: Channel; message_id: string; state: string; attempts: number; delivery_conflicts: number; error: string | null };
const messageStates: Record<string, string> = {
  queued: 'Awaiting Processing', retry_wait: 'Waiting to Retry', dead_letter: 'Retry Limit Reached', applied: 'External Status Applied',
  conflict: 'Conflict', duplicate: 'Duplicate', stale: 'Older Version', pending_link: 'Link Review Required',
};
const messageErrors: Record<string, string> = {
  timeout: 'Request Timed Out', unavailable: 'External Service Unavailable', older_revision: 'Older Version',
  same_revision_different_data: 'Data differs at the same version', patient_demographics_differ: 'Patient details differ',
  external_id_wrong_record_type: 'Record type mismatch',
};
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' });
export const integrationPath = (org: string) => `/api/integration/${encodeURIComponent(org)}`;
export const integrationLabel = (connection: Connection | undefined) =>
  connection ? `${labels[connection.state]}${connection.mode === 'mock' ? ' (Mock)' : ''}` : 'Checking…';
const readableError = (error: unknown) => error instanceof Error ? error.message : 'Unable to process the request.';

export function IntegrationSettings({ org, status, onRefresh }: { org: string; status?: IntegrationStatus; onRefresh: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const root = integrationPath(org);
  const base = root + '/connections/';
  useEffect(() => {
    const controller = new AbortController();
    const poll = () => {
      api<Message[]>(root + '/messages', { signal: controller.signal }).then(setMessages).catch(() => {});
      onRefresh();
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [root, onRefresh]);

  async function act(path: string, options: RequestInit) {
    setBusy(true);
    setError('');
    try {
      await api(path, options);
      setMessages(await api<Message[]>(root + '/messages'));
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(false); onRefresh(); }
  }

  return <section className="panel integration-panel" aria-label="EMR and LIS Settings">
    <div className="panel-title"><h2>EMR and LIS Integration</h2></div>
    <div className="detail-content">
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="integration-grid">{channels.map((channel) => {
        const connection = status?.[channel];
        if (!connection) return null;
        return <form key={`${channel}-${connection.version}`} onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void act(base + channel, jsonBody('PUT', { version: connection.version, mode: form.get('mode'), scenario: form.get('scenario') }));
        }}>
          <h3>{channel.toUpperCase()} · {integrationLabel(connection)}</h3>
          <label className="form-field">Mode<select name="mode" defaultValue={connection.mode}>
            <option value="not_configured">Not Configured</option><option value="disabled">Disabled</option><option value="mock">Development Mock</option>
          </select></label>
          <label className="form-field">Mock Response<select name="scenario" defaultValue={connection.scenario}>
            <option value="normal">Normal</option><option value="unavailable">Connection Unavailable</option><option value="timeout">Delayed Response</option>
          </select></label>
          <p className="muted">Last Success {connection.last_success_at ? date.format(new Date(connection.last_success_at)) : 'No record'}</p>
          <div className="actions"><button className="button primary" disabled={busy}>Save</button>
            <button type="button" className="button secondary" disabled={busy || connection.mode !== 'mock'}
              onClick={() => void act(base + channel + '/probe', { method: 'POST' })}>Check Connection</button></div>
        </form>;
      })}</div>
      <h3>External Inbox</h3>
      {messages.length ? <div className="table-scroll"><table><thead><tr>
        <th>Channel</th><th>Message ID</th><th>Processing Status</th><th>Attempts / ID Conflict</th><th>Actions</th>
      </tr></thead><tbody>{messages.map((message) => <tr key={message.id}>
        <td>{message.channel.toUpperCase()}</td><td>{message.message_id}</td>
        <td>{messageStates[message.state] ?? message.state}{message.error && ` · ${messageErrors[message.error] ?? message.error}`}</td>
        <td>{message.attempts} / {message.delivery_conflicts}</td>
        <td>{['retry_wait', 'dead_letter'].includes(message.state) && <button className="button secondary" disabled={busy}
          onClick={() => void act(`${root}/messages/${message.id}/retry`, { method: 'POST' })}>Reprocess</button>}</td>
      </tr>)}</tbody></table></div> : <p className="muted">No messages received.</p>}
    </div>
  </section>;
}

type Match = { match: 'not_found' } | {
  match: 'found' | 'conflict'; external_id: string; case_version: number; patient_version: number | null;
  revision: number; received_at: string; differences: string[]; data: { display_name?: string; birth_date?: string };
};
type SourceLink = { external_id: string; system: string; state: string; last_synced_at: string | null; external_state: string | null };

export function PatientIntegration({ item, org, editable, status, onChanged }: {
  item: DemoCase; org: string; editable: boolean; status?: IntegrationStatus; onChanged: () => void;
}) {
  const [candidate, setCandidate] = useState<Match>();
  const [links, setLinks] = useState<SourceLink[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const sourceUrl = integrationPath(org) + '/sources';
  const caseUrl = integrationPath(org) + '/cases/' + item.recordId;
  useEffect(() => {
    if (!item.recordId) return;
    const controller = new AbortController();
    const resources = [`${sourceUrl}/case/${item.recordId}`];
    if (item.patient?.id) resources.push(`${sourceUrl}/patient/${item.patient.id}`);
    Promise.all(resources.map((url) => api<SourceLink[]>(url, { signal: controller.signal })))
      .then((rows) => { if (!controller.signal.aborted) setLinks(rows.flat()); })
      .catch(() => {});
    return () => controller.abort();
  }, [item.recordId, item.patient?.id, item.version, sourceUrl, status?.emr.last_success_at]);

  async function submit(event: FormEvent<HTMLFormElement>, action: 'manual-patient' | 'patient-lookup' | 'patient-confirm') {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (action === 'manual-patient') {
        await api(caseUrl + '/' + action, jsonBody('POST', {
          case_version: item.version, display_name: fields.get('name') || null,
          local_reference: fields.get('reference') || null, birth_date: fields.get('birth') || null, sex: fields.get('sex') || null,
        }));
        setManual(false);
        setCandidate(undefined);
        onChanged();
      } else if (action === 'patient-lookup') {
        setCandidate(undefined);
        setCandidate(await api<Match>(caseUrl + '/' + action, jsonBody('POST', { external_id: fields.get('number') })));
        onChanged();
      } else if (candidate?.match === 'found') {
        const link = await api<SourceLink>(caseUrl + '/' + action, jsonBody('POST', {
          external_id: candidate.external_id, case_version: candidate.case_version, patient_version: candidate.patient_version,
          source_revision: candidate.revision, confirm_differences: fields.has('confirm-differences'), reason: fields.get('reason'),
        }));
        setLinks((rows) => [...rows.filter((value) => value.external_id !== candidate.external_id || value.system !== link.system),
          { ...link, external_id: candidate.external_id, state: 'linked' }]);
        setCandidate(undefined);
        onChanged();
      }
    } catch (failure) { setError(readableError(failure)); onChanged(); }
    finally { setBusy(false); }
  }

  if (!item.recordId) return null;
  return <div className="patient-integration">
    <p className="integration-note">EMR {integrationLabel(status?.emr)} · LIS {integrationLabel(status?.lis)}</p>
    {links.map((link) => <p key={link.system + link.external_id}>
      {link.system} · {link.external_id} · {link.state === 'needs_review' ? 'Reconciliation Required' : 'Connected'}
      {link.external_state && ` · External Status ${link.external_state}`}
      {link.last_synced_at && ` · Last Synced ${date.format(new Date(link.last_synced_at))}`}
    </p>)}
    {editable && <>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!item.patient && <button className="button secondary" onClick={() => setManual(!manual)}>Enter Patient Manually</button>}
      {manual && <form className="integration-form" onSubmit={(event) => void submit(event, 'manual-patient')}>
        <label className="form-field">Patient Name<input name="name" maxLength={120} /></label>
        <label className="form-field">Local Patient ID<input name="reference" maxLength={80} /></label>
        <label className="form-field">Date of Birth<input type="date" name="birth" /></label>
        <label className="form-field">Sex<select name="sex"><option value="">Not Recorded</option>
          {Object.entries(sexLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="button primary" disabled={busy}>Register Patient</button>
      </form>}
      {status?.emr.mode === 'mock' && <form className="integration-form" onSubmit={(event) => void submit(event, 'patient-lookup')}>
        <label className="form-field">EMR Patient ID<input name="number" required maxLength={160} /></label>
        <button className="button secondary" disabled={busy}>Search EMR</button>
      </form>}
      {candidate?.match === 'not_found' && <p role="status">No matching patient was found in the external system.</p>}
      {candidate && candidate.match !== 'not_found' && <div className="integration-match">
        <h3>EMR Reconciliation Results</h3>
        <dl className="key-values"><div><dt>External Patient ID</dt><dd>{candidate.external_id}</dd></div>
          <div><dt>External Patient Name</dt><dd>{candidate.data.display_name ?? 'Not Entered'}</dd></div>
          <div><dt>External Date of Birth</dt><dd>{candidate.data.birth_date ?? 'Not Entered'}</dd></div>
          <div><dt>Received At</dt><dd>{date.format(new Date(candidate.received_at))}</dd></div>
        </dl>
        {candidate.match === 'conflict' ? <p role="alert">This external identifier is linked to another patient record.</p>
          : candidate.patient_version === null ? <p>Register patient details before linking.</p>
          : <form className="integration-form" onSubmit={(event) => void submit(event, 'patient-confirm')}>
            {candidate.differences.length > 0 && <label><input type="checkbox" name="confirm-differences" required /> I reviewed the differences ({candidate.differences.map((field) => field === 'display_name' ? 'Patient Name' : 'Date of Birth').join(', ')})</label>}
            <label className="form-field">Reason for Linking<input name="reason" required maxLength={240} /></label>
            <button className="button primary" disabled={busy}>Confirm Match and Link</button>
          </form>}
      </div>}
    </>}
  </div>;
}
