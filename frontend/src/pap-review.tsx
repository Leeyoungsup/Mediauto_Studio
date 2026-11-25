import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { api, auditAttemptId, jsonBody } from './session';

type Term = { code: string; label: string };
export type Terminology = {
  adequacy: (Term & { interpretation_required: boolean })[];
  interpretation: Term[];
  organisms: (Term & { exclusive: boolean })[];
  organisms_required: boolean;
};
type Published = { id: string; name: string; version: number; terms: Terminology };
type Findings = { adequacy: string | null; interpretation: string | null; organisms: string[]; note: string };
type Action = 'save_primary' | 'submit_primary' | 'save_followup' | 'complete' | 'return' | 'reopen_primary' | 'reopen_followup';
type Status = 'not_started' | 'primary_draft' | 'submitted' | 'followup_draft' | 'returned' | 'completed';
type Entry = { id: string; version: number; scan_id: string; action: Action; status: Status; findings: Findings | null;
  reason: string | null; author: string | null; created_by: string; created_at: string; terminology_version: number; policy_version: number };
type Feed = {
  availability: 'available' | 'not_configured' | 'stain_unverified'; status: Status; version: number;
  terminology: Published | null; active_policy_version: number; actions: Action[];
  history: Entry[]; next_before: number | null; primary: { version: number; findings: Findings } | null; draft: Findings | null;
};
const statusLabels: Record<Status, string> = { not_started: 'Not Started', primary_draft: 'Primary Draft',
  submitted: 'Awaiting Follow-up', followup_draft: 'Follow-up Draft', returned: 'Returned to Primary', completed: 'Review Completed' };
const actionLabels: Record<Action, string> = { save_primary: 'Save Primary Draft', submit_primary: 'Submit Primary Review',
  save_followup: 'Save Follow-up Draft', complete: 'Complete Follow-up Review', return: 'Return for Correction',
  reopen_primary: 'Resume Primary Review', reopen_followup: 'Reopen Follow-up Review' };
const formActions: Action[] = ['save_primary', 'submit_primary', 'save_followup', 'complete'];
const reasonActions: Action[] = ['return', 'reopen_primary', 'reopen_followup'];
const empty: Findings = { adequacy: null, interpretation: null, organisms: [], note: '' };
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function FindingsSummary({ findings, terms }: { findings: Findings; terms: Terminology }) {
  const term = (list: Term[], code: string | null) => list.find((entry) => entry.code === code)?.label ?? 'No Entry';
  return <dl className="key-values pap-findings-summary">
    <div><dt>Specimen Adequacy</dt><dd>{term(terms.adequacy, findings.adequacy)}</dd></div>
    <div><dt>Interpretation</dt><dd>{term(terms.interpretation, findings.interpretation)}</dd></div>
    <div><dt>Organisms</dt><dd>{findings.organisms.length ? findings.organisms.map((code) => term(terms.organisms, code)).join(', ') : 'No Entry'}</dd></div>
    {findings.note && <div><dt>Review Note</dt><dd>{findings.note}</dd></div>}
  </dl>;
}

