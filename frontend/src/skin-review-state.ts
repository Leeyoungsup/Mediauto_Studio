import { useEffect, useRef, useState } from 'react';
import { api, auditAttemptId, jsonBody } from './session';
import type { Point } from './viewer-tools';

export type Status = 'pending' | 'confirmed' | 'rejected';
export type Bounds = [number, number, number, number];
type Candidate = { id: string; point: Point; origin: 'model' | 'manual'; status: Status; confidence?: number };
export type CountField = { id: string; bounds: Bounds; manual: boolean; area_mm2: number | null; counts: Record<Status, number>;
  review_density: number | null; reference: { reference: string; version: string; count: number; difference: number } | null };
type Analysis = { id: string; analysis_version: string; model: { name: string; version: string; checkpoint_sha256: string }; scope: string };
type Feed = { status: 'available' | 'archive_unavailable' | 'stain_unverified'; analyses: Analysis[]; manual_id: string | null; can_review: boolean; mpp: [number, number] | null };
type Review = {
  version: number; capabilities?: string[]; analyzed_at?: string;
  windows: CountField[]; candidates: Candidate[];
  orientation?: { id: string; start: Point; surface: Point }[];
  regions?: { id: string; kind: 'epidermis' | 'tissue' | 'lesion'; points: Point[] }[];
  heatmap: { bounds: Bounds; density: number }[];
  heatmap_status: 'available' | 'not_reported' | 'calibration_mismatch';
  history: { version: number; action: Action['action']; change: { candidate_id?: string; window_id: string; before?: Status; after?: Status };
    actor: string | null; reason: string; created_at: string }[];
};
export type Action = { action: 'window'; point: Point; area: number } | { action: 'add'; point: Point; window_id: string }
  | { action: 'decide'; candidate_id: string; window_id: string; status: Status } | { action: 'remove_window'; window_id: string };

export function useSkinReview(endpoint: string, ready: boolean) {
  const base = endpoint + '/skin';
  const [data, setData] = useState<Feed>();
  const [selected, setSelected] = useState('');
  const [reviewState, setReview] = useState<{ key: string; review: Review }>();
  const [fieldId, setField] = useState('');
  const [mode, setMode] = useState<'window' | 'add'>();
  const [area, setArea] = useState(0.2);
  const [reason, setReason] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const [showCandidates, setShowCandidates] = useState(true);
  const request = useRef<{ payload: string; key: string }>(undefined);
  const saving = useRef(false);
  const analysis = data?.analyses.find((item) => item.id === selected);
  const sourceId = selected && (analysis || selected === data?.manual_id) ? selected : data?.analyses[0]?.id ?? data?.manual_id;
  const key = sourceId ? base + '/' + sourceId : '';
  const review = reviewState?.key === key ? reviewState.review : undefined;
  const field = review?.windows.find((item) => item.id === fieldId) ?? review?.windows[0];

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setFailed(false);
    api<Feed>(base, { signal: controller.signal })
      .then((feed) => { if (!controller.signal.aborted) setData(feed); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [base, ready, attempt]);

  useEffect(() => {
    if (!ready || !key) return;
    const controller = new AbortController();
    api<Review>(key, { signal: controller.signal })
      .then((review) => { if (!controller.signal.aborted) setReview({ key, review }); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [key, ready, attempt]);

  async function save(action: Action) {
    if (!review || !reason.trim() || saving.current) return;
    const payload = { ...action, expected_version: review.version, reason: reason.trim() };
    const serialized = JSON.stringify(payload);
    if (request.current?.payload !== serialized) request.current = { payload: serialized, key: auditAttemptId() };
    saving.current = true;
    setBusy(true);
    setSaveError('');
    try {
      const result = await api<{ change: { window_id: string } }>(key + '/revisions',
        jsonBody('POST', { ...payload, request_key: request.current.key }));
      if (action.action === 'window') setField(result.change.window_id);
      setMode(undefined);
      const updated = await api<Review>(key);
      setReview({ key, review: updated });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save the skin review.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return { data, review, field, sourceId, model: data?.analyses.find((item) => item.id === sourceId), mode, setMode, area, setArea,
    reason, setReason, failed, saveError, busy, showHeatmap, setShowHeatmap, showRegions, setShowRegions, showCandidates, setShowCandidates,
    selectSource(id: string) { setSelected(id); setField(''); setMode(undefined); setSaveError(''); },
    selectField(id: string) { setField(id); setMode(undefined); },
    refresh() { setReview(undefined); setMode(undefined); setSaveError(''); setAttempt((value) => value + 1); },
    save,
    place(point: Point) {
      if (mode === 'window') void save({ action: 'window', point, area });
      if (mode === 'add' && field) void save({ action: 'add', point, window_id: field.id });
    },
  };
}

export type State = ReturnType<typeof useSkinReview>;
