import { EnglishDateField } from './english-date-field';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { api, jsonBody } from './session';

type Source = 'manual' | 'emr' | 'lis';
type Kind = 'diagnostic_report' | 'encounter_note';
type Summary = { id: string; source: Source; kind: Kind; title: string; occurred_on: string; recorded_at: string; revision: number };
type Document = Summary & { body: string; author?: string };
type Connection = { state: string; mode: string; checked_at: string | null; last_received_at: string | null };
type HistoryData = {
  match: 'no_patient' | 'not_linked' | 'needs_review' | 'linked';
  records: Summary[]; has_more: boolean; case_version: number; connections: Record<'emr' | 'lis', Connection>;
};

const kindLabels: Record<Kind, string> = { diagnostic_report: 'Diagnostic Report', encounter_note: 'Encounter Note' };
const sourceLabels: Record<Source, string> = { manual: 'Local Manual Entry', emr: 'EMR', lis: 'LIS' };
const connectionLabels: Record<string, string> = {
  not_configured: 'Not Configured', disabled: 'Disabled', configured: 'Configured', connected: 'Connected', degraded: 'Connection Unavailable',
};
const matchMessages = {
  no_patient: 'Link a local patient to this case to open patient history.',
  not_linked: 'External records appear after an operator confirms the patient match in Patient Information.',
  needs_review: 'An external patient match requires review. Records for that identity are hidden.',
  linked: '',
};
const localTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const recordDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const dateLabel = (value: string) => recordDate.format(new Date(value));
const timeLabel = (value: string) => localTime.format(new Date(value));

