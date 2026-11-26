import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Image, Layers, List, LocateFixed, Map, Minus, Pause, Play, Plus, ScanLine, Tag, Tally5, X } from 'lucide-react';
import type { CollectionOrigin } from './workflow-navigation';
import type { WsiScan } from './demo';
import { api, auditAttemptId, jsonBody, request } from './session';
import { ViewerAnalysis } from './viewer-analysis';
import { IhcCellMenu, IhcOverlay, IhcPanel, useIhcResults } from './ihc-results';
import { usePapGallery } from './pap-gallery-state';
import { useSkinReview } from './skin-review-state';
import { ProstateOverlay, ProstatePanel, useProstateResults } from './prostate-results';
import { Pdl1Badge, Pdl1Overlay, Pdl1Panel, usePdl1 } from './pdl1';
import { roiSearchHref } from './roi-search';
import { LymphCounts } from './lymph-counts';
import { referenceMagnification, TileViewer, wheelZoomStep } from './tile-viewer';
import type { CameraFrame, SlideInfo, TileStatus, Viewport } from './tile-viewer';
import { AnnotationOverlay, DrawingControls, ViewerRecordsPanel, ViewerToolsBar, hasVertices, screenToSlide, useViewerRecords } from './viewer-tools';
import type { Camera, Geometry, Point, Tool } from './viewer-tools';
import type { ViewerSettings } from './viewer-preferences';
import { ScanReference, slideEndpoint } from './worklist';
import { ViewportExport, snapshotViewport, viewportScale } from './viewport-export';
import type { ViewportSnapshot } from './viewport-export';

function ScaleBar({ mpp, zoom }: { mpp: number | null; zoom?: number }) {
  if (!zoom) return null;
  if (!mpp) return <span className="scale-bar">Pixel size unavailable</span>;
  const { label, width } = viewportScale(mpp, zoom);
  return <div className="scale-bar" aria-label={`Scale bar ${label}`}><span>{label}</span><i style={{ width }} /></div>;
}

const PapReview = lazy(() => import('./pap-review'));
const PapGallery = lazy(() => import('./pap-gallery'));
const SkinOverlay = lazy(() => import('./skin-review').then((module) => ({ default: module.SkinOverlay })));
const SkinPanel = lazy(() => import('./skin-review').then((module) => ({ default: module.SkinPanel })));

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
  captureLandmark?: (point: Point) => void;
  landmarks?: Point[];
  onFrame: (frame: CameraFrame, info?: SlideInfo) => void;
  onNavigate: (frame: CameraFrame) => void;
};

type ViewerOptions = {
  settings: ViewerSettings;
  active: boolean;
  presenting?: boolean;
  onCamera?: (camera: CameraFrame) => void;
  reportHref?: string;
  position: { index: number; total: number };
  previous?: () => void;
  next?: () => void;
  toggleLabel: () => void;
  toggleOverview: () => void;
  toggleFullscreen: () => Promise<void>;
  toggleGallery: () => void;
  toggleMinimap: () => void;
};

function useCanvasFit(enabled: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    if (!enabled || !surface.current) return;
    const element = surface.current;
    let frame = 0;
    function fit() {
      const fullscreen = document.fullscreenElement;
      const fullscreenViewer = fullscreen instanceof HTMLElement && fullscreen.contains(element) ? fullscreen : undefined;
      const top = element.getBoundingClientRect().top + (fullscreenViewer ? fullscreenViewer.scrollTop - fullscreenViewer.getBoundingClientRect().top : window.scrollY);
      const viewportHeight = fullscreenViewer?.clientHeight ?? window.innerHeight;
      setHeight(Math.max(300, Math.floor(viewportHeight - top - 8)));
    }
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(update);
    const viewer = element.closest('.viewer-workbench');
    for (const layout of [viewer, element.closest('.viewer-layout'), element.closest('.image-panel'), document.querySelector('.topbar'), document.querySelector('.sidebar')]) {
      if (layout) observer.observe(layout);
    }
    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', update);
    };
  }, [enabled]);

  return { surface, height };
}

const autopanVectors = { right: [-1, 0], left: [1, 0], down: [0, -1], up: [0, 1] } as const;
const reviewViewerLimits = { loads: 4, tiles: 64, keepCameraOnResize: true };
const comparisonViewerLimits = { loads: 2, tiles: 24, keepCameraOnResize: true };

