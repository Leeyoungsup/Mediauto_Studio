import { GitCompareArrows } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

const RelatedCasesDialog = lazy(() => import('./related-cases'));

export function RelatedCasesControl({ endpoint, caseId, scanId, compact, fromPapReview }: { endpoint: string; caseId: string; scanId?: string; compact?: boolean; fromPapReview?: boolean }) {
  const [open, setOpen] = useState(false);
  const label = fromPapReview ? 'Compare Related Biopsy' : 'Related Pap and Biopsy Cases';
  return <>
    <button type="button" className={compact ? 'icon-button' : 'button secondary'} aria-label={label}
      title={label} onClick={() => setOpen(true)}>
      {compact ? <GitCompareArrows size={17} /> : label}
    </button>
    {open && <Suspense fallback={<span role="status">Loading related cases…</span>}>
      <RelatedCasesDialog endpoint={endpoint} caseId={caseId} scanId={scanId} fromPapReview={fromPapReview} onClose={() => setOpen(false)} />
    </Suspense>}
  </>;
}
