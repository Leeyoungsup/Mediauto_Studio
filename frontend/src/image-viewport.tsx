import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, LocateFixed, Map, Minus, Pause, Play, Plus, ScanLine } from 'lucide-react';
import type { WsiScan } from './demo';
import { api, auditAttemptId, jsonBody, request } from './session';
import { Pdl1Badge, Pdl1Overlay, Pdl1Panel, usePdl1 } from './pdl1';
import { TileViewer } from './tile-viewer';
import type { CameraFrame, SlideInfo, Viewport } from './tile-viewer';
import { AnnotationOverlay, ViewerRecordsPanel, ViewerToolsBar, screenToSlide, useViewerRecords } from './viewer-tools';
import type { Camera, Point, Tool } from './viewer-tools';
import type { ViewerSettings } from './viewer-preferences';
import { ScanReference, slideEndpoint } from './worklist';

function ScaleBar({ mpp, zoom }: { mpp: number | null; zoom?: number }) {
  if (!zoom) return null;
  if (!mpp) return <span className="scale-bar">Pixel size unavailable</span>;
  const target = 120 * mpp / zoom;
  const power = 10 ** Math.floor(Math.log10(target));
  const length = (target >= 5 * power ? 5 : target >= 2 * power ? 2 : 1) * power;
  const label = length >= 1000 ? `${length / 1000} mm` : `${Number(length.toPrecision(3))} µm`;
  return <div className="scale-bar" aria-label={`Scale bar ${label}`}><span>{label}</span><i style={{ width: length * zoom / mpp }} /></div>;
}

function Navigator({ src, info, view, dynamic, onMove }: { src: string; info: SlideInfo; view: Viewport; dynamic?: boolean; onMove: (x: number, y: number) => void }) {
  const [width, height] = info.dimensions;
  const x = Math.max(0, view.x);
  const y = Math.max(0, view.y);
  const visibleWidth = Math.min(width, view.x + view.width) - x;
  const visibleHeight = Math.min(height, view.y + view.height) - y;

  const scale = dynamic ? Math.min(1.4, Math.max(0.8, 0.8 * Math.sqrt(Math.max(width / view.width, height / view.height)))) : 1;

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onMove((event.clientX - rect.left) / rect.width * width, (event.clientY - rect.top) / rect.height * height);
  }

  return <button className="minimap" aria-label="Pan using minimap"
    style={{ width: scale * Math.min(160, 116 * width / height), aspectRatio: width / height }}
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

type ViewerOptions = {
  settings: ViewerSettings;
  toggleFullscreen: () => Promise<void>;
  toggleGallery: () => void;
  toggleMinimap: () => void;
};

const autopanVectors = { right: [-1, 0], left: [1, 0], down: [0, -1], up: [0, 1] } as const;

