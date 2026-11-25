import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DemoCase } from './demo';
import { api, jsonBody } from './session';
import { formatIntakeDate } from './intake-api';
import { EnglishDateField } from './english-date-field';

function localDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function CaseDates({ item, organization, editable, onChanged }: {
  item: DemoCase; organization: string; editable: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const data = item.worklist;
  const path = '/api/clinical/' + encodeURIComponent(organization);

  async function save(event: FormEvent<HTMLFormElement>, endpoint: string, version: number, field: string) {
    event.preventDefault();
    const entry = new FormData(event.currentTarget).get('date') as string;
    const value = entry && field === 'accessioned_at' ? new Date(entry.replace(' ', 'T')).toISOString() : entry || null;
    setBusy(true); setError('');
    try {
      await api(path + endpoint, jsonBody('PATCH', { version, [field]: value }));
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save the date.');
    } finally { setBusy(false); }
  }

  return <details className="case-dates">
    <summary>Case and Specimen Dates</summary>
    {error && <p role="alert" className="form-error">{error}</p>}
    {editable && item.version ? <form key={'case-' + item.version} onSubmit={(event) =>
      void save(event, '/cases/' + item.recordId + '/accessioned-at', item.version!, 'accessioned_at')}>
      <EnglishDateField label="Accession Time (Browser Time Zone)" name="date" defaultValue={localDateTime(data?.accessioned_at)} withTime />
      <button className="button secondary" disabled={busy}>Save Accession Time</button>
    </form> : <p>Accessioned At: {data?.accessioned_at ? formatIntakeDate(data.accessioned_at) : 'Not Recorded'}</p>}
    {data?.specimens?.map((specimen) => editable ? <form key={specimen.id + ':' + specimen.version} onSubmit={(event) =>
      void save(event, '/specimens/' + specimen.id + '/collection-date', specimen.version, 'collection_date')}>
      <EnglishDateField label={`${specimen.number} Collection Date`} name="date" defaultValue={specimen.collection_date ?? ''} />
      <button className="button secondary" disabled={busy}>Save Collection Date</button>
    </form> : <p key={specimen.id}>{specimen.number} Collection Date: {specimen.collection_date ?? 'Not Recorded'}</p>)}
  </details>;
}
