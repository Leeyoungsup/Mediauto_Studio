import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, ArrowLeft, LocateFixed, Map, Minus, Plus, ScanLine } from 'lucide-react';
import type { DemoCase, Slide } from './demo';
import { SlidePreview, StatusLabel } from './worklist';

type Position = { x: number; y: number; zoom: number };
const initial = { x: 0, y: 0, zoom: 1 };
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

function ImageViewport({ slide }: { slide: Slide }) {
  const region = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; origin: Position } | null>(null);
  const [position, setPosition] = useState(initial);
  const [navigatorVisible, setNavigatorVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const canView = slide.state === '열람 가능' && Boolean(slide.image);

  function move(x: number, y: number, zoom: number): Position {
    const width = region.current?.clientWidth ?? 0;
    const height = region.current?.clientHeight ?? 0;
    return { zoom, x: clamp(x, width * (zoom - 1) / 2), y: clamp(y, height * (zoom - 1) / 2) };
  }

  function magnify(current: Position, factor: number): Position {
    const zoom = Math.max(1, Math.min(8, current.zoom * factor));
    return move(current.x * zoom / current.zoom, current.y * zoom / current.zoom, zoom);
  }

  useEffect(() => {
    const viewport = region.current;
    if (!canView || failed || !viewport) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      setPosition((current) => magnify(current, event.deltaY < 0 ? 1.15 : 1 / 1.15));
    }
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [canView, failed]);

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canView || failed || position.zoom === 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, origin: position };
  }

  function pan(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    setPosition(move(start.origin.x + event.clientX - start.x, start.origin.y + event.clientY - start.y, start.origin.zoom));
  }

  const width = region.current?.clientWidth || 1;
  const height = region.current?.clientHeight || 1;
  const imageSource = slide.image && (attempt ? `${slide.image}?retry=${attempt}` : slide.image);

  return <section className="image-panel" aria-label="슬라이드 미리보기">
    <div className="image-toolbar"><span><ScanLine size={17} /> {slide.label ?? slide.id} <span className="image-stain">{slide.stain}</span></span>
      <div className="image-actions">
        <button className="icon-button" title="축소" aria-label="축소" disabled={!canView || failed || position.zoom === 1} onClick={() => setPosition(magnify(position, 1 / 1.3))}><Minus size={18} /></button>
        <output aria-label="미리보기 배율" className="zoom-value">{position.zoom.toFixed(1)}×</output>
        <button className="icon-button" title="확대" aria-label="확대" disabled={!canView || failed || position.zoom === 8} onClick={() => setPosition(magnify(position, 1.3))}><Plus size={18} /></button>
        <button className="icon-button" title="화면 맞춤" aria-label="화면 맞춤" disabled={!canView || failed} onClick={() => setPosition(initial)}><LocateFixed size={17} /></button>
        <button className="icon-button" title="미니맵" aria-label="미니맵" aria-pressed={navigatorVisible} disabled={!canView || failed} onClick={() => setNavigatorVisible(!navigatorVisible)}><Map size={17} /></button>
      </div>
    </div>
    <div className="image-surface" ref={region} data-zoomed={position.zoom > 1} onPointerDown={startPan} onPointerMove={pan}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      {canView && !failed ? <img className="tissue-image" alt={`${slide.id} 조직 영상`} src={imageSource} draggable={false}
        onError={() => setFailed(true)} style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${position.zoom})` }} />
        : <div className="image-empty" role="status"><AlertTriangle size={25} /><strong>{slide.state === '뷰어 연동 전' ? '파일 정보가 등록되었습니다.' : slide.state === '준비 중' ? '슬라이드 준비 중' : '슬라이드를 열 수 없습니다.'}</strong>
          <p>{slide.state === '뷰어 연동 전' ? '등록 정보는 슬라이드 등록에서 확인할 수 있습니다.' : slide.state === '준비 중' ? '다른 슬라이드를 선택할 수 있습니다.' : '슬라이드 연결 상태를 확인하거나 다른 슬라이드를 선택하세요.'}</p>
          {failed && <button className="button secondary" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>다시 시도</button>}
        </div>}
      {canView && !failed && navigatorVisible && <button className="minimap" aria-label="미니맵에서 이동" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.detail === 0) { setPosition(initial); return; }
        const x = ((event.clientX - bounds.left) / bounds.width - .5) * width * position.zoom;
        const y = ((event.clientY - bounds.top) / bounds.height - .5) * height * position.zoom;
        setPosition(move(-x, -y, position.zoom));
      }}><img alt="" src={slide.image} draggable={false} /><span style={{ width: `${100 / position.zoom}%`, height: `${100 / position.zoom}%`, left: `${50 - position.x / (width * position.zoom) * 100}%`, top: `${50 - position.y / (height * position.zoom) * 100}%` }} /></button>}
    </div>
    <footer className="image-footer"><span>{slide.state === '뷰어 연동 전' ? 'data/ 스캔 파일' : '공개 조직 이미지 · 시연용 미리보기'}</span><span>{slide.state}</span></footer>
  </section>;
}

export function Viewer({ item, activeSlide, onSlide, onBack, onReview }: {
  item: DemoCase; activeSlide?: string; onSlide: (id: string) => void; onBack: () => void; onReview: () => void;
}) {
  const slide = item.slides.find(({ id }) => id === activeSlide) ?? item.slides[0];
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> 케이스 상세</button>
    <div className="page-heading"><div><h1>WSI 뷰어</h1><p>{item.id} · {item.specimen}</p></div><div className="actions"><StatusLabel status={item.status} />
      {item.assignee && (item.status === '배정됨' || item.status === '검토 중') && <button className="button primary" onClick={onReview}>{item.status === '배정됨' ? '검토 시작' : '검토 완료'}</button>}
    </div></div>
    <div className="viewer-layout">
      <aside className="panel viewer-tray"><div className="panel-title"><h2>슬라이드</h2><span className="count">{item.slides.length}</span></div>
        <div className="tray-items">{item.slides.map((entry) => <button className="tray-item" key={entry.id} onClick={() => onSlide(entry.id)} aria-pressed={slide?.id === entry.id}>
          <span className="slide-image"><SlidePreview slide={entry} /></span><span><strong>{entry.label ?? entry.id}</strong><small>{entry.stain} · {entry.state}</small></span>
        </button>)}</div>
      </aside>
      {slide ? <ImageViewport key={slide.id} slide={slide} /> : <div className="panel empty"><ScanLine size={30} /><strong>연결된 슬라이드가 없습니다.</strong><button className="button secondary" onClick={onBack}>케이스 상세로 이동</button></div>}
    </div>
  </>;
}
