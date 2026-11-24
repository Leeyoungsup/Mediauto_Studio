import { useState } from 'react';
import { ArrowLeft, GalleryHorizontalEnd, PanelLeftClose, PanelLeftOpen, ScanLine } from 'lucide-react';
import type { DemoCase } from './demo';
import { ImageViewport } from './image-viewport';
import { MultiView } from './multi-view';
import { SlidePreview, StatusLabel } from './worklist';

export function Viewer({ item, activeSlide, onSlide, onBack, onReview, requestsHref, initialSnapshot }: {
  item: DemoCase; activeSlide?: string; onSlide: (id: string) => void; onBack: () => void; onReview?: () => void; requestsHref?: string; initialSnapshot?: string;
}) {
  const [comparing, setComparing] = useState(false);
  const [trayVisible, setTrayVisible] = useState(true);
  const available = item.slides.filter(({ wsi }) => wsi);
  const slide = activeSlide
    ? item.slides.find(({ id }) => id === activeSlide)
    : item.slides.find(({ wsi }) => wsi) ?? item.slides[0];
  return <section className="viewer-workbench" aria-label="Slide Review">
    <div className="page-heading viewer-heading">
      <div className="viewer-context">
        <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Case Details</button>
        <div className="viewer-title"><h1>WSI Viewer</h1><p>{item.id} · {item.specimen}</p></div>
      </div>
      <div className="actions"><StatusLabel status={item.status} />
      {!comparing && <button type="button" className="button secondary" aria-controls="viewer-slide-tray" aria-expanded={trayVisible}
        onClick={() => setTrayVisible(!trayVisible)}>
        {trayVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        {trayVisible ? 'Hide Slide Tray' : 'Show Slide Tray'}
      </button>}
      {!comparing && <button className="button secondary" disabled={available.length < 2} onClick={() => setComparing(true)}><GalleryHorizontalEnd size={16} /> Multi View</button>}
      {requestsHref && <a className="button secondary" href={requestsHref}>Analysis and Consultation Requests</a>}
      {!comparing && onReview && <button className="button secondary" disabled={!slide?.wsi} onClick={onReview}>{item.status === 'In Review' ? 'Review Complete' : 'Start Review'}</button>}</div></div>
    {comparing ? <MultiView slides={available} primary={slide?.id} onClose={() => setComparing(false)}
      onSingle={(id) => { onSlide(id); setComparing(false); }} /> : <div className="viewer-layout" data-tray={trayVisible}>
      <aside className="panel viewer-tray" id="viewer-slide-tray" hidden={!trayVisible}><div className="panel-title"><h2>Slide Tray</h2><span className="count">{item.slides.length}</span></div>
        <div className="tray-items">{item.slides.map((entry) => <button className="tray-item" key={entry.id} onClick={() => onSlide(entry.id)} aria-pressed={slide?.id === entry.id} disabled={!entry.wsi}>
          <span className="slide-image"><SlidePreview slide={entry} /></span><span><strong>{entry.label ?? entry.id}</strong><small>{entry.stain} · {entry.wsi?.format ?? entry.state}</small></span>
        </button>)}</div>
      </aside>
      {slide?.wsi ? <ImageViewport key={slide.wsi.id + ':' + (initialSnapshot ?? '')} scan={slide.wsi} initialSnapshot={initialSnapshot} label={slide.label ?? slide.id} stain={slide.stain} />
        : <div className="panel empty"><ScanLine size={30} /><strong>{activeSlide && !slide ? 'The requested scan could not be found.' : 'No scans are registered.'}</strong><button className="button secondary" onClick={onBack}>Go to Case Details</button></div>}
    </div>}
  </section>;
}