export function ImageViewport({ scan, label, stain, comparison, readOnlyEndpoint, initialSnapshot, options }: {
  scan: WsiScan; label: string; stain: string; comparison?: PaneComparison; readOnlyEndpoint?: string; initialSnapshot?: string; options?: ViewerOptions;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<TileViewer | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const drawing = useRef<{ id: number; kind: Exclude<Tool, 'pan'>; start: Point } | null>(null);
  const [preview, setPreview] = useState<{ kind: Exclude<Tool, 'pan'>; points: [Point, Point] }>();
  const [view, setView] = useState<Viewport>();
  const [info, setInfo] = useState<SlideInfo>();
  const [overview, setOverview] = useState('');
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const [labelImage, setLabelImage] = useState<{ url: string; source: string }>();
  const [labelError, setLabelError] = useState('');
  const [labelAttempt, setLabelAttempt] = useState(0);
  const [autopan, setAutopan] = useState(false);
  const [autopanNotice, setAutopanNotice] = useState('');
  const settings = options?.settings;
  const autopanSpeed = settings?.autopan_speed;
  const autopanDirection = settings?.autopan_direction;
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
    setAutopan(false);
    setAutopanNotice('');
    action(viewer);
    report.current?.onNavigate(viewer.cameraFrame());
  }

  useEffect(() => {
    if (info && comparison?.camera) renderer.current?.restoreCamera(comparison.camera);
  }, [info, comparison?.camera]);
  const pdl1 = usePdl1(endpoint, Boolean(info) && !readOnlyEndpoint, view, initialSnapshot);
  const restoreCamera = useCallback((camera: Camera) => {
    if (!compareMode) {
      setAutopan(false);
      renderer.current?.restoreCamera(camera);
    }
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
    setAutopan(false);
    setAutopanNotice('');
    setView(undefined);
    setInfo(undefined);
    setFailure('');
    setTileStatus('loading');

    element.addEventListener('wheel', (event) => {
      if (!renderer.current) return;
      event.preventDefault();
      navigate((viewer) => viewer.magnify(event.deltaY < 0 ? 1.25 : 0.8, event.offsetX, event.offsetY));
    }, { signal, passive: false });

    const auditId = auditAttemptId();
    let finished = false;
    function recordView(result: 'success' | 'failed') {
      if (finished || signal.aborted || scan.source !== 'clinical') return;
      finished = true;
      const options = { ...jsonBody('POST', { attempt_id: auditId, result }), keepalive: true };
      void request(`${endpoint}/view-events`, options).catch(() => {});
    }

    async function open() {
      try {
        const metadata = await api<SlideInfo>(endpoint, { signal, headers: { 'X-Audit-Attempt': auditId } });
        if (!element || signal.aborted) return;
        renderer.current = new TileViewer(element, metadata, endpoint, (viewport) => {
          setView(viewport);
          const viewer = renderer.current;
          if (viewer) report.current?.onFrame(viewer.cameraFrame());
        }, (status) => {
          setTileStatus(status);
          if (status !== 'loading') recordView(status === 'unavailable' ? 'failed' : 'success');
        }, compareMode ? { loads: 2, tiles: 24 } : undefined);
        setInfo(metadata);
      } catch (error) {
        if (!signal.aborted) {
          setFailure(error instanceof Error ? error.message : 'Unable to open the slide.');
          recordView('failed');
        }
      }
    }
    void open();
    return () => {
      controller.abort();
      renderer.current?.destroy();
      renderer.current = null;
      drag.current = null;
      drawing.current = null;
    };
  }, [endpoint, attempt, compareMode, scan.source]);

  useEffect(() => {
    setOverview('');
    setOverviewFailed(false);
    const viewer = renderer.current;
    if (!info || !viewer) return;
    const controller = new AbortController();
    const { signal } = controller;
    let image: ImageBitmap | undefined;
    let url: string | undefined;
    const load = async () => {
      try {
        const blob = await (await request(`${endpoint}/overview.jpeg`, { signal })).blob();
        const bitmap = await createImageBitmap(blob);
        if (signal.aborted) { bitmap.close(); return; }
        image = bitmap;
        url = URL.createObjectURL(blob);
        setOverview(url);
        viewer.setOverview(bitmap);
      } catch {
        if (!signal.aborted) {
          setOverviewFailed(true);
          viewer.setOverview();
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      if (image) { viewer.setOverview(); image.close(); }
      if (url) URL.revokeObjectURL(url);
    };
  }, [endpoint, info, overviewAttempt]);

  useEffect(() => {
    setLabelImage(undefined);
    setLabelError('');
    if (!info || !settings?.show_label) return;
    const controller = new AbortController();
    const { signal } = controller;
    let url: string | undefined;
    const load = async () => {
      try {
        const response = await request(`${endpoint}/label.jpeg`, { signal });
        const blob = await response.blob();
        if (signal.aborted) return;
        url = URL.createObjectURL(blob);
        setLabelImage({ url, source: response.headers.get('X-Label-Source') === 'uploaded' ? 'Uploaded' : 'Embedded' });
      } catch (error) {
        if (!signal.aborted) setLabelError(error instanceof Error ? error.message : 'Unable to load the scan label.');
      }
    };
    void load();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [endpoint, info, labelAttempt, settings?.show_label]);

  useEffect(() => {
    if (!autopan || !autopanSpeed || !autopanDirection) return;
    const [dx, dy] = autopanVectors[autopanDirection];
    let last = performance.now();
    let frame = 0;
    function advance(now: number) {
      const viewer = renderer.current;
      if (!viewer || !autopanSpeed) return;
      const distance = autopanSpeed * Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (distance) {
        const before = viewer.cameraFrame();
        viewer.pan(dx * distance, dy * distance);
        const after = viewer.cameraFrame();
        if (before.x === after.x && before.y === after.y) {
          setAutopan(false);
          setAutopanNotice('Autopan reached the edge. Zoom in, move the slide, or change direction.');
          return;
        }
      }
      frame = requestAnimationFrame(advance);
    }
    function pause() { if (document.hidden) setAutopan(false); }
    frame = requestAnimationFrame(advance);
    document.addEventListener('visibilitychange', pause);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', pause);
    };
  }, [autopan, autopanDirection, autopanSpeed]);

  function toggleAutopan() {
    if (!info || viewerRecords.tool !== 'pan' || tileStatus === 'unavailable') return;
    setAutopanNotice('');
    setAutopan((running) => !running);
  }

  useEffect(() => {
    if (viewerRecords.tool !== 'pan' || tileStatus === 'unavailable') setAutopan(false);
  }, [viewerRecords.tool, tileStatus]);

  const minimap = settings?.show_minimap ?? showNavigator;
  const toggleMinimap = options?.toggleMinimap ?? (() => setShowNavigator(!showNavigator));

  return <section className="image-panel" aria-label="Slide Image" data-scan-id={scan.id} data-autopan={autopan}
    data-view-center-x={view && view.x + view.width / 2} data-view-center-y={view && view.y + view.height / 2}
    data-view-zoom={view?.zoom}>
    <div className="image-toolbar"><span><ScanLine size={17} /> {label} <span className="image-stain">{stain} · {scan.format}</span>{options && <ScanReference scan={scan} />}</span>
      <div className="image-actions">
        <button className="icon-button" title="Zoom Out" aria-label="Zoom Out" disabled={!info} onClick={() => navigate((viewer) => viewer.magnify(0.7))}><Minus size={18} /></button>
        <output aria-label="Zoom relative to scan" className="zoom-value">{view ? `${(view.zoom * 100).toFixed(view.zoom < 0.1 ? 1 : 0)}%` : '—'}</output>
        <button className="icon-button" title="Zoom In" aria-label="Zoom In" disabled={!info} onClick={() => navigate((viewer) => viewer.magnify(1.4))}><Plus size={18} /></button>
        <button className="icon-button" title="Fit to Window" aria-label="Fit to Window" disabled={!info} onClick={() => navigate((viewer) => viewer.fitToWindow())}><LocateFixed size={17} /></button>
        <button className="icon-button" title="Minimap" aria-label="Minimap" aria-pressed={minimap} disabled={!overview && !options} onClick={toggleMinimap}><Map size={17} /></button>
        {options && <button type="button" className="icon-button" title={autopan ? 'Pause Autopan' : 'Start Autopan'}
          aria-label={autopan ? 'Pause Autopan' : 'Start Autopan'} aria-pressed={autopan}
          disabled={!info || viewerRecords.tool !== 'pan' || tileStatus === 'unavailable'} onClick={toggleAutopan}>
          {autopan ? <Pause size={17} /> : <Play size={17} />}
        </button>}
      </div>
    </div>
    {info && !compareMode && !readOnlyEndpoint && <ViewerToolsBar state={viewerRecords} view={view} />}
    <div className="image-surface">
      <canvas className={viewerRecords.tool === 'pan' ? 'wsi-canvas' : 'wsi-canvas drawing-tool'} ref={canvas} tabIndex={0} aria-label="WSI Canvas"
        onPointerDown={(event) => {
          if (event.button !== 0 || !info || drag.current || drawing.current) return;
          setAutopan(false);
          setAutopanNotice('');
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
          if (settings?.shortcuts === false || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
          const key = event.key.toLowerCase();
          if (options && ['f', 'm', 'g', ' '].includes(key)) {
            event.preventDefault();
            if (event.repeat) return;
            if (key === 'f') void options.toggleFullscreen();
            if (key === 'm') toggleMinimap();
            if (key === 'g') options.toggleGallery();
            if (key === ' ') toggleAutopan();
            return;
          }
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
      {tileStatus === 'loading' && !failure && <div className="wsi-overlay image-empty" role="status">Opening slide…</div>}
      {(failure || tileStatus === 'unavailable') && <div className="wsi-overlay image-empty" role="alert"><AlertTriangle size={25} />
        <strong>Unable to open the slide.</strong><p>{failure || 'Unable to load tiles.'}</p>
        <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      </div>}
      {info && view && minimap && overview && <Navigator src={overview} info={info} view={view} dynamic={settings?.dynamic_minimap} onMove={(x, y) => navigate((viewer) => viewer.centerAt(x, y))} />}
      {info && (settings?.show_label || settings?.show_overview) && <aside className="scan-images" aria-label="Scan Images">
        {settings.show_label && <div className="scan-image-card"><h3>Scan Label{labelImage && <small>{labelImage.source}</small>}</h3>
          {labelError ? <div role="status">{labelError} <button type="button" onClick={() => setLabelAttempt((value) => value + 1)}>Retry Label</button></div>
            : labelImage ? <img src={labelImage.url} alt="Scan label" onError={() => setLabelError('Unable to display the scan label.')} /> : <span role="status">Loading label…</span>}
        </div>}
        {settings.show_overview && <div className="scan-image-card"><h3>Overview</h3>
          {overviewFailed ? <div role="status">Overview unavailable. <button type="button" onClick={() => setOverviewAttempt((value) => value + 1)}>Retry Overview</button></div>
            : overview ? <button type="button" aria-label="Fit slide from overview" onClick={() => navigate((viewer) => viewer.fitToWindow())}><img src={overview} alt="Slide overview" /></button>
              : <span role="status">Loading overview…</span>}
        </div>}
      </aside>}
      {info && <ScaleBar mpp={info.mpp_x} zoom={view?.zoom} />}
    </div>
    <footer className="image-footer">
      <span>{info ? `${info.dimensions[0].toLocaleString()} × ${info.dimensions[1].toLocaleString()} px` : scan.format}</span>
      {autopanNotice && <span role="status">{autopanNotice}</span>}
      {overviewFailed && minimap && !settings?.show_overview && <span className="tile-warning" role="status">Minimap unavailable. <button className="button secondary" onClick={() => setOverviewAttempt((value) => value + 1)}>Retry Overview</button></span>}
      {tileStatus === 'partial' && <span className="tile-warning" role="status">Some tiles could not be loaded. <button className="button secondary" onClick={() => renderer.current?.retryTiles()}>Retry</button></span>}
    </footer>
    {info && !compareMode && !readOnlyEndpoint && <ViewerRecordsPanel state={viewerRecords} info={info} move={([[x1, y1], [x2, y2]]) => {
      if (!view) return;
      const zoom = Math.min(view.width * view.zoom * 0.65 / Math.max(1, Math.abs(x2 - x1)),
        view.height * view.zoom * 0.65 / Math.max(1, Math.abs(y2 - y1)));
      navigate((viewer) => viewer.restoreCamera({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, zoom }));
    }} />}
    {info && !compareMode && !readOnlyEndpoint && <Pdl1Panel state={pdl1} />}
  </section>;
}

