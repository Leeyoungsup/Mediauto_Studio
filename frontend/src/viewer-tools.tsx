import { ArrowUpRight, Bookmark, Check, CircleDot, Hand, LocateFixed, MapPin, Pencil, Ruler, Scan, Spline, SquareDashed, Tally5, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, auditAttemptId, jsonBody, request } from './session';
import type { SlideInfo, Viewport } from './tile-viewer';

export type Point = [number, number];
type Kind = 'rectangle' | 'distance' | 'ellipse' | 'point' | 'arrow' | 'polygon' | 'brush' | 'count' | 'bookmark';
export type Tool = Exclude<Kind, 'bookmark'> | 'pan' | 'path' | 'preset';
export const hasVertices = (tool: Tool): tool is 'path' | 'polygon' | 'count' => tool === 'path' || tool === 'polygon' || tool === 'count';
export type Geometry = { kind: Kind; points: Point[] };
export type Camera = { x: number; y: number; zoom: number };
type Position = Camera & { version: number; saved_at: string };
type Draft = Geometry & { id: string; label: string; zoom?: number | null };
type Mark = Draft & { length: number | null; unit: 'um' | 'px' | null; created_at: string; author: string; can_delete: boolean; version: number };
type Records = { position: Position | null; annotations: Mark[]; can_annotate: boolean; can_export: boolean };

const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' });
const labels: Record<Kind, string> = { rectangle: 'Rectangular ROI', distance: 'Distance Measurement', ellipse: 'Ellipse ROI',
  point: 'Point', arrow: 'Arrow', polygon: 'Polygon ROI', brush: 'Brush', count: 'Point Count', bookmark: 'Bookmark' };
const exportable = new Set<Kind>(['rectangle', 'ellipse', 'polygon', 'brush']);
function PolygonIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="m4 8 10-4 6 6-3 10-11-1Z" />
    {[[4, 8], [14, 4], [20, 10], [17, 20], [6, 19]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.4" fill="currentColor" />)}
  </svg>;
}

function EllipseIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <ellipse cx="12" cy="12" rx="9" ry="6" />
  </svg>;
}

const toolGroups = [
  { label: 'Navigation', tools: [{ id: 'pan', name: 'Pan', icon: Hand }] },
  { label: 'Regions of Interest', tools: [
    { id: 'rectangle', name: labels.rectangle, icon: SquareDashed },
    { id: 'ellipse', name: labels.ellipse, icon: EllipseIcon },
    { id: 'polygon', name: labels.polygon, icon: PolygonIcon },
    { id: 'brush', name: labels.brush, icon: Pencil },
    { id: 'preset', name: 'Calibrated ROI Preset', icon: Scan },
  ] },
  { label: 'Markers and Measurements', tools: [
    { id: 'point', name: labels.point, icon: CircleDot },
    { id: 'arrow', name: labels.arrow, icon: ArrowUpRight },
    { id: 'distance', name: labels.distance, icon: Ruler },
    { id: 'path', name: 'Multi-segment Distance', icon: Spline },
    { id: 'count', name: labels.count, icon: Tally5 },
  ] },
] as const;

function formatLength(length: number, unit: 'um' | 'px') {
  if (unit === 'um' && length >= 1000) return `${formatter.format(length / 1000)} mm`;
  return `${formatter.format(length)} ${unit === 'um' ? 'µm' : 'px'}`;
}

function draftLength(points: Point[], info: SlideInfo) {
  const calibrated = !!info.mpp_x && !!info.mpp_y;
  const sx = calibrated ? info.mpp_x! : 1;
  const sy = calibrated ? info.mpp_y! : 1;
  const length = points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot((point[0] - points[index][0]) * sx, (point[1] - points[index][1]) * sy), 0);
  return formatLength(length, calibrated ? 'um' : 'px');
}

export function screenToSlide(x: number, y: number, view: Viewport): Point {
  return [view.x + x / view.zoom, view.y + y / view.zoom];
}
function slideToScreen([x, y]: Point, view: Viewport): Point {
  return [(x - view.x) * view.zoom, (y - view.y) * view.zoom];
}

