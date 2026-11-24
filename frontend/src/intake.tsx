import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowUp, FileImage, FolderOpen, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { codipaiRule, emptyFields, fieldLabels, formatIntakeDate, requestIntake } from './intake-api';
import type { Entry, FilenameRule, Match, RuleSet, SlideFields, SourceFile } from './intake-api';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to process the request.';
}

export function IntakePage({ files, loading, problem, refresh }: {
  files: SourceFile[]; loading: boolean; problem: string; refresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<{ id: string; version: number } | null>(null);
  const [draft, setDraft] = useState<SlideFields>(emptyFields);
  const [problemForm, setProblemForm] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const caseField = useRef<HTMLInputElement>(null);
  const edited = files.find(({ id }) => id === opened?.id);
  const pending = files.filter(({ entry }) => !entry).length;
  const matching = files.filter((file) => (filter === 'all' || (filter === 'pending' ? !file.entry : file.entry))
    && `${file.filename} ${file.entry?.fields.case_id ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => { if (opened) caseField.current?.focus(); }, [opened]);

  function edit(file: SourceFile) {
    setOpened({ id: file.id, version: file.entry?.version ?? 0 }); setDraft({ ...emptyFields, ...file.entry?.fields }); setNotice(''); setProblemForm('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edited || !opened) return;
    setSaving(true); setProblemForm(''); setNotice('');
    try {
      await requestIntake<Entry>(`/slides/${edited.id}`, 'PUT', { fields: draft, version: opened.version });
      await refresh();
      setOpened(null);
      setNotice('Slide details saved.');
    } catch (error) {
      setProblemForm(message(error));
    } finally { setSaving(false); }
  }

  return <>
    <div className="page-heading"><div><h1>Slide Registration</h1><p>Review NDPI and SVS files in the data/ folder and link them to cases.</p></div>
      <div className="actions"><button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} /> Refresh List</button><a className="button primary" href="#settings"><Settings2 size={16} /> Filename Rules</a></div>
    </div>
    {problem && <p className="notice" role="alert">{problem}</p>}
    {notice && <p className="success-note" role="status">{notice}</p>}
    <section className="panel">
      <div className="panel-title"><div className="title-inline"><h2>Scan Files</h2><span className="count">{files.length}</span></div></div>
      <div className="filters intake-filters">
        <div className="actions" aria-label="Slide Registration Status">
          {[['pending', `Unregistered Slides (${pending})`], ['registered', `Registered (${files.length - pending})`], ['all', 'All Files']].map(([value, label]) =>
            <button key={value} className={filter === value ? 'button primary' : 'button secondary'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <label className="search-field"><input aria-label="Search Scan Files" placeholder="Filename or Case ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      <div className="table-scroll"><table className="file-table"><thead><tr><th scope="col">Filename</th><th scope="col">Format</th><th scope="col">Case ID</th><th scope="col">Slide ID</th><th scope="col">Registration Source</th><th scope="col">Edit</th></tr></thead>
        <tbody>{matching.map((file) => <tr key={file.id}>
          <td><strong className="file-name"><FileImage size={15} />{file.filename}</strong><small className="muted">{(file.size / 2 ** 20).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB · {formatIntakeDate(file.modified)}</small></td>
          <td>{file.format}</td><td>{file.entry?.fields.case_id || '—'}</td><td>{file.entry?.fields.slide_id || '—'}</td>
          <td><span className={file.entry ? 'status-pill status-3' : 'status-pill status-0'}>{file.entry ? file.entry.source === 'rule' ? 'Filename Rules' : 'Enter Manually' : 'Not Entered'}</span></td>
          <td><button className="button secondary" onClick={() => edit(file)} aria-label={`${file.filename} ${file.entry ? 'Edit Details' : 'Enter Manually'}`}>{file.entry ? 'Edit Details' : 'Enter Manually'}</button></td>
        </tr>)}</tbody>
      </table></div>
      {!matching.length && <div className="empty" role="status"><FolderOpen size={24} /><p>{loading ? 'Loading files…' : 'No scan files match these filters.'}</p></div>}
    </section>
    {edited && <section className="panel intake-editor" aria-label="Enter Slide Details">
      <div className="panel-title"><h2>Enter Slide Details</h2><button className="button secondary" onClick={() => setOpened(null)} disabled={saving}>Close</button></div>
      <form className="detail-content" onSubmit={(event) => void submit(event)}>
        <p className="file-name">{edited.filename}</p>
        <div className="form-grid">
          {(Object.keys(fieldLabels) as (keyof SlideFields)[]).map((key) => <label key={key} className="form-field">{fieldLabels[key]}
            <input ref={key === 'case_id' ? caseField : undefined} value={draft[key]} required={key === 'case_id' || key === 'slide_id'} maxLength={key === 'case_id' || key === 'slide_id' ? 80 : 120}
              pattern={key === 'case_id' || key === 'slide_id' ? '[A-Za-z0-9][A-Za-z0-9._\\-]{0,79}' : undefined}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        </div>
        {problemForm && <p className="form-error" role="alert">{problemForm}</p>}
        <div className="actions"><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Slide Details'}</button></div>
      </form>
    </section>}
  </>;
}

const ruleFields: { key: keyof FilenameRule; label: string; hint?: string }[] = [
  { key: 'name', label: 'Rule Name' },
  { key: 'pattern', label: 'Filename Pattern (without extension)', hint: 'e.g., hospital-{case}-{block}-{slide}' },
  { key: 'case_id', label: 'Case ID Format', hint: '{case}' },
  { key: 'slide_id', label: 'Slide ID Format', hint: '{block}-{slide}' },
  { key: 'specimen', label: 'Specimen Format' }, { key: 'stain', label: 'Stain Code Format' },
  { key: 'patient_number', label: 'Patient ID Format' },
  { key: 'block_number', label: 'Block Number Format' }, { key: 'barcode', label: 'Barcode Format' },
];

export function IntakeSettings({ refresh, emrConnected }: { refresh: () => Promise<void>; emrConnected: boolean }) {
  const [saved, setSaved] = useState<RuleSet | null>(null);
  const [rules, setRules] = useState<FilenameRule[]>([]);
  const [preview, setPreview] = useState<Match[] | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const dirty = Boolean(saved && JSON.stringify(saved.rules) !== JSON.stringify(rules));

  useEffect(() => {
    const controller = new AbortController();
    requestIntake<RuleSet>('/rules', 'GET', undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setSaved(result); setRules(result.rules); }
    }).catch((error) => { if (!controller.signal.aborted) setProblem(message(error)); });
    return () => controller.abort();
  }, []);

  function update(next: FilenameRule[]) { setRules(next); setPreview(null); setProblem(''); setNotice(''); }
  function move(index: number, direction: number) {
    const next = [...rules];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    update(next);
  }

  async function act(action: 'preview' | 'save' | 'apply') {
    if (!saved) return;
    setWorking(true); setProblem(''); setNotice('');
    try {
      if (action === 'preview') {
        setPreview(await requestIntake<Match[]>('/rules/preview', 'POST', { rules }));
      } else if (action === 'save') {
        const result = await requestIntake<RuleSet>('/rules', 'PUT', { rules, version: saved.version });
        setSaved(result); setRules(result.rules); setNotice('Filename rules saved.');
      } else {
        const result = await requestIntake<{ applied: number; unchanged: number; unmatched: number }>('/rules/apply', 'POST', { version: saved.version });
        await refresh();
        setNotice(`Newly registered: ${result.applied} · Previously registered: ${result.unchanged} · Still unregistered: ${result.unmatched}`);
      }
    } catch (error) { setProblem(message(error)); }
    finally { setWorking(false); }
  }

  const hasExample = rules.some((rule) => rule.name === codipaiRule.name
    || ruleFields.every(({ key }) => key === 'name' || (rule[key] ?? '') === codipaiRule[key]));

  return <>
    <div className="page-heading"><div><h1>Settings</h1><p>Define filename rules to use when EMR is disconnected.</p></div><a className="button secondary" href="#scans">Go to Slide Registration</a></div>
    {problem && <p className="notice" role="alert">{problem}</p>}
    {notice && <p className="success-note" role="status">{notice}</p>}
    <section className="panel" aria-label="Filename Rules">
      <div className="panel-title"><div className="title-inline"><h2>Filename Rules</h2><span className="count">{rules.length}</span></div>
        <div className="actions"><button className="button secondary" disabled={!saved || working || rules.length >= 20 || hasExample} onClick={() => update([...rules, codipaiRule])}>Load CODIPAI Example</button>
          <button className="button secondary" disabled={!saved || working || rules.length >= 20} onClick={() => update([...rules, { name: '', pattern: '', case_id: '', slide_id: '', specimen: '', stain: '', block_number: '', barcode: '', patient_number: '' }])}><Plus size={15} /> Add Rule</button></div>
      </div>
      <div className="detail-content">
        <p className="muted">Wrap filename tokens in braces and use them in the output fields. Rules run from top to bottom on unregistered files. Existing registrations are preserved.</p>
        {saved && !rules.length && <p className="empty-inline">No saved rules. Load the example or add a rule.</p>}
        {rules.map((rule, index) => <fieldset className="rule-card" key={index} disabled={working}>
          <legend>{rule.name || 'New Filename Rule'}</legend>
          <div className="actions rule-order">
            <button type="button" className="icon-button" aria-label={`Rule ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="icon-button" aria-label={`Rule ${index + 1} down`} disabled={index === rules.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
            <button type="button" className="icon-button" aria-label={`Rule ${index + 1} Delete`} onClick={() => update(rules.filter((_, position) => position !== index))}><Trash2 size={16} /></button>
          </div>
          <div className="form-grid">{ruleFields.map(({ key, label, hint }) => <label className={`form-field ${key === 'pattern' ? 'pattern-field' : ''}`} key={key}>{label}
            <input value={rule[key] ?? ''} placeholder={hint} maxLength={120} onChange={(event) => update(rules.map((item, position) => position === index ? { ...item, [key]: event.target.value } : item))} />
          </label>)}</div>
        </fieldset>)}
        <div className="actions">
          <button className="button secondary" disabled={working || !rules.length} onClick={() => void act('preview')}>Preview</button>
          <button className="button secondary" disabled={working || !dirty} onClick={() => void act('save')}>Save Rules</button>
          <button className="button primary" disabled={working || dirty || emrConnected || !saved?.rules.length} onClick={() => void act('apply')}>Apply to Unregistered Slides</button>
        </div>
        {emrConnected && <p className="muted">Filename rules are available when EMR is disconnected.</p>}
      </div>
    </section>
    {preview && <section className="panel intake-editor"><div className="panel-title"><h2>Preview Filename Rules</h2><span className="count">{preview.filter(({ match }) => match).length}/{preview.length} Matched</span></div>
      <div className="table-scroll"><table className="file-table"><thead><tr><th scope="col">Filename</th><th scope="col">Matching Rule</th><th scope="col">Case ID</th><th scope="col">Slide ID</th></tr></thead>
        <tbody>{preview.map(({ id, filename, match }) => <tr key={id}><td>{filename}</td><td>{match?.rule ?? 'No matching rule'}</td><td>{match?.fields.case_id ?? '—'}</td><td>{match?.fields.slide_id ?? '—'}</td></tr>)}</tbody></table></div>
    </section>}
  </>;
}
