import { useState } from 'react';
import { api, jsonBody } from './session';
import type { DemoCase } from './demo';

export type PatientSelection = { id: string; version: number };
type Match = PatientSelection & { display_name: string | null; local_reference: string | null; birth_date: string | null };

export function PatientMatch({ organization, item, selected, onSelect }: {
  organization: string; item: DemoCase; selected?: PatientSelection;
  onSelect: (id: PatientSelection | undefined) => void;
}) {
  const [identifier, setIdentifier] = useState(item.patient?.localRef || item.patient?.number || '');
  const [match, setMatch] = useState<Match | null>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function search() {
    setBusy(true); setMatch(undefined); setError(''); onSelect(undefined);
    try {
      setMatch(await api<Match | null>(`/api/clinical/${encodeURIComponent(organization)}/editor/patients/match`,
        jsonBody('POST', { local_reference: identifier.trim() })));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Patient lookup failed.'); }
    finally { setBusy(false); }
  }
  return <div className="patient-match">
    <label className="form-field">Match by Local Patient ID
      <input value={identifier} maxLength={80} onChange={(event) => {
        setIdentifier(event.target.value); setMatch(undefined); onSelect(undefined);
      }} /></label>
    <button type="button" className="button secondary" disabled={busy || !identifier.trim()}
      onClick={() => void search()}>Find Existing Patient</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {match === null && <p role="status">No local patient matches this ID.</p>}
    {match && <>
      <dl className="key-values">
        <div><dt>Current Case / Intake</dt><dd>{item.patient?.name || 'Not Recorded'} · {item.patient?.localRef || item.patient?.number || 'No ID'} · {item.patient?.birth || 'No Date of Birth'}</dd></div>
        <div><dt>Local Patient Record</dt><dd>{match.display_name || 'Not Recorded'} · {match.local_reference} · {match.birth_date || 'No Date of Birth'}</dd></div>
      </dl>
      <label><input type="checkbox" checked={selected?.id === match.id}
        onChange={(event) => onSelect(event.target.checked ? { id: match.id, version: match.version } : undefined)} /> I verified this is the same patient</label>
    </>}
  </div>;
}
