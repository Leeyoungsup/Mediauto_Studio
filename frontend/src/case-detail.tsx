import { RelatedCasesControl } from './related-cases-control';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ClipboardList, PencilLine, MessageSquare, FileSymlink, FileText, Camera, List, History, ScanLine, UserRound } from 'lucide-react';
import { CaseNotes } from './case-notes';
import { CaseAttachments } from './case-attachments';
import { PatientHistory } from './patient-history';
import { CaseLogsDialog } from './case-logs';
import { CaseAudit } from './case-audit';
import { readyCount } from './demo';
import type { DemoCase } from './demo';
import { ScanReference, SlidePreview, StatusLabel } from './worklist';

export function CaseDetail({ item, emr, onBack, onViewer, onAssign, onReview, onConfirm, patientIntegration, requests, report, initialTab, dates, routing, editor, selectedScan, historyEndpoint, attachmentsEndpoint, logsEndpoint, notesEndpoint, frozen, relatedEndpoint }: {
  item: DemoCase; emr: string; onBack: () => void; onViewer: (slide?: string) => void;
  onAssign?: () => void; onReview?: () => void; onConfirm?: () => void; patientIntegration?: ReactNode; requests?: ReactNode; report?: ReactNode; initialTab?: string; selectedScan?: string; historyEndpoint?: string; attachmentsEndpoint?: string; logsEndpoint?: string; notesEndpoint?: string; frozen?: ReactNode; relatedEndpoint?: string; dates?: ReactNode; routing?: ReactNode; editor?: ReactNode;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [tab, setTab] = useState(initialTab ?? 'Slides');
  const available = readyCount(item);
  const selected = item.slides.find((slide) => slide.id === selectedScan);

  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Worklist</button>
    <div className="page-heading"><div><h1>{item.id}</h1><p>{item.specimen} · Received {item.received}</p></div>
      <div className="actions"><StatusLabel status={item.status} />
        {onReview && <button className="button secondary" disabled={!available} onClick={onReview}>{item.status === 'In Review' ? 'Review Complete' : 'Start Review'}</button>}
        {relatedEndpoint && item.recordId && <RelatedCasesControl endpoint={relatedEndpoint} caseId={item.recordId} scanId={selected?.wsi?.id} />}
        {logsEndpoint && <button type="button" className="button secondary" onClick={() => setShowLogs(true)}><List size={16} /> Case Logs</button>}
        <button className="button primary" disabled={selected ? !selected.wsi : !available} onClick={() => onViewer(selected?.id)}><ScanLine size={17} /> Open Viewer</button>
      </div>
    </div>
    <div className="detail-layout">
      <section className="panel detail-panel">
        <nav className="detail-tabs" aria-label="Case Information">
          {[{ name: 'Slides', icon: ScanLine }, { name: 'Patient Information', icon: UserRound }, { name: 'History', icon: History },
            ...(attachmentsEndpoint ? [{ name: 'Media', icon: FileText }, { name: 'Gross Images', icon: Camera }] : []),
            ...(editor ? [{ name: 'Case Editor', icon: PencilLine }] : []),
            ...(notesEndpoint ? [{ name: 'Notes', icon: MessageSquare }] : []),
            ...(frozen ? [{ name: 'Frozen Section', icon: ClipboardList }] : []),
            ...(requests ? [{ name: 'Requests', icon: MessageSquare }, { name: 'Report Draft', icon: ClipboardList }] : [])].map(({ name, icon: Icon }) =>
            <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}><Icon size={16} />{name}</button>)}
        </nav>
        {tab === 'Slides' && <div className="detail-content">{dates}<div className="preview-label"><div className="title-inline"><h2>Specimens and Slides</h2><span>{available}/{item.slides.length} Viewable</span></div>
        </div>
          {item.slides.length ? <div className="detail-slides">{item.slides.map((slide) => <button className="detail-slide" aria-current={selected?.id === slide.id ? "true" : undefined} data-scan-id={slide.wsi?.id} key={slide.id} disabled={!slide.wsi} onClick={() => onViewer(slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><span><strong>{slide.label ?? slide.id}</strong><small>Specimen {slide.specimen} · {slide.stain}{slide.wsi && ` · ${slide.wsi.format}`}</small><ScanReference scan={slide.wsi} /></span><span className="muted">{slide.state}</span><ArrowRight size={16} />
          </button>)}</div> : <div className="empty"><ScanLine size={27} /><strong>No slides are linked to this case.</strong></div>}
        </div>}
        {tab === 'Patient Information' && <div className="detail-content"><div className="preview-label"><h2>Patient Information</h2>{item.source === 'files' && <a className="button secondary" href="#scans">Edit in Slide Registration</a>}</div>
          {!patientIntegration && <p className="integration-note"><FileSymlink size={16} /> EMR {emr}</p>}
          {item.patient ? <dl className="key-values"><div><dt>Patient Name</dt><dd>{item.patient.name || 'Not Entered'}</dd></div><div><dt>Patient ID</dt><dd>{item.patient.number || 'Not Entered'}</dd></div>{item.patient.localRef && <div><dt>Local Patient ID</dt><dd>{item.patient.localRef}</dd></div>}<div><dt>Date of Birth</dt><dd>{item.patient.birth || 'Not Entered'}</dd></div><div><dt>Source</dt><dd>{item.source === 'files' ? 'Slide Registration Details' : 'Patient Record'}</dd></div></dl> : <p className="empty-inline">No patient information is available.</p>}
          {patientIntegration}
        </div>}
        {attachmentsEndpoint && (tab === 'Media' || tab === 'Gross Images') && <div className="detail-content">
          <CaseAttachments key={tab} endpoint={attachmentsEndpoint} kind={tab === 'Media' ? 'pdf' : 'gross'} heading />
        </div>}
        {tab === 'Case Editor' && <div className="detail-content">{editor}</div>}
        {tab === 'Notes' && notesEndpoint && <div className="detail-content"><CaseNotes endpoint={notesEndpoint} /></div>}
        {tab === 'Requests' && <div className="detail-content">{requests}</div>}
        {tab === 'Frozen Section' && <div className="detail-content">{frozen}</div>}
        {tab === 'Report Draft' && <div className="detail-content">{report}</div>}
        {tab === 'History' && <div className="detail-content">
          {historyEndpoint && <PatientHistory key={historyEndpoint} endpoint={historyEndpoint} heading />}
          <h2>Case History</h2><CaseAudit item={item} />
        </div>}
      </section>
      <aside className="panel"><div className="panel-title"><h2>Assignment Details</h2><ClipboardList className="muted" size={18} /></div>
        <div className="preview-content">
          <dl className="key-values"><div><dt>Assigned Pathologist</dt><dd>{item.assignee || 'Unassigned'}</dd></div><div><dt>Review Status</dt><dd><StatusLabel status={item.status} /></dd></div><div><dt>Viewable</dt><dd>{available}/{item.slides.length} slides</dd></div></dl>
          {routing}
          {onAssign && <button className="button primary full" onClick={onAssign}>{item.assignedTo ? 'Reassign' : 'Assign Case'}</button>}
          {onConfirm && <button className="button secondary full" onClick={onConfirm}>Confirm Case from Registered Files</button>}
        </div>
      </aside>
    </div>
    {showLogs && logsEndpoint && <CaseLogsDialog endpoint={logsEndpoint} onClose={() => setShowLogs(false)} />}
  </>;
}
