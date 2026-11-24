import { GitCompareArrows } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

const RelatedCasesDialog = lazy(() => import('./related-cases'));

export function RelatedCasesControl({ endpoint, caseId, scanId, compact }: { endpoint: string; caseId: string; scanId?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={compact ? 'icon-button' : 'button secondary'} aria-label="Related Pap and Biopsy Cases"
      title="Related Pap and Biopsy Cases" onClick={() => setOpen(true)}>
      {compact ? <GitCompareArrows size={17} /> : 'Related Pap and Biopsy Cases'}
    </button>
    {open && <Suspense fallback={<span role="status">Loading related cases…</span>}>
      <RelatedCasesDialog endpoint={endpoint} caseId={caseId} scanId={scanId} onClose={() => setOpen(false)} />
    </Suspense>}
  </>;
}
