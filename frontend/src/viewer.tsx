import { RelatedCasesControl } from './related-cases-control';
import { CollaborativeReview, useCollaborativeReview } from './collaborative-review';
import { roiSearchHref, roiViewerHref } from './roi-search';
import type { RoiLocation } from './roi-search';
import { useEffect, useRef, useState } from 'react';
import { ClipboardList, ArrowLeft, GalleryHorizontalEnd, PanelLeftClose, PanelLeftOpen, Maximize, Minimize, Settings2, ScanLine, History, FileText, Camera, List, MessageSquare, UsersRound, FlaskConical, PanelsTopLeft, SquarePen } from 'lucide-react';
import type { DemoCase } from './demo';
import { CaseNotes } from './case-notes';
import { CaseLogs } from './case-logs';
import { CaseAttachments } from './case-attachments';
import { ImageViewport } from './image-viewport';
import { PatientHistory } from './patient-history';
import { MultiView } from './multi-view';
import { ViewerSettingsPanel, useViewerPreferences } from './viewer-preferences';
import { ScanReference, SlidePreview, StatusLabel } from './worklist';

import { WorkspaceTabs } from './workspace-tabs';

type ViewerTab = 'slides' | 'analysis' | 'history' | 'media' | 'gross' | 'notes' | 'logs';

