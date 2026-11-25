import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, jsonBody, request } from './session';
import type { DemoCase } from './demo';
import { PatientMatch } from './patient-match';
import type { PatientSelection } from './patient-match';

type Versioned = { id: string; version: number; history: Event[] };
type Specimen = Versioned & { specimen_number: string; description: string | null; collection_date: string | null };
type Block = Versioned & { block_number: string; specimen_id: string };
type Slide = Versioned & { slide_number: string; stain: string | null; specimen_id: string; block_id: string | null;
  barcode: string | null; label_text: string | null };
type Event = { version: number; action: string; reason?: string; source: string; at: string; after: Record<string, string | number | null> };
type Scan = Versioned & { slide_id: string; storage_key: string; format: string; scanner: string | null;
  qc_status: keyof typeof qualityLabels; replaces_id: string | null };
type EditorData = { specimens: Specimen[]; blocks: Block[]; slides: Slide[]; scans: Scan[] };
type OCR = { candidate: string; scan_id: string; version: number; source: string; engine: string };
const qualityLabels = { unassessed: 'Unassessed', passed: 'Passed', hold: 'On Hold', rescan_required: 'Rescan Required', replaced: 'Replaced' };
const actions: Record<string, string> = {
  registered: 'Registered', scanner_edited: 'Scanner Metadata Edited', scan_structure_checked: 'Structure Check',
  scan_label_uploaded: 'Label Uploaded', label_ocr_generated: 'OCR Candidate Generated', scan_qc_recorded: 'QC Recorded',
  scan_replaced: 'Scan Replaced', replacement_registered: 'Replacement Registered',
  specimen_edited: 'Specimen Edited', block_registered: 'Block Registered', block_edited: 'Block Edited', slide_edited: 'Slide Edited',
};

function message(failure: unknown) {
  return failure instanceof Error ? failure.message : 'The Case Editor could not complete this action.';
}

function fieldValues(form: HTMLFormElement) {
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, typeof value === 'string' ? value.trim() || null : value]));
}

function Field({ label, name, value, type = 'text', required = false, maxLength = 120 }: {
  label: string; name: string; value?: string | null; type?: string; required?: boolean; maxLength?: number;
}) {
  return <label className="form-field">{label}<input type={type} name={name} defaultValue={value ?? ''} maxLength={maxLength} required={required} /></label>;
}

function EditForm({ action, save, children }: { action: string; save: (data: object) => Promise<unknown>; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await save(fieldValues(event.currentTarget)); } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <form className="editor-form" onSubmit={(event) => void submit(event)}>
    <div className="editor-fields">{children}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button secondary" disabled={busy}>{busy ? 'Saving…' : action}</button>
  </form>;
}

function Reason() { return <Field label="Reason for Change" name="reason" maxLength={240} required />; }

function CreateRecord({ action, endpoint, data, onChanged, children }: {
  action: string; endpoint: string; data: object; onChanged: () => void; children: ReactNode;
}) {
  const [key] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join(''));
  return <EditForm action={action} save={async (values) => {
    await api(endpoint, jsonBody('POST', { ...data, ...values }, { 'Idempotency-Key': key }));
    onChanged();
  }}>{children}</EditForm>;
}

