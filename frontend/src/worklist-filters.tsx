import { useEffect, useState } from 'react';
import { priorityLabels } from './workgroups';
import type { Priority, Queue } from './workgroups';
import { ListFilter, X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { EnglishDateField } from './english-date-field';

export const dateFields = {
  accessioned_at: 'Accessioned At', created_at: 'Registered At',
  collection_date: 'Collection Date', last_opened: 'Last Opened',
} as const;
export const sexLabels = { female: 'Female', male: 'Male', intersex: 'Intersex', other: 'Other', unknown: 'Unknown' };
export const slideStates = { viewable: 'Viewable', missing_scan: 'Missing Scan', no_slides: 'No Slides', qc_blocked: 'QC Blocked' };
export const openedOptions = { unopened: 'Unopened', today: 'Today', last_2_days: 'Last 2 Days', last_7_days: 'Last 7 Days' };
const ageOptions = { available: 'Recorded', missing: 'Not Recorded' };
const lisOptions = { available: 'Available', missing: 'Not Available', conflict: 'Conflicting Sources' };
const sexOptions = { ...sexLabels, missing: 'Not Recorded' };

export type AdvancedFilters = {
  group_key?: string; priority?: Priority | 'unset';
  patient_name?: string; patient_id?: string; sex?: keyof typeof sexOptions;
  specimen?: string; slide_id?: string; slide_state?: keyof typeof slideStates;
  lis_status?: string; lis_data?: keyof typeof lisOptions;
  age_min?: number; age_max?: number; age_data?: keyof typeof ageOptions;
  date_field?: keyof typeof dateFields; date_from?: string; date_to?: string; opened?: keyof typeof openedOptions;
};

export function normalizeFilters(values: AdvancedFilters | undefined): AdvancedFilters {
  const entries = Object.entries(values ?? {}).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]);
  const filters = Object.fromEntries(entries.filter(([, value]) => value != null && value !== ''));
  if (!filters.date_from && !filters.date_to) delete filters.date_field;
  return filters;
}


const textInputs = [
  { key: 'patient_name', label: 'Patient Name' }, { key: 'patient_id', label: 'MRN or Local Patient ID' },
  { key: 'specimen', label: 'Specimen' }, { key: 'slide_id', label: 'Slide ID' }, { key: 'lis_status', label: 'LIS Case Status' },
];
const selects = [
  { key: 'sex', label: 'Sex', options: sexOptions },
  { key: 'slide_state', label: 'Slide Status', options: slideStates },
  { key: 'lis_data', label: 'LIS Status Availability', options: lisOptions },
  { key: 'age_data', label: 'Age Availability', options: ageOptions },
  { key: 'opened', label: 'Recent Activity', options: openedOptions },
];

function rangeLabel(from: number | string | undefined, to: number | string | undefined) {
  return from != null && to != null ? `${from}–${to}` : from != null ? `≥ ${from}` : `≤ ${to}`;
}