export function PatientHistoryDialog({ endpoint, onClose }: { endpoint: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="patient-history-dialog" aria-labelledby="patient-history-dialog-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="panel-title"><h2 id="patient-history-dialog-title">Patient History</h2>
      <button type="button" aria-label="Close History" className="icon-button" onClick={onClose}><X size={19} /></button></div>
    <div className="dialog-content"><PatientHistory endpoint={endpoint} /></div>
  </dialog>;
}

export function PatientHistory({ endpoint, heading = false }: { endpoint: string; heading?: boolean }) {
  const [history, setHistory] = useState<HistoryData>();
  const [selected, setSelected] = useState<Summary>();
  const [document, setDocument] = useState<Document>();
  const [query, setQuery] = useState({ offset: 0, attempt: 0 });
  const [documentAttempt, setDocumentAttempt] = useState(0);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [draft, setDraft] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setListError('');
    setHistory(undefined);
    setSelected(undefined);
    api<HistoryData>(`${endpoint}?offset=${query.offset}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setHistory(result);
          setSelected(result.records[0]);
        }
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setListError(error.message); });
    return () => controller.abort();
  }, [endpoint, query]);

  useEffect(() => {
    setDocument(undefined);
    setDetailError('');
    if (!selected) return;
    const controller = new AbortController();
    const qs = new URLSearchParams({ source: selected.source, record_id: selected.id });
    api<Document>(`${endpoint}/document?${qs}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setDocument(result); })
      .catch((error: Error) => { if (!controller.signal.aborted) setDetailError(error.message); });
    return () => controller.abort();
  }, [endpoint, selected, documentAttempt]);

  function load(offset = query.offset) {
    setQuery({ offset, attempt: query.attempt + 1 });
  }

  return <section aria-label="Patient History Records" className="patient-history">
    <div className="preview-label history-heading">
      {heading && <h2>Patient History</h2>}
      <div className="actions">
        <button type="button" className="button secondary" onClick={() => load()} disabled={draft}>Refresh History</button>
        {history && history.match !== 'no_patient' && !draft && <button type="button" className="button primary" onClick={() => { setNotice(''); setDraft(true); }}>Add Clinical Record</button>}
      </div>
    </div>
    {notice && <p role="status">{notice}</p>}
    {listError ? <p role="alert" className="form-error">{listError}</p> : !history && <p role="status">Loading patient history…</p>}
    {history && <>
      {matchMessages[history.match] && <p className="integration-note">{matchMessages[history.match]}</p>}
      <dl className="history-connections">{(['emr', 'lis'] as const).map((source) => {
        const status = history.connections[source];
        return <div key={source}><dt>{sourceLabels[source]}{status.mode === 'mock' ? ' (Mock)' : ''} · {connectionLabels[status.state] ?? 'Status Unavailable'}</dt>
          <dd>{status.last_received_at ? `Latest record received ${timeLabel(status.last_received_at)}`
            : history.match === 'linked' ? 'No records received for this patient.' : 'Patient match required to show received records.'}</dd>
          {status.checked_at && <dd>Connection checked {timeLabel(status.checked_at)}</dd>}
        </div>;
      })}</dl>
      {draft && <ManualRecordForm endpoint={endpoint} caseVersion={history.case_version}
        onCancel={() => setDraft(false)} onSaved={() => { setDraft(false); setNotice('Clinical record saved.'); load(0); }} />}
      <div className="history-documents">
        <section aria-label="Clinical Record List">
          <h3>Diagnostic Reports and Encounter Notes</h3>
          {history.records.length ? <ul>{history.records.map((record) => <li key={record.source + record.id}>
            <button type="button" aria-pressed={selected?.id === record.id && selected.source === record.source} onClick={() => setSelected(record)}>
              <strong>{record.title}</strong><small>{dateLabel(record.occurred_on)} · {kindLabels[record.kind]} · {sourceLabels[record.source]}</small>
            </button>
          </li>)}</ul> : <p className="empty-inline">{query.offset ? 'No records on this page.' : 'No clinical records available.'}</p>}
          {(query.offset > 0 || history.has_more) && <div className="actions history-pages">
            <button type="button" className="button secondary" disabled={draft || query.offset === 0} onClick={() => load(query.offset - 20)}>Previous Records</button>
            <button type="button" className="button secondary" disabled={draft || !history.has_more} onClick={() => load(query.offset + 20)}>More Records</button>
          </div>}
        </section>
        {selected && <section aria-label="Clinical Record Details" className="history-document">
          {detailError ? <div role="alert"><p>{detailError}</p><button type="button" className="button secondary" onClick={() => setDocumentAttempt((value) => value + 1)}>Retry Record</button></div>
            : document?.id === selected.id && document.source === selected.source ? <>
              <h3>{document.title}</h3>
              <p className="muted">{kindLabels[document.kind]} · {dateLabel(document.occurred_on)} · {sourceLabels[document.source]}</p>
              <p className="muted">{document.source === 'manual' ? `Entered ${timeLabel(document.recorded_at)}${document.author ? ` by ${document.author}` : ''}`
                : `Source revision ${document.revision} · Received ${timeLabel(document.recorded_at)}`}</p>
              <p className="history-document-text">{document.body}</p>
            </> : <p role="status">Loading clinical record…</p>}
        </section>}
      </div>
    </>}
  </section>;
}

function ManualRecordForm({ endpoint, caseVersion, onCancel, onSaved }: {
  endpoint: string; caseVersion: number; onCancel: () => void; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submission = useRef<{ key: string; payload: string } | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = { ...Object.fromEntries(new FormData(event.currentTarget)), case_version: caseVersion };
    const payload = JSON.stringify(data);
    if (payload !== submission.current?.payload) {
      submission.current = { key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''), payload };
    }
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    try {
      await api(endpoint, { ...jsonBody('POST', data, { 'Idempotency-Key': submission.current.key }), signal: request.signal });
      if (!request.signal.aborted) onSaved();
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to save the clinical record.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return <form className="history-manual" aria-label="Add Clinical Record" onSubmit={(event) => void save(event)}>
    <div className="form-grid">
      <label className="form-field">Record Type<select name="kind"><option value="encounter_note">Encounter Note</option><option value="diagnostic_report">Diagnostic Report</option></select></label>
      <EnglishDateField label="Clinical Date" name="occurred_on" required />
    </div>
    <label className="form-field">Title<input name="title" required maxLength={160} /></label>
    <label className="form-field">Clinical Text<textarea name="body" rows={5} required maxLength={12000} /></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="actions"><button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" className="button primary" disabled={busy}>Save Clinical Record</button></div>
  </form>;
}