function ScanQuality({ scan, path, editable, canImport, onChanged, onCandidate }: {
  scan: Scan; path: string; editable: boolean; canImport: boolean; onChanged: () => void; onCandidate: (value: OCR) => void;
}) {
  const [label, setLabel] = useState<{ url: string; source: string }>();
  const [labelError, setLabelError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [qcSource, setQcSource] = useState('manual');
  const editableScan = editable && scan.qc_status !== 'replaced';
  useEffect(() => {
    const controller = new AbortController();
    let url = '';
    setLabel(undefined);
    setLabelError('');
    request(path + '/label.jpeg', { signal: controller.signal }).then(async (response) => {
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setLabel({ url, source: response.headers.get('X-Label-Source') === 'uploaded' ? 'Uploaded Label' : 'Embedded Scan Label' });
    }).catch((failure) => { if (!controller.signal.aborted) setLabelError(message(failure)); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [path, attempt]);

  async function mutate(suffix: string, method: string, fields: object) {
    const result = await api(path + suffix, jsonBody(method, { ...fields, version: scan.version }));
    onChanged();
    return result;
  }

  return <div className="editor-scan-content">
    <section className="editor-label">
      <h4>Scan Label</h4>
      {label ? <><img src={label.url} alt="Scan label" /><p>{label.source}</p></>
        : <p role={labelError ? 'alert' : 'status'}>{labelError || 'Loading label…'}</p>}
      <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>Retry Label</button>
      {editableScan && <>
        <EditForm action="Upload Label" save={async (fields) => {
          const file = (fields as { image: File }).image;
          if (file.size > 2 * 1024 * 1024) throw new Error('Label images are limited to 2 MB.');
          await api(`${path}/label?version=${scan.version}`, { method: 'PUT', body: file });
          setAttempt((value) => value + 1); onChanged();
        }}><label className="form-field">Label Image<input name="image" type="file" accept="image/jpeg,image/png" required /></label></EditForm>
        {label && <EditForm action="Read Label with OCR" save={async (fields) => {
          const candidate = await api<OCR>(path + '/ocr', jsonBody('POST', { ...fields, version: scan.version }));
          onCandidate(candidate); onChanged();
        }}><Field label="OCR Reason" name="reason" required maxLength={240} /></EditForm>}
      </>}
    </section>
    <section className="editor-qc">
      <h4>Scan Quality</h4>
      <p><strong>{qualityLabels[scan.qc_status]}</strong>{scan.replaces_id && ' · Replacement Scan'}</p>
      {notice && <p role="status">{notice}</p>}
      {editableScan && <>
        <div>
          <EditForm action="Save Scanner" key={scan.scanner ?? ''} save={(fields) => mutate('', 'PATCH', fields)}>
            <Field label="Scanner" name="scanner" value={scan.scanner} /><Reason />
          </EditForm>
          <EditForm action="Check Scan Structure" save={async (fields) => {
            const result = await mutate('/check', 'POST', fields) as { error?: string };
            setNotice(result.error || 'Scan structure check passed.');
          }}><Field label="Structure Check Reason" name="reason" required maxLength={240} /></EditForm>
          <EditForm action="Record QC" save={(fields) => mutate('/qc', 'POST', fields)}>
            <label className="form-field">QC Source<select name="source" value={qcSource} onChange={(event) => setQcSource(event.target.value)}>
              <option value="manual">Manual Decision</option>{canImport && <><option value="scanner">Scanner Observation</option><option value="ai">AI Observation</option></>}
            </select></label>
            <label className="form-field">QC Outcome<select name="outcome" defaultValue="hold">
              <option value="passed">Passed</option><option value="hold">On Hold</option><option value="rescan_required">Rescan Required</option>
            </select></label>
            {qcSource !== 'manual' && <><Field name="provider" label="Provider / Version" required /><Field name="reference" label="Result Reference" required /></>}
            <Field label="QC Reason" name="reason" required maxLength={240} />
          </EditForm>
          {(scan.qc_status === 'hold' || scan.qc_status === 'rescan_required') &&
            <EditForm action="Register Replacement" save={(fields) => mutate('/replacement', 'POST', fields)}>
              <Field label="Replacement Path Under data/" name="storage_key" required maxLength={512} />
              <Field label="Replacement Scanner" name="scanner" /><Field label="Replacement Reason" name="reason" required maxLength={240} />
            </EditForm>}
        </div>
      </>}
      <RecordHistory title="Scan History" events={scan.history} />
    </section>
  </div>;
}

function RecordHistory({ title, events }: { title: string; events: Event[] }) {
  return events.length ? <details className="editor-history"><summary>{title}</summary><ul className="timeline">
    {events.map((event) => <li key={event.version}><strong>{actions[event.action] ?? event.action}</strong>
      <p>{event.source} · {new Date(event.at).toLocaleString('en-US')}</p>
      {event.after.outcome && <p>{qualityLabels[event.after.outcome as keyof typeof qualityLabels]}</p>}
      {event.after.provider && <p>{event.after.provider}{event.after.reference ? ` · ${event.after.reference}` : ''}</p>}
      {event.after.label_source === 'ocr_confirmed' && <p>OCR Candidate Confirmed</p>}
      {event.after.error && <p>{event.after.error}</p>}{event.reason && <p>{event.reason}</p>}
    </li>)}
  </ul></details> : null;
}

function ScanEntry({ focused, ...props }: Parameters<typeof ScanQuality>[0] & { focused: boolean }) {
  const [open, setOpen] = useState(focused);
  const { scan } = props;
  const summary = useRef<HTMLElement>(null);
  useEffect(() => { if (focused) summary.current?.focus(); }, [focused]);
  return <details className="editor-scan" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary ref={summary} data-focused-scan={focused || undefined}>{scan.storage_key} · {scan.format} · {qualityLabels[scan.qc_status]}</summary>
    {open && <ScanQuality {...props} />}
  </details>;
}

function SlideEditor({ slide, scans, blocks, apiRoot, path, editable, canImport, onChanged, focusScan }: {
  slide: Slide; scans: Scan[]; blocks: Block[]; apiRoot: string; path: string; editable: boolean; canImport: boolean; onChanged: () => void; focusScan?: string;
}) {
  const [ocr, setOcr] = useState<OCR>();
  const [confirmed, setConfirmed] = useState(false);
  const [labelText, setLabelText] = useState(slide.label_text ?? '');
  const [newScan, setNewScan] = useState(false);
  async function save(data: object) {
    await api(path + '/slides/' + slide.id, jsonBody('PATCH', { ...data, version: slide.version,
      confirmed_ocr_scan: confirmed ? ocr?.scan_id : null, confirmed_ocr_version: confirmed ? ocr?.version : null }));
    setOcr(undefined); setConfirmed(false); onChanged();
  }
  return <details className="editor-slide" open={scans.some(({ id }) => id === focusScan) || undefined}>
    <summary>{slide.slide_number} · {slide.stain || 'No Stain'} · {scans.length} scans</summary>
    {editable && <EditForm action="Save Slide Details" save={save} key={slide.version}>
      <Field label="Slide Number" name="slide_number" value={slide.slide_number} required maxLength={80} />
      <Field label="Stain" name="stain" value={slide.stain} maxLength={80} />
      <label className="form-field">Block<select name="block_id" defaultValue={slide.block_id ?? ''}>
        <option value="">No Block</option>{blocks.map((block) => <option key={block.id} value={block.id}>{block.block_number}</option>)}
      </select></label>
      <Field label="Barcode" name="barcode" value={slide.barcode} />
      <label className="form-field">Confirmed Label Text<textarea name="label_text" maxLength={500} value={labelText}
        onChange={(event) => setLabelText(event.target.value)} /></label>
      <Reason />
    </EditForm>}
    {!editable && <dl className="key-values">
      <div><dt>Block</dt><dd>{blocks.find((block) => block.id === slide.block_id)?.block_number ?? 'Not Recorded'}</dd></div>
      <div><dt>Barcode</dt><dd>{slide.barcode ?? 'Not Recorded'}</dd></div>
      <div><dt>Confirmed Label Text</dt><dd>{slide.label_text ?? 'Not Recorded'}</dd></div>
    </dl>}
    {ocr && <div className="notice editor-ocr" role="status"><p><strong>OCR Candidate ({ocr.engine})</strong><br />{ocr.candidate}
      {slide.barcode && !ocr.candidate.toUpperCase().includes(slide.barcode) && <><br />Saved barcode was not found in this candidate. Check the label before saving.</>}
      </p>
      <button type="button" className="button secondary" onClick={() => {
        setLabelText(ocr.candidate); setConfirmed(true);
      }}>{confirmed ? 'Candidate Ready to Save' : 'Use Candidate After Review'}</button></div>}
    <RecordHistory title="Slide History" events={slide.history} />
    {editable && <button className="button secondary" onClick={() => setNewScan(!newScan)}>{newScan ? 'Close Scan Registration' : 'Add Scan'}</button>}
    {newScan && <CreateRecord action="Register Scan" endpoint={apiRoot + '/scans'} data={{ slide_id: slide.id }}
      onChanged={() => { setNewScan(false); onChanged(); }}><Field label="Scan Path Under data/" name="storage_key" required maxLength={512} /></CreateRecord>}
    {scans.map((scan) => <ScanEntry key={scan.id} scan={scan} focused={focusScan === scan.id} path={path + '/scans/' + scan.id} editable={editable}
      canImport={canImport} onChanged={onChanged} onCandidate={(candidate) => { setOcr(candidate); setConfirmed(false); }} />)}
  </details>;
}

export function CaseEditor({ item, organization, editable, canImport, patient, onChanged, focusScan }: {
  item: DemoCase; organization: string; editable: boolean; canImport: boolean; patient?: ReactNode; onChanged: () => void; focusScan?: string;
}) {
  const apiRoot = '/api/clinical/' + encodeURIComponent(organization);
  const path = apiRoot + '/editor';
  const [data, setData] = useState<EditorData>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [addSpecimen, setAddSpecimen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientSelection>();
  const update = () => { setRefresh((value) => value + 1); onChanged(); };

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<EditorData>(path + '/cases/' + item.recordId, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(message(failure)); });
    return () => controller.abort();
  }, [path, item.recordId, refresh]);

  const focusedScan = data?.scans.find(({ id }) => id === focusScan);
  const focusedSpecimen = data?.slides.find(({ id }) => id === focusedScan?.slide_id)?.specimen_id;
  const blockedScans = data?.scans.filter(({ qc_status }) => qc_status === 'hold' || qc_status === 'rescan_required').length ?? 0;

  return <div className="case-editor">
    <div className="preview-label"><h2>Case Editor</h2>
      <button type="button" className="button secondary" onClick={() => setRefresh((value) => value + 1)}>Reload Case Editor</button></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {data && <div className="editor-context" aria-label="Intake Summary">
      <span>{item.patient ? 'Patient Linked' : 'Patient Not Linked'}</span>
      <span>{data.specimens.length} Specimens · {data.blocks.length} Blocks · {data.scans.length} Scans</span>
      {blockedScans > 0 && <span className="status-pill status-0">{blockedScans} QC Blocked</span>}
    </div>}
    {data && focusScan && !focusedScan && <p role="status">The requested scan is unavailable. Review the current scan list below.</p>}
    <details className="editor-entry" open={editable && !item.patient && !focusScan ? true : undefined}><summary>Patient Reconciliation</summary>
      {editable && <EditForm action="Link Existing Patient" save={async (fields) => {
        if (!selectedPatient) throw new Error('Find the local record and confirm the patient match.');
        await api(path + '/cases/' + item.recordId + '/patient-match',
          jsonBody('PATCH', { ...fields, patient_id: selectedPatient.id, patient_version: selectedPatient.version, version: item.version }));
        setSelectedPatient(undefined); update();
      }}>
        <PatientMatch organization={organization} item={item} selected={selectedPatient} onSelect={setSelectedPatient} />
        <Reason />
      </EditForm>}
      {patient}
    </details>
    {editable && <div><button className="button secondary" onClick={() => setAddSpecimen(!addSpecimen)}>
      {addSpecimen ? 'Close Specimen Registration' : 'Add Specimen'}</button></div>}
    {addSpecimen && <CreateRecord action="Register Specimen" endpoint={apiRoot + '/specimens'} data={{ case_id: item.recordId }}
      onChanged={() => { setAddSpecimen(false); update(); }}>
      <Field label="Specimen Number" name="specimen_number" maxLength={80} required />
      <Field label="Description" name="description" maxLength={160} /><Field label="Collection Date" name="collection_date" type="date" />
    </CreateRecord>}
    {!data && !error && <p role="status">Loading case records…</p>}
    {data?.specimens.map((specimen) => <details className="editor-entry" key={specimen.id} open={specimen.id === focusedSpecimen || undefined}>
      <summary>Specimen {specimen.specimen_number}{specimen.description ? ` · ${specimen.description}` : ''}</summary>
      <SpecimenEditor specimen={specimen} data={data} apiRoot={apiRoot} path={path} editable={editable} canImport={canImport} onChanged={update} focusScan={focusScan} />
    </details>)}
  </div>;
}

function SpecimenEditor({ specimen, data, apiRoot, path, editable, canImport, onChanged, focusScan }: {
  specimen: Specimen; data: EditorData; apiRoot: string; path: string; editable: boolean; canImport: boolean; onChanged: () => void; focusScan?: string;
}) {
  const [adding, setAdding] = useState<'block' | 'slide'>();
  const blocks = data.blocks.filter((block) => block.specimen_id === specimen.id);
  const edit = (endpoint: string, version: number, values: object) => api(path + endpoint,
    jsonBody('PATCH', { version, ...values })).then(onChanged);
  return <>
    {editable && <EditForm key={specimen.version} action="Save Specimen" save={(values) => edit('/specimens/' + specimen.id, specimen.version, values)}>
      <Field name="specimen_number" label="Specimen Number" value={specimen.specimen_number} maxLength={80} required />
      <Field name="description" label="Description" value={specimen.description} maxLength={160} />
      <Field name="collection_date" label="Collection Date" type="date" value={specimen.collection_date} /><Reason />
    </EditForm>}
    {!editable && <p>Collection Date: {specimen.collection_date ?? 'Not Recorded'}</p>}
    <RecordHistory title="Specimen History" events={specimen.history} />
    {editable && <div className="actions"><button className="button secondary" onClick={() => setAdding(adding === 'block' ? undefined : 'block')}>Add Block</button>
      <button className="button secondary" onClick={() => setAdding(adding === 'slide' ? undefined : 'slide')}>Add Slide</button></div>}
    {adding === 'block' && <EditForm action="Register Block" save={async (values) => {
      await api(path + '/specimens/' + specimen.id + '/blocks', jsonBody('POST', { ...values, version: specimen.version }));
      setAdding(undefined); onChanged();
    }}><Field name="block_number" label="Block Number" required maxLength={80} /><Reason /></EditForm>}
    {adding === 'slide' && <CreateRecord action="Register Slide" endpoint={apiRoot + '/slides'} data={{ specimen_id: specimen.id }}
      onChanged={() => { setAdding(undefined); onChanged(); }}>
      <Field name="slide_number" label="Slide Number" required maxLength={80} /><Field name="stain" label="Stain" maxLength={80} />
    </CreateRecord>}
    {blocks.map((block) => <details className="editor-block" key={block.id}>
      <summary>Block {block.block_number}</summary>
      {editable && <EditForm action="Save Block" key={block.version} save={(values) => edit('/blocks/' + block.id, block.version, values)}>
        <Field name="block_number" label="Block Number" value={block.block_number} required maxLength={80} /><Reason />
      </EditForm>}
      <RecordHistory title="Block History" events={block.history} />
    </details>)}
    {data.slides.filter((slide) => slide.specimen_id === specimen.id).map((slide) => <SlideEditor key={slide.id} slide={slide}
      blocks={blocks} scans={data.scans.filter((scan) => scan.slide_id === slide.id)} apiRoot={apiRoot} path={path}
      editable={editable} canImport={canImport} onChanged={onChanged} focusScan={focusScan} />)}
  </>;
}
