import { useEffect, useState } from 'react';
import { ImageViewport } from './image-viewport';
import { api } from './session';
import type { Scan } from './related-cases';

type Pair = { id: string; pap: Scan; biopsy: Scan };

export default function RelatedComparison({ organization, id, anchor }: { organization: string; id: string; anchor?: string }) {
  const endpoint = '/api/clinical/' + encodeURIComponent(organization) + '/related-comparisons/' + id;
  const [data, setData] = useState<Pair>();
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    setFailure('');
    setData(undefined);
    async function refresh() {
      if (loading || controller.signal.aborted) return;
      loading = true;
      try {
        const loaded = await api<Pair>(endpoint, { signal: controller.signal });
        if (!controller.signal.aborted) { setData((previous) => previous ?? loaded); setFailure(''); }
      } catch (error) {
        if (!controller.signal.aborted) {
          setData(undefined);
          setFailure(error instanceof Error ? error.message : 'The comparison is unavailable.');
        }
      } finally {
        loading = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2500);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [endpoint, attempt]);

  const sides = data && (anchor === data.biopsy.case_id ? ['biopsy', 'pap'] : ['pap', 'biopsy']) as ('pap' | 'biopsy')[] | undefined;
  return <section className="related-comparison" aria-label="Independent WSI Comparison">
    <div className="page-heading"><div><h1>Pap and Biopsy Comparison</h1><p>Read-Only · Independent Pan and Zoom</p></div>
      {data && sides && <a className="button secondary" href={'#viewer/' + data[sides[0]].case_id + '/' + data[sides[0]].id}>Open Primary Viewer</a>}</div>
    {failure ? <p className="notice" role="alert">{failure} <button className="button secondary" type="button"
      onClick={() => setAttempt((value) => value + 1)}>Retry Comparison</button></p>
      : !data || !sides ? <p role="status">Checking the confirmed comparison…</p>
        : <div className="related-comparison-grid">{sides.map((side, index) => {
          const row = data[side];
          const title = index === 0 ? 'Primary Case' : 'Related Case';
          return <section key={row.id} aria-label={title}>
            <header className={index === 0 ? 'related-pane-heading' : 'related-pane-heading related-secondary'}>
              <strong>{title} · {row.case_number}</strong>
              <span>{side === 'pap' ? 'Pap' : 'Tissue Biopsy'} · Specimen {row.specimen_number}</span>
            </header>
            <ImageViewport scan={{ id: row.id, source: 'clinical', format: row.format }} label={row.label} stain={row.stain}
              readOnlyEndpoint={`${endpoint}/wsi/${side}`} />
          </section>;
        })}</div>}
  </section>;
}
