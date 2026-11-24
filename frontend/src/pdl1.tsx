import { useEffect, useRef, useState } from 'react';
import { api } from './session';
import type { Viewport } from './tile-viewer';

type Point = [x: number, y: number, category: number];
type Cells = { points: Point[]; truncated: boolean };
type Audit = { action: string; actor: string; occurred_at: string; source: 'ims' | 'exported'; reference?: string };
type ScoreStatus = 'archived' | 'native' | 'validated_pair' | 'input_unverified' | 'invalid_saved_score' | 'edited_score_unverified';
type Comparison = {
  status: 'available' | 'validation_required' | 'insufficient_scores';
  pair: { cps_snapshot_id: string; tps_snapshot_id: string; reference: string } | null;
};
type Result = {
  id: string; kind: 'original' | 'edited'; original_id: string | null; variant: 'Stomach' | 'Lung';
  score_type: 'CPS' | 'TPS'; score: number | null; score_status: ScoreStatus; counts: Record<string, number>;
  classes: Record<string, { label: string; color: string }>; point_count: number; dimensions: [number, number];
  model: string | null; model_version: string | null; architecture: string | null; model_bytes: number | null;
  model_mtime_ns: string | null; analysis_version: string | null; source_digest: string; editor: string | null;
  saved_at: string | null; audit: Audit[]; checkpoint_sha256?: string | null;
};

const typeLabel = { original: '원본', edited: '사용자 수정본' };
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
const rangeSize = 512;

