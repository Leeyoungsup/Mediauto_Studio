import { useState } from 'react';
import type { Candidate, PapState } from './pap-gallery-state';

const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const preparation = { conventional: 'Conventional', liquid_based: 'Liquid-Based' };
const percentage = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

function CandidateTile({ path, candidate, category, pressed, disabled, select }: {
  path: string; candidate: Candidate; category: string; pressed: boolean; disabled: boolean; select: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <article>
    <button type="button" disabled={disabled} aria-pressed={pressed} aria-label={`Focus candidate ${candidate.id}`} onClick={select}>
      {failed ? <span className="pap-thumb pap-thumb-unavailable">Preview unavailable</span>
        : <img className="pap-thumb" src={path + '?attempt=' + attempt} alt="" loading="lazy" onError={() => setFailed(true)} />}
      <strong>{candidate.id}</strong><span>{category}</span>
      {candidate.confidence != null && <small>Confidence {percentage.format(candidate.confidence)}</small>}
    </button>
    {failed && <button type="button" className="button secondary" aria-label={`Retry thumbnail for ${candidate.id}`}
      onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}>Retry Preview</button>}
  </article>;
}

export default function PapGallery({ state, following, onReview }: { state: PapState; following: boolean; onReview: () => void }) {
  const { index, archive, selected, candidates, page } = state;
  const pageCount = Math.ceil((candidates?.total ?? 0) / (candidates?.page_size ?? 1));
  function label(candidate: Candidate) {
    return archive?.categories.find((item) => item.code === candidate.category)?.label ?? candidate.category;
  }
  return <aside className="pap-gallery" aria-label="Pap Candidate Gallery">
    <header className="panel-title"><h2>Pap Candidates</h2>
      <div className="actions">
        <button type="button" className="button secondary" onClick={onReview}>Open Pap Review</button>
        <button type="button" className="button secondary" disabled={state.busy} onClick={state.refresh}>Reload Gallery</button>
      </div>
    </header>
    {state.error ? <p role="alert">{state.error}</p>
      : !index ? <p role="status">Loading Pap results…</p>
        : index.status === 'stain_unverified' ? <p>Pap Gallery requires a registered Papanicolaou stain.</p>
          : index.status === 'archive_error' ? <p role="alert">Pap results could not be verified. Reload after checking the source archive.</p>
            : index.status === 'not_received' ? <p>No Pap results have been received for this scan.</p>
              : archive && <>
                {index.partial_error && <p role="status">An analysis archive could not be verified.</p>}
                {index.resume_unavailable && <p role="status">Your saved candidate is unavailable for this scan.</p>}
                {index.archives.length > 1 && <label className="form-field">Pap Analysis
                  <select value={archive.id} onChange={(event) => state.selectArchive(event.target.value)} disabled={state.busy}>
                    {index.archives.map((item) => <option key={item.id} value={item.id}>
                      {item.model.name} · {item.analysis_version} · {item.id.slice(0, 8)}</option>)}
                  </select></label>}
                <label className="form-field">Candidate Category
                  <select value={state.category} onChange={(event) => state.selectCategory(event.target.value)}>
                    <option value="">All Categories ({archive.candidate_count})</option>
                    {archive.categories.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.count})</option>)}
                  </select>
                </label>
                {selected && <div className="pap-selection" role="status">
                  <strong>{selected.id} · {label(selected)}</strong>
                  <span>Level 0 px {selected.bounds.join(', ')}</span>
                  <button type="button" className="button secondary" disabled={following} onClick={state.reframe}>Center Selected Candidate</button>
                </div>}
                {state.saveError && <p role="alert">{state.saveError}</p>}
                {archive.candidate_count === 0 ? <p>This analysis contains no candidates.</p>
                  : state.listError ? <p role="alert">{state.listError}</p>
                    : !candidates ? <p role="status">Loading candidates…</p>
                      : !candidates.total ? <p>No candidates in this category.</p>
                        : <div className="pap-grid">{candidates.candidates.map((candidate) => <CandidateTile key={archive.id + ':' + candidate.id}
                          candidate={candidate} category={label(candidate)} pressed={selected?.id === candidate.id}
                          disabled={following || state.busy} select={() => void state.select(candidate)}
                          path={`${state.root}/${archive.id}/candidates/${candidate.id}/thumbnail`} />)}</div>}
                {pageCount > 1 && <nav className="actions" aria-label="Pap Candidate Pages">
                  <button type="button" className="button secondary" onClick={() => state.setPage(page - 1)} disabled={page <= 1}>Previous Candidates</button>
                  <span>Page {page} of {pageCount}</span>
                  <button type="button" className="button secondary" onClick={() => state.setPage(page + 1)} disabled={page >= pageCount}>Next Candidates</button>
                </nav>}
                <details className="pdl1-audit"><summary>Model and Candidate Source</summary>
                  <dl className="key-values">
                    <div><dt>Preparation</dt><dd>{preparation[archive.preparation]}</dd></div>
                    <div><dt>Model</dt><dd>{archive.model.name} · {archive.model.version}</dd></div>
                    <div><dt>Analysis</dt><dd>{archive.analysis_version} · {date.format(new Date(archive.exported_at))}</dd></div>
                    <div><dt>Schema</dt><dd>{archive.schema_version}</dd></div>
                    <div><dt>Checkpoint SHA-256</dt><dd>{archive.model.checkpoint_sha256}</dd></div>
                    <div><dt>Archive SHA-256</dt><dd>{archive.id}</dd></div>
                  </dl>
                </details>
              </>}
  </aside>;
}