function polygonProblem(points: Point[]) {
  if (new Set(points.map((point) => point.join(','))).size !== points.length) return 'Use a different position for each vertex.';
  const cross = ([ax, ay]: Point, [bx, by]: Point, [cx, cy]: Point) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const within = ([x, y]: Point, a: Point, b: Point) => x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])
    && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1]);
  const edges = points.map((point, index) => [point, points[(index + 1) % points.length]]);
  for (const [i, [a, b]] of edges.entries()) {
    for (let j = i + 2; j < edges.length - Number(i === 0); j++) {
      const [c, d] = edges[j];
      const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
      if ((ac * ad < 0 && ca * cb < 0) || (ac === 0 && within(c, a, b)) || (ad === 0 && within(d, a, b))
        || (ca === 0 && within(a, c, d)) || (cb === 0 && within(b, c, d))) return 'Polygon edges cannot cross or touch.';
    }
  }
  const area = edges.reduce((sum, [a, b]) => sum + cross(points[0], a, b), 0);
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const boundsArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return Math.abs(area) <= boundsArea * 1e-12 ? 'The polygon must enclose an area.' : '';
}

export function useViewerRecords(endpoint: string, enabled: boolean, restore: (camera: Camera) => void) {
  const [records, setRecords] = useState<Records>();
  const [draft, setDraft] = useState<Draft>();
  const [tool, setTool] = useState<Tool>('pan');
  const [vertices, setVertices] = useState<Point[]>([]);
  const [preset, setPreset] = useState(500);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const path = endpoint + '/viewer-records';

  function failure(error: unknown) {
    setError(error instanceof Error ? error.message : 'Unable to process the viewer records.');
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<Records>(path, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setRecords(result);
      if (result.position) restore(result.position);
    }).catch((error) => { if (!controller.signal.aborted) failure(error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, path, restore, attempt]);

  function chooseTool(next: Tool) {
    setTool(next);
    setVertices([]);
    setError('');
    setNotice('');
  }

  function complete(kind: Kind, points: Point[], zoom?: number) {
    if (!records?.can_annotate || busy) return;
    if ((kind === 'rectangle' || kind === 'ellipse') && (points[0][0] === points[1][0] || points[0][1] === points[1][1])
        || points.length === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1]) {
      setError('Select two different points on the image.');
      return;
    }
    setDraft({ id: auditAttemptId(), kind, points, label: '', zoom });
    setVertices([]);
    setError('');
    setNotice('');
    setTool('pan');
  }

  function addVertex(point: Point) {
    setError('');
    setVertices((current) => {
      const last = current.at(-1);
      return current.length < 256 && (!last || last[0] !== point[0] || last[1] !== point[1]) ? [...current, point] : current;
    });
  }

  const minimum = tool === 'polygon' ? 3 : tool === 'path' ? 2 : 1;
  function finishVertices() {
    if (!hasVertices(tool) || vertices.length < minimum) return;
    if (tool === 'polygon') {
      const problem = polygonProblem(vertices);
      if (problem) { setError(problem); return; }
    }
    complete(tool === 'path' ? 'distance' : tool, vertices);
  }

  function placePreset([x, y]: Point, info: SlideInfo) {
    if (!info.mpp_x || !info.mpp_y) return;
    const dx = preset / info.mpp_x / 2;
    const dy = preset / info.mpp_y / 2;
    if (x < dx || y < dy || x + dx >= info.dimensions[0] || y + dy >= info.dimensions[1]) {
      setError('Place the full preset inside the scan image.');
      return;
    }
    complete('rectangle', [[x - dx, y - dy], [x + dx, y + dy]]);
  }

  async function change(task: () => Promise<void>) {
    if (!records || busy || loading) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await task(); } catch (error) { failure(error); } finally { setBusy(false); }
  }

  function savePosition(view: Viewport) {
    if (!records) return;
    void change(async () => {
      const position = await api<Position>(path + '/position', jsonBody('PUT', {
        x: view.x + view.width / 2, y: view.y + view.height / 2, zoom: view.zoom,
        version: records.position?.version ?? 0,
      }));
      setRecords((current) => current && { ...current, position });
      setNotice('Review position saved.');
    });
  }

  function saveAnnotation() {
    if (!draft) return;
    void change(async () => {
      const annotation = await api<Mark>(path + '/annotations', jsonBody('POST', draft));
      setRecords((current) => current && { ...current, annotations: [...current.annotations.filter((item) => item.id !== annotation.id), annotation] });
      setDraft(undefined);
      setNotice('Viewer record saved.');
    });
  }

  function edit(annotation: Mark, label: string, onSaved: () => void) {
    void change(async () => {
      const saved = await api<Mark>(path + '/annotations/' + annotation.id, jsonBody('PATCH', { label, version: annotation.version }));
      setRecords((current) => current && { ...current, annotations: current.annotations.map((item) => item.id === saved.id ? saved : item) });
      setNotice('Annotation name updated.');
      onSaved();
    });
  }

  function remove(annotation: Mark) {
    void change(async () => {
      await api(path + '/annotations/' + annotation.id, { method: 'DELETE' });
      setRecords((current) => current && { ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) });
      setNotice('Viewer record deleted.');
    });
  }

  function capture(annotation: Mark, includeAnnotation: boolean, includeScale: boolean) {
    void change(async () => {
      const params = new URLSearchParams({ annotations: String(includeAnnotation), scale_bar: String(includeScale) });
      const response = await request(`${path}/annotations/${annotation.id}/capture.png?${params}`, {
        headers: { 'X-Audit-Attempt': auditAttemptId() },
      });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `roi-${annotation.id}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('ROI capture exported.');
    });
  }

  return { records, draft, tool, chooseTool, complete, savePosition, saveAnnotation, edit, remove, capture, error, notice,
    preset, setPreset, placePreset, vertices, addVertex, finishVertices, minimum, undoVertex: () => { setError(''); setVertices((current) => current.slice(0, -1)); },
    busy: busy || loading, refresh: () => setAttempt((value) => value + 1),
    applySaved: () => { if (records?.position) restore(records.position); },
    cancel: () => setDraft(undefined),
    renameDraft: (label: string) => setDraft((item) => item && { ...item, label }),
  };
}

type ToolState = ReturnType<typeof useViewerRecords>;

export function ViewerToolsBar({ state, view, info, onChoose }: { state: ToolState; view?: Viewport; info: SlideInfo; onChoose: (tool: Tool) => void }) {
  const { records, tool, busy, savePosition, applySaved } = state;
  return <div className="viewer-record-buttons" role="group" aria-label="Review Tools">
    {records?.can_annotate && toolGroups.map((group) => <div key={group.label} className="viewer-tool-group" role="group" aria-label={group.label}>
      {group.tools.map(({ id, name, icon: Icon }) => <button key={id} type="button" className="button secondary viewer-icon-tool"
        aria-label={name} title={id === 'preset' && !(info.mpp_x && info.mpp_y) ? 'Pixel size unavailable for calibrated presets' : name}
        aria-pressed={tool === id} disabled={busy || !!state.draft && id !== 'pan' || id === 'preset' && !(info.mpp_x && info.mpp_y)}
        onClick={() => onChoose(id)}><Icon size={18} aria-hidden="true" /></button>)}
    </div>)}
    <div className="viewer-tool-group" role="group" aria-label="Saved Positions">
      {records?.can_annotate && <button type="button" className="button secondary viewer-icon-tool" aria-label="Save Bookmark" title="Save Bookmark" disabled={!view || busy || !!state.draft || tool !== 'pan'} onClick={() => {
        if (!view) return;
        const x = Math.max(0, Math.min(info.dimensions[0] - 0.001, view.x + view.width / 2));
        const y = Math.max(0, Math.min(info.dimensions[1] - 0.001, view.y + view.height / 2));
        state.complete('bookmark', [[x, y]], view.zoom);
      }}><Bookmark size={18} aria-hidden="true" /></button>}
      <button type="button" className="button secondary viewer-icon-tool" aria-label="Save Position" title="Save Position" disabled={!view || !records || busy || tool !== 'pan'} onClick={() => { if (view) savePosition(view); }}><MapPin size={18} aria-hidden="true" /></button>
      <button type="button" className="button secondary viewer-icon-tool" aria-label="Restore Saved Position" title="Restore Saved Position" disabled={!records?.position || busy} onClick={applySaved}><LocateFixed size={18} aria-hidden="true" /></button>
    </div>
  </div>;
}

export function DrawingControls({ state, shortcuts }: { state: ToolState; shortcuts: boolean }) {
  const { tool, vertices, minimum } = state;
  if (tool === 'pan') return null;
  const name = tool === 'path' ? 'Multi-segment Distance' : tool === 'preset' ? 'Calibrated ROI Preset' : labels[tool];
  const instructions = tool === 'polygon' ? 'Click to add vertices. Click the first vertex to close the shape.'
    : hasVertices(tool) ? 'Click the slide to add points.'
    : tool === 'point' || tool === 'preset' ? 'Click the slide to place the annotation.'
    : 'Drag on the slide to draw.';
  return <div className="viewer-drawing-controls" role="group" aria-label="Drawing Controls">
    <div><strong>{name}</strong>{hasVertices(tool) && <span className="drawing-point-count" aria-live="polite">{vertices.length} / 256 points</span>}</div>
    <p>{instructions}{hasVertices(tool) && shortcuts && ' Press Enter when ready.'}</p>
    {state.error && <p className="drawing-error" role="alert">{state.error}</p>}
    {tool === 'preset' && <label>Preset Size <select value={state.preset} onChange={(event) => state.setPreset(Number(event.target.value))}>
      {[250, 500, 1000].map((size) => <option key={size} value={size}>{size} × {size} µm</option>)}
    </select></label>}
    <div className="actions">
      {hasVertices(tool) && <>
        <button type="button" className="button secondary" disabled={!vertices.length} onClick={state.undoVertex}><Undo2 size={15} /> Undo Point</button>
        <button type="button" className="button primary" disabled={vertices.length < minimum} onClick={state.finishVertices}><Check size={15} /> {tool === 'polygon' ? 'Close Polygon' : 'Finish Points'}</button>
      </>}
      <button type="button" className="icon-button" title="Cancel Drawing" aria-label="Cancel Drawing" onClick={() => state.chooseTool('pan')}><X size={17} /></button>
    </div>
  </div>;
}

export function AnnotationOverlay({ view, annotations, draft, drawing, guide, closeHint }: {
  view?: Viewport; annotations: Mark[]; draft?: Draft; drawing?: Geometry; guide?: Point; closeHint?: boolean;
}) {
  if (!view || (!annotations.length && !draft && !drawing)) return null;
  const display = (item: Geometry, preview: boolean, key: string, caption?: string) => {
    if (item.kind === 'bookmark') return null;
    const points = item.points.map((point) => slideToScreen(point, view));
    const [[x1, y1], [x2, y2] = [x1, y1]] = points;
    const style = preview ? 'annotation-draft' : 'annotation-roi';
    if (item.kind === 'point' || item.kind === 'count') return <g key={key} data-record={key}>
      {points.map(([x, y], index) => <g key={index}><circle className={style} cx={x} cy={y} r={5} />
        {item.kind === 'count' && <text className="annotation-length" x={x} y={y - 9}>{index + 1}</text>}</g>)}
    </g>;
    if (item.kind === 'rectangle') return <rect key={key} data-record={key} className={style}
      x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} />;
    if (item.kind === 'ellipse') return <ellipse key={key} data-record={key} className={style}
      cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} />;
    if (item.kind === 'arrow') {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      return <g key={key} data-record={key} className={preview ? 'annotation-draft' : 'annotation-distance'}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <path fill="none" d={`M ${x2 - 13 * Math.cos(angle - .45)} ${y2 - 13 * Math.sin(angle - .45)} L ${x2} ${y2} L ${x2 - 13 * Math.cos(angle + .45)} ${y2 - 13 * Math.sin(angle + .45)}`} />
      </g>;
    }
    const path = points.map((point) => point.join(',')).join(' ');
    if (item.kind === 'polygon' && key === 'drawing') {
      const [lastX, lastY] = points.at(-1)!;
      const [guideX, guideY] = closeHint ? points[0] : guide ? slideToScreen(guide, view) : points.at(-1)!;
      return <g key={key} data-record={key}>
        <polyline className="polygon-outline" points={path} />
        {guide && <line className="polygon-guide" x1={lastX} y1={lastY} x2={guideX} y2={guideY} />}
        {points.map(([x, y], index) => <circle key={index} className={index === 0 && points.length >= 3 ? 'polygon-start' : 'polygon-vertex'}
          cx={x} cy={y} r={index === 0 && points.length >= 3 ? (closeHint ? 8 : 6) : 3.5} />)}
      </g>;
    }
    if (item.kind === 'polygon' && points.length >= 3) return <polygon key={key} data-record={key} className={style} points={path} />;
    return <g key={key}>
      {item.kind === 'distance' && points.length === 2
        ? <line data-record={key} className={preview ? 'annotation-draft' : 'annotation-distance'} x1={x1} y1={y1} x2={x2} y2={y2} />
        : <polyline data-record={key} className={preview ? 'annotation-draft' : 'annotation-distance'} style={{ fill: 'none' }} points={path} />}
      {caption && <text className="annotation-length" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}>{caption}</text>}
    </g>;
  };
  return <svg className="annotation-overlay" aria-label="Review Annotation Overlay" viewBox={`0 0 ${view.width * view.zoom} ${view.height * view.zoom}`}>
    {annotations.map((item) => display(item, false, item.id, item.length !== null && item.unit ? formatLength(item.length, item.unit) : undefined))}
    {draft && display(draft, true, draft.id)}
    {drawing && display(drawing, true, 'drawing')}
  </svg>;
}

export function ViewerRecordsPanel({ state, info, move, searchHref, onClose }: {
  state: ToolState; info: SlideInfo; move: (points: Point[], zoom?: number | null) => void; searchHref?: (id: string) => string; onClose?: () => void;
}) {
  const { records, draft, tool, error, busy, notice } = state;
  const [includeAnnotation, setIncludeAnnotation] = useState(true);
  const [includeScale, setIncludeScale] = useState(!!info.mpp_x);
  const [newestFirst, setNewestFirst] = useState(true);
  const annotations = newestFirst ? records?.annotations.slice().reverse() : records?.annotations;
  const [editing, setEditing] = useState<{ mark: Mark; label: string }>();
  return <section className="viewer-record-panel" aria-label="Review Position and Annotations">
    <div className="viewer-record-heading"><h2>Annotations</h2>
      {onClose && <button type="button" className="icon-button" aria-label="Close Annotations" title="Close Annotations" onClick={onClose}><X size={18} /></button>}
    </div>
    {error && tool === 'pan' && <div className="notice" role="alert">{error}<button className="button secondary" disabled={busy} onClick={() => { setEditing(undefined); state.refresh(); }}>Refresh Saved Records</button></div>}
    {notice && <p role="status">{notice}</p>}
    {records?.position && <p>Saved Position {date.format(new Date(records.position.saved_at))}</p>}
    {records?.can_export && records.annotations.some((item) => exportable.has(item.kind)) && <fieldset className="roi-export-options">
      <legend>ROI Export Options</legend>
      <label><input type="checkbox" checked={includeAnnotation} onChange={(event) => setIncludeAnnotation(event.target.checked)} /> Include ROI Annotation</label>
      <label><input type="checkbox" checked={includeScale} disabled={!info.mpp_x} onChange={(event) => setIncludeScale(event.target.checked)} /> Include Scale Bar</label>
    </fieldset>}
    {draft && <form className="viewer-record-draft" onSubmit={(event) => { event.preventDefault(); state.saveAnnotation(); }}>
      <strong>{labels[draft.kind]}{draft.kind === 'count' && ` · ${draft.points.length} points`}{draft.kind === 'distance' && ` · ${draftLength(draft.points, info)}`}</strong>
      <label className="form-field">Annotation Name <input value={draft.label} maxLength={160} onChange={(event) => state.renameDraft(event.target.value)} /></label>
      <div className="actions"><button className="button primary" disabled={busy}>Save Annotation</button>
        <button className="button secondary" type="button" disabled={busy} onClick={state.cancel}>Cancel</button></div>
    </form>}
    {!!annotations?.length && <label className="annotation-order">Sort by <select value={newestFirst ? 'newest' : 'oldest'}
      onChange={(event) => setNewestFirst(event.target.value === 'newest')}>
      <option value="newest">Newest First</option><option value="oldest">Oldest First</option>
    </select></label>}
    {annotations?.length && records ? <ul className="viewer-record-list">{annotations.map((item) => <li key={item.id}>
      <div><strong>{item.label || labels[item.kind]}</strong>
        {item.kind === 'count' && <span> · {item.points.length} points</span>}
        {item.length !== null && item.unit && <span> · {formatLength(item.length, item.unit)}{item.unit === 'px' && ' (Pixel size unavailable)'}</span>}
        <small>{item.author} · {date.format(new Date(item.created_at))}</small>
      </div>
      <div className="actions">
        <button className="button secondary" onClick={() => move(item.points, item.zoom)}>Go to Position</button>
        {searchHref && records.can_annotate && item.kind !== 'brush' && exportable.has(item.kind) &&
          <a className="button secondary" href={searchHref(item.id)}>Find Similar ROIs</a>}
        {records.can_export && exportable.has(item.kind) && <button className="button secondary" disabled={busy}
          onClick={() => state.capture(item, includeAnnotation, includeScale)}>Export ROI PNG</button>}
        {records.can_annotate && item.can_delete && <>
          <button className="button secondary" disabled={busy} onClick={() => setEditing({ mark: item, label: item.label })}>Edit Name</button>
          <button className="button secondary" disabled={busy}
            onClick={() => { if (window.confirm('Delete this annotation?')) { setEditing(undefined); state.remove(item); } }}>Delete</button>
        </>}
      </div>
      {editing?.mark.id === item.id && <form className="viewer-record-draft" onSubmit={(event) => {
        event.preventDefault();
        state.edit(editing.mark, editing.label, () => setEditing(undefined));
      }}>
        <label className="form-field">Updated Annotation Name <input value={editing.label} maxLength={160}
          onChange={(event) => setEditing({ ...editing, label: event.target.value })} /></label>
        <div className="actions"><button type="submit" className="button primary" disabled={busy}>Save Name</button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</button></div>
      </form>}
    </li>)}</ul> : records && <p>No saved annotations.</p>}
  </section>;
}