export function usePdl1(endpoint: string, ready: boolean, view: Viewport | undefined, initialSnapshot?: string) {
  const [data, setData] = useState<{ results: Result[]; comparison: Comparison }>();
  const results = data?.results;
  const [selected, setSelected] = useState(initialSnapshot ?? '');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(false);
  const [overlayError, setOverlayError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [overlay, setOverlay] = useState<{ id: string; cells: Cells }>();
  const result = results?.find((item) => item.id === selected);
  const width = result?.dimensions[0] ?? 0;
  const height = result?.dimensions[1] ?? 0;
  const snapStart = (value: number) => Math.max(0, Math.floor(value / rangeSize) * rangeSize);
  const left = view ? snapStart(view.x) : 0;
  const top = view ? snapStart(view.y) : 0;
  const right = view ? Math.min(width, Math.ceil((view.x + view.width) / rangeSize) * rangeSize) : 0;
  const bottom = view ? Math.min(height, Math.ceil((view.y + view.height) / rangeSize) * rangeSize) : 0;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setError(false);
    api<NonNullable<typeof data>>(endpoint + '/pdl1', { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response);
        const entries = response.results;
        setSelected((id) => entries.some((entry) => entry.id === id) ? id : initialSnapshot ?? entries[0]?.id ?? '');
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [endpoint, ready, attempt, initialSnapshot]);

  useEffect(() => {
    if (!ready || !selected || !enabled || left >= right || top >= bottom) return;
    const controller = new AbortController();
    setOverlayError(false);
    const query = new URLSearchParams({ left: String(left), top: String(top), right: String(right), bottom: String(bottom) });
    const timer = window.setTimeout(() => {
      api<Cells>(`${endpoint}/pdl1/${selected}/cells?${query}`, { signal: controller.signal })
        .then((cells) => { if (!controller.signal.aborted) setOverlay({ id: selected, cells }); })
        .catch(() => { if (!controller.signal.aborted) { setOverlay(undefined); setOverlayError(true); } });
    }, 100);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [endpoint, ready, selected, enabled, left, top, right, bottom, attempt]);

  return { results, result, referenceMissing: Boolean(initialSnapshot && selected === initialSnapshot && results && !result), comparison: data?.comparison, selected, setSelected, enabled, setEnabled, error, overlayError,
    retry: () => setAttempt((count) => count + 1), cells: ready && enabled && overlay?.id === selected ? overlay.cells : undefined };
}

type Pdl1State = ReturnType<typeof usePdl1>;

export function Pdl1Overlay({ view, result, cells }: { view?: Viewport; result?: Result; cells?: Cells }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { x, y, width, height, zoom } = view ?? { x: 0, y: 0, width: 0, height: 0, zoom: 0 };

  useEffect(() => {
    const element = canvas.current;
    if (!element || !result || !cells || !zoom) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(width * zoom * ratio);
    element.height = Math.round(height * zoom * ratio);
    ctx.scale(ratio, ratio);
    ctx.globalAlpha = 0.86;
    const radius = Math.min(4, Math.max(1.15, zoom * 3));
    const byClass = new Map<number, Path2D>();
    for (const [px, py, category] of cells.points) {
      const sx = (px - x) * zoom;
      const sy = (py - y) * zoom;
      if (sx < 0 || sy < 0 || sx >= width * zoom || sy >= height * zoom) continue;
      const path = byClass.get(category) ?? new Path2D();
      path.moveTo(sx + radius, sy);
      path.arc(sx, sy, radius, 0, 2 * Math.PI);
      byClass.set(category, path);
    }
    for (const [category, path] of byClass) {
      ctx.fillStyle = result.classes[category].color;
      ctx.fill(path);
    }
  }, [x, y, width, height, zoom, result, cells]);

  if (!result || !cells) return null;
  return <canvas className="pdl1-overlay" ref={canvas} aria-label="PD-L1 세포 오버레이" />;
}

const scoreStatusLabel: Record<ScoreStatus, string> = {
  archived: '보관 점수 · 입력 정보 미확인',
  native: '원본 저장 점수',
  validated_pair: '검증 자료에 연결된 저장 점수',
  input_unverified: '입력 또는 조합 검증 필요',
  invalid_saved_score: '저장 점수 확인 불가',
  edited_score_unverified: '수정본 점수 확인 불가',
};

export function Pdl1Badge({ state }: { state: Pdl1State }) {
  const { result, results, comparison } = state;
  if (!result) return null;
  const pair = comparison?.pair;
  const ids = pair ? [pair.cps_snapshot_id, pair.tps_snapshot_id] : [];
  const pairResults = ids.map((id) => results?.find((item) => item.id === id));
  const shown = ids.includes(result.id) && pairResults.every((item) => item?.score != null)
    ? pairResults as Result[] : [result];
  return <aside className="pdl1-score" aria-label="PD-L1 점수 카드">
    {shown.map((item) => <div key={item.id}>
      <span>PD-L1 · {item.score_type} · {typeLabel[item.kind]}</span>
      <strong>{item.score == null ? '—' : number.format(item.score) + (item.score_type === 'TPS' ? '%' : '')}</strong>
      <small>{scoreStatusLabel[item.score_status]}</small>
    </div>)}
  </aside>;
}

export function Pdl1Panel({ state }: { state: Pdl1State }) {
  const { results, result, selected, setSelected, enabled, setEnabled, error, overlayError, retry, cells, comparison, referenceMissing } = state;
  return <section className="pdl1-panel" aria-label="PD-L1 결과">
    <div className="pdl1-heading"><h2>PD-L1</h2>
      {result && <label className="pdl1-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 세포 오버레이</label>}
    </div>
    {error ? <div role="alert">PD-L1 결과를 불러올 수 없습니다. <button className="button secondary" onClick={retry}>다시 불러오기</button></div>
      : !results ? <p role="status">PD-L1 결과 확인 중</p>
      : referenceMissing ? <div role="alert">참조한 PD-L1 결과를 열 수 없습니다.
        {results[0] && <button className="button secondary" onClick={() => setSelected(results[0].id)}>다른 결과 보기</button>}</div>
      : !result ? <p>이 스캔에 연결된 PD-L1 결과가 없습니다.</p>
      : <>
        <label className="form-field">결과 버전<select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {results.map((entry) => <option key={entry.id} value={entry.id}>{entry.score_type} · {typeLabel[entry.kind]}{entry.editor ? ` · ${entry.editor}` : ''} · {entry.id.slice(0, 8)}</option>)}
        </select></label>
        {comparison?.status === 'validation_required' && <p role="status">이 스캔의 CPS·TPS 동시 표시에는 입력 조건과 검증 근거 확인이 필요합니다.</p>}
        {comparison?.status === 'insufficient_scores' && <p>동시 표시 조건을 충족하는 두 결과가 없습니다.</p>}
        {comparison?.pair && <p>동시 표시 검증 근거 {comparison.pair.reference} · 세포 표식은 선택한 결과 기준</p>}
        <div className="pdl1-metadata">
          <dl className="key-values"><div><dt>모델</dt><dd>{result.model ?? '기록 없음'}</dd></div>
            <div><dt>모델 버전</dt><dd>{result.model_version ?? '기록 없음'}</dd></div>
            {result.architecture && <div><dt>아키텍처</dt><dd>{result.architecture}</dd></div>}
            {result.model_mtime_ns && <div><dt>가중치 파일 기록</dt><dd title={result.model_mtime_ns}>{date.format(new Date(Number(result.model_mtime_ns) / 1e6))}{result.model_bytes ? ` · ${number.format(result.model_bytes)} B` : ''}</dd></div>}
            {result.checkpoint_sha256 && <div><dt>체크포인트 SHA-256</dt><dd title={result.checkpoint_sha256}>{result.checkpoint_sha256.slice(0, 12)}</dd></div>}
            <div><dt>저장된 분석 버전</dt><dd>{result.analysis_version ?? '기록 없음'}</dd></div>
            <div><dt>결과 지문</dt><dd title={result.source_digest}>{result.source_digest.slice(0, 12)}</dd></div>
            {result.original_id && <div><dt>연결된 원본</dt><dd>{result.original_id.slice(0, 12)}</dd></div>}
            {result.editor && <div><dt>수정자 · 저장 시각</dt><dd>{result.editor} · {result.saved_at ? date.format(new Date(result.saved_at)) : '기록 없음'}</dd></div>}
          </dl>
        </div>
        <ul className="pdl1-legend">{Object.entries(result.classes).map(([key, item]) => <li key={key}><i style={{ background: item.color }} />
          <span>{item.label}{key in result.counts && ` · ${number.format(result.counts[key])}`}</span>
        </li>)}</ul>
        {enabled && cells?.truncated && <p role="status">현재 영역의 세포 표식은 일부만 표시됩니다. 확대하면 해당 영역의 표식을 더 볼 수 있습니다.</p>}
        {enabled && overlayError && <p role="alert">세포 표식을 불러올 수 없습니다. <button className="button secondary" onClick={retry}>다시 불러오기</button></p>}
        <details className="pdl1-audit"><summary>감사 이력</summary>
          {result.audit.filter((entry) => entry.source === 'exported').length === 0 && <p>원천 감사 이력 자료 없음</p>}
          <ul className="timeline">{result.audit.map((entry, index) => <li key={`${entry.occurred_at}-${index}`}>
            <strong>{entry.action === 'snapshot_imported' ? 'IMS 읽기 전용 가져오기' : entry.action}</strong>
            <span> · {entry.actor} · {date.format(new Date(entry.occurred_at))}{entry.reference ? ` · ${entry.reference}` : ''}</span>
          </li>)}</ul>
        </details>
      </>}
  </section>;
}
