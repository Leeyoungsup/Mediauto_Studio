import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, LocateFixed, Map, Minus, Plus, ScanLine } from 'lucide-react';
import type { WsiScan } from './demo';
import { api, request } from './session';
import { Pdl1Badge, Pdl1Overlay, Pdl1Panel, usePdl1 } from './pdl1';
import { TileViewer } from './tile-viewer';
import type { CameraFrame, SlideInfo, Viewport } from './tile-viewer';
import { AnnotationOverlay, ViewerRecordsPanel, ViewerToolsBar, screenToSlide, useViewerRecords } from './viewer-tools';
import type { Camera, Point, Tool } from './viewer-tools';
import { slideEndpoint } from './worklist';

function ScaleBar({ mpp, zoom }: { mpp: number | null; zoom?: number }) {
  if (!zoom) return null;
  if (!mpp) return <span className="scale-bar">픽셀 크기 정보 없음</span>;
  const target = 120 * mpp / zoom;
  const power = 10 ** Math.floor(Math.log10(target));
  const length = (target >= 5 * power ? 5 : target >= 2 * power ? 2 : 1) * power;
  const label = length >= 1000 ? `${length / 1000} mm` : `${Number(length.toPrecision(3))} µm`;
  return <div className="scale-bar" aria-label={`스케일바 ${label}`}><span>{label}</span><i style={{ width: length * zoom / mpp }} /></div>;
}

function Navigator({ src, info, view, onMove }: { src: string; info: SlideInfo; view: Viewport; onMove: (x: number, y: number) => void }) {
  const [width, height] = info.dimensions;
  const x = Math.max(0, view.x);
  const y = Math.max(0, view.y);
  const visibleWidth = Math.min(width, view.x + view.width) - x;
  const visibleHeight = Math.min(height, view.y + view.height) - y;

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onMove((event.clientX - rect.left) / rect.width * width, (event.clientY - rect.top) / rect.height * height);
  }

  return <button className="minimap" aria-label="미니맵에서 이동"
    style={{ width: Math.min(160, 116 * width / height), aspectRatio: width / height }}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); move(event); }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event); }}
    onClick={(event) => { if (event.detail === 0) onMove(width / 2, height / 2); }}>
    <img src={src} alt="" draggable={false} />
    <span style={{ left: `${100 * x / width}%`, top: `${100 * y / height}%`,
      width: `${100 * visibleWidth / width}%`, height: `${100 * visibleHeight / height}%` }} />
  </button>;
}

export type PaneComparison = {
  camera?: Camera;
  onFrame: (frame: CameraFrame) => void;
  onNavigate: (frame: CameraFrame) => void;
};