export function MoreFilters({ filters, queues, onApply, toolbar, clearAll }: {
  filters: AdvancedFilters; queues: Queue[]; onApply: (value: AdvancedFilters) => void; toolbar: ReactNode; clearAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilters>(filters);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(filters); setError(''); }, [filters]);

  function apply(event: FormEvent) {
    event.preventDefault();
    const { age_min, age_max, age_data, date_from, date_to, date_field, opened, lis_status, lis_data } = draft;
    if (age_min != null && age_max != null && age_min > age_max) return setError('Minimum age must not exceed maximum age.');
    if (date_from && date_to && date_from > date_to) return setError('Start date must not be after end date.');
    if (age_data === 'missing' && (age_min != null || age_max != null)) return setError('Clear the age range to find cases without a recorded age.');
    if (lis_status && (lis_data === 'missing' || lis_data === 'conflict')) return setError('Clear the LIS status to search for missing or conflicting data.');
    if (opened === 'unopened' && date_field === 'last_opened' && (date_from || date_to)) return setError('Clear the last-opened date range to find unopened cases.');
    onApply(normalizeFilters(draft));
    setOpen(false);
  }

  function set(key: string, value: string | number | undefined) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
  }

  const chips: { keys: string[]; label: string }[] = [];
  for (const { key, label } of textInputs) {
    const value = filters[key as keyof AdvancedFilters];
    if (value) chips.push({ keys: [key], label: `${label}: ${value}` });
  }
  const groupOptions = Object.fromEntries(queues.filter((queue) => queue.group_key).map((queue) => [queue.group_key!, queue.name]));
  const extraSelects = [{ key: 'group_key', label: 'Workgroup', options: groupOptions },
    { key: 'priority', label: 'Priority', options: { ...priorityLabels, unset: 'Not Set' } }];
  for (const { key, label, options } of [...selects, ...extraSelects]) {
    const value = filters[key as keyof AdvancedFilters];
    if (typeof value === 'string') chips.push({ keys: [key], label: `${label}: ${((options as Record<string, string>)[value] ?? value)}` });
  }
  if (filters.age_min != null || filters.age_max != null) {
    chips.push({ keys: ['age_min', 'age_max'], label: 'Age at Collection: ' + rangeLabel(filters.age_min, filters.age_max) });
  }
  if (filters.date_from || filters.date_to) {
    chips.push({ keys: ['date_from', 'date_to', 'date_field'], label: dateFields[filters.date_field ?? 'accessioned_at'] + ': ' + rangeLabel(filters.date_from, filters.date_to) });
  }

  return <>
    <div className="advanced-filter-bar" role="group" aria-label="Worklist Search and Filters">
      {toolbar}
      <button type="button" className="button secondary" aria-expanded={open} aria-controls="worklist-advanced-filters"
        onClick={() => { setDraft(filters); setError(''); setOpen(!open); }}>
        <ListFilter size={16} /> More Filters{chips.length > 0 && <span className="count">{chips.length}</span>}
      </button>
      {clearAll && <button type="button" className="button secondary" onClick={() => { clearAll(); setOpen(false); }}>Clear Filters</button>}
    </div>
    {chips.length > 0 && <div className="worklist-filter-chips" aria-label="Applied Advanced Filters">
      {chips.map(({ keys, label }) => <button type="button" key={keys[0]} className="filter-chip" aria-label={'Remove ' + label}
        onClick={() => onApply(Object.fromEntries(Object.entries(filters).filter(([key]) => !keys.includes(key))))}>{label}<X size={13} /></button>)}
    </div>}
    <form hidden={!open} id="worklist-advanced-filters" className="advanced-filter-form" onSubmit={apply}>
      <div className="advanced-filter-fields">
        {textInputs.map(({ key, label }) => <label className="form-field" key={key}>{label}
          <input maxLength={160} value={draft[key as keyof AdvancedFilters] ?? ''} onChange={(event) => set(key, event.target.value)} /></label>)}
        {[...extraSelects, ...selects].map(({ key, label, options }) => <label className="form-field" key={key}>{label}
          <select value={draft[key as keyof AdvancedFilters] ?? ''} onChange={(event) => set(key, event.target.value)}>
            <option value="">Any</option>{Object.entries(options).map(([value, display]) => <option key={value} value={value}>{display}</option>)}
          </select></label>)}
        {(['age_min', 'age_max'] as const).map((key) => <label className="form-field" key={key}>{key === 'age_min' ? 'Minimum Age at Collection' : 'Maximum Age at Collection'}
          <input type="number" min={0} max={150} value={draft[key] ?? ''} onChange={(event) => set(key, event.target.value === '' ? undefined : Number(event.target.value))} /></label>)}
        <label className="form-field">Date Field<select value={draft.date_field ?? 'accessioned_at'} onChange={(event) => set('date_field', event.target.value)}>
          {Object.entries(dateFields).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <EnglishDateField label="From Date" value={draft.date_from ?? ''} onValueChange={(value) => set('date_from', value)} />
        <EnglishDateField label="Through Date" value={draft.date_to ?? ''} onValueChange={(value) => set('date_to', value)} />
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="actions">
        <button className="button primary">Apply Filters</button>
        <button type="button" className="button secondary" onClick={() => { onApply({}); setOpen(false); }}>Clear Advanced Filters</button>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>Close Filters</button>
      </div>
    </form>
  </>;
}
