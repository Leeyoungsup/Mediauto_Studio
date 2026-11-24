import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, auditAttemptId, jsonBody } from './session';

type Result = { id: string; sequence: number; findings: string; margins: string | null; corrects_id: string | null; correction_reason: string | null; published_at: string };
type Receipt = { id: string; recipient_id: string; status: 'pending' | 'acknowledged' | 'failed'; reason: string | null; responded_at: string | null };
type Call = { id: string; recipient_id: string; outcome: 'reached_read_back' | 'no_answer' | 'failed'; note: string | null; recorded_at: string; recorded_by: string };
type Publication = Result & { receipts: Receipt[]; callbacks: Call[] };
type Recipient = { id: string; name: string; active: boolean };
type Candidate = { id: string; name: string; username: string };
type FinalReport = { status: 'draft' | 'in_review' | 'approved'; version: number } | null;
type FrozenSummary = { publications: Publication[]; recipients: Recipient[]; candidates: Candidate[]; can_manage: boolean; can_publish: boolean; final_report: FinalReport };
type ORCase = { id: string; case_number: string; sequence: number | null; published_at: string | null; status: Receipt['status'] | null };
type ORQueue = { cases: ORCase[]; can_acknowledge: boolean };
type ORResult = { case_number: string; publication: Result | null; receipt: Receipt | null; callback: { outcome: Call["outcome"]; recorded_at: string } | null; final_report: FinalReport };

const timestamp = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
const finalLabels = { draft: 'Draft', in_review: 'In Review', approved: 'Approved' };
const receiptLabels = { pending: 'Awaiting Confirmation', acknowledged: 'Acknowledged', failed: 'Confirmation Issue' };
const outcomes = { reached_read_back: 'Reached With Read-back', no_answer: 'No Answer', failed: 'Call Failed' };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unable to update the frozen result.';
const when = (value: string) => timestamp.format(new Date(value));

function FinalStatus({ report }: { report: FinalReport }) {
  return <p className="muted">Case Report Workflow · {report ? `${finalLabels[report.status]} · Version ${report.version}` : 'Not Started'}</p>;
}

function ResultContent({ publication }: { publication: Result }) {
  return <div className="frozen-result-content">
    <div className="preview-label"><h3>Preliminary Result · Version {publication.sequence}</h3>
      <time dateTime={publication.published_at}>{when(publication.published_at)}</time></div>
    {publication.corrects_id && <p className="integration-note">Correction of Version {publication.sequence - 1} · {publication.correction_reason}</p>}
    <div><h3>Frozen Section Findings</h3><p>{publication.findings}</p></div>
    <div><h3>Margin Assessment</h3><p>{publication.margins ?? 'Not Recorded'}</p></div>
  </div>;
}

function useFrozenRequest<T>(path: string, options?: { attempt?: string; interval: number }) {
  const [state, setState] = useState<{ path: string; value?: T; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const requestId = options?.attempt;
  const interval = options?.interval;
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function request() {
      try {
        const result = await api<T>(path, { signal: controller.signal, headers: requestId ? { 'X-Audit-Attempt': requestId } : undefined });
        if (!controller.signal.aborted) setState({ path, value: result });
      } catch (failure) {
        if (!controller.signal.aborted) setState({ path, error: errorText(failure) });
      } finally {
        if (!controller.signal.aborted && interval) timer = window.setTimeout(() => void request(), interval);
      }
    }
    void request();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [path, attempt, requestId, interval]);
  return { state: state?.path === path ? state : undefined, refresh };
}

