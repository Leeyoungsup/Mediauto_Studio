import { useEffect, useState } from 'react';
import { api, auditAttemptId, jsonBody, request } from './session';
import type { SlideInfo, Viewport } from './tile-viewer';

export type Point = [number, number];
type Kind = 'rectangle' | 'distance' | 'ellipse' | 'point' | 'arrow' | 'polygon' | 'brush' | 'count' | 'bookmark';
export type Tool = Exclude<Kind, 'bookmark'> | 'pan' | 'path' | 'preset';
export const hasVertices = (tool: Tool) => tool === 'path' || tool === 'polygon' || tool === 'count';
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
const additionalTools = ['ellipse', 'point', 'arrow', 'polygon', 'brush', 'count', 'path', 'preset'] as const;

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
    setDraft(undefined);
    setError('');
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
    setVertices((current) => {
      const last = current.at(-1);
      return current.length < 256 && (!last || last[0] !== point[0] || last[1] !== point[1]) ? [...current, point] : current;
    });
  }

  const minimum = tool === 'polygon' ? 3 : tool === 'path' ? 2 : 1;
  function finishVertices() {
    if (hasVertices(tool) && vertices.length >= minimum) {
      complete(tool === 'path' ? 'distance' : tool as 'polygon' | 'count', vertices);
    }
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
    preset, setPreset, placePreset, vertices, addVertex, finishVertices, minimum, undoVertex: () => setVertices((current) => current.slice(0, -1)),
    busy: busy || loading, refresh: () => setAttempt((value) => value + 1),
    applySaved: () => { if (records?.position) restore(records.position); },
    cancel: () => setDraft(undefined),
    renameDraft: (label: string) => setDraft((item) => item && { ...item, label }),
  };
}

type ToolState = ReturnType<typeof useViewerRecords>;

export function ViewerToolsBar({ state, view, info }: { state: ToolState; view?: Viewport; info: SlideInfo }) {
  const { records, tool, chooseTool, busy, savePosition, applySaved } = state;
  return <div className="image-actions viewer-record-buttons" aria-label="Review Tools">
    {records?.can_annotate && <>
      <button className="button secondary" aria-pressed={tool === 'pan'} disabled={busy} onClick={() => chooseTool('pan')}>Pan</button>
      <button className="button secondary" aria-pressed={tool === 'rectangle'} disabled={busy} onClick={() => chooseTool('rectangle')}>Rectangular ROI</button>
      <button className="button secondary" aria-pressed={tool === 'distance'} disabled={busy} onClick={() => chooseTool('distance')}>Distance Measurement</button>
      <label>Additional Tool <select aria-label="Additional Tool" disabled={busy}
        value={additionalTools.find((item) => item === tool) ?? ''}
        onChange={(event) => chooseTool(event.target.value as Tool || 'pan')}>
        <option value="">Select Tool</option>
        {additionalTools.map((item) => <option key={item} value={item} disabled={item === 'preset' && !(info.mpp_x && info.mpp_y)}>
          {item === 'path' ? 'Multi-segment Distance' : item === 'preset' ? 'Calibrated ROI Preset' : labels[item]}
        </option>)}
      </select></label>
      {tool === 'preset' && <label>Preset Size <select value={state.preset} onChange={(event) => state.setPreset(Number(event.target.value))}>
        {[250, 500, 1000].map((size) => <option key={size} value={size}>{size} × {size} µm</option>)}
      </select></label>}
      <button className="button secondary" disabled={!view || busy} onClick={() => {
        if (!view) return;
        const x = Math.max(0, Math.min(info.dimensions[0] - 0.001, view.x + view.width / 2));
        const y = Math.max(0, Math.min(info.dimensions[1] - 0.001, view.y + view.height / 2));
        state.complete('bookmark', [[x, y]], view.zoom);
      }}>Save Bookmark</button>

    </>}
    <button className="button secondary" disabled={!view || !records || busy} onClick={() => { if (view) savePosition(view); }}>Save Position</button>
    <button className="button secondary" disabled={!records?.position || busy} onClick={applySaved}>Restore Saved Position</button>
  </div>;
}

export function AnnotationOverlay({ view, annotations, draft, drawing }: {
  view?: Viewport; annotations: Mark[]; draft?: Draft; drawing?: Geometry;
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

export function ViewerRecordsPanel({ state, info, move, searchHref }: {
  state: ToolState; info: SlideInfo; move: (points: Point[], zoom?: number | null) => void; searchHref?: (id: string) => string;
}) {
  const { records, draft, tool, error, busy, notice } = state;
  const [includeAnnotation, setIncludeAnnotation] = useState(true);
  const [includeScale, setIncludeScale] = useState(!!info.mpp_x);
  const [editing, setEditing] = useState<{ mark: Mark; label: string }>();
  return <section className="viewer-record-panel" aria-label="Review Position and Annotations">
    <h2>Review Position and Annotations</h2>
    {error && <div className="notice" role="alert">{error}<button className="button secondary" disabled={busy} onClick={() => { setEditing(undefined); state.refresh(); }}>Refresh Saved Records</button></div>}
    {notice && <p role="status">{notice}</p>}
    {records?.position && <p>Saved Position {date.format(new Date(records.position.saved_at))}</p>}
    {tool !== 'pan' && <p role="status">{hasVertices(tool) ? `Click the image to add points · ${state.vertices.length}`
      : tool === 'point' || tool === 'preset' ? 'Click the image to place the annotation.'
        : 'Drag from the start point to the end point on the image.'}</p>}
    {hasVertices(tool) && <div className="actions">
      <button className="button secondary" disabled={!state.vertices.length} onClick={state.undoVertex}>Undo Point</button>
      <button className="button primary" disabled={state.vertices.length < state.minimum} onClick={state.finishVertices}>Finish Points</button>
    </div>}
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
    {records?.annotations.length ? <ul className="viewer-record-list">{records.annotations.map((item) => <li key={item.id}>
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
