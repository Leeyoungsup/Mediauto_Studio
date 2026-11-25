import { RelatedCasesControl } from './related-cases-control';
import { CollaborativeReview, useCollaborativeReview } from './collaborative-review';
import { roiSearchHref, roiViewerHref } from './roi-search';
import type { RoiLocation } from './roi-search';
import { useEffect, useRef, useState } from 'react';
import { ClipboardList, ArrowLeft, Bell, ExternalLink, GalleryHorizontalEnd, Images, PanelLeftClose, PanelLeftOpen, Maximize, Minimize, Settings2, ScanLine, History, FileText, Camera, List, MessageSquare, UsersRound, FlaskConical, PanelsTopLeft, SquarePen } from 'lucide-react';
import type { DemoCase } from './demo';
import { CaseRequests } from './case-requests';
import { withCollection } from './workflow-navigation';
import type { CollectionOrigin } from './workflow-navigation';
import { CaseNotes } from './case-notes';
import { caseHref, notificationPreferencesHref } from './case-navigation';
import { CaseLogs } from './case-logs';
import { CaseAttachments } from './case-attachments';
import { ImageViewport } from './image-viewport';
import { PatientHistory } from './patient-history';
import { MultiView } from './multi-view';
import { ViewerSettingsPanel, useViewerPreferences } from './viewer-preferences';
import type { Camera as SlideCamera } from './viewer-tools';
import { ScanReference, SlidePreview, StatusLabel } from './worklist';

import { WorkspaceTabs } from './workspace-tabs';

type ViewerTab = 'slides' | 'analysis' | 'history' | 'media' | 'gross' | 'notes' | 'logs' | 'requests';

