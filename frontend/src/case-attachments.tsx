import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { api, request } from './session';

export type AttachmentKind = 'pdf' | 'gross';
type Attachment = { id: string; filename: string; specimen_id: string | null; pages: number | null; size_bytes: number; created_at: string };
type Specimen = { id: string; specimen_number: string; description: string | null };
type Catalog = { records: Attachment[]; specimens: Specimen[]; can_upload: boolean; max_upload_bytes: number };
type Activity = { id: string; action: 'attachment_registered' | 'attachment_downloaded'; occurred_at: string; actor: string | null };

const titles = { pdf: 'Media', gross: 'Gross Images' };
const formats = { pdf: 'PDF', gross: 'JPEG or PNG' };
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const specimenName = (specimen: Specimen) => `Specimen ${specimen.specimen_number}${specimen.description ? ` · ${specimen.description}` : ''}`;

export function AttachmentDialog({ endpoint, kind, onClose }: { endpoint: string; kind: AttachmentKind; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="patient-history-dialog" aria-labelledby="attachment-dialog-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="panel-title"><h2 id="attachment-dialog-title">{titles[kind]}</h2>
      <button type="button" aria-label="Close Attachments" className="icon-button" onClick={onClose}><X size={19} /></button></div>
    <div className="dialog-content"><CaseAttachments endpoint={endpoint} kind={kind} /></div>
  </dialog>;
}

export function CaseAttachments({ endpoint, kind, heading = false }: { endpoint: string; kind: AttachmentKind; heading?: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [selection, setSelection] = useState('');
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const href = `${endpoint}/${kind}`;
  const isGross = kind === 'gross';
  const visible = catalog?.records.filter(({ specimen_id }) => !filter || specimen_id === filter) ?? [];
  const active = visible.find(({ id }) => id === selection) ?? visible[0];

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<Catalog>(href, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setCatalog(result); })
      .catch((failure: Error) => { if (!controller.signal.aborted) { setCatalog(undefined); setError(failure.message); } });
    return () => controller.abort();
  }, [href, attempt]);

  return <section className="case-attachments" aria-label={`${titles[kind]} Attachments`}>
    <div className="preview-label">
      {heading && <h2>{titles[kind]}</h2>}
      {catalog?.can_upload && (!isGross || catalog.specimens.length > 0) && !formOpen &&
        <button type="button" className="button primary" onClick={() => setFormOpen(true)}>{isGross ? 'Add Gross Image' : 'Attach PDF'}</button>}
    </div>
    {error && <div role="alert" className="form-error">{error} <button type="button" className="button secondary"
      onClick={() => setAttempt((value) => value + 1)}>Retry Attachments</button></div>}
    {!catalog && !error && <p role="status">Loading attachments…</p>}
    {catalog && <>
      {formOpen && <UploadAttachment href={href} catalog={catalog} kind={kind} preferredSpecimen={filter} onCancel={() => setFormOpen(false)}
        onSaved={(added) => {
          setSelection(added.id);
          if (filter && added.specimen_id !== filter) setFilter(added.specimen_id ?? '');
          setCatalog({ ...catalog, records: [added, ...catalog.records.filter(({ id }) => id !== added.id)] });
          setFormOpen(false);
        }} />}
      {isGross && catalog.specimens.length > 0 && <label className="form-field attachment-filter">Filter by Specimen
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="">All Specimens</option>
          {catalog.specimens.map((specimen) => <option key={specimen.id} value={specimen.id}>{specimenName(specimen)}</option>)}
        </select>
      </label>}
      {!visible.length && <p className="empty-inline">{isGross
        ? catalog.specimens.length > 0 ? 'No gross images for this selection.' : 'Register a specimen before adding gross images.'
        : 'No PDF documents attached to this case.'}</p>}
      {active && <div className="attachment-layout">
        <section aria-label="Attachment List"><ul>{visible.map((entry) => {
          const specimen = catalog.specimens.find(({ id }) => id === entry.specimen_id);
          return <li key={entry.id}><button type="button" aria-pressed={active.id === entry.id} onClick={() => setSelection(entry.id)}>
            <strong>{entry.filename}</strong>
            <small>{specimen ? specimenName(specimen) : `${entry.pages} ${entry.pages === 1 ? 'page' : 'pages'}`} · {sizeLabel(entry.size_bytes)}</small>
          </button></li>;
        })}</ul></section>
        <AttachmentPreview key={active.id} attachment={active} href={`${href}/${active.id}`} />
      </div>}
    </>}
  </section>;
}