export function ImageViewport({ scan, label, stain, comparison, readOnlyEndpoint, initialSnapshot }: {
  scan: WsiScan; label: string; stain: string; comparison?: PaneComparison; readOnlyEndpoint?: string; initialSnapshot?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<TileViewer | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const drawing = useRef<{ id: number; kind: Exclude<Tool, 'pan'>; start: Point } | null>(null);
  const [preview, setPreview] = useState<{ kind: Exclude<Tool, 'pan'>; points: [Point, Point] }>();
  const [view, setView] = useState<Viewport>();
  const [info, setInfo] = useState<SlideInfo>();
  const [overview, setOverview] = useState('');
  const [showNavigator, setShowNavigator] = useState(true);
  const [failure, setFailure] = useState('');
  const [tileStatus, setTileStatus] = useState<'loading' | 'ok' | 'partial' | 'unavailable'>('loading');
  const [attempt, setAttempt] = useState(0);
  const endpoint = readOnlyEndpoint ?? slideEndpoint(scan);
  const compareMode = Boolean(comparison);
  const report = useRef(comparison);
  report.current = comparison;

  function navigate(action: (viewer: TileViewer) => void) {
    const viewer = renderer.current;
    if (!viewer) return;
    action(viewer);
    report.current?.onNavigate(viewer.cameraFrame());
  }

  useEffect(() => {
    if (info && comparison?.camera) renderer.current?.restoreCamera(comparison.camera);
  }, [info, comparison?.camera]);
  const pdl1 = usePdl1(endpoint, Boolean(info) && !readOnlyEndpoint, view, initialSnapshot);
  const restoreCamera = useCallback((camera: Camera) => {
    if (!compareMode) renderer.current?.restoreCamera(camera);
  }, [compareMode]);
  const viewerRecords = useViewerRecords(endpoint, Boolean(info) && !readOnlyEndpoint, restoreCamera);

  function getPoint(event: ReactPointerEvent<HTMLCanvasElement>, allowClip: boolean): Point | null {
    if (!view || !info) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const [x, y] = screenToSlide(event.clientX - bounds.left, event.clientY - bounds.top, view);
    const [width, height] = info.dimensions;
    if (allowClip) return [Math.min(width - 1e-6, Math.max(0, x)), Math.min(height - 1e-6, Math.max(0, y))];
    return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
  }

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const controller = new AbortController();
    const { signal } = controller;
    let image: ImageBitmap | undefined;
    let imageUrl: string | undefined;
    setOverview('');
    setView(undefined);
    setInfo(undefined);
    setFailure('');
    setTileStatus('loading');

    element.addEventListener('wheel', (event) => {
      if (!renderer.current) return;
      event.preventDefault();
      navigate((viewer) => viewer.magnify(event.deltaY < 0 ? 1.25 : 0.8, event.offsetX, event.offsetY));
    }, { signal, passive: false });

    async function open() {
      try {
        const metadata = await api<SlideInfo>(endpoint, { signal });
        if (!element || signal.aborted) return;
        renderer.current = new TileViewer(element, metadata, endpoint, (viewport) => {
          setView(viewport);
          const viewer = renderer.current;
          if (viewer) report.current?.onFrame(viewer.cameraFrame());
        }, setTileStatus, compareMode ? { loads: 2, tiles: 24 } : undefined);
        setInfo(metadata);
      } catch (error) {
        if (!signal.aborted) setFailure(error instanceof Error ? error.message : '슬라이드를 열 수 없습니다.');
        return;
      }
      try {
        const blob = await (await request(`${endpoint}/overview.jpeg`, { signal })).blob();
        const bitmap = await createImageBitmap(blob);
        if (signal.aborted) { bitmap.close(); return; }
        image = bitmap;
        imageUrl = URL.createObjectURL(blob);
        setOverview(imageUrl);
        renderer.current?.setOverview(bitmap);
      } catch {
        if (!signal.aborted) renderer.current?.setOverview();
      }
    }
    void open();
    return () => {
      controller.abort();
      renderer.current?.destroy();
      renderer.current = null;
      drag.current = null;
      drawing.current = null;
      image?.close();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [endpoint, attempt, compareMode]);

  return <section className="image-panel" aria-label="슬라이드 영상"
    data-view-center-x={view && view.x + view.width / 2} data-view-center-y={view && view.y + view.height / 2}
    data-view-zoom={view?.zoom}>
    <div className="image-toolbar"><span><ScanLine size={17} /> {label} <span className="image-stain">{stain} · {scan.format}</span></span>
      <div className="image-actions">
        <button className="icon-button" title="축소" aria-label="축소" disabled={!info} onClick={() => navigate((viewer) => viewer.magnify(0.7))}><Minus size={18} /></button>
        <output aria-label="스캔 대비 화면 배율" className="zoom-value">{view ? `${(view.zoom * 100).toFixed(view.zoom < 0.1 ? 1 : 0)}%` : '—'}</output>
        <button className="icon-button" title="확대" aria-label="확대" disabled={!info} onClick={() => navigate((viewer) => viewer.magnify(1.4))}><Plus size={18} /></button>
        <button className="icon-button" title="화면 맞춤" aria-label="화면 맞춤" disabled={!info} onClick={() => navigate((viewer) => viewer.fitToWindow())}><LocateFixed size={17} /></button>
        <button className="icon-button" title="미니맵" aria-label="미니맵" aria-pressed={showNavigator} disabled={!overview} onClick={() => setShowNavigator(!showNavigator)}><Map size={17} /></button>
      </div>
    </div>
    {info && !compareMode && !readOnlyEndpoint && <ViewerToolsBar state={viewerRecords} view={view} />}
    <div className="image-surface">
      <canvas className={viewerRecords.tool === 'pan' ? 'wsi-canvas' : 'wsi-canvas drawing-tool'} ref={canvas} tabIndex={0} aria-label="WSI 캔버스"
        onPointerDown={(event) => {
          if (event.button !== 0 || !info || drag.current || drawing.current) return;
          if (viewerRecords.tool !== 'pan') {
            const start = getPoint(event, false);
            if (start) {
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = { id: event.pointerId, kind: viewerRecords.tool, start };
            }
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const gesture = drawing.current;
          if (gesture?.id === event.pointerId) {
            const point = getPoint(event, true);
            if (point) setPreview({ kind: gesture.kind, points: [gesture.start, point] });
            return;
          }
          const last = drag.current;
          if (!last || last.id !== event.pointerId) return;
          navigate((viewer) => viewer.pan(event.clientX - last.x, event.clientY - last.y));
          drag.current = { id: last.id, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const gesture = drawing.current;
          if (gesture?.id !== event.pointerId) return;
          const end = getPoint(event, true);
          drawing.current = null;
          setPreview(undefined);
          if (end) viewerRecords.complete(gesture.kind, gesture.start, end);
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.id === event.pointerId) drag.current = null;
          if (drawing.current?.id === event.pointerId) {
            drawing.current = null;
            setPreview(undefined);
          }
        }}
        onKeyDown={(event) => {
          const directions: Record<string, [number, number]> = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
          if (directions[event.key]) navigate((viewer) => viewer.pan(...directions[event.key]));
          else if (event.key === '+' || event.key === '=') navigate((viewer) => viewer.magnify(1.4));
          else if (event.key === '-') navigate((viewer) => viewer.magnify(0.7));
          else if (event.key === '0') navigate((viewer) => viewer.fitToWindow());
          else return;
          event.preventDefault();
        }}
      />
      <Pdl1Overlay view={view} result={pdl1.result} cells={pdl1.cells} />
      <AnnotationOverlay view={view} annotations={viewerRecords.records?.annotations ?? []} draft={viewerRecords.draft} drawing={preview} />
      {info && !readOnlyEndpoint && <Pdl1Badge state={pdl1} />}
      {tileStatus === 'loading' && !failure && <div className="wsi-overlay image-empty" role="status">슬라이드를 여는 중입니다.</div>}
      {(failure || tileStatus === 'unavailable') && <div className="wsi-overlay image-empty" role="alert"><AlertTriangle size={25} />
        <strong>슬라이드를 열 수 없습니다.</strong><p>{failure || '타일을 불러오지 못했습니다.'}</p>
        <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>
      </div>}
      {info && view && showNavigator && overview && <Navigator src={overview} info={info} view={view} onMove={(x, y) => navigate((viewer) => viewer.centerAt(x, y))} />}
      {info && <ScaleBar mpp={info.mpp_x} zoom={view?.zoom} />}
    </div>
    <footer className="image-footer">
      <span>{info ? `${info.dimensions[0].toLocaleString()} × ${info.dimensions[1].toLocaleString()} px` : scan.format}</span>
      {tileStatus === 'partial' && <span className="tile-warning" role="status">일부 타일을 불러오지 못했습니다. <button className="button secondary" onClick={() => renderer.current?.retryTiles()}>다시 시도</button></span>}
    </footer>
    {info && !compareMode && !readOnlyEndpoint && <ViewerRecordsPanel state={viewerRecords} info={info} move={([[x1, y1], [x2, y2]]) => {
      if (!view) return;
      const zoom = Math.min(view.width * view.zoom * 0.65 / Math.max(1, Math.abs(x2 - x1)),
        view.height * view.zoom * 0.65 / Math.max(1, Math.abs(y2 - y1)));
      renderer.current?.restoreCamera({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, zoom });
    }} />}
    {info && !compareMode && !readOnlyEndpoint && <Pdl1Panel state={pdl1} />}
  </section>;
}

