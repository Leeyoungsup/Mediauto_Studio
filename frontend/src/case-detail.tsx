import { RelatedCasesControl } from './related-cases-control';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Bell, ClipboardList, PencilLine, MessageSquare, FileSymlink, FileText, Camera, List, History, ScanLine, UserRound } from 'lucide-react';
import { CaseNotes } from './case-notes';
import { CaseAttachments } from './case-attachments';
import { PatientHistory } from './patient-history';
import { CaseLogs, CaseLogsDialog } from './case-logs';
import { CaseAudit } from './case-audit';
import { caseHref, caseTabs, notificationPreferencesHref } from './case-navigation';
import { withCollection } from './workflow-navigation';
import type { CollectionOrigin } from './workflow-navigation';
import type { CaseTab } from './case-navigation';
import { readyCount } from './demo';
import type { DemoCase } from './demo';
import { ScanReference, SlidePreview, StatusLabel } from './worklist';

export function CaseDetail({ item, emr, onBack, onViewer, onAssign, onReview, onConfirm, patientIntegration, requests, report, initialTab, collectionOrigin, dates, routing, editor, selectedScan, historyEndpoint, attachmentsEndpoint, logsEndpoint, notesEndpoint, frozen, relatedEndpoint }: {
  item: DemoCase; emr: string; onBack: () => void; onViewer: (slide?: string) => void;
  onAssign?: () => void; onReview?: () => void; onConfirm?: () => void; patientIntegration?: ReactNode; requests?: ReactNode; report?: ReactNode; initialTab?: CaseTab; collectionOrigin?: CollectionOrigin; selectedScan?: string; historyEndpoint?: string; attachmentsEndpoint?: string; logsEndpoint?: string; notesEndpoint?: string; frozen?: ReactNode; relatedEndpoint?: string; dates?: ReactNode; routing?: ReactNode; editor?: ReactNode;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [localTab, setLocalTab] = useState<CaseTab>('slides');
  const available = readyCount(item);
  const selected = item.slides.find((slide) => slide.id === selectedScan);
  const missingScan = !!selectedScan && !selected;

  const tabs = [
    { key: 'slides', icon: ScanLine, enabled: true },
    { key: 'patient', icon: UserRound, enabled: true },
    { key: 'editor', icon: PencilLine, enabled: !!editor },
    { key: 'history', icon: History, enabled: true },
    { key: 'media', icon: FileText, enabled: !!attachmentsEndpoint },
    { key: 'gross', icon: Camera, enabled: !!attachmentsEndpoint },
    { key: 'notes', icon: MessageSquare, enabled: !!notesEndpoint },
    { key: 'requests', icon: MessageSquare, enabled: !!requests },
    { key: 'report', icon: ClipboardList, enabled: !!report },
    { key: 'frozen', icon: ClipboardList, enabled: !!frozen },
  ] as const;
  const deniedTab = initialTab && !tabs.some(({ key, enabled }) => enabled && key === initialTab)
    && !(initialTab === 'logs' && logsEndpoint);
  const tab = item.recordId ? deniedTab ? 'slides' : initialTab ?? 'slides' : localTab;
  const canOpenViewer = selected ? !!selected.wsi : available > 0 && (!missingScan || tab === 'editor');

  function selectTab(key: CaseTab) {
    if (item.recordId) location.hash = withCollection(caseHref(item.recordId, key, selected?.id), collectionOrigin);
    else setLocalTab(key);
  }

  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Worklist</button>
    <div className="page-heading case-workspace-heading"><div className="case-workspace-title">
      <span className="workspace-title-icon"><ClipboardList size={22} aria-hidden="true" /></span>
      <div><h1>{item.id}</h1><p>{item.specimen} · Received {item.received}</p>
        {missingScan && <p className="case-source-scan" role="status">The source scan is no longer linked to this case.</p>}
        {selected && <p className="case-source-scan">Source Scan · {selected.label ?? selected.id}{selected.wsi && ` · ${selected.wsi.format} · ${selected.wsi.id.slice(0, 8)}`}</p>}
      </div></div>
      <div className="actions"><StatusLabel status={item.status} />
        {onReview && <button className="button secondary" disabled={!available} onClick={onReview}>{item.status === 'In Review' ? 'Review Complete' : 'Start Review'}</button>}
        {relatedEndpoint && item.recordId && <RelatedCasesControl endpoint={relatedEndpoint} caseId={item.recordId} scanId={selected?.wsi?.id} />}
        {logsEndpoint && tab !== 'logs' && <button type="button" className="button secondary" onClick={() => setShowLogs(true)}><List size={16} /> Case Logs</button>}
        <button className="button primary" disabled={!canOpenViewer}
          title={missingScan && tab === 'editor' ? 'Open the first viewable scan' : undefined} onClick={() => onViewer(selected?.id)}><ScanLine size={17} /> Open Viewer</button>
      </div>
    </div>
    <div className="detail-layout">
      <section className="panel detail-panel">
        <nav className="detail-tabs" aria-label="Case Information">
          {tabs.filter(({ enabled }) => enabled).map(({ key, icon: Icon }) =>
            <button type="button" key={key} aria-pressed={tab === key} onClick={() => selectTab(key)}><Icon size={16} />{caseTabs[key]}</button>)}
        </nav>
        {initialTab && deniedTab && <p className="detail-content notice" role="status">{caseTabs[initialTab]} is unavailable for this case or account.</p>}
        {tab === 'slides' && <div className="detail-content">{dates}<div className="preview-label"><div className="title-inline"><h2>Specimens and Slides</h2><span>{available}/{item.slides.length} Viewable</span></div>
        </div>
          {item.slides.length ? <div className="detail-slides">{item.slides.map((slide) => <button className="detail-slide" aria-current={selected?.id === slide.id ? "true" : undefined} data-scan-id={slide.wsi?.id} key={slide.id} disabled={!slide.wsi} onClick={() => onViewer(slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><span><strong>{slide.label ?? slide.id}</strong><small>Specimen {slide.specimen} · {slide.stain}{slide.wsi && ` · ${slide.wsi.format}`}</small><ScanReference scan={slide.wsi} /></span><span className="muted">{slide.state}</span><ArrowRight size={16} />
          </button>)}</div> : <div className="empty"><ScanLine size={27} /><strong>No slides are linked to this case.</strong></div>}
        </div>}
        {tab === 'patient' && <div className="detail-content"><div className="preview-label"><h2>Patient Information</h2>{item.source === 'files' && <a className="button secondary" href="#scans">Edit in Slide Registration</a>}</div>
          {!patientIntegration && <p className="integration-note"><FileSymlink size={16} /> EMR {emr}</p>}
          {item.patient ? <dl className="key-values"><div><dt>Patient Name</dt><dd>{item.patient.name || 'Not Entered'}</dd></div><div><dt>Patient ID</dt><dd>{item.patient.number || 'Not Entered'}</dd></div>{item.patient.localRef && <div><dt>Local Patient ID</dt><dd>{item.patient.localRef}</dd></div>}<div><dt>Date of Birth</dt><dd>{item.patient.birth || 'Not Entered'}</dd></div><div><dt>Source</dt><dd>{item.source === 'files' ? 'Slide Registration Details' : 'Patient Record'}</dd></div></dl> : <p className="empty-inline">No patient information is available.</p>}
          {patientIntegration}
        </div>}
        {attachmentsEndpoint && (tab === 'media' || tab === 'gross') && <div className="detail-content">
          <CaseAttachments key={tab} endpoint={attachmentsEndpoint} kind={tab === 'media' ? 'pdf' : 'gross'} heading />
        </div>}
        {tab === 'editor' && <div className="detail-content">{editor}</div>}
        {tab === 'notes' && notesEndpoint && <div className="detail-content">
          {item.recordId && <div className="case-document-actions"><a className="button secondary"
            href={notificationPreferencesHref(item.recordId, selected?.id)}><Bell size={16} /> Notification Preferences</a></div>}
          <CaseNotes endpoint={notesEndpoint} />
        </div>}
        {tab === 'logs' && logsEndpoint && <div className="detail-content">
          <h2>Case Logs</h2>
          <CaseLogs endpoint={logsEndpoint} />
        </div>}
        {tab === 'requests' && <div className="detail-content">{requests}</div>}
        {tab === 'frozen' && <div className="detail-content">{frozen}</div>}
        {tab === 'report' && <div className="detail-content">{report}</div>}
        {tab === 'history' && <div className="detail-content">
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
