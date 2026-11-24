import { useRef, useState } from 'react';
import { ImageViewport } from './image-viewport';
import type { Slide } from './demo';
import { fitTissue, identity, project, unproject } from './tissue-registration';
import type { Transform } from './tissue-registration';
import type { CameraFrame, SlideInfo } from './tile-viewer';
import type { Camera, Point } from './viewer-tools';

const MIN_PANES = 2;
const MAX_PANES = 4;
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

export function MultiView({ slides, primary, onClose, onSingle }: {
  slides: Slide[]; primary?: string; onClose: () => void; onSingle: (id: string) => void;
}) {
  const [selection, setSelection] = useState(() => {
    const ids = slides.map((slide) => slide.id);
    return (primary && ids.includes(primary) ? [primary, ...ids.filter((id) => id !== primary)] : ids).slice(0, MIN_PANES);
  });
  const selected = selection.filter((id) => slides.some((slide) => slide.id === id));
  const [activeId, setActiveId] = useState(selection[0]);
  const active = selected.includes(activeId) ? activeId : selected[0];
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
  const round = Math.min(...selected.map((id) => points[id]?.length ?? 0));
  const completeRound = selected.every((id) => (points[id]?.length ?? 0) === round);
  const pairs = completeRound && round >= 3 ? selected.slice(1).map((id) => ({
    id, result: fitTissue(points[selected[0]], points[id], metadata.current[id]),
  })) : [];
  const validated = pairs.length > 0 && pairs.every((pair) => pair.result);
  const formatError = (value: number, unit: string) => unit === 'µm' && value >= 1000
    ? `${(value / 1000).toFixed(2)} mm` : `${value.toFixed(2)} ${unit}`;
  const allReady = selected.length >= MIN_PANES && selected.every((id) => loaded.includes(id));

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

  function toggleSlide(id: string) {
    const checked = selected.includes(id);
    if ((checked && selected.length <= MIN_PANES) || (!checked && selected.length >= MAX_PANES)) return;
    if (checked) {
      delete frames.current[id];
      setLoaded((current) => current.filter((value) => value !== id));
    }
    setSelection(checked ? selected.filter((value) => value !== id) : [...selected, id]);
    setSynchronized(false);
    setCommands({});
    setAnchors(undefined);
    setPoints({});
    setRegistered(undefined);
    setPicking(false);
    delete metadata.current[id];
  }

  function recordPoint(id: string, point: Point) {
    setPoints((current) => {
      const currentRound = Math.min(...selected.map((value) => current[value]?.length ?? 0));
      if (currentRound >= 8 || (current[id]?.length ?? 0) > currentRound) return current;
      return { ...current, [id]: [...(current[id] ?? []), point] };
    });
  }

  return <section aria-label="Multi View" className="multi-view">
    <div className="panel multi-view-control">
      <div className="panel-title"><h2>Multi View</h2><span>{selected.length} / {MAX_PANES} panes</span></div>
      <div className="multi-view-options">
        <fieldset className="multi-view-slides" disabled={focused}><legend>Scans in This Case</legend>
          {slides.map((slide) => {
            const checked = selected.includes(slide.id);
            return <label key={slide.id}>
              <input type="checkbox" checked={checked}
                disabled={checked ? selected.length <= MIN_PANES : selected.length >= MAX_PANES}
                onChange={() => toggleSlide(slide.id)} />
              {slide.label ?? slide.id} · {slide.wsi?.format}
            </label>;
          })}
        </fieldset>
        <div className="actions multi-view-actions">
          <button className="button secondary" aria-pressed={synchronized} disabled={!allReady || focused || picking} onClick={() => {
            const next = !synchronized;
            setSynchronized(next);
            if (next && active && frames.current[active]) publish(active, frames.current[active]);
            else setCommands({});
          }}>Sync Position</button>
          <button className="button secondary" disabled={!allReady || synchronized || focused || picking || !!registered} onClick={() => {
            setAnchors(anchors ? undefined : Object.fromEntries(selected.map((id) => [id, frames.current[id]])));
          }}>{anchors ? 'Clear Alignment Points' : 'Use Current Positions as Alignment Points'}</button>
          <button className="button secondary" aria-pressed={focused} disabled={!active || !loaded.includes(active) || picking}
            onClick={() => setFocused(!focused)}>{focused ? 'Restore Split View' : 'Expand Active Pane'}</button>
          <button className="button secondary" disabled={!active} onClick={() => { if (active) onSingle(active); }}>Open Active Scan in Single View</button>
          <button className="button secondary" onClick={onClose}>Close Comparison</button>
        </div>
        <p className="muted" role="status">{registered ? 'Tissue Landmark Registration' : anchors ? 'Manual Alignment Points' : 'Normalized Image Coordinates'} · {focused ? 'Sync Paused While Expanded' : synchronized ? 'Sync On' : 'Sync Off'}</p>
        <details className="tissue-registration">
          <summary>Tissue Registration</summary>
          <p className="muted">Pick the same feature in each pane. The first two landmarks fit the alignment. Use a different feature for each additional check.</p>
          <div className="actions">
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
          {picking && <p role="status">{round < 8 ? `Landmark ${round + 1} · ${round < 2 ? 'Fit' : 'Independent Check'}` : 'Eight landmarks recorded'}</p>}
          {pairs.length > 0 && <ul aria-label="Registration Error by Scan">{pairs.map(({ id, result }) => <li key={id}>
            {slides.find((slide) => slide.id === id)?.label ?? id}{' · '}
            {result ? `Check landmarks ${round - 2} · RMS ${formatError(result.rms, result.unit)} · Maximum ${formatError(result.maximum, result.unit)}`
              : 'Choose two more widely spaced fit landmarks.'}
          </li>)}</ul>}
        </details>
      </div>
    </div>
    <div className="multi-view-grid" data-count={selected.length} data-focused={focused}>
      {selected.map((id, index) => {
        const slide = slides.find((item) => item.id === id);
        if (!slide?.wsi) return null;
        return <div key={id} role="group" aria-label={`Pane ${index + 1}: ${slide.label ?? id} ${slide.wsi.format}`}
          className="multi-view-pane" data-active={active === id} hidden={focused && active !== id}
          onFocusCapture={() => setActiveId(id)} onPointerDownCapture={() => setActiveId(id)}>
          <button type="button" className="multi-view-activate" aria-pressed={active === id} onClick={() => setActiveId(id)}>
            Pane {index + 1}{active === id ? ' · Active' : ''}
          </button>
          <ImageViewport scan={slide.wsi} label={slide.label ?? id} stain={slide.stain} comparison={{
            camera: commands[id], landmarks: points[id],
            captureLandmark: picking ? (point) => recordPoint(id, point) : undefined,
            onFrame: (frame, info) => {
              if (info) metadata.current[id] = info;
              if (!frames.current[id]) setLoaded((current) => [...current, id]);
              frames.current[id] = frame;
            },
            onNavigate: (frame) => {
              setActiveId(id);
              if (synchronized && !focused) publish(id, frame);
            },
          }} />
        </div>;
      })}
    </div>
  </section>;
}