export function FrozenWorkflow({ endpoint, caseId }: { endpoint: string; caseId: string }) {
  const { state, refresh } = useFrozenRequest<FrozenSummary>(endpoint);
  const [compose, setCompose] = useState(false);
  const data = state?.value;
  const latest = data?.publications[0];
  const authorized = data?.recipients.filter((item) => item.active) ?? [];
  const named = (id: string) => data?.recipients.find((item) => item.id === id)?.name ?? 'Former Recipient';

  return <section className="frozen-workflow" aria-label="Frozen Section Workflow">
    <div className="preview-label"><h2>Frozen Section</h2><div className="actions">
      {data?.can_manage && <a className="button secondary" href={`#or/${caseId}`}>Open OR View</a>}
      <button className="button secondary" type="button" onClick={refresh}>Refresh Frozen Result</button>
    </div></div>
    {state?.error ? <p role="alert" className="form-error">{state.error}</p>
      : !data ? <p role="status">Loading frozen workflow…</p> : <>
        <FinalStatus report={data.final_report} />
        {data.can_manage && <RecipientForm data={data} endpoint={endpoint} refresh={refresh} />}
        {latest && <div className="history-manual">
          <ResultContent publication={latest} />
          <ResponseLog publication={latest} named={named} />
        </div>}
        {!latest && !compose && <p className="empty-inline">No preliminary result published.</p>}
        {data.can_publish && <div>
          {compose ? <PublicationForm key={latest?.id ?? 'new'} previous={latest} endpoint={endpoint} onSaved={() => {
            setCompose(false);
            refresh();
          }} onCancel={() => setCompose(false)} />
            : <button className="button primary" type="button" disabled={!authorized.length}
              onClick={() => setCompose(true)}>{latest ? 'Start Correction' : 'New Preliminary Result'}</button>}
          {!authorized.length && <p className="muted">An administrator must authorize an OR recipient.</p>}
        </div>}
        {data.can_publish && latest && authorized.length > 0 &&
          <CallbackForm key={latest.id} publication={latest} recipients={authorized} endpoint={endpoint} refresh={refresh} />}
        {data.publications.length > 1 && <details className="report-history"><summary>Published Version History</summary>
          {data.publications.slice(1).map((row) => <div className="history-manual" key={row.id}>
            <ResultContent publication={row} /><ResponseLog publication={row} named={named} />
          </div>)}
        </details>}
      </>}
  </section>;
}

function ResponseLog({ publication, named }: { publication: Publication; named: (id: string) => string }) {
  return <div className="frozen-responses">
    <section><h3>OR Confirmation</h3><ul className="timeline">
      {publication.receipts.map((row) => <li key={row.id}><strong>{named(row.recipient_id)} · {receiptLabels[row.status]}</strong>
        {row.responded_at && <small> · {when(row.responded_at)}</small>}{row.reason && <p>{row.reason}</p>}</li>)}</ul></section>
    <section><h3>Telephone Callback</h3>{publication.callbacks.length ? <ul className="timeline">
      {publication.callbacks.map((row) => <li key={row.id}><strong>{named(row.recipient_id)} · {outcomes[row.outcome]}</strong>
        <p>{when(row.recorded_at)} · {row.recorded_by}</p>{row.note && <p>{row.note}</p>}</li>)}</ul>
      : <p className="muted">No callbacks recorded for this version.</p>}</section>
  </div>;
}

