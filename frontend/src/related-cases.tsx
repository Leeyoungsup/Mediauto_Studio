import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api, auditAttemptId, jsonBody } from './session';

export type Scan = {
  id: string; case_id: string; case_number: string; specimen_id: string; specimen_number: string;
  label: string; stain: string; format: 'NDPI' | 'SVS'; type: 'pap' | 'he'; token: string;
};
type Side = Pick<Scan, 'case_id' | 'case_number' | 'specimen_id'> & { scan_id: string };
type Link = { id: string; version: number; status: 'revoked' | 'confirmed' | 'unavailable'; pap: Side; biopsy: Side;
  reason: string; approved_at: string; approved_by: string; revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null };
type Feed = { status: 'patient_required' | 'available'; sources: Scan[]; candidates: Scan[]; links: Link[] };
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const label = (scan: Scan) => `${scan.case_number} · Specimen ${scan.specimen_number} · ${scan.label} · ${scan.stain} ${scan.format}`;
const reference = (scan: Scan) => ({ case_id: scan.case_id, specimen_id: scan.specimen_id, scan_id: scan.id, token: scan.token });
const statusText = { revoked: 'Unlinked', confirmed: 'Confirmed', unavailable: 'Reconciliation Required' };

export default function RelatedCasesDialog({ endpoint, caseId, scanId, onClose }: {
  endpoint: string; caseId: string; scanId?: string; onClose: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Feed>();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sourceId, setSource] = useState(scanId ?? '');
  const [targetId, setTarget] = useState('');
  const [patientConfirmed, setPatient] = useState(false);
  const [biopsyConfirmed, setBiopsy] = useState(false);
  const [reason, setReason] = useState('');
  const [revoking, setRevoking] = useState<Link>();
  const [revokeReason, setRevokeReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ serialized: string; id: string }>(undefined);
  const source = data?.sources.find((item) => item.id === sourceId);
  const options = source ? data?.candidates.filter((item) => item.type !== source.type) ?? [] : [];
  const target = options.find((item) => item.id === targetId);
  const base = endpoint.split('/cases/')[0];

  useEffect(() => { modal.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    api<Feed>(endpoint + '?' + new URLSearchParams({ q: query }), { signal: controller.signal }).then((feed) => {
      if (controller.signal.aborted) return;
      setData(feed);
      setSource((current) => feed.sources.some((item) => item.id === current) ? current : feed.sources[0]?.id ?? '');
      setTarget('');
      setPatient(false);
      setBiopsy(false);
      setBusy(false);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) { setError(error.message); setBusy(false); }
    });
    return () => controller.abort();
  }, [endpoint, query, attempt]);

  async function confirm() {
    if (!source || !target || !reason.trim() || busy) return;
    const payload = { source: reference(source), target: reference(target), patient_confirmed: patientConfirmed,
      biopsy_confirmed: biopsyConfirmed, reason: reason.trim() };
    const serialized = JSON.stringify(payload);
    if (request.current?.serialized !== serialized) request.current = { serialized, id: auditAttemptId() };
    setBusy(true);
    setError('');
    try {
      await api(endpoint, jsonBody('POST', { ...payload, request_key: request.current.id }));
      setReason('');
      setAttempt((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to confirm the comparison link.');
      setBusy(false);
    }
  }

  async function unlink() {
    if (!revoking || !revokeReason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(base + '/related-comparisons/' + revoking.id + '/revoke', jsonBody('POST', {
        expected_version: revoking.version, reason: revokeReason.trim(),
      }));
      setRevoking(undefined);
      setRevokeReason('');
      setAttempt((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to unlink the comparison.');
      setBusy(false);
    }
  }

  function resetConfirmation() { setPatient(false); setBiopsy(false); }

  return <dialog ref={modal} className="patient-history-dialog related-cases-dialog" aria-labelledby="related-cases-heading"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="panel-title"><h2 id="related-cases-heading">Related Pap and Biopsy Cases</h2>
      <button className="icon-button" type="button" aria-label="Close Related Cases" onClick={onClose}><X size={18} /></button></div>
    <div className="dialog-content">
      {error && <p role="alert">{error} <button type="button" className="button secondary" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Reload</button></p>}
      {!data && busy && <p role="status">Checking related cases…</p>}
      {data?.status === 'patient_required' && <p>Link a verified patient to this case before reconciling related cases.</p>}
      {data?.status === 'available' && <>
        {!data.sources.length ? <p>This case has no eligible registered Pap or H&amp;E scan.</p> : <>
          <form className="related-fields" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}>
            <label className="form-field">Related Case ID Search<input value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} /></label>
            <button type="submit" className="button secondary" disabled={busy}>Find Related Cases</button>
          </form>
          <div className="related-fields">
            <label className="form-field">Source Scan<select value={source?.id ?? ''} disabled={busy} onChange={(event) => {
              setSource(event.target.value); setTarget(''); resetConfirmation();
            }}>{data.sources.map((item) => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label>
            <label className="form-field">Related Scan<select value={target?.id ?? ''} disabled={busy} onChange={(event) => {
              setTarget(event.target.value); resetConfirmation();
            }}><option value="">Select a scan</option>{options.map((item) => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label>
          </div>
          {!options.length && <p>No accessible matching Pap or biopsy scans for this patient.</p>}
          {target && source && <div className="related-confirm">
            <p>Both cases link to the same patient record.</p>
            <div className="actions">
              <a href={'#case/' + source.case_id} target="_blank" rel="noopener">Review Source Case</a>
              <a href={'#case/' + target.case_id} target="_blank" rel="noopener">Review Related Case</a>
            </div>
            <label><input type="checkbox" checked={patientConfirmed} disabled={busy} onChange={(event) => setPatient(event.target.checked)} /> I verified the patient match</label>
            <label><input type="checkbox" checked={biopsyConfirmed} disabled={busy} onChange={(event) => setBiopsy(event.target.checked)} /> I verified the selected H&amp;E specimen is a tissue biopsy</label>
            <label className="form-field">Link Reason<input value={reason} maxLength={240} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
            <button type="button" className="button primary" disabled={busy || !patientConfirmed || !biopsyConfirmed || !reason.trim()}
              onClick={() => void confirm()}>Confirm Related Link</button>
          </div>}
        </>}
      </>}
      {data && <section className="related-history" aria-label="Related Link History">
        <h3>Related Link History</h3>
        {!data.links.length && <p>No comparison links for this case.</p>}
        {data.links.map((link) => <article key={link.id}>
          <strong>Pap {link.pap.case_number} · Biopsy {link.biopsy.case_number}</strong>
          <p>{statusText[link.status]} · {link.approved_by} · {date.format(new Date(link.approved_at))}</p>
          <p>{link.reason}</p>
          {link.revoked_at && <p>Unlinked by {link.revoked_by} · {date.format(new Date(link.revoked_at))} · {link.revoke_reason}</p>}
          <div className="actions">
            {link.status === 'confirmed' && <a className="button secondary" href={`#related-comparison/${link.id}/${caseId}`}
              target="_blank" rel="noopener">Open Independent Comparison</a>}
            {link.status !== 'revoked' && <button className="button secondary" type="button" disabled={busy}
              onClick={() => { setRevoking(link); setRevokeReason(''); }}>Unlink</button>}
          </div>
          {revoking?.id === link.id && <div className="related-confirm">
            <label className="form-field">Unlink Reason<input value={revokeReason} maxLength={240} onChange={(event) => setRevokeReason(event.target.value)} /></label>
            <div className="actions">
              <button className="button primary" type="button" disabled={busy || !revokeReason.trim()} onClick={() => void unlink()}>Confirm Unlink</button>
              <button className="button secondary" type="button" disabled={busy} onClick={() => setRevoking(undefined)}>Cancel Unlink</button>
            </div>
          </div>}
        </article>)}
      </section>}
    </div>
  </dialog>;
}
