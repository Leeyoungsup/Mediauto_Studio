import { interpretations, markerNames, modelNames } from './analysis-execution';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, jsonBody } from './session';
import { ReportDictation } from './report-dictation';

type Section = { key: string; label: string; required: boolean };
type Template = { id: string | null; template_key: string | null; name: string; version: number; sections: Section[] };
type Evidence = {
  id: string; kind: 'ai' | 'consult' | 'lymph_node_count' | 'analysis_run' | 'ihc_review'; version: number; completed_at: string; scan_id: string | null; result_note: string | null;
  request_id?: string; model?: string; model_version?: string; marker?: string; interpretation?: keyof typeof interpretations; block_number?: string;
  specimen?: string; positive?: number; total?: number; superseded?: boolean; reason?: string | null;
  snapshot: { id: string; model?: string; model_version?: string; analysis_version?: string; score_type?: string; kind?: string } | null;
};
type History = { version: number; status: 'draft' | 'in_review' | 'approved'; author?: string; action: string; created_at: string; reason?: string; replaces_version?: number };
type Revision = History & { template: Template; sections: Record<string, string>; evidence: Evidence[]; dictated_sections: string[]; correction_reason?: string };
type Delivery = { id: string; report_version: number; status: 'queued' | 'sending' | 'retry_wait' | 'acknowledged' | 'failed';
  attempts: number; error?: string; ack_id?: string; finished_at?: string; kind: 'initial' | 'correction' };
type Report = { draft: Revision | null; templates: Template[]; evidence: Evidence[]; history: History[]; deliveries: Delivery[];
  can_approve: boolean; can_manage_templates: boolean; lis_enabled: boolean; lis_accession: string | null };
type Draft = { template: Template; sections: Record<string, string>; evidence_ids: string[]; dictated_sections: string[] };

const phases = { draft: 'Draft', in_review: 'In Review', approved: 'Approved' };
const deliveryLabels = { queued: 'Queued', sending: 'Sending', retry_wait: 'Retry Scheduled', acknowledged: 'Acknowledged', failed: 'Failed' };
const failures: Record<string, string> = {
  timeout: 'The LIS response timed out.', unavailable: 'The adapter is unavailable.', invalid_ack: 'The acknowledgement could not be matched.',
  rejected: 'The LIS mock rejected the report.', adapter_disabled: 'Mock report delivery is disabled.',
  payload_changed: 'The queued report could not be verified.', interrupted: 'The previous attempt was interrupted.', adapter_error: 'The adapter could not process the report.',
};
const actionNames: Record<string, string> = {
  report_draft_saved: 'Draft Saved', report_submitted: 'Submitted for Review', report_returned: 'Returned to Draft',
  report_approved: 'Approved', report_correction_started: 'Correction Started',
};
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const describe = (error: unknown) => error instanceof Error ? error.message : 'Unable to update the report.';

function draftOf(report: Report): Draft {
  const current = report.draft;
  return current ? { template: current.template, sections: current.sections, evidence_ids: current.evidence.map((item) => item.id),
    dictated_sections: current.dictated_sections }
    : { template: report.templates[0], sections: {}, evidence_ids: [], dictated_sections: [] };
}

function evidenceLabel(item: Evidence) {
  if (item.kind === 'analysis_run') return `${modelNames[item.model ?? ''] ?? 'Model Run'} · ${item.model_version}`;
  if (item.kind === 'ihc_review') return `IHC Review · ${markerNames[item.marker ?? '']} · ${item.interpretation ? interpretations[item.interpretation] : ''} · Best Block ${item.block_number}`;
  if (item.kind === 'lymph_node_count') return `Lymph Node Count · Specimen ${item.specimen} · Positive / Total ${item.positive} / ${item.total}`;
  return item.kind === 'ai' ? 'Archived AI Result' : 'Completed Consultation';
}

function evidenceRoute(item: Evidence, caseId: string) {
  if (item.kind === 'analysis_run') return item.snapshot?.id && item.scan_id
    ? `#viewer/${caseId}/${item.scan_id}/${item.snapshot.id}` : '#request/' + item.request_id;
  return item.kind === 'lymph_node_count' || item.kind === 'ihc_review' ? `#viewer/${caseId}/${item.scan_id}` : '#request/' + item.id;
}

