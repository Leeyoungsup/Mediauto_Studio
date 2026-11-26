import { Crosshair, Maximize2, PanelTop, Unlink2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ImageViewport } from './image-viewport';
import type { Slide } from './demo';
import { fitTissue, identity, project, unproject } from './tissue-registration';
import type { Transform } from './tissue-registration';
import { useTissueRegistrationStorage, type LandmarkRegistration, type TissueRegistration } from './tissue-registration-storage';
import type { CameraFrame, SlideInfo } from './tile-viewer';
import type { Camera, Point } from './viewer-tools';

export const MAX_COMPARE_SCANS = 6;
type Frames = Record<string, CameraFrame>;

export function mapCamera(source: CameraFrame, target: CameraFrame, start?: Camera, end?: Camera): Camera {
  const [sourceWidth, sourceHeight] = source.dimensions;
  const [targetWidth, targetHeight] = target.dimensions;
  return {
    x: (end?.x ?? 0) + (source.x - (start?.x ?? 0)) / sourceWidth * targetWidth,
    y: (end?.y ?? 0) + (source.y - (start?.y ?? 0)) / sourceHeight * targetHeight,
    zoom: source.zoom / (start?.zoom ?? source.fitZoom) * (end?.zoom ?? target.fitZoom),
  };
}

