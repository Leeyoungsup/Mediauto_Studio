import { useEffect, useState } from 'react';
import { api, jsonBody } from './session';
import type { SlideInfo, Viewport } from './tile-viewer';

export type Point = [number, number];
export type Tool = 'pan' | 'rectangle' | 'distance';
export type Camera = { x: number; y: number; zoom: number };
type Position = Camera & { version: number; saved_at: string };
type Kind = Exclude<Tool, 'pan'>;
type Draft = { id: string; kind: Kind; points: [Point, Point]; label: string };
type Mark = Draft & { length: number | null; unit: 'um' | 'px' | null; created_at: string; author: string; can_delete: boolean };
type Records = { position: Position | null; annotations: Mark[]; can_annotate: boolean };

const formatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
const labelFor = (kind: Kind) => kind === 'distance' ? '거리 측정' : '사각형 ROI';

function formatLength(length: number, unit: 'um' | 'px') {
  if (unit === 'um' && length >= 1000) return `${formatter.format(length / 1000)} mm`;
  return `${formatter.format(length)} ${unit === 'um' ? 'µm' : 'px'}`;
}

function draftLength([start, end]: [Point, Point], info: SlideInfo) {
  const [dx, dy] = [end[0] - start[0], end[1] - start[1]];
  return info.mpp_x && info.mpp_y ? formatLength(Math.hypot(dx * info.mpp_x, dy * info.mpp_y), 'um')
    : formatLength(Math.hypot(dx, dy), 'px');
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
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const path = endpoint + '/viewer-records';

  function failure(error: unknown) {
    setError(error instanceof Error ? error.message : '판독 기록을 처리할 수 없습니다.');
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
    setDraft(undefined);
  }

  function complete(kind: Kind, start: Point, end: Point) {
    if (!records?.can_annotate || busy) return;
    if ((kind === 'rectangle' && (start[0] === end[0] || start[1] === end[1]))
        || (start[0] === end[0] && start[1] === end[1])) {
      setError('영상에서 서로 다른 두 점을 선택하세요.');
      return;
    }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20)}`;
    setDraft({ id: uuid, kind, points: [start, end], label: '' });
    setError('');
    setNotice('');
    setTool('pan');
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
      setNotice('현재 판독 위치를 저장했습니다.');
    });
  }

  function saveAnnotation() {
    if (!draft) return;
    void change(async () => {
      const annotation = await api<Mark>(path + '/annotations', jsonBody('POST', draft));
      setRecords((current) => current && { ...current, annotations: [...current.annotations.filter((item) => item.id !== annotation.id), annotation] });
      setDraft(undefined);
      setNotice('판독 기록을 저장했습니다.');
    });
  }

  function remove(annotation: Mark) {
    void change(async () => {
      await api(path + '/annotations/' + annotation.id, { method: 'DELETE' });
      setRecords((current) => current && { ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) });
      setNotice('판독 기록을 삭제했습니다.');
    });
  }

  return { records, draft, tool, chooseTool, complete, savePosition, saveAnnotation, remove, error, notice,
    busy: busy || loading, refresh: () => setAttempt((value) => value + 1),
    applySaved: () => { if (records?.position) restore(records.position); },
    cancel: () => setDraft(undefined),
    renameDraft: (label: string) => setDraft((item) => item && { ...item, label }),
  };
}

type ToolState = ReturnType<typeof useViewerRecords>;
type Geometry = { kind: Kind; points: [Point, Point] };

export function ViewerToolsBar({ state, view }: { state: ToolState; view?: Viewport }) {
  const { records, tool, chooseTool, busy, savePosition, applySaved } = state;
  return <div className="image-actions viewer-record-buttons" aria-label="판독 도구">
    {records?.can_annotate && <>
      <button className="button secondary" aria-pressed={tool === 'pan'} disabled={busy} onClick={() => chooseTool('pan')}>탐색</button>
      <button className="button secondary" aria-pressed={tool === 'rectangle'} disabled={busy} onClick={() => chooseTool('rectangle')}>사각형 ROI</button>
      <button className="button secondary" aria-pressed={tool === 'distance'} disabled={busy} onClick={() => chooseTool('distance')}>거리 측정</button>
    </>}
    <button className="button secondary" disabled={!view || !records || busy} onClick={() => { if (view) savePosition(view); }}>위치 저장</button>
    <button className="button secondary" disabled={!records?.position || busy} onClick={applySaved}>저장 위치 복원</button>
  </div>;
}

export function AnnotationOverlay({ view, annotations, draft, drawing }: {
  view?: Viewport; annotations: Mark[]; draft?: Draft; drawing?: Geometry;
}) {
  if (!view || (!annotations.length && !draft && !drawing)) return null;
  const display = (item: Geometry, preview: boolean, key: string, caption?: string) => {
    const [[x1, y1], [x2, y2]] = item.points.map((point) => slideToScreen(point, view));
    return item.kind === 'distance'
      ? <g key={key}><line data-record={key} className={preview ? 'annotation-draft' : 'annotation-distance'} x1={x1} y1={y1} x2={x2} y2={y2} />
        {caption && <text className="annotation-length" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}>{caption}</text>}</g>
      : <rect key={key} data-record={key} className={preview ? 'annotation-draft' : 'annotation-roi'} x={Math.min(x1, x2)} y={Math.min(y1, y2)}
        width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} />;
  };
  return <svg className="annotation-overlay" aria-label="판독 주석 오버레이" viewBox={`0 0 ${view.width * view.zoom} ${view.height * view.zoom}`}>
    {annotations.map((item) => display(item, false, item.id, item.length !== null && item.unit ? formatLength(item.length, item.unit) : undefined))}
    {draft && display(draft, true, draft.id)}
    {drawing && display(drawing, true, 'drawing')}
  </svg>;
}

export function ViewerRecordsPanel({ state, info, move }: { state: ToolState; info: SlideInfo; move: (points: [Point, Point]) => void }) {
  const { records, draft, tool, error, busy, notice } = state;
  return <section className="viewer-record-panel" aria-label="판독 위치와 주석">
    <h2>판독 위치와 주석</h2>
    {error && <div className="notice" role="alert">{error}<button className="button secondary" disabled={busy} onClick={state.refresh}>저장 기록 새로고침</button></div>}
    {notice && <p role="status">{notice}</p>}
    {records?.position && <p>저장 위치 {date.format(new Date(records.position.saved_at))}</p>}
    {tool !== 'pan' && <p role="status">영상에서 시작점부터 끝점까지 드래그하세요.</p>}
    {draft && <form className="viewer-record-draft" onSubmit={(event) => { event.preventDefault(); state.saveAnnotation(); }}>
      <strong>{labelFor(draft.kind)}{draft.kind === 'distance' && ` · ${draftLength(draft.points, info)}`}</strong>
      <label className="form-field">주석 이름 <input value={draft.label} maxLength={160} onChange={(event) => state.renameDraft(event.target.value)} /></label>
      <div className="actions"><button className="button primary" disabled={busy}>주석 저장</button>
        <button className="button secondary" type="button" disabled={busy} onClick={state.cancel}>취소</button></div>
    </form>}
    {records?.annotations.length ? <ul className="viewer-record-list">{records.annotations.map((item) => <li key={item.id}>
      <div><strong>{item.label || labelFor(item.kind)}</strong>
        {item.length !== null && item.unit && <span> · {formatLength(item.length, item.unit)}{item.unit === 'px' && ' (픽셀 크기 정보 없음)'}</span>}
        <small>{item.author} · {date.format(new Date(item.created_at))}</small>
      </div>
      <div className="actions">
        <button className="button secondary" onClick={() => move(item.points)}>위치로 이동</button>
        {records.can_annotate && item.can_delete && <button className="button secondary" disabled={busy}
          onClick={() => { if (window.confirm('이 주석을 삭제하시겠습니까?')) state.remove(item); }}>삭제</button>}
      </div>
    </li>)}</ul> : records && <p>저장된 주석이 없습니다.</p>}
  </section>;
}