export function CaseReport({ endpoint, caseId, caseVersion, caseChanged }: {
  endpoint: string; caseId: string; caseVersion?: number; caseChanged: () => void;
}) {
  const [data, setData] = useState<Report>();
  const [draft, setDraft] = useState<Draft>();
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState<Revision>();
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [accession, setAccession] = useState('');
  const [linkReason, setLinkReason] = useState('');

  const load = useCallback(async (signal?: AbortSignal, preserveDraft = false) => {
    const result = await api<Report>(endpoint, { signal });
    if (signal?.aborted) return;
    setData(result);
    if (!preserveDraft) {
      const initial = draftOf(result);
      setDraft(initial);
      setSaved(JSON.stringify(initial));
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((failure) => { if (!controller.signal.aborted) setError(describe(failure)); });
    return () => controller.abort();
  }, [load]);

  const inFlight = data?.deliveries.some(({ status }) => ['queued', 'sending', 'retry_wait'].includes(status));
  useEffect(() => {
    if (!inFlight) return;
    const controller = new AbortController();
    const id = window.setInterval(() => void load(controller.signal, true).catch(() => {}), 1200);
    return () => { controller.abort(); window.clearInterval(id); };
  }, [load, inFlight]);

  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await task(); } catch (failure) { setError(describe(failure)); } finally { setBusy(false); }
  }

  if (!data || !draft) return <section aria-label="Case Report">
    {error ? <><p role="alert" className="form-error">{error}</p>
      <button className="button secondary" onClick={() => void perform(() => load())}>Reload Report</button></>
      : <p role="status">Loading report…</p>}
  </section>;

  const latest = data.draft;
  const dirty = JSON.stringify(draft) !== saved;
  const editable = !latest || latest.status === 'draft';
  const templateValues = data.templates.some(({ id }) => id === draft.template.id) ? data.templates : [...data.templates, draft.template];
  const currentDelivery = data.deliveries.find((item) => item.report_version === latest?.version);

  function editSection(key: string, text: string) {
    setDraft((current) => current && { ...current, sections: { ...current.sections, [key]: text } });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    void perform(async () => {
      await api(endpoint, jsonBody('PUT', {
        version: latest?.version ?? 0, template_id: draft.template.id, sections: draft.sections,
        evidence_ids: draft.evidence_ids, dictated_sections: draft.dictated_sections,
      }));
      setVersion(undefined);
      await load();
      setNotice('Report draft saved.');
    });
  }

  function action(actionName: 'submit' | 'approve' | 'return' | 'correct') {
    if (!latest) return;
    void perform(async () => {
      await api(endpoint + '/actions', jsonBody('POST', { version: latest.version, action: actionName, reason: reason.trim() || null, reviewed }));
      setReviewed(false);
      setReason('');
      setVersion(undefined);
      await load();
    });
  }

  function send(retry = false) {
    if (!latest) return;
    void perform(async () => {
      await api(endpoint + (retry ? '/retry' : '/send'), jsonBody('POST', { version: latest.version }));
      await load();
      setNotice('Mock LIS delivery queued.');
    });
  }

  return <section className="case-report" aria-label="Case Report">
    <div className="preview-label"><h2>Case Report</h2>
      <span className="count">{latest ? `Version ${latest.version} · ${phases[latest.status]}` : 'Not Started'}</span></div>
    {latest?.replaces_version && <p className="integration-note">Correction of Version {latest.replaces_version} · {latest.correction_reason}</p>}
    {error && <div role="alert" className="form-error">{error} <button className="button secondary" type="button" disabled={busy}
      onClick={() => void perform(() => load())}>Reload Report</button></div>}
    {notice && <p role="status">{notice}</p>}
    {data.can_manage_templates && <div>
      <button className="button secondary" type="button" onClick={() => setShowTemplateEditor((value) => !value)}>Manage Templates</button>
      {showTemplateEditor && <TemplateEditor templates={data.templates} endpoint={endpoint.replace(/\/cases\/[^/]+\/report$/, '/report-templates')}
        onChanged={() => void load(undefined, true)} />}
    </div>}
    {editable ? <>
      <form className="history-manual" aria-label="Edit Report Draft" onSubmit={save}>
        <label className="form-field">Report Template
          <select value={draft.template.id ?? ''} disabled={busy} onChange={(event) => {
            const template = templateValues.find((item) => (item.id ?? '') === event.target.value);
            if (!template) return;
            const retained = template.sections.map((item) => ({
              key: item.key, previous: draft.template.sections.find((section) => section.label === item.label)?.key,
            }));
            setDraft({ ...draft, template,
              sections: Object.fromEntries(retained.map(({ key, previous }) => [key, previous ? draft.sections[previous] ?? '' : ''])),
              dictated_sections: retained.filter(({ previous }) => previous && draft.dictated_sections.includes(previous)).map(({ key }) => key),
            });
          }}>
            {templateValues.map((item) => <option key={item.id ?? 'default'} value={item.id ?? ''}>{item.name} · Version {item.version}</option>)}
          </select>
        </label>
        {draft.template.sections.map((item) => <label className="form-field" key={item.key}>{item.label}{item.required && ' (Required)'}
          <textarea rows={item.required ? 5 : 3} maxLength={12000} value={draft.sections[item.key] ?? ''} disabled={busy}
            onChange={(event) => editSection(item.key, event.target.value)} />
        </label>)}
        <fieldset className="report-evidence"><legend>Result Evidence</legend>
          {data.evidence.length ? data.evidence.map((item) => <label key={item.id}>
            <input type="checkbox" checked={draft.evidence_ids.includes(item.id)} onChange={(event) => {
              const selected = event.target.checked;
              setDraft({ ...draft, evidence_ids: selected ? [...draft.evidence_ids, item.id] : draft.evidence_ids.filter((id) => id !== item.id) });
            }} disabled={busy} />
            {evidenceLabel(item)} · Version {item.version}{item.superseded ? ' (Superseded)' : ''} · {date.format(new Date(item.completed_at))}
            <a href={evidenceRoute(item, caseId)}>Open Evidence</a>
          </label>) : <p className="muted">No completed case results are available.</p>}
        </fieldset>
        <button className="button primary" type="submit" disabled={busy || (!!latest && !dirty)}>Save Draft</button>
      </form>
      <ReportDictation key={draft.template.id ?? 'default'} sections={draft.template.sections} apply={(key, transcript) => {
        const combined = [draft.sections[key], transcript].filter(Boolean).join('\n');
        if (combined.length > 12000) return false;
        setDraft({ ...draft, sections: { ...draft.sections, [key]: combined },
          dictated_sections: [...new Set([...draft.dictated_sections, key])] });
        return true;
      }} />
      {latest && <div className="actions">
        <button className="button secondary" type="button" disabled={dirty || busy} onClick={() => action('submit')}>Submit for Review</button>
      </div>}
    </> : latest && <ReportSnapshot row={latest} caseId={caseId} />}
    {latest?.status === 'in_review' && data.can_approve && <div className="history-manual">
      <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed this report and its evidence.</label>
      <label className="form-field">Return Reason<input value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="actions"><button className="button primary" disabled={busy || !reviewed} onClick={() => action('approve')}>Approve Report</button>
        <button className="button secondary" disabled={busy || !reason.trim()} onClick={() => action('return')}>Return to Draft</button></div>
    </div>}
    {latest?.status === 'approved' && <div className="history-manual">
      <label className="form-field">Correction Reason<input maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button className="button secondary" disabled={busy || !reason.trim() || (!!currentDelivery && currentDelivery.status !== 'acknowledged')}
        onClick={() => action('correct')}>Start Correction</button>
    </div>}
    <div className="history-manual" aria-label="LIS Delivery">
      <h3>LIS Delivery</h3>
      <p className="muted">{data.lis_enabled ? 'Development Mock Report Delivery Enabled' : 'Mock report delivery is disabled. Enable it in LIS integration settings.'}</p>
      <p className="muted">{data.lis_accession ? `LIS accession ${data.lis_accession}` : 'Link one LIS accession before sending.'}</p>
      {!data.lis_accession && data.can_manage_templates && caseVersion && <form className="history-manual" onSubmit={(event) => {
        event.preventDefault();
        void perform(async () => {
          await api(endpoint.replace(/\/report$/, '/external-identifiers'), jsonBody('POST', {
            system: 'lis.mock', kind: 'ACCESSION', value: accession, version: caseVersion, reason: linkReason,
          }));
          setAccession('');
          setLinkReason('');
          caseChanged();
          await load(undefined, true);
        });
      }}>
        <label className="form-field">Mock LIS Accession<input maxLength={160} value={accession} required onChange={(event) => setAccession(event.target.value)} /></label>
        <label className="form-field">Link Reason<input maxLength={240} value={linkReason} required onChange={(event) => setLinkReason(event.target.value)} /></label>
        <button type="submit" className="button secondary" disabled={busy}>Link Mock LIS Accession</button>
      </form>}
      {latest?.status === 'approved' && !currentDelivery && <button className="button primary"
        disabled={busy || !data.lis_enabled || !data.lis_accession} onClick={() => send()}>Queue Mock LIS Delivery</button>}
      {currentDelivery?.status === 'failed' && <button className="button secondary" disabled={busy || !data.lis_enabled}
        onClick={() => send(true)}>Retry LIS Delivery</button>}
      {data.deliveries.length > 0 && <ul className="timeline">{data.deliveries.map((item) => <li key={item.id}>
        Version {item.report_version} · {item.kind === 'initial' ? 'Initial' : 'Correction'} · {deliveryLabels[item.status]} · Attempts {item.attempts}
        {item.error && <p>{failures[item.error] ?? 'Delivery failed.'}</p>}
        {item.ack_id && <small className="report-identifier">ACK {item.ack_id}</small>}
      </li>)}</ul>}
    </div>
    {data.history.length > 0 && <details className="report-history"><summary>Version History</summary>
      <ul className="timeline">{data.history.map((row) => <li key={row.version}>
        <div><strong>Version {row.version} · {actionNames[row.action] ?? phases[row.status]}</strong>
          <p>{row.author ?? 'Unknown User'} · {date.format(new Date(row.created_at))}</p>
          {row.reason && <p>{row.reason}</p>}
        </div>
        <button className="button secondary" type="button" aria-label={`View Version ${row.version}`} disabled={busy}
          onClick={() => void perform(async () => setVersion(await api<Revision>(endpoint + '/versions/' + row.version)))}>View Version</button>
      </li>)}</ul>
      {version && <div className="history-manual"><h3>Version {version.version} · {phases[version.status]}</h3>
        {version.replaces_version && <p>Correction of Version {version.replaces_version} · {version.correction_reason}</p>}
        <ReportSnapshot row={version} caseId={caseId} />
      </div>}
    </details>}
  </section>;
}