function UploadAttachment({ href, kind, catalog, preferredSpecimen, onSaved, onCancel }: {
  href: string; kind: AttachmentKind; catalog: Catalog; preferredSpecimen: string; onSaved: (entry: Attachment) => void; onCancel: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [specimen, setSpecimen] = useState(preferredSpecimen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const retry = useRef<{ file: File; specimen: string; key: string } | null>(null);
  const ongoing = useRef<AbortController | null>(null);
  useEffect(() => () => ongoing.current?.abort(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || saving || (kind === 'gross' && !specimen)) return;
    if (file.size > catalog.max_upload_bytes) {
      setError('The file exceeds the attachment size limit.');
      return;
    }
    if (retry.current?.file !== file || retry.current.specimen !== specimen) {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      retry.current = { file, specimen, key };
    }
    const controller = new AbortController();
    ongoing.current = controller;
    setError('');
    setSaving(true);
    try {
      const url = kind === 'gross' ? `${href}?specimen_id=${encodeURIComponent(specimen)}` : href;
      const result = await api<Attachment>(url, { method: 'POST', signal: controller.signal, body: file,
        headers: { 'Idempotency-Key': retry.current.key, 'X-File-Name': encodeURIComponent(file.name) } });
      if (!controller.signal.aborted) onSaved(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to upload the attachment.');
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <form className="history-manual" aria-label="Upload Attachment" onSubmit={(event) => void save(event)}>
    {kind === 'gross' && <label className="form-field">Target Specimen
      <select value={specimen} required disabled={saving} onChange={(event) => setSpecimen(event.target.value)}>
        <option value="">Select a Specimen</option>
        {catalog.specimens.map((entry) => <option key={entry.id} value={entry.id}>{specimenName(entry)}</option>)}
      </select>
    </label>}
    <label className="form-field">Attachment File
      <input type="file" required disabled={saving} accept={kind === 'pdf' ? '.pdf,application/pdf' : '.jpg,.jpeg,.png,image/jpeg,image/png'}
        onChange={(event) => { setFile(event.target.files?.[0]); setError(''); }} />
    </label>
    <p className="muted">{formats[kind]} · Up to {catalog.max_upload_bytes / (1024 * 1024)} MB</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="actions">
      <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="submit" className="button primary" disabled={saving || !file}>{saving ? 'Uploading…' : 'Upload Attachment'}</button>
    </div>
  </form>;
}

function AttachmentPreview({ attachment, href }: { attachment: Attachment; href: string }) {
  const [page, setPage] = useState(1);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState<Activity[]>();
  const [activityError, setActivityError] = useState('');
  const [activityAttempt, setActivityAttempt] = useState(0);
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => download.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setImage('');
    setError('');
    request(`${href}/preview?page=${page}`, { signal: controller.signal }).then((response) => response.blob())
      .then((blob) => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob);
          setImage(url);
        }
      }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [href, page, attempt]);

  useEffect(() => {
    if (!showActivity) return;
    const controller = new AbortController();
    setActivityError('');
    api<Activity[]>(`${href}/activity`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setActivity(result); })
      .catch((failure: Error) => { if (!controller.signal.aborted) setActivityError(failure.message); });
    return () => controller.abort();
  }, [href, showActivity, activityAttempt]);

  async function saveFile() {
    const controller = new AbortController();
    download.current = controller;
    setDownloadError('');
    setDownloadBusy(true);
    try {
      const blob = await (await request(`${href}/download`, { method: 'POST', signal: controller.signal })).blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
      setActivityAttempt((value) => value + 1);
    } catch (failure) {
      if (!controller.signal.aborted) setDownloadError(failure instanceof Error ? failure.message : 'Unable to download the attachment.');
    } finally {
      if (!controller.signal.aborted) setDownloadBusy(false);
    }
  }

  return <section className="attachment-preview" aria-label="Attachment Preview">
    <div className="preview-label"><h3>{attachment.filename}</h3>
      <button type="button" className="button secondary" disabled={downloadBusy} onClick={() => void saveFile()}>Download Attachment</button>
    </div>
    {downloadError && <p role="alert" className="form-error">{downloadError}</p>}
    {attachment.pages !== null && <div className="attachment-pages">
      <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous Page</button>
      <output aria-label="PDF Page">Page {page} of {attachment.pages}</output>
      <button type="button" className="button secondary" disabled={page >= attachment.pages} onClick={() => setPage(page + 1)}>Next Page</button>
    </div>}
    {error ? <div role="alert" className="form-error">{error} <button type="button" className="button secondary"
      onClick={() => setAttempt((value) => value + 1)}>Retry Preview</button></div>
      : image ? <img src={image} className="attachment-image" alt={attachment.pages === null ? 'Gross specimen photograph' : `PDF page ${page}`}
        onError={() => setError('The attachment preview could not be displayed.')} /> : <p role="status">Loading preview…</p>}
    <button type="button" className="button secondary" aria-expanded={showActivity} onClick={() => setShowActivity(!showActivity)}>Attachment Activity</button>
    {showActivity && (activityError ? <div role="alert" className="form-error">{activityError} <button type="button" className="button secondary"
      onClick={() => setActivityAttempt((value) => value + 1)}>Retry Activity</button></div>
      : !activity ? <p role="status">Loading activity…</p> : <ul className="timeline">
        {activity.map((entry) => <li key={entry.id}>{entry.action === 'attachment_downloaded' ? 'Downloaded' : 'Registered'} · {entry.actor ?? 'User'} · {date.format(new Date(entry.occurred_at))}</li>)}
      </ul>)}
  </section>;
}
