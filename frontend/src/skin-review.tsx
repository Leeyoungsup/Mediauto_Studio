import { useId, useState } from 'react';
import type { Bounds, CountField, State, Status } from './skin-review-state';
import type { Viewport } from './tile-viewer';
import type { Point } from './viewer-tools';

const statuses: Record<Status, string> = { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected' };
const actions = { window: 'Count Field Placed', remove_window: 'Count Field Removed', add: 'Manual Mark Added', decide: 'Candidate Decision' };
const labels = { epidermal_orientation: 'Epidermal Orientation', tissue_regions: 'Tissue Regions', count_fields: 'Count Fields',
  mitosis_candidates: 'Mitosis Candidates', candidate_heatmap: 'Candidate Heatmap' };
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const inBounds = ([x, y]: Point, [left, top, right, bottom]: Bounds) => x >= left && x < right && y >= top && y < bottom;

export function SkinOverlay({ state, view }: { state: State; view?: Viewport }) {
  const marker = useId().replaceAll(':', '');
  const { review, field } = state;
  if (!view || !review) return null;
  const x = (value: number) => (value - view.x) * view.zoom;
  const y = (value: number) => (value - view.y) * view.zoom;
  const rect = ([left, top, right, bottom]: Bounds) => ({ x: x(left), y: y(top), width: (right - left) * view.zoom,
    height: (bottom - top) * view.zoom });
  const maximum = Math.max(1, ...review.heatmap.map((tile) => tile.density));
  return <svg aria-label="Skin Review Overlay" className="prostate-overlay skin-overlay"
    viewBox={`0 0 ${view.width * view.zoom} ${view.height * view.zoom}`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0 0L10 5L0 10Z" fill="#13a9a0" /></marker></defs>
    {state.showHeatmap && review.heatmap.filter(({ bounds: [left, top, right, bottom] }) =>
      left < view.x + view.width && right > view.x && top < view.y + view.height && bottom > view.y).map((tile) =>
      <rect key={tile.bounds.join(',')} data-layer="density" {...rect(tile.bounds)} fill="#de1866" opacity={0.66 * tile.density / maximum}>
        <title>{number.format(tile.density)} candidates/mm²</title></rect>)}
    {state.showRegions && review.regions?.map((region) => <polygon key={region.id} data-layer={region.kind}
      points={region.points.map(([px, py]) => `${x(px)},${y(py)}`).join(' ')}><title>{region.kind} · {region.id}</title></polygon>)}
    {state.showRegions && review.orientation?.map((item) => <line key={item.id} data-layer="orientation" x1={x(item.start[0])}
      y1={y(item.start[1])} x2={x(item.surface[0])} y2={y(item.surface[1])} markerEnd={`url(#${marker})`}>
      <title>Epidermal surface direction · {item.id}</title></line>)}
    {field && <rect data-layer="count-field" {...rect(field.bounds)} />}
    {state.showCandidates && review.candidates.filter(({ point }) => inBounds(point, [view.x, view.y, view.x + view.width, view.y + view.height])
      && (!field || inBounds(point, field.bounds))).map(({ id, point, status }) =>
      <circle key={id} data-status={status} cx={x(point[0])} cy={y(point[1])} r={4}><title>{id} · {statuses[status]}</title></circle>)}
  </svg>;
}

export function SkinPanel({ state, following, focus, activate }: { state: State; following: boolean; focus: (points: Point[]) => void;
  activate: (mode: 'window' | 'add') => void }) {
  const { data, review, field, model } = state;
  const [page, setPage] = useState(0);
  const canEdit = Boolean(data?.can_review) && !following;
  const candidates = field && review ? review.candidates.filter((item) => inBounds(item.point, field.bounds)) : [];
  const pages = Math.ceil(candidates.length / 40);
  const visiblePage = Math.min(page, Math.max(0, pages - 1));
  const labelsFor = (item: CountField, index: number) => item.manual ? `Manual Count Field ${index + 1}` : item.id;
  return <section className="pdl1-panel skin-review" aria-label="Skin and Melanoma Review">
    <div className="pdl1-heading"><h2>Skin and Melanoma Review</h2>
      {data && <button type="button" className="button secondary" disabled={state.busy} onClick={state.refresh}>Reload Skin Review</button>}
    </div>
    {state.failed ? <p role="alert">Unable to load skin review. <button className="button secondary" onClick={state.refresh}>Retry</button></p>
      : !data ? <p role="status">Loading skin review…</p>
      : data.status === 'stain_unverified' ? <p>Skin review requires a registered H&amp;E scan.</p>
      : <>
        {data.status === 'archive_unavailable' && <p role="status">Model archive unavailable. Manual review is available.</p>}
        <label className="form-field skin-input">Analysis Source<select value={state.sourceId ?? ''} disabled={state.busy}
          onChange={(event) => { state.selectSource(event.target.value); setPage(0); }}>
          {data.analyses.map((item) => <option key={item.id} value={item.id}>{item.model.name} · {item.analysis_version}</option>)}
          <option value={data.manual_id ?? ''}>Manual Review</option>
        </select></label>
        {review && <>
          {model && <div className="skin-layers">
            {(review.orientation?.length || review.regions?.length) ? <label><input type="checkbox" checked={state.showRegions}
              onChange={(event) => state.setShowRegions(event.target.checked)} /> Epidermal Orientation and Regions</label> : null}
            {review.heatmap_status === 'available' && <label><input type="checkbox" checked={state.showHeatmap}
              onChange={(event) => state.setShowHeatmap(event.target.checked)} /> Model Heatmap (candidates/mm²)</label>}
            {review.heatmap_status === 'calibration_mismatch' && <span>Heatmap calibration differs from the registered WSI.</span>}
          </div>}
          <div className="ihc-controls">
            {review.windows.length > 0 && <label className="form-field">Count Field<select value={field?.id ?? ''} disabled={state.busy}
              onChange={(event) => { state.selectField(event.target.value); setPage(0); }}>
              {review.windows.map((item, index) => <option key={item.id} value={item.id}>{labelsFor(item, index)}</option>)}
            </select></label>}
            {field && <button type="button" className="button secondary" disabled={following}
              onClick={() => focus([[field.bounds[0], field.bounds[1]], [field.bounds[2], field.bounds[3]]])}>Focus Count Field</button>}
            {review.candidates.length > 0 && <label className="pdl1-toggle"><input type="checkbox" checked={state.showCandidates}
              onChange={(event) => state.setShowCandidates(event.target.checked)} /> Candidate Markers</label>}
          </div>
          {field && <dl className="key-values">
            <div><dt>Area</dt><dd>{field.area_mm2 == null ? 'Calibration Unavailable' : `${number.format(field.area_mm2)} mm²`}</dd></div>
            <div><dt>Confirmed in Review</dt><dd>{field.counts.confirmed}</dd></div>
            <div><dt>Rejected</dt><dd>{field.counts.rejected}</dd></div>
            <div><dt>Pending</dt><dd>{field.counts.pending}</dd></div>
            {field.review_density != null && <div><dt>Reviewed Density</dt><dd>{number.format(field.review_density)} confirmed/mm²</dd></div>}
            {field.reference && <div><dt>Reference Comparison</dt><dd>{field.reference.reference} · {field.reference.version} ·
              {' '}{field.reference.count} reference · {field.reference.difference} difference</dd></div>}
          </dl>}
          {canEdit && <>
            <div className="ihc-controls">
              <label className="form-field">Review Reason<input value={state.reason} maxLength={240} disabled={state.busy}
                onChange={(event) => state.setReason(event.target.value)} /></label>
              <label className="form-field">Count Field Area<select value={state.area} disabled={!data.mpp || state.busy}
                onChange={(event) => state.setArea(Number(event.target.value))}>
                <option value={0.2}>0.2 mm²</option><option value={1}>1 mm²</option></select></label>
              <button type="button" className="button secondary" disabled={!data.mpp || !state.reason.trim() || state.busy}
                aria-pressed={state.mode === 'window'} onClick={() => activate('window')}>Place Count Field</button>
              <button type="button" className="button secondary" disabled={!field || !state.reason.trim() || state.busy}
                aria-pressed={state.mode === 'add'} onClick={() => activate('add')}>Mark Mitosis</button>
              {field?.manual && <button type="button" className="button secondary" disabled={!state.reason.trim() || state.busy}
                onClick={() => void state.save({ action: 'remove_window', window_id: field.id })}>Remove Count Field</button>}
            </div>
            {!data.mpp && <p role="status">A calibrated count field requires both WSI pixel scales.</p>}
            {state.mode && <p role="status">{state.mode === 'window' ? 'Click the center of the count field on the slide.' : 'Click the mitosis inside the selected count field.'}
              {' '}<button type="button" className="button secondary" onClick={() => state.setMode(undefined)}>Cancel Placement</button></p>}
            {state.saveError && <p role="alert">{state.saveError}</p>}
          </>}
          {field && candidates.length > 0 && <div className="skin-candidates">
            {candidates.slice(visiblePage * 40, visiblePage * 40 + 40).map((item) => <div className="actions" key={item.id}>
              <button type="button" className="button secondary" disabled={following} onClick={() => focus([item.point])}>
                {item.origin === 'manual' ? 'Manual Mark' : item.id} · {statuses[item.status]}</button>
              {item.confidence != null && <span>Confidence {number.format(item.confidence)}</span>}
              {canEdit && <select aria-label={`Decision for ${item.id}`} value={item.status} disabled={!state.reason.trim() || state.busy}
                onChange={(event) => void state.save({ action: 'decide', candidate_id: item.id, window_id: field.id, status: event.target.value as Status })}>
                {(Object.keys(statuses) as Status[]).map((status) => <option key={status} value={status}>{statuses[status]}</option>)}
              </select>}
            </div>)}
            {pages > 1 && <div className="actions">
              <button className="button secondary" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous Candidates</button>
              <button className="button secondary" disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>Next Candidates</button>
            </div>}
          </div>}
          {model && <details className="pdl1-audit"><summary>Model and Archive</summary>
            <p>{model.model.name} · {model.model.version} · {model.analysis_version}</p>
            <p>{model.scope.replaceAll('_', ' ')} · {review.analyzed_at && date.format(new Date(review.analyzed_at))}</p>
            <p>Checkpoint {model.model.checkpoint_sha256}</p><p>Archive {model.id}</p>
            <ul>{Object.entries(labels).map(([capability, label]) => <li key={capability}>{label} ·
              {' '}{review.capabilities?.includes(capability) ? 'Supported' : 'Unsupported'}</li>)}</ul>
          </details>}
          {review.history.length > 0 && <details className="pdl1-audit"><summary>Skin Review History</summary>
            <ol className="timeline">{review.history.map((entry) => <li key={entry.version}>
              <strong>Revision {entry.version} · {actions[entry.action]}</strong>
              {entry.change.candidate_id && <p>{entry.change.candidate_id} · {entry.change.before ?? 'New'} → {entry.change.after}</p>}
              <p>{entry.actor ?? 'Former User'} · {date.format(new Date(entry.created_at))} · {entry.reason}</p>
            </li>)}</ol>
          </details>}
        </>}
      </>}
  </section>;
}
