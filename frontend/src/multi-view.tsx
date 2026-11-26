import { Crosshair, Maximize2, PanelTop, Unlink2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ImageViewport } from './image-viewport';
import type { Slide } from './demo';
import { fitTissue, identity, project, unproject } from './tissue-registration';
import type { Transform } from './tissue-registration';
import type { CameraFrame, SlideInfo } from './tile-viewer';
import type { Camera, Point } from './viewer-tools';

export const MAX_COMPARE_SCANS = 6;
type Frames = Record<string, CameraFrame>;

export function mapCamera(source: CameraFrame, target: CameraFrame, start?: CameraFrame, end?: CameraFrame): Camera {
  const [sourceWidth, sourceHeight] = source.dimensions;
  const [targetWidth, targetHeight] = target.dimensions;
  return {
    x: (end?.x ?? 0) + (source.x - (start?.x ?? 0)) / sourceWidth * targetWidth,
    y: (end?.y ?? 0) + (source.y - (start?.y ?? 0)) / sourceHeight * targetHeight,
    zoom: source.zoom / (start?.zoom ?? source.fitZoom) * (end?.zoom ?? target.fitZoom),
  };
}

export function MultiView({ slides, selected, active, cameras, roiCaseId, onActive, onFrame, onClose, onSingle }: {
  slides: Slide[]; selected: string[]; active: string; cameras: Record<string, Camera>;
  roiCaseId?: string;
  onActive: (id: string) => void; onFrame: (id: string, camera: Camera) => void;
  onClose: () => void; onSingle: (id: string, camera?: Camera) => void;
}) {
  const [synchronized, setSynchronized] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<Frames>();
  const [commands, setCommands] = useState<Record<string, Camera>>({});
  const [picking, setPicking] = useState(false);
  const [points, setPoints] = useState<Record<string, Point[]>>({});
  const [registered, setRegistered] = useState<Record<string, Transform>>();
  const frames = useRef<Frames>({});
  const metadata = useRef<Record<string, SlideInfo>>({});
  // Adapted from the SaaS MultiViewFocus gesture. Slow double-clicks and controls retain their usual behavior.
  const previousClick = useRef<{ target: EventTarget; time: number; x: number; y: number }>(undefined);
  const quickPair = useRef(false);
  const round = Math.min(...selected.map((id) => points[id]?.length ?? 0));
  const completeRound = selected.every((id) => (points[id]?.length ?? 0) === round);
  const pairs = completeRound && round >= 3 ? selected.slice(1).map((id) => ({
    id, result: fitTissue(points[selected[0]], points[id], metadata.current[id]),
  })) : [];
  const validated = pairs.length > 0 && pairs.every((pair) => pair.result);
  const formatError = (value: number, unit: string) => unit === 'µm' && value >= 1000
    ? `${(value / 1000).toFixed(2)} mm` : `${value.toFixed(2)} ${unit}`;
  const waitingFor = picking ? selected.flatMap((id, index) => (points[id]?.length ?? 0) === round ? [`Pane ${index + 1}`] : []) : [];
  const allReady = selected.length >= 2 && selected.every((id) => loaded.includes(id));

  function publish(driver: string, frame: CameraFrame, bases = anchors) {
    const commands: Record<string, Camera> = {};
    for (const id of selected) {
      const target = frames.current[id];
      if (id !== driver && target?.fitZoom && frame.fitZoom) {
        const sourceTransform = registered?.[driver];
        const targetTransform = registered?.[id];
        if (sourceTransform && targetTransform) {
          const reference = unproject([frame.x, frame.y], sourceTransform);
          const [x, y] = project(reference, targetTransform);
          commands[id] = { x, y, zoom: frame.zoom * sourceTransform.scale / targetTransform.scale };
        } else {
          commands[id] = mapCamera(frame, target, bases?.[driver], bases?.[id]);
        }
      }
    }
    setCommands(commands);
  }

  const lastSelection = useRef(selected.join(','));
  const selectionKey = selected.join(',');
  useEffect(() => {
    if (lastSelection.current === selectionKey) return;
    lastSelection.current = selectionKey;
    const current = new Set(selectionKey.split(','));
    for (const id of Object.keys(frames.current)) {
      if (!current.has(id)) { delete frames.current[id]; delete metadata.current[id]; }
    }
    setLoaded((previous) => previous.filter((id) => current.has(id)));
    setSynchronized(false);
    setFocused(false);
    setCommands({});
    setAnchors(undefined);
    setPoints({});
    setRegistered(undefined);
    setPicking(false);
  }, [selectionKey]);

  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const workbench = element.closest('.viewer-workbench');
    function resize() {
      if (!element) return;
      const fullscreen = document.fullscreenElement;
      const bounds = element.getBoundingClientRect();
      const top = fullscreen?.contains(element) ? bounds.top - fullscreen.getBoundingClientRect().top + fullscreen.scrollTop : bounds.top + window.scrollY;
      const height = (fullscreen?.clientHeight ?? window.innerHeight) - top - 8;
      element.style.setProperty('--comparison-height', `${Math.max(320, Math.floor(height))}px`);
    }
    const observer = new ResizeObserver(resize);
    if (workbench) observer.observe(workbench);
    if (element.previousElementSibling) observer.observe(element.previousElementSibling);
    window.addEventListener('resize', resize);
    document.addEventListener('fullscreenchange', resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', resize);
    };
  }, []);

  function recordPoint(id: string, point: Point) {
    setPoints((current) => {
      const currentRound = Math.min(...selected.map((value) => current[value]?.length ?? 0));
      if (currentRound >= 8 || (current[id]?.length ?? 0) > currentRound) return current;
      return { ...current, [id]: [...(current[id] ?? []), point] };
    });
  }

  return <section aria-label="Multi View" className="multi-view">
    <div className="multi-view-control">
      <div className="actions multi-view-actions">
        <span className="multi-view-count" title="Selected scans">{selected.length} / {MAX_COMPARE_SCANS} panes</span>
        <button className="button secondary" aria-pressed={synchronized} disabled={!allReady || focused || picking} onClick={() => {
          const next = !synchronized;
          setSynchronized(next);
          if (next && frames.current[active]) publish(active, frames.current[active]);
          else setCommands({});
        }}>Sync Position</button>
        <button className="button secondary" aria-pressed={focused} disabled={!loaded.includes(active) || picking}
          aria-label={focused ? 'Restore Split View' : 'Expand Active Pane'} title={focused ? 'Restore Split View' : 'Expand Active Pane'}
          onClick={() => setFocused(!focused)}><Maximize2 size={15} aria-hidden="true" />{focused ? 'Restore Split' : 'Expand'}</button>
        <button className="icon-button" aria-label="Open Active Scan in Single View" title="Open Active Scan in Single View"
          disabled={!loaded.includes(active)} onClick={() => onSingle(active, frames.current[active])}><PanelTop size={16} aria-hidden="true" /></button>
        <button className="icon-button" aria-label="Close Comparison" title="Close Comparison" onClick={onClose}><Unlink2 size={16} aria-hidden="true" /></button>
        <details className="tissue-registration">
          <summary>Tissue Registration</summary>
          <div className="registration-popover">
            <p className="muted">Pick the same feature in each pane. The first two landmarks fit the alignment. Use a different feature for each additional check.</p>
            <div className="actions">
              <button className="button secondary" disabled={!allReady || synchronized || focused || picking || !!registered}
                onClick={() => setAnchors(anchors ? undefined : Object.fromEntries(selected.map((id) => [id, frames.current[id]])))}>
                {anchors ? 'Clear Alignment Points' : 'Use Current Positions as Alignment Points'}</button>
              <button className="button secondary" disabled={!allReady || synchronized || focused || picking} onClick={() => {
                setRegistered(undefined); setPoints({}); setPicking(true);
              }}>Pick Tissue Landmarks</button>
              {picking && <>
                <button className="button secondary" disabled={!Object.values(points).some((list) => list.length)} onClick={() => {
                  const last = Math.max(...Object.values(points).map((list) => list.length));
                  setPoints(Object.fromEntries(selected.map((id) => [id, (points[id] ?? []).slice(0, last - 1)])));
                }}>Undo Landmark Round</button>
                <button className="button primary" disabled={!validated} onClick={() => {
                  setRegistered(Object.fromEntries([[selected[0], identity], ...pairs.map(({ id, result }) => [id, result!.fit])]));
                  setAnchors(undefined);
                  setPicking(false);
                }}>Use Tissue Registration</button>
              </>}
              {(picking || registered) && <button className="button secondary" disabled={synchronized} onClick={() => {
                setRegistered(undefined); setPoints({}); setPicking(false); setCommands({});
              }}>Clear Tissue Registration</button>}
            </div>
            {picking && <p role="status" className="landmark-progress"><Crosshair size={15} aria-hidden="true" />
              {round < 8 ? `Landmark ${round + 1} · ${round < 2 ? 'Fit' : 'Independent Check'} · Waiting for ${waitingFor.join(', ')}` : 'Eight landmarks recorded'}
            </p>}
            {pairs.length > 0 && <ul aria-label="Registration Error by Scan">{pairs.map(({ id, result }) => <li key={id}>
              {slides.find((slide) => slide.id === id)?.label ?? id}{' · '}
              {result ? `Check landmarks ${round - 2} · RMS ${formatError(result.rms, result.unit)} · Maximum ${formatError(result.maximum, result.unit)}`
                : 'Choose two more widely spaced fit landmarks.'}
            </li>)}</ul>}
          </div>
        </details>
      </div>
      <span className="multi-view-sync-status muted" role="status">{registered ? 'Tissue Landmark Registration' : anchors ? 'Manual Alignment Points' : 'Normalized Image Coordinates'} · {focused ? 'Sync Paused While Expanded' : synchronized ? 'Sync On' : 'Sync Off'}</span>
    </div>
    <div ref={grid} className="multi-view-grid" data-count={selected.length} data-focused={focused}>
      {selected.map((id, index) => {
        const slide = slides.find((item) => item.id === id);
        if (!slide?.wsi) return null;
        return <div key={id} role="group" aria-label={`Pane ${index + 1}: ${slide.label ?? id} ${slide.wsi.format}`}
          className="multi-view-pane" data-active={active === id} hidden={focused && active !== id}
          onClickCapture={(event) => {
            if (event.target instanceof HTMLCanvasElement && event.target.classList.contains('drawing-tool')) {
              previousClick.current = undefined;
              quickPair.current = false;
              return;
            }
            const previous = previousClick.current;
            quickPair.current = !!previous && event.button === 0 && event.target === previous.target
              && event.timeStamp >= previous.time && event.timeStamp - previous.time <= 250
              && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8;
            previousClick.current = event.button === 0
              ? { target: event.target, time: event.timeStamp, x: event.clientX, y: event.clientY } : undefined;
          }}
          onDoubleClickCapture={(event) => {
            const withinClickWindow = quickPair.current;
            quickPair.current = false;
            previousClick.current = undefined;
            if (!withinClickWindow || focused || picking || !loaded.includes(id)
                || !(event.target instanceof HTMLCanvasElement) || event.target.classList.contains('drawing-tool')) return;
            event.preventDefault();
            onActive(id);
            setFocused(true);
          }}
          onFocusCapture={() => onActive(id)} onPointerDownCapture={() => onActive(id)}>
          {picking && round < 8 && <span className="pane-landmark-state">{(points[id]?.length ?? 0) === round ? 'Pick Landmark' : 'Landmark Recorded'}</span>}
          <ImageViewport scan={slide.wsi} label={slide.label ?? id} stain={slide.stain} initialCamera={cameras[id]} roiCaseId={roiCaseId} comparison={{
            camera: commands[id], landmarks: points[id],
            captureLandmark: picking ? (point) => recordPoint(id, point) : undefined,
            onFrame: (frame, info) => {
              if (info) metadata.current[id] = info;
              if (!frames.current[id]) setLoaded((current) => [...current, id]);
              frames.current[id] = frame;
              onFrame(id, frame);
            },
            onNavigate: (frame) => {
              onActive(id);
              if (synchronized && !focused) publish(id, frame);
            },
          }} />
        </div>;
      })}
    </div>
  </section>;
}