export function Viewer({ item, activeSlide, onSlide, onBack, onReview, requestsHref, initialSnapshot, initialRoi, roiOrigin, editorHref, historyEndpoint, attachmentsEndpoint, logsEndpoint, notesEndpoint, reviewEndpoint, viewerAccount, relatedEndpoint, analysisEndpoint }: {
  item: DemoCase; activeSlide?: string; onSlide: (id: string) => void; onBack: (scan?: string) => void; onReview?: () => void; requestsHref?: string; initialSnapshot?: string; initialRoi?: string; roiOrigin?: RoiLocation; editorHref?: string; historyEndpoint?: string; attachmentsEndpoint?: string; logsEndpoint?: string; notesEndpoint?: string; reviewEndpoint?: string; relatedEndpoint?: string; viewerAccount: string;
  analysisEndpoint?: string;
}) {
  const [contextTab, setContextTab] = useState<Exclude<ViewerTab, 'analysis'>>('slides');
  const [comparing, setComparing] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [reviewSelection, setReviewSelection] = useState<string>();
  const review = useCollaborativeReview(reviewEndpoint, viewerAccount);
  const followingFrame = review.following ? review.room?.frame : undefined;
  const inReview = review.state?.state === 'joined';
  const noCaseAccess = review.connection === 'denied';

  useEffect(() => {
    if (followingFrame?.scan_id) setReviewSelection(followingFrame.scan_id);
  }, [followingFrame?.scan_id]);
  useEffect(() => { if (inReview) setComparing(false); }, [inReview]);
  const root = useRef<HTMLElement>(null);
  const preferences = useViewerPreferences();
  const { settings, change } = preferences;
  const trayVisible = settings.tray_visible;
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');

  useEffect(() => { if (initialRoi) setComparing(false); }, [initialRoi]);

  useEffect(() => {
    const element = root.current;
    const sync = () => setFullscreen(document.fullscreenElement === element);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  async function toggleFullscreen() {
    const element = root.current;
    if (!element) return;
    setFullscreenError('');
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else if (element.requestFullscreen && document.fullscreenEnabled) await element.requestFullscreen();
      else setFullscreenError('Fullscreen is unavailable in this browser.');
    } catch {
      setFullscreenError('Unable to change fullscreen mode. Try again.');
    }
  }

  function toggleGallery() {
    change('gallery', !trayVisible || !settings.gallery);
    if (!trayVisible) change('tray_visible', true);
  }
  const available = item.slides.filter(({ wsi }) => wsi);
  const requested = followingFrame?.scan_id ?? reviewSelection ?? activeSlide;
  const slide = requested
    ? item.slides.find(({ id }) => id === requested)
    : item.slides.find(({ wsi }) => wsi) ?? item.slides[0];
  function selectSlide(id: string) {
    setReviewSelection(undefined);
    onSlide(id);
  }

  const canAnalyze = Boolean(analysisEndpoint && slide?.wsi?.source === 'clinical' && !review.following && !comparing);
  const activeTab: ViewerTab = analysisOpen && canAnalyze ? 'analysis' : contextTab;
  const tabs = [
    { key: 'slides', label: 'Slides', icon: PanelsTopLeft },
    ...(analysisEndpoint ? [{ key: 'analysis', label: 'Analysis', icon: FlaskConical, disabled: !canAnalyze }] : []),
    ...(historyEndpoint ? [{ key: 'history', label: 'History', icon: History }] : []),
    ...(attachmentsEndpoint ? [{ key: 'media', label: 'Media', icon: FileText }, { key: 'gross', label: 'Gross Images', icon: Camera }] : []),
    ...(notesEndpoint ? [{ key: 'notes', label: 'Notes', icon: MessageSquare }] : []),
    ...(logsEndpoint ? [{ key: 'logs', label: 'Case Logs', icon: List }] : []),
  ] as { key: ViewerTab; label: string; icon: typeof ScanLine; disabled?: boolean }[];
  const activeLabel = tabs.find((tab) => tab.key === activeTab)?.label;
  const isDocument = contextTab !== 'slides';
  function selectTab(tab: ViewerTab) {
    setAnalysisOpen(tab === 'analysis');
    setContextTab(tab === 'analysis' ? 'slides' : tab);
  }

  if (noCaseAccess) return <section className="panel detail-content" aria-label="Slide Review">
    <p role="alert">Case access is no longer available.</p>
    <a href="#worklist/all">Back to Worklist</a>
  </section>;
  return <section ref={root} className="viewer-workbench" aria-label="Slide Review">
    <div className="page-heading viewer-heading">
      <div className="viewer-context">
        <button className="back-link" onClick={() => onBack(slide?.id)}><ArrowLeft size={16} /> Case Details</button>
        <div className="viewer-title"><h1>WSI Viewer</h1><p>{item.id} · {item.specimen}</p></div>
        {reviewEndpoint && <button className="icon-button" type="button" title="Collaborative Review" aria-label="Collaborative Review"
          aria-expanded={review.open} onClick={review.toggle}><UsersRound size={18} /></button>}
      </div>
      <div className="actions"><StatusLabel status={item.status} />
      {roiOrigin && <><a className="button secondary" href={roiViewerHref(roiOrigin)}>Back to Source ROI</a>
        <a className="button secondary" href={roiSearchHref(roiOrigin)}>Return to ROI Search</a></>}
      {!comparing && <button type="button" className="button secondary" aria-controls="viewer-slide-tray" aria-expanded={trayVisible}
        onClick={() => change('tray_visible', !trayVisible)}>
        {trayVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        {trayVisible ? 'Hide Slide Tray' : 'Show Slide Tray'}
      </button>}
      {!comparing && <button type="button" className="button secondary" aria-pressed={trayVisible && settings.gallery}
        onClick={toggleGallery} title="Scan Gallery"><GalleryHorizontalEnd size={16} /> Gallery</button>}
      {!comparing && <div className="viewer-settings-anchor"><button type="button" className="icon-button" title="Viewer Settings"
        aria-label="Viewer Settings" aria-expanded={showSettings} aria-controls="viewer-settings" onClick={() => setShowSettings(!showSettings)}><Settings2 size={18} /></button>
        {showSettings && <ViewerSettingsPanel preferences={preferences} />}
      </div>}
      <button type="button" className="icon-button" title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        aria-label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()}>
        {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>
      {!comparing && <button className="button secondary" disabled={available.length < 2 || inReview} onClick={() => setComparing(true)}><GalleryHorizontalEnd size={16} /> Multi View</button>}
      {editorHref && <a className="button secondary viewer-editor-link" href={editorHref}><SquarePen size={15} /> Case Editor</a>}
      {requestsHref && <a className="button secondary" href={requestsHref.replace(/\/requests$/, '/report')}><ClipboardList size={16} /> Report Draft</a>}
      {requestsHref && <a className="button secondary" href={requestsHref} aria-label="Analysis and Consultation Requests"><MessageSquare size={15} /> Requests</a>}
      {!comparing && onReview && <button className="button secondary" disabled={!slide?.wsi} onClick={onReview}>{item.status === 'In Review' ? 'Review Complete' : 'Start Review'}</button>}</div></div>
    <WorkspaceTabs label="Viewer Workspace" tabs={tabs} active={activeTab} onSelect={selectTab} panelId="viewer-workspace-panel" />
    {fullscreenError && <p className="notice" role="alert">{fullscreenError}</p>}
    {review.open && reviewEndpoint && <CollaborativeReview review={review} />}
    <div id="viewer-workspace-panel" role="tabpanel" aria-labelledby={'viewer-workspace-panel-tab-' + activeTab} className="viewer-stage" data-document={isDocument}>
      <div inert={isDocument} className="viewer-scan-stage">
    {comparing ? <MultiView slides={available} primary={slide?.id} onClose={() => setComparing(false)}
      onSingle={(id) => { selectSlide(id); setComparing(false); }} /> : <div className="viewer-layout" data-tray={trayVisible} data-orientation={settings.tray_orientation}>
      <aside className="panel viewer-tray" id="viewer-slide-tray" hidden={!trayVisible}><div className="panel-title"><h2>Slide Tray</h2><span className="count">{item.slides.length}</span></div>
        <div className="tray-items" data-gallery={settings.gallery}>{item.slides.map((entry) => <button className="tray-item" data-scan-id={entry.wsi?.id} key={entry.id} onClick={() => selectSlide(entry.id)} aria-pressed={slide?.id === entry.id} disabled={!entry.wsi || review.following}>
          <span className="slide-image"><SlidePreview slide={entry} /></span><span><strong>{entry.label ?? entry.id}</strong><small>{entry.stain} · {entry.wsi?.format ?? entry.state}</small><ScanReference scan={entry.wsi} /></span>
        </button>)}</div>
      </aside>
      {slide?.wsi ? <ImageViewport key={slide.wsi.id + ':' + (initialSnapshot ?? initialRoi ?? '')} scan={slide.wsi} initialSnapshot={initialSnapshot}
        initialRoi={initialRoi} roiCaseId={requestsHref && item.recordId ? item.recordId : undefined} label={slide.label ?? slide.id} stain={slide.stain}
        analysis={analysisEndpoint && slide.wsi.source === 'clinical' && !review.following ?
          { caseEndpoint: analysisEndpoint, open: analysisOpen, change: (open) => selectTab(open ? 'analysis' : 'slides') } : undefined}
        sharedReview={reviewEndpoint ? {
          locked: review.following,
          camera: followingFrame?.scan_id === slide.wsi.id ? followingFrame : undefined,
          onFrame: (camera) => review.camera(slide.wsi!.id, camera),
        } : undefined}
        extraAction={relatedEndpoint && item.recordId ? <RelatedCasesControl compact endpoint={relatedEndpoint}
          caseId={item.recordId} scanId={slide.wsi.id} /> : undefined}
        options={{ settings, toggleFullscreen, toggleGallery, toggleMinimap: () => change('show_minimap', !settings.show_minimap) }} />
        : <div className="panel empty"><ScanLine size={30} /><strong>{activeSlide && !slide ? 'The requested scan could not be found.' : slide?.state === 'QC Hold' || slide?.state === 'Rescan Required' ? 'This scan is blocked by QC.' : 'No scans are available for review.'}</strong><button className="button secondary" onClick={() => onBack(slide?.id)}>Go to Case Details</button></div>}
    </div>}
      </div>
      {isDocument && <section className="viewer-document panel" aria-label={activeLabel}>
        <div className="panel-title"><h2>{activeLabel}</h2>
          <button type="button" className="button secondary" onClick={() => {
            selectTab('slides');
            document.getElementById('viewer-workspace-panel-tab-slides')?.focus();
          }}><ScanLine size={15} /> Return to Slides</button></div>
        <div className="detail-content">
          {contextTab === 'history' && historyEndpoint && <PatientHistory endpoint={historyEndpoint} />}
          {attachmentsEndpoint && (contextTab === 'media' || contextTab === 'gross') &&
            <CaseAttachments key={contextTab} endpoint={attachmentsEndpoint} kind={contextTab === 'media' ? 'pdf' : 'gross'} />}
          {contextTab === 'notes' && notesEndpoint && <CaseNotes endpoint={notesEndpoint} />}
          {contextTab === 'logs' && logsEndpoint && <CaseLogs endpoint={logsEndpoint} />}
        </div>
      </section>}
    </div>
  </section>;
}
