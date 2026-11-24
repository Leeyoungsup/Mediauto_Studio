import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, GalleryHorizontalEnd, PanelLeftClose, PanelLeftOpen, Maximize, Minimize, Settings2, ScanLine, History, FileText, Camera, List } from 'lucide-react';
import type { DemoCase } from './demo';
import { CaseLogsDialog } from './case-logs';
import { AttachmentDialog } from './case-attachments';
import type { AttachmentKind } from './case-attachments';
import { ImageViewport } from './image-viewport';
import { PatientHistoryDialog } from './patient-history';
import { MultiView } from './multi-view';
import { ViewerSettingsPanel, useViewerPreferences } from './viewer-preferences';
import { ScanReference, SlidePreview, StatusLabel } from './worklist';

export function Viewer({ item, activeSlide, onSlide, onBack, onReview, requestsHref, initialSnapshot, editorHref, historyEndpoint, attachmentsEndpoint, logsEndpoint }: {
  item: DemoCase; activeSlide?: string; onSlide: (id: string) => void; onBack: (scan?: string) => void; onReview?: () => void; requestsHref?: string; initialSnapshot?: string; editorHref?: string; historyEndpoint?: string; attachmentsEndpoint?: string; logsEndpoint?: string;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [attachmentKind, setAttachmentKind] = useState<AttachmentKind>();
  const [showHistory, setShowHistory] = useState(false);
  const [comparing, setComparing] = useState(false);
  const root = useRef<HTMLElement>(null);
  const preferences = useViewerPreferences();
  const { settings, change } = preferences;
  const trayVisible = settings.tray_visible;
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');

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
  const slide = activeSlide
    ? item.slides.find(({ id }) => id === activeSlide)
    : item.slides.find(({ wsi }) => wsi) ?? item.slides[0];
  return <section ref={root} className="viewer-workbench" aria-label="Slide Review">
    <div className="page-heading viewer-heading">
      <div className="viewer-context">
        <button className="back-link" onClick={() => onBack(slide?.id)}><ArrowLeft size={16} /> Case Details</button>
        <div className="viewer-title"><h1>WSI Viewer</h1><p>{item.id} · {item.specimen}</p></div>
      </div>
      <div className="actions"><StatusLabel status={item.status} />
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
      {!comparing && <button className="button secondary" disabled={available.length < 2} onClick={() => setComparing(true)}><GalleryHorizontalEnd size={16} /> Multi View</button>}
      {historyEndpoint && <button type="button" className="button secondary" onClick={() => setShowHistory(true)}>
        <History size={16} /> Patient History
      </button>}
      {attachmentsEndpoint && <><button type="button" className="button secondary" onClick={() => setAttachmentKind('pdf')}><FileText size={16} /> Media</button>
        <button type="button" className="button secondary" onClick={() => setAttachmentKind('gross')}><Camera size={16} /> Gross Images</button></>}
      {logsEndpoint && <button type="button" className="button secondary" onClick={() => setShowLogs(true)}><List size={16} /> Case Logs</button>}
      {editorHref && <a className="button secondary" href={editorHref}>Case Editor</a>}
      {requestsHref && <a className="button secondary" href={requestsHref}>Analysis and Consultation Requests</a>}
      {!comparing && onReview && <button className="button secondary" disabled={!slide?.wsi} onClick={onReview}>{item.status === 'In Review' ? 'Review Complete' : 'Start Review'}</button>}</div></div>
    {fullscreenError && <p className="notice" role="alert">{fullscreenError}</p>}
    {comparing ? <MultiView slides={available} primary={slide?.id} onClose={() => setComparing(false)}
      onSingle={(id) => { onSlide(id); setComparing(false); }} /> : <div className="viewer-layout" data-tray={trayVisible} data-orientation={settings.tray_orientation}>
      <aside className="panel viewer-tray" id="viewer-slide-tray" hidden={!trayVisible}><div className="panel-title"><h2>Slide Tray</h2><span className="count">{item.slides.length}</span></div>
        <div className="tray-items" data-gallery={settings.gallery}>{item.slides.map((entry) => <button className="tray-item" data-scan-id={entry.wsi?.id} key={entry.id} onClick={() => onSlide(entry.id)} aria-pressed={slide?.id === entry.id} disabled={!entry.wsi}>
          <span className="slide-image"><SlidePreview slide={entry} /></span><span><strong>{entry.label ?? entry.id}</strong><small>{entry.stain} · {entry.wsi?.format ?? entry.state}</small><ScanReference scan={entry.wsi} /></span>
        </button>)}</div>
      </aside>
      {slide?.wsi ? <ImageViewport key={slide.wsi.id + ':' + (initialSnapshot ?? '')} scan={slide.wsi} initialSnapshot={initialSnapshot} label={slide.label ?? slide.id} stain={slide.stain}
        options={{ settings, toggleFullscreen, toggleGallery, toggleMinimap: () => change('show_minimap', !settings.show_minimap) }} />
        : <div className="panel empty"><ScanLine size={30} /><strong>{activeSlide && !slide ? 'The requested scan could not be found.' : slide?.state === 'QC Hold' || slide?.state === 'Rescan Required' ? 'This scan is blocked by QC.' : 'No scans are available for review.'}</strong><button className="button secondary" onClick={() => onBack(slide?.id)}>Go to Case Details</button></div>}
    </div>}
    {attachmentKind && attachmentsEndpoint && <AttachmentDialog endpoint={attachmentsEndpoint} kind={attachmentKind} onClose={() => setAttachmentKind(undefined)} />}
    {showLogs && logsEndpoint && <CaseLogsDialog endpoint={logsEndpoint} onClose={() => setShowLogs(false)} />}
    {showHistory && historyEndpoint && <PatientHistoryDialog key={historyEndpoint} endpoint={historyEndpoint} onClose={() => setShowHistory(false)} />}
  </section>;
}