function RecipientForm({ data, endpoint, refresh }: { data: FrozenSummary; endpoint: string; refresh: () => void }) {
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function modify(recipient: string, active: boolean) {
    if (!recipient || !reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(endpoint + '/recipients/' + recipient, jsonBody('PUT', { active, reason: reason.trim() }));
      setReason('');
      setId('');
      refresh();
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }

  const active = data.recipients.filter((row) => row.active);
  return <form className="history-manual" aria-label="Manage OR Recipients" onSubmit={(event) => {
    event.preventDefault();
    void modify(id, true);
  }}>
    <h3>OR Recipients</h3>
    <label className="form-field">OR Viewer<select value={id} onChange={(event) => setId(event.target.value)}>
      <option value="">Select an OR Viewer</option>
      {data.candidates.filter((row) => !active.some((item) => item.id === row.id)).map((row) =>
        <option key={row.id} value={row.id}>{row.name} · {row.username}</option>)}
    </select></label>
    <label className="form-field">Authorization Reason<input value={reason} maxLength={240}
      onChange={(event) => setReason(event.target.value)} /></label>
    <button className="button secondary" type="submit" disabled={busy || !id || !reason.trim()}>Authorize Recipient</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {active.length > 0 && <ul className="timeline">{active.map((row) => <li key={row.id}>
      <strong>{row.name}</strong> <button className="button secondary" type="button" disabled={busy || !reason.trim()}
        onClick={() => void modify(row.id, false)}>Revoke {row.name}</button>
    </li>)}</ul>}
  </form>;
}

function useSubmission(endpoint: string, done: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const last = useRef<{ key: string; payload: string } | undefined>(undefined);
  async function submit(data: object) {
    if (busy) return;
    const payload = JSON.stringify(data);
    if (last.current?.payload !== payload) last.current = { key: auditAttemptId(), payload };
    setBusy(true);
    setError('');
    try {
      await api(endpoint, jsonBody('POST', data, { 'Idempotency-Key': last.current.key }));
      last.current = undefined;
      done();
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }
  return { busy, error, submit };
}

function PublicationForm({ endpoint, previous, onSaved, onCancel }: {
  endpoint: string; previous?: Result; onSaved: () => void; onCancel: () => void;
}) {
  const [findings, setFindings] = useState(previous?.findings ?? '');
  const [margins, setMargins] = useState(previous?.margins ?? '');
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmission(endpoint + '/publications', onSaved);
  function save(event: FormEvent) {
    event.preventDefault();
    void submit({ findings, margins: margins.trim() || null, corrects_id: previous?.id ?? null, correction_reason: reason.trim() || null });
  }
  return <form className="history-manual" aria-label="Publish Frozen Result" onSubmit={save}>
    <label className="form-field">Preliminary Findings<textarea required rows={4} maxLength={4000} value={findings} disabled={busy}
      onChange={(event) => setFindings(event.target.value)} /></label>
    <label className="form-field">Margin Assessment<textarea rows={3} maxLength={2000} value={margins} disabled={busy}
      onChange={(event) => setMargins(event.target.value)} /></label>
    {previous && <label className="form-field">Correction Reason<input required maxLength={240} value={reason} disabled={busy}
      onChange={(event) => setReason(event.target.value)} /></label>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="actions">
      <button className="button primary" disabled={busy} type="submit">{previous ? 'Publish Correction' : 'Publish Preliminary Result'}</button>
      <button className="button secondary" disabled={busy} type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function CallbackForm({ endpoint, publication, recipients, refresh }: {
  endpoint: string; publication: Result; recipients: Recipient[]; refresh: () => void;
}) {
  const [id, setId] = useState('');
  const [outcome, setOutcome] = useState<keyof typeof outcomes>('no_answer');
  const [readBack, setReadBack] = useState(false);
  const [note, setNote] = useState('');
  const { busy, error, submit } = useSubmission(endpoint + '/callbacks', () => {
    setNote('');
    setReadBack(false);
    refresh();
  });
  return <form className="history-manual" aria-label="Record Telephone Callback" onSubmit={(event) => {
    event.preventDefault();
    void submit({ publication_id: publication.id, recipient_id: id, outcome, read_back: readBack, note: note.trim() || null });
  }}>
    <h3>Log Telephone Callback · Version {publication.sequence}</h3>
    <label className="form-field">Callback Recipient<select value={id} required onChange={(event) => setId(event.target.value)}>
      <option value="">Select a Recipient</option>{recipients.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    <label className="form-field">Call Outcome<select value={outcome} onChange={(event) => {
      setOutcome(event.target.value as keyof typeof outcomes);
      setReadBack(false);
    }}>
      {Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {outcome === 'reached_read_back' && <label>
      <input type="checkbox" checked={readBack} onChange={(event) => setReadBack(event.target.checked)} /> Recipient read back this version.
    </label>}
    <label className="form-field">Callback Note<input maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} required={outcome !== 'reached_read_back'} /></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button secondary" type="submit" disabled={!id || busy || (outcome === 'reached_read_back' && !readBack)}>Save Callback</button>
  </form>;
}

export function ORResults({ organization, caseId }: { organization: string; caseId?: string }) {
  const root = `/api/clinical/${encodeURIComponent(organization)}/or`;
  const { state, refresh } = useFrozenRequest<ORQueue>(root, { interval: 5000 });
  const queue = state?.value;
  return <>
    <div className="page-heading"><div><h1>OR Results</h1></div>
      <button className="button secondary" type="button" onClick={refresh}>Refresh OR Cases</button></div>
    <div className="or-results-layout">
      <section className="panel detail-content" aria-label="OR Case Queue">
        <h2>Frozen Cases</h2>
        {state?.error ? <p role="alert" className="form-error">{state.error}</p>
          : !queue ? <p role="status">Loading OR cases…</p>
            : queue.cases.length ? <ul className="request-list">{queue.cases.map((item) => <li key={item.id}>
              <a href={`#or/${item.id}`} aria-current={item.id === caseId ? 'page' : undefined}><strong>{item.case_number}</strong></a>
              {item.sequence ? <small>Preliminary Version {item.sequence} · {item.status ? receiptLabels[item.status] : 'Published'}</small>
                : <small>Awaiting Publication</small>}
            </li>)}</ul> : <p className="empty-inline">No authorized frozen cases.</p>}
      </section>
      {caseId && <ORResultPanel key={caseId} endpoint={`${root}/cases/${encodeURIComponent(caseId)}`}
        canAcknowledge={!!queue?.can_acknowledge} />}
    </div>
  </>;
}

function ORResultPanel({ endpoint, canAcknowledge }: { endpoint: string; canAcknowledge: boolean }) {
  const [attempt] = useState(auditAttemptId);
  const { state, refresh } = useFrozenRequest<ORResult>(endpoint, { attempt, interval: 4000 });
  const result = state?.value;
  return <section className="panel detail-content" aria-label="OR Case Result">
    <div className="preview-label"><h2>{result?.case_number ?? 'Frozen Section Result'}</h2>
      <button className="button secondary" type="button" onClick={refresh}>Refresh OR Result</button></div>
    {state?.error ? <p role="alert" className="form-error">{state.error}</p>
      : !result ? <p role="status">Loading OR result…</p> : <>
        <FinalStatus report={result.final_report} />
        {result.publication ? <>
          <ResultContent publication={result.publication} />
          <p className="muted">Telephone Callback · {result.callback
            ? `${outcomes[result.callback.outcome]} · ${when(result.callback.recorded_at)}` : 'No Callback Recorded'}</p>
          {result.receipt && <p role="status">{receiptLabels[result.receipt.status]}
            {result.receipt.responded_at && ` · ${when(result.receipt.responded_at)}`}
            {result.receipt.reason && ` · ${result.receipt.reason}`}</p>}
          {canAcknowledge && result.receipt?.status !== 'acknowledged' && <ConfirmationForm key={result.publication.id}
            endpoint={`${endpoint}/results/${result.publication.id}/confirmation`} refresh={refresh} />}
        </> : <p className="empty-inline">Awaiting publication of a preliminary result.</p>}
      </>}
  </section>;
}

function ConfirmationForm({ endpoint, refresh }: { endpoint: string; refresh: () => void }) {
  const [read, setRead] = useState(false);
  const [issue, setIssue] = useState('');
  const { busy, error, submit } = useSubmission(endpoint, () => { setRead(false); setIssue(''); refresh(); });
  return <div className="history-manual">
    <label><input type="checkbox" checked={read} disabled={busy} onChange={(event) => setRead(event.target.checked)} /> I have read this version.</label>
    <button className="button primary" type="button" disabled={busy || !read}
      onClick={() => void submit({ outcome: 'acknowledged', read_back: true })}>Acknowledge Result</button>
    <label className="form-field">Confirmation Issue<input value={issue} maxLength={240} disabled={busy}
      onChange={(event) => setIssue(event.target.value)} /></label>
    <button className="button secondary" type="button" disabled={busy || !issue.trim()}
      onClick={() => void submit({ outcome: 'failed', reason: issue.trim() })}>Record Confirmation Issue</button>
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}
