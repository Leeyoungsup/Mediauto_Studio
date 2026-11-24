import { useState } from 'react';
import { ArrowLeft, GalleryHorizontalEnd, ScanLine } from 'lucide-react';
import type { DemoCase } from './demo';
import { ImageViewport } from './image-viewport';
import { MultiView } from './multi-view';
import { SlidePreview, StatusLabel } from './worklist';

export function Viewer({ item, activeSlide, onSlide, onBack, onReview, requestsHref, initialSnapshot }: {
  item: DemoCase; activeSlide?: string; onSlide: (id: string) => void; onBack: () => void; onReview?: () => void; requestsHref?: string; initialSnapshot?: string;
}) {
  const [comparing, setComparing] = useState(false);
  const available = item.slides.filter(({ wsi }) => wsi);
  const slide = activeSlide
    ? item.slides.find(({ id }) => id === activeSlide)
    : item.slides.find(({ wsi }) => wsi) ?? item.slides[0];
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> 케이스 상세</button>
    <div className="page-heading"><div><h1>WSI 뷰어</h1><p>{item.id} · {item.specimen}</p></div><div className="actions"><StatusLabel status={item.status} />
      {!comparing && <button className="button secondary" disabled={available.length < 2} onClick={() => setComparing(true)}><GalleryHorizontalEnd size={16} /> Multi View</button>}
      {requestsHref && <a className="button secondary" href={requestsHref}>분석·자문 요청</a>}
      {!comparing && onReview && <button className="button secondary" disabled={!slide?.wsi} onClick={onReview}>{item.status === '검토 중' ? '검토 완료' : '검토 시작'}</button>}</div></div>
    {comparing ? <MultiView slides={available} primary={slide?.id} onClose={() => setComparing(false)}
      onSingle={(id) => { onSlide(id); setComparing(false); }} /> : <div className="viewer-layout">
      <aside className="panel viewer-tray"><div className="panel-title"><h2>슬라이드 Tray</h2><span className="count">{item.slides.length}</span></div>
        <div className="tray-items">{item.slides.map((entry) => <button className="tray-item" key={entry.id} onClick={() => onSlide(entry.id)} aria-pressed={slide?.id === entry.id} disabled={!entry.wsi}>
          <span className="slide-image"><SlidePreview slide={entry} /></span><span><strong>{entry.label ?? entry.id}</strong><small>{entry.stain} · {entry.wsi?.format ?? entry.state}</small></span>
        </button>)}</div>
      </aside>
      {slide?.wsi ? <ImageViewport key={slide.wsi.id + ':' + (initialSnapshot ?? '')} scan={slide.wsi} initialSnapshot={initialSnapshot} label={slide.label ?? slide.id} stain={slide.stain} />
        : <div className="panel empty"><ScanLine size={30} /><strong>{activeSlide && !slide ? '요청한 스캔을 찾을 수 없습니다.' : '등록된 스캔이 없습니다.'}</strong><button className="button secondary" onClick={onBack}>케이스 상세로 이동</button></div>}
    </div>}
  </>;
}
