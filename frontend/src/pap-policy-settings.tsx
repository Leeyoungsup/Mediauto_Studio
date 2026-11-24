import { useEffect, useState } from 'react';
import { api, jsonBody } from './session';
import type { Terminology } from './pap-review';

type Permissions = { primary_reviewers: string[]; followup_reviewers: string[] };
type Policy = { id: string; name: string; version: number; terms: Terminology; permissions: Permissions; reason: string; created_at: string };
type Data = { policies: Policy[]; users: { id: string; name: string; role: 'doctor' | 'labeler' }[] };
const blank: Permissions = { primary_reviewers: [], followup_reviewers: [] };

function parse(text: string, flag?: string) {
  return text.split('\n').filter((line) => line.trim()).map((line) => {
    const [code, label, attribute, ...extra] = line.split('|').map((item) => item.trim());
    if (!code || !label || extra.length || (attribute && attribute !== flag)) throw new Error('Check the code, label and optional flag on each terminology line.');
    return { code, label, enabled: Boolean(attribute) };
  });
}

export default function PapPolicySettings({ organization }: { organization: string }) {
  const endpoint = '/api/clinical/' + encodeURIComponent(organization) + '/pap-policy';
  const [data, setData] = useState<Data>();
  const [name, setName] = useState('');
  const [adequacy, setAdequacy] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [organisms, setOrganisms] = useState('');
  const [required, setRequired] = useState(false);
  const [permissions, setPermissions] = useState<Permissions>(blank);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  function load(policy: Policy | undefined, staff: Data["users"]) {
    setName(policy?.name ?? '');
    setAdequacy(policy?.terms.adequacy.map((term) =>
      term.code + ' | ' + term.label + (term.interpretation_required ? '' : ' | no_interpretation')).join('\n') ?? '');
    setInterpretation(policy?.terms.interpretation.map((term) => term.code + ' | ' + term.label).join('\n') ?? '');
    setOrganisms(policy?.terms.organisms.map((term) => term.code + ' | ' + term.label + (term.exclusive ? ' | exclusive' : '')).join('\n') ?? '');
    setRequired(policy?.terms.organisms_required ?? false);
    const activeIds = new Set(staff.map((user) => user.id));
    setPermissions(policy ? { primary_reviewers: policy.permissions.primary_reviewers.filter((id) => activeIds.has(id)),
      followup_reviewers: policy.permissions.followup_reviewers.filter((id) => staff.some((user) => user.id === id && user.role === 'doctor')) } : blank);
    setReason('');
  }

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<Data>(endpoint, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) { setData(result); load(result.policies[0], result.users); }
    }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [endpoint, attempt]);

  async function publish() {
    if (!data || busy) return;
    setBusy(true);
    setError('');
    try {
      const terms = {
        adequacy: parse(adequacy, 'no_interpretation').map(({ code, label, enabled }) => ({ code, label, interpretation_required: !enabled })),
        interpretation: parse(interpretation).map(({ code, label }) => ({ code, label })),
        organisms: parse(organisms, 'exclusive').map(({ code, label, enabled }) => ({ code, label, exclusive: enabled })),
        organisms_required: required,
      };
      const policy = await api<Policy>(endpoint, jsonBody('POST', { version: data.policies[0]?.version ?? 0, name, terms, permissions, reason }));
      setData({ ...data, policies: [policy, ...data.policies] });
      load(policy, data.users);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to publish Pap policy.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel detail-content pap-policy" aria-label="Pap Review Policy">
    <div className="panel-title"><h2>Pap Review Policy</h2><a href="#settings">Back to Settings</a></div>
    <button type="button" className="button secondary" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Reload Pap Policy</button>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p role="status">{data.policies.length ? `Active Pap Policy Version ${data.policies[0].version}` : 'Pap Review Is Not Configured'}</p>
      <form onSubmit={(event) => { event.preventDefault(); void publish(); }}>
        <fieldset disabled={busy} className="pap-review-fields">
          <label className="form-field">Policy Name<input value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} /></label>
          <p>Use one code and English label per line, separated by |.</p>
          <label className="form-field">Adequacy Terms<textarea rows={4} required value={adequacy} onChange={(event) => setAdequacy(event.target.value)} />
            <small>Add | no_interpretation to an adequacy term that excludes interpretation and organisms.</small></label>
          <label className="form-field">Interpretation Terms<textarea rows={4} required value={interpretation} onChange={(event) => setInterpretation(event.target.value)} /></label>
          <label className="form-field">Organism Terms<textarea rows={4} value={organisms} onChange={(event) => setOrganisms(event.target.value)} />
            <small>Add | exclusive to a term that must be selected on its own.</small></label>
          <label><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /> Require organisms when interpretation applies</label>
          {(['primary_reviewers', 'followup_reviewers'] as const).map((field) => <fieldset className="pap-organisms" key={field}>
            <legend>{field === 'primary_reviewers' ? 'Primary Reviewers' : 'Follow-up Reviewers'}</legend>
            {data.users.filter((user) => field === 'primary_reviewers' || user.role === 'doctor').map((user) => <label key={user.id}>
              <input type="checkbox" checked={permissions[field].includes(user.id)} onChange={(event) => {
                setPermissions({ ...permissions, [field]: event.target.checked ? [...permissions[field], user.id]
                  : permissions[field].filter((id) => id !== user.id) });
              }} /> {user.name}</label>)}
          </fieldset>)}
          <label className="form-field">Publication Reason<input value={reason} maxLength={240} required onChange={(event) => setReason(event.target.value)} /></label>
          <button type="submit" className="button primary">Publish Pap Policy</button>
        </fieldset>
      </form>
      {data.policies.length > 0 && <details className="pdl1-audit"><summary>Published Versions</summary>
        <ol className="timeline">{data.policies.map((policy) => <li key={policy.id}>
          <strong>Version {policy.version} · {policy.name}</strong> <time dateTime={policy.created_at}>{new Date(policy.created_at).toLocaleString('en-US')}</time>
          <p>{policy.reason}</p>
        </li>)}</ol></details>}
    </>}
  </section>;
}