export function ImageViewport({ scan, label, stain, comparison, readOnlyEndpoint, initialSnapshot, initialRoi, initialCamera, roiCaseId, options, sharedReview, extraAction, analysis, papMode, relatedReviewAction, caseRequestsHref }: {
  scan: WsiScan; label: string; stain: string; comparison?: PaneComparison; readOnlyEndpoint?: string; initialSnapshot?: string; initialRoi?: string; initialCamera?: Camera; roiCaseId?: string; options?: ViewerOptions;
  extraAction?: ReactNode; relatedReviewAction?: ReactNode; caseRequestsHref?: string;
  papMode?: 'gallery' | 'review';
  analysis?: { caseEndpoint: string; collectionOrigin?: CollectionOrigin; open: boolean; change: (open: boolean) => void };
  sharedReview?: { locked: boolean; camera?: Camera; onFrame: (camera: Camera) => void };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const isFullViewer = Boolean(options);
  const fit = useCanvasFit(isFullViewer);
  const slideVisible = options?.active ?? true;
  const analysisButton = useRef<HTMLButtonElement>(null);
  const pdlPanel = useRef<HTMLDivElement>(null);
  const ihcPanel = useRef<HTMLDivElement>(null);
  const [resultDock, setResultDock] = useState<'ihc' | 'pdl1' | null>();
  const [cellMenu, setCellMenu] = useState(false);
  const papReviewPanel = useRef<HTMLDivElement>(null);
  const papGalleryPanel = useRef<HTMLDivElement>(null);
  const papFocus = useRef<'gallery' | 'review'>(undefined);
  const skinPanel = useRef<HTMLDivElement>(null);
  const focusedRoi = useRef<string>(undefined);
  const [roiUnavailable, setRoiUnavailable] = useState(false);
  const renderer = useRef<TileViewer | null>(null);
  const onCamera = useRef(options?.onCamera);
  onCamera.current = options?.onCamera;
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const drawing = useRef<{ id: number; kind: Geometry['kind']; points: Point[] } | null>(null);
  const [preview, setPreview] = useState<Geometry>();
  const [vertexGuide, setVertexGuide] = useState<Point>();
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [showMarkup, setShowMarkup] = useState(true);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string>();
  const [lymphOpen, setLymphOpen] = useState(false);
  const lymphButton = useRef<HTMLButtonElement>(null);
  const lymphDock = useRef<HTMLDivElement>(null);
  const annotationsButton = useRef<HTMLButtonElement>(null);
  const annotationsDock = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Viewport>();
  const [info, setInfo] = useState<SlideInfo>();
  const [overview, setOverview] = useState('');
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const [labelImage, setLabelImage] = useState<{ url: string; source: string }>();
  const [labelError, setLabelError] = useState('');
  const [labelAttempt, setLabelAttempt] = useState(0);
  const [autopan, setAutopan] = useState(false);
  const [showPapReview, setShowPapReview] = useState(papMode === 'review');
  const [showPap, setShowPap] = useState(!!papMode);
  const [showSkin, setShowSkin] = useState(false);
  const [showProstate, setShowProstate] = useState(false);
  const [autopanNotice, setAutopanNotice] = useState('');
  const settings = options?.settings;
  const presenting = options?.presenting === true;
  const autopanSpeed = settings?.autopan_speed;
  const autopanDirection = settings?.autopan_direction;
  const [showNavigator, setShowNavigator] = useState(true);
  const [failure, setFailure] = useState('');
  const [tileStatus, setTileStatus] = useState<TileStatus>('loading');
  const [viewportSnapshot, setViewportSnapshot] = useState<ViewportSnapshot>();
  const [attempt, setAttempt] = useState(0);
  const endpoint = readOnlyEndpoint ?? slideEndpoint(scan);
  const compareMode = Boolean(comparison);
  const report = useRef(comparison);
  report.current = comparison;
  const reviewFrame = useRef(sharedReview);
  reviewFrame.current = sharedReview;
  const following = !!sharedReview?.locked;

  function navigate(action: (viewer: TileViewer) => void) {
    const viewer = renderer.current;
    if (!viewer || reviewFrame.current?.locked) return;
    setAutopan(false);
    setAutopanNotice('');
    setCellMenu(false);
    action(viewer);
    report.current?.onNavigate(viewer.cameraFrame());
  }

  useEffect(() => {
    if (info && comparison?.camera) renderer.current?.restoreCamera(comparison.camera);
  }, [info, comparison?.camera]);
  const sharedCamera = sharedReview?.camera;
  useEffect(() => {
    if (info) renderer.current?.followCamera(following ? sharedCamera : undefined);
  }, [info, following, sharedCamera?.x, sharedCamera?.y, sharedCamera?.zoom]);
  const canOpenSlideReview = Boolean(info) && !readOnlyEndpoint && !compareMode && scan.source === 'clinical';
  const stainKey = stain.toLowerCase().replace(/[^a-z0-9]/g, '');
  const papStain = ['pap', 'papanicolaou', 'papsmear', 'papanicolaoustain'].includes(stainKey.replace(/[0-9]/g, ''));
  const ihcStain = ['ki67', 'er', 'pr', 'her2'].includes(stainKey);
  const canOpenPap = canOpenSlideReview && papStain;
  const pap = usePapGallery(endpoint, canOpenPap && showPap);
  const appliedPapFocus = useRef<typeof pap.focus>(undefined);
  const skin = useSkinReview(endpoint, canOpenSlideReview && !papStain && showSkin);
  const prostate = useProstateResults(endpoint, canOpenSlideReview && !papStain && showProstate);
  const ihc = useIhcResults(endpoint, Boolean(info) && !readOnlyEndpoint && !compareMode && !papStain, view);
  const pdl1 = usePdl1(endpoint, Boolean(info) && !readOnlyEndpoint && !papStain, view, initialSnapshot);
  const restoreCamera = useCallback((camera: Camera) => {
    if (!compareMode && !reviewFrame.current?.locked) {
      setAutopan(false);
      renderer.current?.restoreCamera(camera);
    }
  }, [compareMode]);
  const entryCamera = useRef(initialCamera);
  const initialFocusApplied = useRef(false);
  const viewerRecords = useViewerRecords(endpoint, Boolean(info) && !readOnlyEndpoint, restoreCamera, !entryCamera.current);
  useEffect(() => {
    if (!info || !entryCamera.current || following || initialFocusApplied.current) return;
    initialFocusApplied.current = true;
    if (compareMode) renderer.current?.restoreCamera(entryCamera.current);
    else restoreCamera(entryCamera.current);
  }, [info, following, compareMode, restoreCamera]);

  const { tool, draft, notice: recordNotice, error: recordError } = viewerRecords;
  useEffect(() => {
    if (draft || recordNotice || (recordError && tool === 'pan')) {
      setAnnotationsOpen(true);
      setLymphOpen(false);
    }
  }, [draft, recordNotice, recordError, tool]);

  useEffect(() => {
    if (draft && annotationsOpen && window.matchMedia('(max-width: 760px)').matches) {
      annotationsDock.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [draft?.id, annotationsOpen]);

  useEffect(() => {
    if (lymphOpen && window.matchMedia('(max-width: 760px)').matches) {
      lymphDock.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [lymphOpen]);

  function chooseReviewTool(next: Tool) {
    setAutopan(false);
    ihc.setPicking(false);
    skin.setMode(undefined);
    setVertexGuide(undefined);
    viewerRecords.chooseTool(next);
    if (next !== 'pan') {
      setAnnotationsOpen(false);
      setLymphOpen(false);
      if (analysis?.open) analysis.change(false);
    }
    canvas.current?.focus({ preventScroll: true });
  }

  function nearPolygonStart(point: Point) {
    if (!view || tool !== 'polygon' || viewerRecords.vertices.length < 3) return false;
    const [x, y] = viewerRecords.vertices[0];
    return Math.hypot(point[0] - x, point[1] - y) * view.zoom <= 10;
  }

  function cameraFor(points: Point[], view: Viewport, savedZoom?: number | null): Camera {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const zoom = savedZoom ?? (points.length === 1 ? view.zoom : Math.min(
      view.width * view.zoom * 0.65 / Math.max(1, x2 - x1), view.height * view.zoom * 0.65 / Math.max(1, y2 - y1)));
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2, zoom };
  }

  useEffect(() => {
    if (!showPap) { appliedPapFocus.current = undefined; return; }
    if (!view || !pap.focus || following || appliedPapFocus.current === pap.focus) return;
    const [left, top, right, bottom] = pap.focus.candidate.bounds;
    appliedPapFocus.current = pap.focus;
    restoreCamera(cameraFor([[left, top], [right, bottom]], view));
  }, [view, pap.focus, following, restoreCamera, showPap]);

  useEffect(() => {
    if (!initialRoi || !view || !viewerRecords.records || focusedRoi.current === initialRoi) return;
    focusedRoi.current = initialRoi;
    const match = viewerRecords.records.annotations.find((item) => item.id === initialRoi &&
      ['rectangle', 'ellipse', 'polygon'].includes(item.kind));
    if (match) {
      setSelectedAnnotation(match.id);
      if (!entryCamera.current) restoreCamera(cameraFor(match.points, view));
    }
    setRoiUnavailable(!match);
  }, [initialRoi, view, viewerRecords.records, restoreCamera]);

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
      if (event.deltaY) navigate((viewer) => viewer.magnify(event.deltaY < 0 ? wheelZoomStep : 1 / wheelZoomStep));
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
          if (viewer) {
            report.current?.onFrame(viewer.cameraFrame(), metadata);
            reviewFrame.current?.onFrame(viewer.cameraFrame());
            onCamera.current?.(viewer.cameraFrame());
          }
        }, (status) => {
          setTileStatus(status);
          if (status !== 'loading') recordView(status === 'unavailable' ? 'failed' : 'success');
        }, compareMode ? comparisonViewerLimits : isFullViewer ? reviewViewerLimits : undefined);
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
  }, [endpoint, attempt, compareMode, isFullViewer, scan.source]);

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
    if (!slideVisible || !autopan || !autopanSpeed || !autopanDirection) return;
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
  }, [autopan, autopanDirection, autopanSpeed, slideVisible]);

  function toggleAutopan() {
    if (!slideVisible || !info || following || viewerRecords.tool !== 'pan' || tileStatus === 'unavailable') return;
    setAutopanNotice('');
    setAutopan((running) => !running);
  }

  useEffect(() => {
    if (!slideVisible || following || viewerRecords.tool !== 'pan' || tileStatus === 'unavailable') setAutopan(false);
  }, [slideVisible, following, viewerRecords.tool, tileStatus]);

  const minimap = settings?.show_minimap ?? showNavigator;
  const toggleMinimap = options?.toggleMinimap ?? (() => setShowNavigator(!showNavigator));
  const canReview = info && !compareMode && !readOnlyEndpoint && !following;
  const reviewTools = canReview && <ViewerToolsBar state={viewerRecords} view={view} info={info} onChoose={chooseReviewTool} />;
  const canCountLymph = info && !compareMode && !readOnlyEndpoint && !following
    && scan.source === 'clinical' && viewerRecords.records?.can_annotate;
  const drawingPreview: Geometry | undefined = preview ?? (viewerRecords.vertices.length ? {
    kind: tool === 'polygon' ? 'polygon' : tool === 'count' ? 'count' : 'distance',
    points: tool === 'path' && vertexGuide ? [...viewerRecords.vertices, vertexGuide] : viewerRecords.vertices,
  } : undefined);
  const recordsPanel = canReview && <ViewerRecordsPanel state={viewerRecords} info={info}
    selectedId={selectedAnnotation} showMarkup={showMarkup} onToggleMarkup={() => setShowMarkup(!showMarkup)}
    onClose={options ? () => { setAnnotationsOpen(false); annotationsButton.current?.focus({ preventScroll: true }); } : undefined}
    searchHref={roiCaseId && scan.source === 'clinical' ? (roiId) => roiSearchHref({ caseId: roiCaseId, scanId: scan.id, roiId }) : undefined}
    move={(id, points, zoom) => {
      if (!view) return;
      setSelectedAnnotation(id);
      setShowMarkup(true);
      navigate((viewer) => viewer.restoreCamera(cameraFor(points, view, zoom)));
      if (options && window.matchMedia('(max-width: 760px)').matches) canvas.current?.focus();
    }} />;
  function closeAnalysis() {
    analysis?.change(false);
    analysisButton.current?.focus({ preventScroll: true });
  }

  function openPapPanel(panel: 'gallery' | 'review') {
    const target = panel === 'review' ? papReviewPanel : papGalleryPanel;
    if (target.current) {
      target.current.focus();
    } else {
      papFocus.current = panel;
      if (panel === 'review') setShowPapReview(true);
      else setShowPap(true);
    }
  }

  useEffect(() => {
    if (papMode) {
      setShowPap(true);
      if (papMode === 'review') setShowPapReview(true);
    }
  }, [papMode]);

  useEffect(() => {
    const panel = papFocus.current === 'review' ? papReviewPanel.current : papFocus.current === 'gallery' ? papGalleryPanel.current : null;
    if (panel) { panel.focus(); papFocus.current = undefined; }
  }, [canOpenPap, showPap, showPapReview]);

  useEffect(() => { if (showSkin) skinPanel.current?.focus(); }, [showSkin]);
  const focusSlide = () => canvas.current?.focus();
  const papCandidate = pap.selected && { id: pap.selected.id,
    category: pap.archive?.categories.find(({ code }) => code === pap.selected?.category)?.label ?? pap.selected.category };
  const showIhcJump = canOpenSlideReview && !papStain && (ihcStain || ihc.source || ihc.failed);
  const showPdlJump = canOpenSlideReview && !papStain && (stainKey === 'pdl1' || pdl1.result || pdl1.error || pdl1.referenceMissing);
  const mpp = info?.mpp_x;
  const resultMode = resultDock === undefined ? (
    pdl1.result && (initialSnapshot || stainKey === 'pdl1') ? 'pdl1'
      : ihc.source || ihcStain ? 'ihc' : pdl1.result ? 'pdl1' : null
  ) : resultDock;
  const dockedResult = options && !presenting && !analysis?.open && !annotationsOpen && !lymphOpen && !showPap
    && info && !readOnlyEndpoint && !papStain ? resultMode : null;

  function openResult(mode: 'ihc' | 'pdl1', focus = true) {
    if (!options) { (mode === 'ihc' ? ihcPanel : pdlPanel).current?.focus(); return; }
    setResultDock(mode);
    setAnnotationsOpen(false);
    setLymphOpen(false);
    setShowPap(false);
    if (mode !== 'ihc') { setCellMenu(false); ihc.setPicking(false); }
    if (analysis?.open) analysis.change(false);
    if (focus) requestAnimationFrame(() => (mode === 'ihc' ? ihcPanel : pdlPanel).current?.focus());
  }

  const pdlResults = <Pdl1Panel state={pdl1} reportHref={options?.reportHref} onSlide={focusSlide} />;
  const ihcResults = <IhcPanel state={ihc} readOnly={following} showEmpty={ihcStain} caseRequestsHref={caseRequestsHref} onSlide={focusSlide}
    onPickStart={() => { setAutopan(false); skin.setMode(undefined); viewerRecords.chooseTool('pan'); canvas.current?.focus({ preventScroll: true }); }} />;

  const navigationControls = <>
        <button className="icon-button" title="Zoom Out" aria-label="Zoom Out" disabled={!info || following} onClick={() => navigate((viewer) => viewer.magnify(0.7))}><Minus size={18} /></button>
        <output aria-label="Zoom relative to scan" className="zoom-value">{view ? `${(view.zoom * 100).toFixed(view.zoom < 0.01 ? 2 : view.zoom < 0.1 ? 1 : 0)}%` : '—'}</output>
        <button className="icon-button" title="Zoom In" aria-label="Zoom In" disabled={!info || following} onClick={() => navigate((viewer) => viewer.magnify(1.4))}><Plus size={18} /></button>
        <button className="icon-button" title="Fit to Window" aria-label="Fit to Window" disabled={!info || following} onClick={() => navigate((viewer) => viewer.fitToWindow())}><LocateFixed size={17} /></button>
        {mpp && view && <select className="wsi-magnification" aria-label="Calibrated Magnification" title="Calibrated Magnification"
          value="" disabled={following} onChange={(event) => {
            const value = Number(event.target.value);
            if (value > 0) navigate((viewer) => viewer.zoomTo(value * mpp / referenceMagnification));
          }}>
          <option value="" disabled>{Number((view.zoom * referenceMagnification / mpp).toPrecision(2))}×</option>
          {[2, 5, 10, 20, 40, 80].filter((value) => value * mpp / referenceMagnification <= 4)
            .map((value) => <option value={value} key={value}>{value}×</option>)}
        </select>}
        <button className="icon-button" title="Minimap" aria-label="Minimap" aria-keyshortcuts={settings?.shortcuts ? 'M' : undefined} aria-pressed={minimap} disabled={!overview && !options} onClick={toggleMinimap}><Map size={17} /></button>
        {options && <>
          <button type="button" className="icon-button" title="Scan Label" aria-label="Scan Label" aria-pressed={settings?.show_label}
            disabled={!info} onClick={options.toggleLabel}><Tag size={17} /></button>
          <button type="button" className="icon-button" title="Slide Overview" aria-label="Slide Overview" aria-pressed={settings?.show_overview}
            disabled={!info} onClick={options.toggleOverview}><Image size={17} /></button>
          <button type="button" className="icon-button" title={autopan ? 'Pause Autopan' : `Start Autopan · ${autopanDirection} · ${autopanSpeed} px/s`}
          aria-label={autopan ? 'Pause Autopan' : 'Start Autopan'} aria-pressed={autopan}
          disabled={!info || following || ihc.picking || skin.mode !== undefined || viewerRecords.tool !== 'pan' || tileStatus === 'unavailable'} onClick={toggleAutopan}>
          {autopan ? <Pause size={17} /> : <Play size={17} />}
        </button></>}
  </>;

  return <section className="image-panel" aria-label="Slide Image" data-scan-id={scan.id} data-autopan={autopan} data-tiles={tileStatus}
    data-view-center-x={view && view.x + view.width / 2} data-view-center-y={view && view.y + view.height / 2}
    data-view-zoom={view?.zoom}>
    <div className={options ? 'image-toolbar viewer-image-toolbar' : 'image-toolbar'}>
      {options ? <div className="viewer-scan-row">
        <div className="viewer-active-scan" role="group" aria-label="Active Scan">
          <ScanLine size={17} aria-hidden="true" />
          <span><strong>{label}</strong><small>{stain} · {scan.format}</small></span>
          <ScanReference scan={scan} />
        </div>
        <div className="viewer-image-controls">
          <div className="viewer-scan-step" role="group" aria-label="Navigate Scans">
            <button type="button" className="icon-button" title="Previous Scan" aria-label="Previous Scan" disabled={!options.previous} onClick={options.previous}><ChevronLeft size={16} /></button>
            <span aria-label="Scan position">{options.position.index}/{options.position.total}</span>
            <button type="button" className="icon-button" title="Next Scan" aria-label="Next Scan" disabled={!options.next} onClick={options.next}><ChevronRight size={16} /></button>
          </div>
          <div className="viewer-image-navigation" role="group" aria-label="Slide Navigation">{navigationControls}</div>
        </div>
      </div> : <span><ScanLine size={17} /> {label} <span className="image-stain">{stain} · {scan.format}</span></span>}
      <div className={options ? 'image-actions viewer-scan-actions' : 'image-actions'}>{analysis && <button type="button" ref={analysisButton} className="button primary"
        aria-expanded={analysis.open} aria-controls={analysis.open ? 'viewer-analysis-panel' : undefined}
        onClick={() => { setLymphOpen(false); analysis.change(!analysis.open); }}>Analysis</button>}{extraAction}
        {options && !readOnlyEndpoint && viewerRecords.records?.can_export && <button type="button" className="button secondary"
          disabled={!view || tileStatus !== 'ok' || Boolean(failure)} onClick={() => {
            if (!canvas.current?.clientWidth || !view) return;
            setAutopan(false);
            setViewportSnapshot(snapshotViewport(canvas.current, info?.mpp_x ? viewportScale(info.mpp_x, view.zoom) : undefined));
          }}><Download size={16} aria-hidden="true" /> Export Current View</button>}
        {options && canReview && <button type="button" ref={annotationsButton} className="button secondary viewer-annotations-toggle"
          aria-expanded={annotationsOpen && !analysis?.open}
          onClick={() => {
            setLymphOpen(false);
            if (analysis?.open) { analysis.change(false); setAnnotationsOpen(true); }
            else setAnnotationsOpen(!annotationsOpen);
          }}><List size={17} aria-hidden="true" /> Annotations{viewerRecords.records?.annotations.length ? <small aria-hidden="true">{viewerRecords.records.annotations.length}</small> : null}</button>}
        {options && canCountLymph && <button ref={lymphButton} type="button" className="button secondary"
          aria-expanded={lymphOpen && !analysis?.open} onClick={() => {
            setAnnotationsOpen(false);
            if (analysis?.open) analysis.change(false);
            setLymphOpen(!lymphOpen || !!analysis?.open);
          }}><Tally5 size={16} aria-hidden="true" /> Lymph Node Count</button>}
        {showPdlJump && <button type="button" className="button secondary" aria-expanded={options ? dockedResult === 'pdl1' : undefined}
          onClick={() => openResult('pdl1')}><Layers size={15} /> PD-L1 Results</button>}
        {showIhcJump && <button type="button" className="button secondary" aria-expanded={options ? dockedResult === 'ihc' : undefined}
          onClick={() => openResult('ihc')}><Layers size={15} /> IHC Results</button>}
        {canOpenPap && <button type="button" className="button secondary" aria-expanded={showPapReview}
          onClick={() => setShowPapReview((open) => !open)}>Pap Review</button>}
        {canOpenPap && <button type="button" className="button secondary" aria-expanded={showPap}
          disabled={pap.busy} onClick={() => setShowPap((open) => !open)}>Pap Gallery</button>}
        {canOpenSlideReview && !papStain && <button type="button" className="button secondary" aria-expanded={showSkin}
          disabled={skin.busy} onClick={() => { skin.setMode(undefined); setShowSkin((open) => !open); }}>Skin Review</button>}
        {canOpenSlideReview && !papStain && <button type="button" className="button secondary" aria-expanded={showProstate}
          onClick={() => setShowProstate((open) => !open)}>Prostate AI</button>}
        {!options && navigationControls}
      </div>
    </div>
    {!options && reviewTools}
    <div className={!presenting && canOpenPap && showPap ? 'analysis-workspace pap-workspace' : 'analysis-workspace'}
      data-results-dock={Boolean(dockedResult)}>
    <div ref={fit.surface} className="image-surface" data-review-dock={Boolean(options && reviewTools)}
      style={options && fit.height ? { height: fit.height } : undefined}>
      <canvas className={presenting || (viewerRecords.tool === 'pan' && !ihc.picking && !skin.mode) ? 'wsi-canvas' : 'wsi-canvas drawing-tool'} ref={canvas} tabIndex={0} aria-label="WSI Canvas"
        onContextMenu={(event) => {
          if (!options || presenting || following || !ihc.canReview || !ihc.enabled || viewerRecords.tool !== 'pan' || skin.mode) return;
          const box = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - box.left;
          const y = event.clientY - box.top;
          if (!view || !ihc.pickAt(view.x + x / view.zoom, view.y + y / view.zoom)) return;
          event.preventDefault();
          setAutopan(false);
          openResult('ihc', false);
          setCellMenu(true);
        }}
        onPointerDown={(event) => {
          if (following || event.button !== 0 || !info || drag.current || drawing.current) return;
          setCellMenu(false);
          setAutopan(false);
          setAutopanNotice('');
          if (report.current?.captureLandmark) {
            const point = getPoint(event, false);
            if (point) report.current.captureLandmark(point);
            return;
          }
          if (!presenting && showSkin && skin.mode) {
            const point = getPoint(event, false);
            if (point) skin.place(point);
            return;
          }
          if (!presenting && ihc.picking) {
            const point = getPoint(event, false);
            if (point) ihc.pickAt(...point);
            return;
          }
          const tool = presenting ? 'pan' : viewerRecords.tool;
          if (tool !== 'pan') {
            const start = getPoint(event, false);
            if (!start) return;
            if (hasVertices(tool)) {
              if (nearPolygonStart(start)) viewerRecords.finishVertices();
              else viewerRecords.addVertex(start);
            }
            else if (tool === 'preset') viewerRecords.placePreset(start, info);
            else if (tool === 'point') viewerRecords.complete('point', [start]);
            else {
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = { id: event.pointerId, kind: tool, points: [start] };
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
            if (point) {
              const last = gesture.points.at(-1)!;
              if (gesture.kind === 'brush' && gesture.points.length < 255 &&
                  Math.hypot(last[0] - point[0], last[1] - point[1]) * (view?.zoom ?? 1) >= 3) gesture.points.push(point);
              setPreview({ kind: gesture.kind, points: [...gesture.points, point] });
            }
            return;
          }
          if (!presenting && !following && (tool === 'polygon' || tool === 'path') && viewerRecords.vertices.length) setVertexGuide(getPoint(event, false) ?? undefined);
          const last = drag.current;
          if (following || !last || last.id !== event.pointerId) return;
          navigate((viewer) => viewer.pan(event.clientX - last.x, event.clientY - last.y));
          drag.current = { id: last.id, x: event.clientX, y: event.clientY };
        }}
        onPointerLeave={() => setVertexGuide(undefined)}
        onPointerUp={(event) => {
          const gesture = drawing.current;
          if (gesture?.id !== event.pointerId) return;
          const end = getPoint(event, true);
          drawing.current = null;
          setPreview(undefined);
          if (end) {
            const last = gesture.points.at(-1)!;
            const points = last[0] === end[0] && last[1] === end[1] ? gesture.points : [...gesture.points, end];
            if (points.length >= 2) viewerRecords.complete(gesture.kind, points);
          }
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.id === event.pointerId) drag.current = null;
          if (drawing.current?.id === event.pointerId) {
            drawing.current = null;
            setPreview(undefined);
          }
        }}
        onKeyDown={(event) => {
          if (following || settings?.shortcuts === false || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
          const key = event.key.toLowerCase();
          if (key === 'escape' && skin.mode) {
            skin.setMode(undefined);
            return;
          }
          if (key === 'escape' && ihc.picking) {
            ihc.setPicking(false);
            return;
          }
          if (key === 'escape' && viewerRecords.tool !== 'pan') {
            viewerRecords.chooseTool('pan');
            return;
          }
          if (!presenting && hasVertices(tool) && (key === 'enter' || key === 'backspace')) {
            event.preventDefault();
            if (key === 'enter') viewerRecords.finishVertices();
            else viewerRecords.undoVertex();
            return;
          }
          if (options && !presenting && ['f', 'm', 'g', ' '].includes(key)) {
            event.preventDefault();
            if (event.repeat) return;
            if (key === 'f') void options.toggleFullscreen();
            if (key === 'm') toggleMinimap();
            if (key === 'g') options.toggleGallery();
            if (key === ' ' && !skin.mode) toggleAutopan();
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
      {!papStain && <Pdl1Overlay view={view} result={pdl1.result} cells={pdl1.cells} mpp={mpp} />}
      {!papStain && <IhcOverlay state={ihc} view={view} mpp={mpp} />}
      {canOpenSlideReview && !papStain && showSkin && <Suspense fallback={null}><SkinOverlay state={skin} view={view} /></Suspense>}
      {canOpenSlideReview && !papStain && showProstate && <ProstateOverlay state={prostate} view={view} />}
      {showPap && view && pap.selected && <svg className="annotation-overlay pap-candidate-overlay" aria-label="Selected Pap Candidate"
        viewBox={`0 0 ${view.width * view.zoom} ${view.height * view.zoom}`}>
        <rect x={(pap.selected.bounds[0] - view.x) * view.zoom} y={(pap.selected.bounds[1] - view.y) * view.zoom}
          width={(pap.selected.bounds[2] - pap.selected.bounds[0]) * view.zoom}
          height={(pap.selected.bounds[3] - pap.selected.bounds[1]) * view.zoom} />
      </svg>}
      <AnnotationOverlay view={view} annotations={showMarkup ? viewerRecords.records?.annotations ?? [] : []}
        draft={viewerRecords.draft} drawing={drawingPreview} selectedId={selectedAnnotation}
        guide={tool === 'polygon' ? vertexGuide : undefined} closeHint={!!vertexGuide && nearPolygonStart(vertexGuide)} />
      {view && !!comparison?.landmarks?.length && <svg className="annotation-overlay" aria-label="Tissue Landmarks"
        viewBox={`0 0 ${view.width * view.zoom} ${view.height * view.zoom}`}>
        {comparison.landmarks.map(([x, y], index) => <text className="annotation-length" key={index}
          x={(x - view.x) * view.zoom} y={(y - view.y) * view.zoom}>{index + 1}</text>)}
      </svg>}
      {info && !readOnlyEndpoint && !papStain && <Pdl1Badge state={pdl1} />}
      {tileStatus === 'loading' && !failure && <div className="wsi-overlay image-empty" role="status">Opening slide…</div>}
      {tileStatus === 'refining' && <span className="viewport-tile-status" role="status">Loading tiles…</span>}
      {tileStatus === 'partial' && <div className="viewport-tile-status" role="status">
        Some tiles could not be loaded. <button className="button secondary" onClick={() => renderer.current?.retryTiles()}>Retry</button>
      </div>}
      {(failure || tileStatus === 'unavailable') && <div className="wsi-overlay image-empty" role="alert"><AlertTriangle size={25} />
        <strong>Unable to open the slide.</strong><p>{presenting ? 'Try loading the slide again.' : failure || 'Unable to load tiles.'}</p>
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
      {presenting && <div className="presentation-zoom" role="group" aria-label="Slide Zoom">
        <button type="button" className="icon-button" aria-label="Zoom Out" disabled={!info} onClick={() => navigate((viewer) => viewer.magnify(0.7))}><Minus size={18} /></button>
        <button type="button" className="icon-button" aria-label="Zoom In" disabled={!info} onClick={() => navigate((viewer) => viewer.magnify(1.4))}><Plus size={18} /></button>
        <button type="button" className="icon-button" aria-label="Fit to Window" disabled={!info} onClick={() => navigate((viewer) => viewer.fitToWindow())}><LocateFixed size={18} /></button>
      </div>}
      {canReview && <DrawingControls state={viewerRecords} info={info} preview={drawingPreview} shortcuts={settings?.shortcuts !== false} />}
      {options && reviewTools && <div className="viewer-tool-dock">{reviewTools}</div>}
      {cellMenu && dockedResult === 'ihc' && !following && view && ihc.picked && <IhcCellMenu state={ihc}
        x={Math.max(4, Math.min((ihc.picked[0] - view.x) * view.zoom, view.width * view.zoom - 208))}
        y={Math.max(4, Math.min((ihc.picked[1] - view.y) * view.zoom, view.height * view.zoom - 272))}
        close={() => { setCellMenu(false); focusSlide(); }} />}
    </div>
    {dockedResult && <div className="viewer-results-dock clinical-panel-focus"
      ref={dockedResult === 'ihc' ? ihcPanel : pdlPanel} tabIndex={-1} style={{ maxHeight: fit.height }}>
      <div className="viewer-results-heading"><strong>Detection Results</strong>
        <button type="button" className="icon-button" aria-label="Close Detection Results" onClick={() => {
          setResultDock(null); setCellMenu(false); ihc.setPicking(false); focusSlide();
        }}><X size={16} /></button></div>
      {dockedResult === 'ihc' ? ihcResults : pdlResults}
    </div>}
    {canOpenPap && showPap && <div className="clinical-panel-focus pap-gallery-dock" ref={papGalleryPanel} tabIndex={-1}>
      <Suspense fallback={<p role="status">Loading Pap Gallery…</p>}>
        <PapGallery state={pap} following={following} onReview={() => openPapPanel('review')} />
      </Suspense>
    </div>}
    {options && annotationsOpen && !analysis?.open && recordsPanel && <div className="viewer-annotations-dock" ref={annotationsDock}>{recordsPanel}</div>}
    {options && lymphOpen && !analysis?.open && canCountLymph && <div className="viewer-annotations-dock viewer-count-dock" ref={lymphDock}>
      <LymphCounts endpoint={endpoint} scanId={scan.id} reportHref={options.reportHref}
        onClose={() => { setLymphOpen(false); lymphButton.current?.focus({ preventScroll: true }); }} />
    </div>}
    {analysis?.open && <ViewerAnalysis caseEndpoint={analysis.caseEndpoint} scanId={scan.id} label={label} stain={stain}
      format={scan.format} collectionOrigin={analysis.collectionOrigin}
      onClose={closeAnalysis} onResult={(id) => { pdl1.openSnapshot(id); closeAnalysis(); openResult('pdl1', false); }} />}
    </div>
    <footer className="image-footer">
      <span>{info ? `${info.dimensions[0].toLocaleString()} × ${info.dimensions[1].toLocaleString()} px` : scan.format}</span>
      {autopanNotice && <span role="status">{autopanNotice}</span>}
      {pdl1.referenceMissing && <span className="tile-warning" role="status">Referenced PD-L1 Result Unavailable
        <button type="button" className="button secondary" onClick={() => pdlPanel.current?.focus()}>Review Result Status</button></span>}
      {overviewFailed && minimap && !settings?.show_overview && <span className="tile-warning" role="status">Minimap unavailable. <button className="button secondary" onClick={() => setOverviewAttempt((value) => value + 1)}>Retry Overview</button></span>}
    </footer>
    {canOpenPap && showPapReview && <div className="clinical-panel-focus" ref={papReviewPanel} tabIndex={-1}>
      <Suspense fallback={<p role="status">Loading Pap review…</p>}>
        <PapReview endpoint={endpoint} following={following} candidate={papCandidate} onGallery={() => openPapPanel('gallery')}
          relatedAction={relatedReviewAction} />
      </Suspense>
    </div>}
    {canOpenSlideReview && !papStain && showSkin && <div className="clinical-panel-focus" ref={skinPanel} tabIndex={-1}>
      <Suspense fallback={<p role="status">Loading skin tools…</p>}><SkinPanel state={skin} following={following} onSlide={focusSlide}
      activate={(mode) => {
        setAutopan(false);
        ihc.setPicking(false);
        viewerRecords.chooseTool('pan');
        skin.setMode(mode);
        canvas.current?.focus();
      }}
      focus={(points) => {
        if (view) navigate((viewer) => viewer.restoreCamera(cameraFor(points, view)));
        canvas.current?.scrollIntoView({ block: 'nearest' });
      }} /></Suspense></div>}
    {canOpenSlideReview && !papStain && showProstate && <ProstatePanel state={prostate} canNavigate={Boolean(view) && !following} onSlide={focusSlide}
      focus={(points) => {
        if (view) navigate((viewer) => viewer.restoreCamera(cameraFor(points, view)));
        canvas.current?.scrollIntoView({ block: 'nearest' });
      }} />}
    {roiUnavailable && <p className="notice" role="status">The linked ROI is unavailable. The scan is still open.</p>}
    {viewportSnapshot && <ViewportExport snapshot={viewportSnapshot} endpoint={endpoint} onClose={() => setViewportSnapshot(undefined)} />}
    {!options && recordsPanel}
    {!options && canCountLymph && <LymphCounts endpoint={endpoint} scanId={scan.id} />}
    {!options && info && !compareMode && !readOnlyEndpoint && !papStain && <>
      <div className="clinical-panel-focus" ref={pdlPanel} tabIndex={-1}>{pdlResults}</div>
      <div className="clinical-panel-focus" ref={ihcPanel} tabIndex={-1}>{ihcResults}</div>
    </>}
  </section>;
}