export function Viewer({ item, activeSlide, onSlide, onBack, onReview, canRequest, hasFrozenWorkflow, initialSnapshot, initialRoi, roiOrigin, historyEndpoint, attachmentsEndpoint, logsEndpoint, notesEndpoint, reviewEndpoint, viewerAccount, relatedEndpoint, analysisEndpoint, organization, openRequests, openReview, collectionOrigin }: {
  item: DemoCase; activeSlide?: string; onSlide: (id: string) => void; onBack: (scan?: string) => void; onReview?: () => void; canRequest?: boolean; hasFrozenWorkflow?: boolean; initialSnapshot?: string; initialRoi?: string; roiOrigin?: RoiLocation; historyEndpoint?: string; attachmentsEndpoint?: string; logsEndpoint?: string; notesEndpoint?: string; reviewEndpoint?: string; relatedEndpoint?: string; viewerAccount: string;
  analysisEndpoint?: string; organization: string; openRequests?: boolean; openReview?: boolean; collectionOrigin?: CollectionOrigin;
}) {
  const [contextTab, setContextTab] = useState<Exclude<ViewerTab, 'analysis'>>(openRequests && canRequest ? 'requests' : 'slides');
  const [comparing, setComparing] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [reviewSelection, setReviewSelection] = useState<string>();
  const review = useCollaborativeReview(reviewEndpoint, viewerAccount, openReview);
  const followingFrame = review.following ? review.room?.frame : undefined;
  const inReview = review.state?.state === 'joined';
  const noCaseAccess = review.connection === 'denied';

  useEffect(() => {
    if (followingFrame?.scan_id) setReviewSelection(followingFrame.scan_id);
  }, [followingFrame?.scan_id]);
  useEffect(() => { if (inReview) setComparing(false); }, [inReview]);
  useEffect(() => { if (openRequests && canRequest) { setAnalysisOpen(false); setContextTab('requests'); } }, [openRequests, canRequest]);
  const root = useRef<HTMLElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const trayList = useRef<HTMLDivElement>(null);
  const singleCamera = useRef<{ id: string; camera: SlideCamera }>(undefined);
  const [returnCamera, setReturnCamera] = useState<{ id: string; camera: SlideCamera }>();
  const preferences = useViewerPreferences();
  const { settings, change } = preferences;
  const trayVisible = settings.tray_visible;
  const [showSettings, setShowSettings] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
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
  function selectSlide(id: string, camera?: SlideCamera) {
    setReviewSelection(undefined);
    setReturnCamera(camera ? { id, camera } : undefined);
    onSlide(id);
  }

  const slideIndex = slide ? item.slides.indexOf(slide) : -1;
  const previous = slideIndex >= 0 ? item.slides.slice(0, slideIndex).reverse().find((entry) => entry.wsi) : undefined;
  const next = slideIndex >= 0 ? item.slides.slice(slideIndex + 1).find((entry) => entry.wsi) : undefined;

  useEffect(() => {
    const list = trayList.current;
    const active = list?.querySelector('[aria-pressed=true]');
    if (!list || !active || !trayVisible || comparing) return;
    const bounds = list.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    const delta = (start: number, end: number, min: number, max: number) => start < min ? start - min : Math.max(0, end - max);
    list.scrollBy({ left: delta(item.left, item.right, bounds.left, bounds.right), top: delta(item.top, item.bottom, bounds.top, bounds.bottom) });
  }, [slide?.id, trayVisible, comparing, settings.gallery, settings.tray_orientation]);

  const canAnalyze = Boolean(analysisEndpoint && slide?.wsi?.source === 'clinical' && !review.following && !comparing);
  const activeTab: ViewerTab = analysisOpen && canAnalyze ? 'analysis' : contextTab;
  const tabs = [
    { key: 'slides', label: 'Slides', icon: PanelsTopLeft },
    ...(analysisEndpoint ? [{ key: 'analysis', label: 'Analysis', icon: FlaskConical, disabled: !canAnalyze }] : []),
    ...(historyEndpoint ? [{ key: 'history', label: 'History', icon: History }] : []),
    ...(attachmentsEndpoint ? [{ key: 'media', label: 'Media', icon: FileText }, { key: 'gross', label: 'Gross Images', icon: Camera }] : []),
    ...(notesEndpoint ? [{ key: 'notes', label: 'Notes', icon: MessageSquare }] : []),
    ...(logsEndpoint ? [{ key: 'logs', label: 'Case Logs', icon: List }] : []),
    ...(canRequest ? [{ key: 'requests', label: 'Requests', icon: MessageSquare }] : []),
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
  const reportHref = canRequest && item.recordId ? withCollection(caseHref(item.recordId, 'report', slide?.id), collectionOrigin) : undefined;
  const documentHref = item.recordId && contextTab !== 'slides' ? withCollection(caseHref(item.recordId, contextTab, slide?.id), collectionOrigin) : undefined;
  return <section ref={root} className="viewer-workbench" aria-label="Slide Review">
    <div className="page-heading viewer-heading">
      <div className="viewer-context">
        <button className="back-link" onClick={() => onBack(slide?.id)}><ArrowLeft size={16} /> Case Details</button>
        <div className="viewer-title"><h1>WSI Viewer</h1><p>{item.id} · {item.specimen}</p></div>
        {reviewEndpoint && <button ref={reviewButton} className="button secondary viewer-collaboration" type="button" aria-label="Collaborative Review"
          aria-expanded={review.open} aria-controls={review.open ? 'collaborative-review-panel' : undefined}
          aria-describedby={inReview ? 'viewer-review-mode' : undefined} data-joined={inReview || undefined} onClick={review.toggle}>
          <UsersRound size={16} /> <span className="viewer-collaboration-label">Collaborative Review</span>
          {inReview && <span className="review-mode" id="viewer-review-mode">{review.connection === 'reconnecting' ? 'Reconnecting…' : review.driving ? 'Driving' : review.following ? 'Following' : 'Independent'}</span>}
        </button>}
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
        onClick={toggleGallery} title="Scan Gallery"><Images size={16} /> Gallery</button>}
      {!comparing && <div className="viewer-settings-anchor"><button ref={settingsButton} type="button" className="icon-button" title="Viewer Settings"
        aria-label="Viewer Settings" aria-expanded={showSettings} aria-controls="viewer-settings" onClick={() => setShowSettings(!showSettings)}><Settings2 size={18} /></button>
        {showSettings && <ViewerSettingsPanel preferences={preferences} onClose={() => { setShowSettings(false); settingsButton.current?.focus(); }} />}
      </div>}
      <button type="button" className="icon-button" title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        aria-label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()}>
        {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>
      {!comparing && <button className="button secondary" disabled={available.length < 2 || inReview} onClick={() => setComparing(true)}><GalleryHorizontalEnd size={16} /> Multi View</button>}
      {item.recordId && <a className="button secondary viewer-editor-link" href={withCollection(caseHref(item.recordId, 'editor', slide?.id), collectionOrigin)}><SquarePen size={15} /> Case Editor</a>}
      {reportHref && <a className="button secondary" href={reportHref}><ClipboardList size={16} /> Report Draft</a>}
      {hasFrozenWorkflow && item.recordId && <a className="button secondary" href={caseHref(item.recordId, 'frozen', slide?.id)}><ClipboardList size={16} /> Frozen Section</a>}
      {canRequest && <button type="button" className="button secondary" aria-label="Analysis and Consultation Requests"
        aria-pressed={contextTab === 'requests'} onClick={() => {
          selectTab('requests');
          document.getElementById('viewer-workspace-panel-tab-requests')?.focus();
        }}><MessageSquare size={15} /> Requests</button>}
      {!comparing && onReview && <button className="button secondary" disabled={!slide?.wsi} onClick={onReview}>{item.status === 'In Review' ? 'Review Complete' : 'Start Review'}</button>}</div></div>
    <WorkspaceTabs label="Viewer Workspace" tabs={tabs} active={activeTab} onSelect={selectTab} panelId="viewer-workspace-panel" />
    {fullscreenError && <p className="notice" role="alert">{fullscreenError}</p>}
    <div id="viewer-workspace-panel" role="tabpanel" aria-labelledby={'viewer-workspace-panel-tab-' + activeTab} className="viewer-stage" data-document={isDocument}>
        {review.open && reviewEndpoint && <CollaborativeReview review={review} sessionHref={item.recordId ? `#viewer/${item.recordId}?review=1` : undefined}
        onClose={() => { review.toggle(); reviewButton.current?.focus(); }} />}
      <div inert={isDocument} className="viewer-scan-stage">
    {comparing ? <MultiView slides={available} primary={slide?.id} onClose={() => {
      setReturnCamera(singleCamera.current);
      setComparing(false);
    }} onSingle={(id, camera) => { selectSlide(id, camera); setComparing(false); }} /> : <div className="viewer-layout" data-tray={trayVisible} data-orientation={settings.tray_orientation}>
      <aside className="panel viewer-tray" id="viewer-slide-tray" hidden={!trayVisible}><div className="panel-title"><h2>Slide Tray</h2><span className="count" title="Viewable scans">{available.length}/{item.slides.length}</span></div>
        <div ref={trayList} className="tray-items" data-gallery={settings.gallery}>{item.slides.map((entry) => <button className="tray-item" data-scan-id={entry.wsi?.id} key={entry.id} onClick={() => selectSlide(entry.id)} aria-pressed={slide?.id === entry.id} disabled={!entry.wsi || review.following}>
          <span className="slide-image"><SlidePreview slide={entry} /></span><span className="tray-scan-label"><strong>{entry.label ?? entry.id}</strong><small>{entry.wsi?.format ?? entry.state} · {entry.stain}</small><ScanReference scan={entry.wsi} /></span>
        </button>)}</div>
      </aside>
      {slide?.wsi ? <ImageViewport key={slide.wsi.id + ':' + (initialSnapshot ?? initialRoi ?? '')} scan={slide.wsi} initialSnapshot={initialSnapshot}
        initialRoi={initialRoi} initialCamera={returnCamera?.id === slide.id ? returnCamera.camera : undefined} roiCaseId={canRequest && item.recordId ? item.recordId : undefined} label={slide.label ?? slide.id} stain={slide.stain}
        analysis={analysisEndpoint && slide.wsi.source === 'clinical' && !review.following ?
          { caseEndpoint: analysisEndpoint, open: analysisOpen, change: (open) => selectTab(open ? 'analysis' : 'slides') } : undefined}
        sharedReview={reviewEndpoint ? {
          locked: review.following,
          camera: followingFrame?.scan_id === slide.wsi.id ? followingFrame : undefined,
          onFrame: (camera) => review.camera(slide.wsi!.id, camera),
        } : undefined}
        extraAction={relatedEndpoint && item.recordId ? <RelatedCasesControl compact endpoint={relatedEndpoint}
          caseId={item.recordId} scanId={slide.wsi.id} /> : undefined}
        options={{ settings, active: !isDocument,
          onCamera: (camera) => { singleCamera.current = { id: slide.id, camera }; },
          reportHref,
          position: { index: slideIndex + 1, total: item.slides.length }, toggleFullscreen, toggleGallery,
          previous: previous && !review.following ? () => selectSlide(previous.id) : undefined,
          next: next && !review.following ? () => selectSlide(next.id) : undefined,
          toggleMinimap: () => change('show_minimap', !settings.show_minimap),
          toggleLabel: () => change('show_label', !settings.show_label),
          toggleOverview: () => change('show_overview', !settings.show_overview) }} />
        : <div className="panel empty"><ScanLine size={30} /><strong>{activeSlide && !slide ? 'The requested scan could not be found.' : slide?.state === 'QC Hold' || slide?.state === 'Rescan Required' ? 'This scan is blocked by QC.' : 'No scans are available for review.'}</strong><button className="button secondary" onClick={() => onBack(slide?.id)}>Go to Case Details</button></div>}
    </div>}
      </div>
      {isDocument && <section className="viewer-document panel" aria-label={activeLabel}>
        <div className="panel-title"><div><h2>{activeLabel}</h2>
          {slide && <p className="viewer-document-context">{item.id} · {slide.label ?? slide.id}{slide.wsi && ` · ${slide.wsi.format} · Scan ${slide.wsi.id.slice(0, 8)}`}</p>}</div>
          <div className="actions">
          {contextTab === 'notes' && item.recordId && <a className="button secondary"
            href={notificationPreferencesHref(item.recordId, slide?.id)}><Bell size={15} /> Notification Preferences</a>}
          {documentHref && <a className="button secondary" href={documentHref}><ExternalLink size={15} /> Open in Case Details</a>}
          <button type="button" className="button secondary" onClick={() => {
            selectTab('slides');
            document.getElementById('viewer-workspace-panel-tab-slides')?.focus();
          }}><ScanLine size={15} /> Return to Slides</button></div></div>
        <div className="detail-content">
          {contextTab === 'history' && historyEndpoint && <PatientHistory endpoint={historyEndpoint} />}
          {attachmentsEndpoint && (contextTab === 'media' || contextTab === 'gross') &&
            <CaseAttachments key={contextTab} endpoint={attachmentsEndpoint} kind={contextTab === 'media' ? 'pdf' : 'gross'} />}
          {contextTab === 'notes' && notesEndpoint && <CaseNotes endpoint={notesEndpoint} />}
          {contextTab === 'logs' && logsEndpoint && <CaseLogs endpoint={logsEndpoint} />}
          {contextTab === 'requests' && canRequest && <CaseRequests organization={organization} item={item} sourceScan={slide?.wsi?.id}
            collectionOrigin={collectionOrigin} inViewer />}
        </div>
      </section>}
    </div>
  </section>;
}