function ReportSnapshot({ row, caseId }: { row: Revision; caseId: string }) {
  return <section className="report-snapshot" aria-label="Saved Report Content">
    <p className="muted">{row.template.name} · Template Version {row.template.version}</p>
    {row.template.sections.map((section) => <div key={section.key}><h3>{section.label}</h3>
      <p>{row.sections[section.key] || '—'}</p>
      {row.dictated_sections.includes(section.key) && <small className="muted">Dictation draft used</small>}
    </div>)}
    {!!row.evidence.length && <><h3>Versioned Result Evidence</h3><ul className="timeline">{row.evidence.map((entry) => <li key={entry.id}>
      <a href={evidenceRoute(entry, caseId)}>{evidenceLabel(entry)}</a> · Version {entry.version}
      {entry.kind === 'lymph_node_count' && entry.reason && <p>{entry.reason}</p>}
      {entry.snapshot && <p>{entry.snapshot.score_type ?? 'AI'} · {entry.snapshot.model ?? 'Model unavailable'} · {entry.snapshot.model_version ?? 'Version unavailable'}
        {entry.snapshot.analysis_version && ` · Analysis ${entry.snapshot.analysis_version}`}</p>}
      {entry.snapshot && entry.scan_id && <a className="button secondary"
        href={`#viewer/${caseId}/${entry.scan_id}/${entry.snapshot.id}`}>Open Result in Viewer</a>}
      {entry.result_note && <p>{entry.result_note}</p>}
    </li>)}</ul></>}
  </section>;
}

