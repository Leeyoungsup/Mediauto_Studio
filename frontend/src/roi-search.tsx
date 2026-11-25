import { useEffect, useRef, useState } from 'react';
import { api, auditAttemptId, jsonBody } from './session';

export type RoiLocation = { caseId: string; scanId: string; roiId: string };
type Context = { case_id: string; adapter: string; organ_systems: Record<string, string>; organ_system: string | null };
type Result = { scan_id: string; roi_id: string; slide: string; format: string };
type SearchResults = { organ_system: string; results: Result[] };

export function roiViewerHref(location: RoiLocation, origin?: RoiLocation) {
  const route = `#viewer/${location.caseId}/${location.scanId}/roi/${location.roiId}`;
  return origin ? `${route}/${origin.scanId}/${origin.roiId}` : route;
}

export function roiSearchHref({ caseId, scanId, roiId }: RoiLocation) {
  return `#roi-search/${caseId}/${scanId}/${roiId}`;
}

function roiEndpoint(scanId: string, roiId: string) {
  return `/api/wsi/clinical/${scanId}/roi-search/rois/${roiId}`;
}

function Preview({ endpoint, description }: { endpoint: string; description: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <div className="roi-search-preview">
    {failed ? <div role="status">ROI preview unavailable.
      <button type="button" className="button secondary" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>Retry Preview</button>
    </div> : <img src={`${endpoint}/preview.png?attempt=${attempt}`} alt={description} onError={() => setFailed(true)} />}
  </div>;
}

export function RoiSearchPage({ location, initialOrgan, onOrganChange }: {
  location: RoiLocation; initialOrgan?: string; onOrganChange: (organ: string) => void;
}) {
  const root = roiEndpoint(location.scanId, location.roiId);
  const openingOrgan = useRef(initialOrgan);
  const [context, setContext] = useState<Context>();
  const [organ, setOrgan] = useState('');
  const [found, setFound] = useState<SearchResults>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<Context>(root, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      if (data.case_id !== location.caseId) throw new Error('The ROI belongs to a different case.');
      setContext(data);
      const remembered = openingOrgan.current;
      setOrgan(remembered !== undefined && (remembered === '' || Object.hasOwn(data.organ_systems, remembered))
        ? remembered : data.organ_system ?? '');
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [root, location.caseId, reload]);

  async function update(action: 'search' | 'save' | 'remove') {
    const headers = { 'X-Audit-Attempt': auditAttemptId() };
    if (!context || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setFound(undefined);
    try {
      if (action === 'search') {
        setFound(await api<SearchResults>(root + '/search', jsonBody('POST', { organ_system: organ }, headers)));
      } else {
        const options = action === 'save' ? jsonBody('PUT', { organ_system: organ }, headers) : { method: 'DELETE', headers };
        const result = await api<{ organ_system: string | null }>(root + '/reference', options);
        setContext({ ...context, organ_system: result.organ_system });
        setNotice(action === 'save' ? 'ROI saved to this case’s local reference set.' : 'ROI removed from the local reference set.');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The ROI request failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="roi-search-page" aria-label="ROI Similarity Search">
    <header className="page-heading"><div><h1>ROI Similarity Search</h1></div>
      <a className="button secondary" href={roiViewerHref(location)}>Back to Source ROI</a>
    </header>
    {error && <p className="form-error" role="alert">{error}{!context && <button type="button" className="button secondary"
      onClick={() => { setError(''); setReload(reload + 1); }}>Retry ROI</button>}</p>}
    {!context && !error && <p role="status">Opening ROI…</p>}
    {context && <div className="roi-search-layout">
      <section className="panel detail-content" aria-label="Search ROI">
        <h2>Source ROI</h2>
        <small className="scan-reference" title={location.scanId}>Scan {location.scanId.slice(0, 8)}</small>
        <Preview endpoint={root} description="Source ROI preview" />
        <p className="muted">{context.adapter}</p>
        <p>Search this case’s registered references. ROI images stay on this server. Results are for development review.</p>
        <form onSubmit={(event) => { event.preventDefault(); void update('search'); }}>
          <label className="form-field">Organ System<select value={organ} disabled={busy} required onChange={(event) => {
            setOrgan(event.target.value); onOrganChange(event.target.value); setFound(undefined); setError(''); setNotice('');
          }}>
            <option value="">Select an Organ System</option>
            {Object.entries(context.organ_systems).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <button className="button primary" type="submit" disabled={busy || !organ}>Search Similar ROIs</button>
        </form>
        <details className="roi-reference-controls">
          <summary>Local Reference</summary>
          <p>{context.organ_system ? `Indexed as ${context.organ_systems[context.organ_system]}.` : 'This ROI is available to add to the case reference set.'}</p>
          <div className="actions">
            <button className="button secondary" type="button" disabled={busy || !organ || context.organ_system === organ}
              onClick={() => void update('save')}>Save as Local Reference</button>
            {context.organ_system && <button className="button secondary" type="button" disabled={busy}
              onClick={() => void update('remove')}>Remove Local Reference</button>}
          </div>
        </details>
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="panel detail-content" aria-label="Similar ROI Results" aria-busy={busy}>
        <h2>Search Results</h2>
        {busy ? <p role="status">Processing ROI request…</p> : found ? found.results.length ? <>
          <p role="status">{found.results.length} {found.results.length === 1 ? 'match' : 'matches'} · {context.organ_systems[found.organ_system]}</p>
          <ul className="roi-search-results">{found.results.map((match) => <li key={match.roi_id}>
            <Preview endpoint={roiEndpoint(match.scan_id, match.roi_id)} description={`Match on ${match.format} slide ${match.slide}`} />
            <div><h3>Slide {match.slide} · {match.format}</h3>
              <small className="scan-reference" title={match.scan_id}>Scan {match.scan_id.slice(0, 8)}</small><a className="button secondary" href={roiViewerHref({
              caseId: location.caseId, scanId: match.scan_id, roiId: match.roi_id,
            }, location)}>Open Match in WSI</a></div>
          </li>)}</ul>
        </> : <p role="status">No other indexed ROIs match this organ system in this case.</p>
          : <p className="muted">Select an organ system and run a search.</p>}
      </section>
    </div>}
  </section>;
}