const tissueSlots = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function MultiView({ slides, selected, active, cameras, caseId, roiCaseId, onActive, onFrame, onClose, onSingle }: {
  slides: Slide[]; selected: string[]; active: string; cameras: Record<string, Camera>;
  caseId?: string; roiCaseId?: string;
  onActive: (id: string) => void; onFrame: (id: string, camera: Camera) => void;
  onClose: () => void; onSingle: (id: string, camera?: Camera) => void;
}) {
  const [synchronized, setSynchronized] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<Record<string, Camera>>();
  const [commands, setCommands] = useState<Record<string, Camera>>({});
  const [picking, setPicking] = useState(false);
  const [points, setPoints] = useState<Record<string, Point[]>>({});
  const [registered, setRegistered] = useState<Record<string, Transform>>();
  const [reference, setReference] = useState<string>();
  const [tissueSlot, setTissueSlot] = useState<string>();
  const restoredScope = useRef<string>(undefined);
  const entryCameras = useRef(new Set(Object.keys(cameras)));
  const storage = useTissueRegistrationStorage(caseId, selected);
  const profiles = storage.catalog?.profiles;
  const nextSlot = tissueSlots.find((slot) => !profiles?.[slot]);
  const slot = caseId ? tissueSlot ?? storage.catalog?.active ?? nextSlot : undefined;
  const storageLoading = Boolean(caseId && !storage.catalog && !storage.error);
  const frames = useRef<Frames>({});
  const metadata = useRef<Record<string, SlideInfo>>({});
  // Adapted from the SaaS MultiViewFocus gesture. Slow double-clicks and controls retain their usual behavior.
  const previousClick = useRef<{ target: EventTarget; time: number; x: number; y: number }>(undefined);
  const quickPair = useRef(false);
  const round = Math.min(...selected.map((id) => points[id]?.length ?? 0));
  const completeRound = selected.every((id) => (points[id]?.length ?? 0) === round);
  const referenceScan = reference ?? selected[0];
  const fits = (group: LandmarkRegistration) => selected.filter((id) => id !== group.reference).map((id) => ({
    id, result: fitTissue(group.points[group.reference], group.points[id], metadata.current[id]),
  }));
  const pairs = completeRound && round >= 3 ? fits({ reference: referenceScan, points }) : [];
  const validated = pairs.length > 0 && pairs.every((pair) => pair.result);
  const formatError = (value: number, unit: string) => unit === 'µm' && value >= 1000
    ? `${(value / 1000).toFixed(2)} mm` : `${value.toFixed(2)} ${unit}`;
  const waitingFor = picking ? selected.flatMap((id, index) => (points[id]?.length ?? 0) === round ? [`Pane ${index + 1}`] : []) : [];
  const allReady = selected.length >= 2 && selected.every((id) => loaded.includes(id));

  function publish(driver: string, frame: CameraFrame, transforms = registered, retainDriver = false, alignment = anchors) {
    const commands: Record<string, Camera> = {};
    if (retainDriver) commands[driver] = frame;
    for (const id of selected) {
      const target = frames.current[id];
      if (id !== driver && target?.fitZoom && frame.fitZoom) {
        const sourceTransform = transforms?.[driver];
        const targetTransform = transforms?.[id];
        if (sourceTransform && targetTransform) {
          const reference = unproject([frame.x, frame.y], sourceTransform);
          const [x, y] = project(reference, targetTransform);
          commands[id] = { x, y, zoom: frame.zoom * sourceTransform.scale / targetTransform.scale };
        } else {
          commands[id] = mapCamera(frame, target, alignment?.[driver], alignment?.[id]);
        }
      }
    }
    setCommands(commands);
  }

  function apply(group: TissueRegistration, tissue: string | undefined, sync: boolean, restorePosition = true) {
    if ('anchors' in group) {
      setAnchors(group.anchors);
      setPoints({});
      setReference(undefined);
      setRegistered(undefined);
      setTissueSlot(tissue);
      setPicking(false);
      setSynchronized(sync);
      if (restorePosition) setCommands({ ...group.anchors });
      else if (sync && frames.current[active]) publish(active, frames.current[active], undefined, false, group.anchors);
      else setCommands({});
      return;
    }
    const aligned = fits(group);
    if (!aligned.every(({ result }) => result)) return;
    const transforms = Object.fromEntries([[group.reference, identity], ...aligned.map(({ id, result }) => [id, result!.fit])]);
    setAnchors(undefined);
    setPoints(group.points);
    setReference(group.reference);
    setRegistered(transforms);
    setTissueSlot(tissue);
    setPicking(false);
    setSynchronized(sync);
    const camera = restorePosition ? tissueCamera(active, group.points) : undefined;
    if (camera) publish(active, camera, transforms, true);
    else if (sync && frames.current[active]) publish(active, frames.current[active], transforms);
    else setCommands({});
  }

  function clearWorkingRegistration() {
    setSynchronized(false);
    setAnchors(undefined);
    setRegistered(undefined);
    setReference(undefined);
    setPoints({});
    setPicking(false);
    setCommands({});
  }

  async function chooseTissue(tissue: string) {
    const profile = profiles?.[tissue];
    if (!profile) {
      clearWorkingRegistration();
      setTissueSlot(tissue);
      return;
    }
    if (await storage.save(tissue, synchronized)) apply(profile, tissue, synchronized);
  }

  async function useRegistration() {
    if (!validated) return;
    const group = { reference: referenceScan, points };
    if (caseId && (!slot || !await storage.save(slot, false, group))) return;
    apply(group, slot, false, false);
  }

  async function saveAlignmentPositions() {
    if (anchors) { await clearRegistration(); return; }
    const positions = Object.fromEntries(selected.map((id) => {
      const { x, y, zoom } = frames.current[id];
      return [id, { x, y, zoom }];
    }));
    const group = { anchors: positions };
    if (caseId && (!slot || !await storage.save(slot, false, group))) return;
    apply(group, slot, false, false);
  }

  async function changeSync() {
    const next = !synchronized;
    if (caseId && (registered || anchors) && slot && !await storage.save(slot, next)) return;
    setSynchronized(next);
    if (next && frames.current[active]) publish(active, frames.current[active]);
    else setCommands({});
  }

  async function clearRegistration() {
    const savedSlot = storage.catalog?.active;
    if (picking && savedSlot && profiles?.[savedSlot]) {
      apply(profiles[savedSlot], savedSlot, storage.catalog?.sync ?? false, false);
      return;
    }
    if (!picking && caseId && !await storage.save(null, false)) return;
    clearWorkingRegistration();
    setTissueSlot(undefined);
  }

  function tissueCamera(scan: string, landmarks: Record<string, Point[]>) {
    const group = landmarks[scan];
    const current = frames.current[scan];
    const canvas = grid.current?.querySelector<HTMLCanvasElement>(`[data-scan-id="${scan}"] canvas.wsi-canvas`);
    if (!group?.length || !current || !canvas?.clientWidth || !canvas.clientHeight) return;
    const xs = group.map(([x]) => x);
    const ys = group.map(([, y]) => y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const zoom = Math.min(4, canvas.clientWidth / Math.max(1, 2 * (right - left)),
      canvas.clientHeight / Math.max(1, 2 * (bottom - top)));
    return { ...current, x: (left + right) / 2, y: (top + bottom) / 2, zoom: Math.max(current.fitZoom, zoom) };
  }

  function goToTissue() {
    if (anchors) { setCommands({ ...anchors }); return; }
    const camera = tissueCamera(active, points);
    if (!camera) return;
    if (synchronized && !focused) publish(active, camera, registered, true);
    else setCommands({ [active]: camera });
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
    clearWorkingRegistration();
    setFocused(false);
    setTissueSlot(undefined);
    restoredScope.current = undefined;
  }, [selectionKey]);

  useEffect(() => {
    if (picking || !allReady || !storage.key || !storage.catalog || restoredScope.current === storage.key) return;
    restoredScope.current = storage.key;
    const { active: tissue, profiles, sync } = storage.catalog;
    if (tissue) apply(profiles[tissue], tissue, sync, !selected.every((id) => entryCameras.current.has(id)));
  }, [allReady, picking, storage.key, storage.catalog]);

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
        <button className="button secondary" aria-pressed={synchronized} disabled={!allReady || focused || picking || storageLoading || storage.savePending}
          onClick={() => void changeSync()}>Sync Position</button>
        <button className="button secondary" aria-pressed={focused} disabled={!loaded.includes(active) || picking}
          aria-label={focused ? 'Restore Split View' : 'Expand Active Pane'} title={focused ? 'Restore Split View' : 'Expand Active Pane'}
          onClick={() => setFocused(!focused)}><Maximize2 size={15} aria-hidden="true" />{focused ? 'Restore Split' : 'Expand'}</button>
        <button className="icon-button" aria-label="Open Active Scan in Single View" title="Open Active Scan in Single View"
          disabled={!loaded.includes(active)} onClick={() => onSingle(active, frames.current[active])}><PanelTop size={16} aria-hidden="true" /></button>
        <button className="icon-button" aria-label="Close Comparison" title="Close Comparison" onClick={onClose}><Unlink2 size={16} aria-hidden="true" /></button>
        <details className="tissue-registration">
          <summary>Tissue Registration</summary>
          <div className="registration-popover">
            {caseId && <label className="form-field">Tissue
              <select aria-label="Tissue" value={slot ?? ''} disabled={!storage.catalog || !allReady || storage.savePending || picking || focused}
                onChange={(event) => void chooseTissue(event.target.value)}>
                {!storage.catalog && <option value="">{storage.error ? 'Saved tissues unavailable' : 'Loading saved tissues…'}</option>}
                {storage.catalog && !slot && <option value="">Select Tissue</option>}
                {Object.keys(profiles ?? {}).sort().map((letter) => <option key={letter} value={letter}>Tissue {letter}</option>)}
                {storage.catalog && nextSlot && <option value={nextSlot}>New Tissue {nextSlot}</option>}
              </select>
            </label>}
            <p className="muted">Pick the same feature in each pane. The first two landmarks fit the alignment. Use a different feature for each additional check.</p>
            <div className="actions">
              <button className="button secondary" disabled={!allReady || synchronized || focused || picking || !!registered || storage.savePending || !!caseId && (!storage.catalog || !slot)}
                onClick={() => void saveAlignmentPositions()}>
                {anchors ? 'Clear Alignment Points' : 'Use Current Positions as Alignment Points'}</button>
              <button className="button secondary" disabled={!allReady || synchronized || focused || picking || storage.savePending} onClick={() => {
                setAnchors(undefined); setRegistered(undefined); setReference(selected[0]); setPoints({}); setPicking(true);
              }}>Pick Tissue Landmarks</button>
              {picking && <>
                <button className="button secondary" disabled={!Object.values(points).some((list) => list.length)} onClick={() => {
                  const last = Math.max(...Object.values(points).map((list) => list.length));
                  setPoints(Object.fromEntries(selected.map((id) => [id, (points[id] ?? []).slice(0, last - 1)])));
                }}>Undo Landmark Round</button>
                <button className="button primary" disabled={!validated || storage.savePending || !!caseId && (!storage.catalog || !slot)}
                  onClick={() => void useRegistration()}>{slot && profiles?.[slot] ? 'Update Tissue Registration' : 'Use Tissue Registration'}</button>
              </>}
              {(picking || registered) && <button className="button secondary" disabled={storage.savePending}
                onClick={() => void clearRegistration()}>{picking ? 'Cancel Landmark Picking' : 'Deactivate Tissue Registration'}</button>}
              {(registered || anchors) && <button className="button secondary" onClick={goToTissue}>Go to Tissue</button>}
            </div>
            {storage.error && <div className="notice" role="alert">{storage.error}
              <button className="button secondary" onClick={() => { restoredScope.current = undefined; storage.reload(); }}>Reload Saved Tissues</button></div>}
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
      <span className="multi-view-sync-status muted" role="status">{registered ? `Tissue Landmark Registration${slot ? ' · Tissue ' + slot : ''}` : anchors ? `Manual Alignment Points${slot ? ' · Tissue ' + slot : ''}` : 'Normalized Image Coordinates'} · {focused ? 'Sync Paused While Expanded' : synchronized ? 'Sync On' : 'Sync Off'}</span>
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
            camera: commands[id], aligned: Boolean(anchors || registered), landmarks: points[id],
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