function TemplateEditor({ templates, endpoint, onChanged }: { templates: Template[]; endpoint: string; onChanged: () => void }) {
  const [selection, setSelection] = useState('');
  const [name, setName] = useState('');
  const [lines, setLines] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const selected = templates.find((item) => item.id === selection);
    try {
      const sections = lines.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => ({
        key: selected?.sections[index]?.key ?? `section_${index + 1}`,
        label: line.replace(/^\*\s*/, ''), required: line.startsWith('*'),
      }));
      await api(endpoint, jsonBody('POST', { template_key: selected?.template_key, version: selected?.version ?? 0, name, sections }));
      setSelection('');
      setName('');
      setLines('');
      setNotice('Report template saved.');
      onChanged();
    } catch (failure) { setError(describe(failure)); } finally { setBusy(false); }
  }

  return <form className="history-manual" aria-label="Manage Report Templates" onSubmit={(event) => void save(event)}>
    <label className="form-field">Template Record<select value={selection} onChange={(event) => {
      const selected = templates.find((item) => item.id === event.target.value);
      setSelection(event.target.value);
      setName(selected?.name ?? '');
      setLines(selected?.sections.map(({ label, required }) => `${required ? '*' : ''}${label}`).join('\n') ?? '');
    }}><option value="">New Template</option>
      {templates.filter((item) => !!item.id).map((item) => <option key={item.id} value={item.id!}>{item.name} · Version {item.version}</option>)}
    </select></label>
    <label className="form-field">Template Name<input value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} /></label>
    <label className="form-field">Template Sections<textarea rows={5} required value={lines} onChange={(event) => setLines(event.target.value)} /></label>
    <p className="muted">Enter one section per line. Start required sections with *.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button type="submit" className="button primary" disabled={busy}>Save Template Version</button>
  </form>;
}