export default function PapReview({ endpoint, following, candidate, onGallery, relatedAction }: {
  endpoint: string; following: boolean; candidate?: { id: string; category: string }; onGallery: () => void; relatedAction?: ReactNode;
}) {
  const url = endpoint + '/pap-review';
  const [feed, setFeed] = useState<Feed>();
  const [findings, setFindings] = useState<Findings>(empty);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<{ payload: string; id: string }>(undefined);
  const selectedAdequacy = feed?.terminology?.terms.adequacy.find((term) => term.code === findings.adequacy);
  const applicable = selectedAdequacy?.interpretation_required !== false;

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    api<Feed>(url, { signal: controller.signal }).then((loaded) => {
      if (controller.signal.aborted) return;
      setFeed(loaded);
      setFindings(loaded.draft ?? empty);
      setReason('');
      setError('');
      setBusy(false);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) { setError(error.message); setBusy(false); }
    });
    return () => controller.abort();
  }, [url, attempt]);

  async function change(action: Action) {
    if (!feed?.terminology || busy) return;
    const payload = { action, terminology_id: feed.terminology.id, expected_version: feed.version,
      findings: formActions.includes(action) ? findings : null, reason: reason.trim() || null };
    const serialized = JSON.stringify(payload);
    if (pending.current?.payload !== serialized) pending.current = { payload: serialized, id: auditAttemptId() };
    setError('');
    setBusy(true);
    try {
      await api(url + '/revisions', jsonBody('POST', { ...payload, request_key: pending.current.id }));
      setAttempt((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save Pap review.');
      setBusy(false);
    }
  }

  async function older() {
    if (!feed?.next_before || busy) return;
    setBusy(true);
    try {
      const next = await api<Feed>(url + '?before=' + feed.next_before);
      setFeed((current) => current && ({ ...current, history: [...current.history, ...next.history], next_before: next.next_before }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to load older reviews.');
    } finally {
      setBusy(false);
    }
  }

  const terms = feed?.terminology?.terms;
  const actions = following ? [] : feed?.actions ?? [];
  const hasForm = actions.some((action) => formActions.includes(action));
  return <section className="pdl1-panel pap-review" aria-label="Pap Specimen Review">
    <div className="pdl1-heading"><h2>Pap Specimen Review</h2>
      <div className="actions">{relatedAction}
        <button type="button" className="button secondary" onClick={onGallery}>Return to Pap Candidates</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Reload Pap Review</button>
      </div></div>
    {candidate && <p className="clinical-panel-context">Selected Candidate · {candidate.id} · {candidate.category}</p>}
    {error && <p role="alert">{error}</p>}
    {!feed && busy && <p role="status">Loading Pap review…</p>}
    {feed?.availability === 'stain_unverified' && <p>Pap review requires a registered Papanicolaou scan.</p>}
    {feed?.availability === 'not_configured' && <p>An administrator must publish the institution’s Pap review policy.</p>}
    {feed?.terminology && terms && <>
      <p role="status">{statusLabels[feed.status]} · Review {feed.version} · {feed.terminology.name} v{feed.terminology.version}
        {' · '}Active permission policy v{feed.active_policy_version}</p>
      {feed.primary && <details className="pdl1-audit"><summary>Submitted Primary Review · Revision {feed.primary.version}</summary>
        <FindingsSummary findings={feed.primary.findings} terms={terms} /></details>}
      {hasForm && <fieldset className="pap-review-fields" disabled={busy}>
        <label className="form-field">Specimen Adequacy
          <select value={findings.adequacy ?? ''} onChange={(event) => {
            const adequacy = event.target.value || null;
            const excludes = terms.adequacy.find((item) => item.code === adequacy)?.interpretation_required === false;
            setFindings({ ...findings, adequacy, ...(excludes && { interpretation: null, organisms: [] }) });
          }}>
            <option value="">Select adequacy</option>{terms.adequacy.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select></label>
        <label className="form-field">Interpretation
          <select value={findings.interpretation ?? ''} disabled={!applicable}
            onChange={(event) => setFindings({ ...findings, interpretation: event.target.value || null })}>
            <option value="">Select interpretation</option>
            {terms.interpretation.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select></label>
        {terms.organisms.length > 0 && <fieldset disabled={!applicable} className="pap-organisms"><legend>Organisms</legend>
          {terms.organisms.map((item) => <label key={item.code}><input type="checkbox" checked={findings.organisms.includes(item.code)}
            onChange={(event) => {
              const previous = findings.organisms.filter((code) => code !== item.code && (!event.target.checked
                || !terms.organisms.find((candidate) => candidate.code === code)?.exclusive));
              setFindings({ ...findings, organisms: event.target.checked ? item.exclusive ? [item.code] : [...previous, item.code] : previous });
            }} /> {item.label}</label>)}</fieldset>}
        <label className="form-field">Review Note<textarea maxLength={2000} value={findings.note}
          onChange={(event) => setFindings({ ...findings, note: event.target.value })} /></label>
      </fieldset>}
      {actions.length > 0 && <>
        <label className="form-field pap-review-reason">Action Reason<input value={reason} maxLength={240} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="actions">{actions.map((action) => <button type="button" key={action} className="button secondary"
          onClick={() => void change(action)} disabled={busy || (reasonActions.includes(action) && !reason.trim())}>{actionLabels[action]}</button>)}</div>
      </>}
      {!actions.length && <p>Review history is read-only for your account at this stage.</p>}
      {feed.history.length > 0 && <section aria-label="Pap Review History">
        <h3>Pap Review History</h3>
        <ol className="timeline">{feed.history.map((entry) => <li key={entry.id}>
          <details className="pdl1-audit"><summary>Revision {entry.version} · {actionLabels[entry.action]} · {entry.author ?? entry.created_by}</summary>
            <p>{date.format(new Date(entry.created_at))} · Term version {entry.terminology_version} · Permission version {entry.policy_version}</p>
            <p>Source scan {entry.scan_id}</p>
            {entry.reason && <p>{entry.reason}</p>}
            {entry.findings && <FindingsSummary findings={entry.findings} terms={terms} />}
          </details>
        </li>)}</ol>
        {feed.next_before && <button type="button" className="button secondary" disabled={busy} onClick={() => void older()}>Load Older Pap Reviews</button>}
      </section>}
    </>}
  </section>;
}
