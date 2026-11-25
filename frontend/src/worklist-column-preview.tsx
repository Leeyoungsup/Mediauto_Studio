import { useEffect, useRef, useState } from 'react';
import type { DemoCase } from './demo';
import { ColumnPicker, columnValue } from './worklist-columns';
import { columns, defaultColumns } from './worklist-config';
import type { ColumnSetting } from './worklist-config';

const accession = '2026-11-24T00:30:00Z';
const clinical: DemoCase = {
  id: 'SAMPLE-001', source: 'clinical', specimen: 'Gastric biopsy', assignee: 'Sample Pathologist',
  status: 'In Review', received: '', history: [],
  patient: { name: 'Sample Patient A', number: 'TEST-MRN-01', localRef: 'TEST-LOCAL-01', birth: '1975-11-23', sex: 'female', source: 'manual' },
  slides: [
    { id: 'sample-ndpi', label: 'A1', stain: 'H&E', specimen: 'A', state: 'Viewable',
      wsi: { id: 'sample-ndpi', source: 'clinical', format: 'NDPI' } },
    { id: 'sample-svs', label: 'A2', stain: 'PD-L1', specimen: 'A', state: 'Viewable',
      wsi: { id: 'sample-svs', source: 'clinical', format: 'SVS' } },
  ],
  worklist: {
    accessioned_at: accession, created_at: '2026-11-24T00:35:00Z', collection_date: '2026-11-23',
    last_opened: '2026-11-24T03:15:00Z', age: 51, priority: 'routine', priority_source: 'manual',
    group_name: 'Gastrointestinal', has_storage: true, slide_state: ['viewable'], request_count: 2,
    review_note: 'Sample review note', mrns: [{ value: 'TEST-MRN-01', source: 'Sample EMR' }],
    lis_data: 'available', lis_status: 'In Process',
    lis_sources: [{ value: 'In Process', source: 'Sample LIS', received_at: accession }],
  },
};

const samples: DemoCase[] = [
  clinical,
  { id: 'SAMPLE-002', source: 'clinical', specimen: 'Frozen margin', assignee: '', status: 'Awaiting Assignment',
    received: '', history: [], patient: null,
    slides: [
      { id: 'sample-hold', label: 'F1', stain: 'H&E', specimen: 'F', state: 'QC Hold' },
      { id: 'sample-missing', label: 'F2', stain: 'H&E', specimen: 'F', state: 'No scan registered' },
    ],
    worklist: { priority: 'frozen', priority_source: 'manual', slide_state: ['qc_blocked', 'missing_scan'], request_count: 0, has_storage: true } },
  { id: 'SAMPLE-003', source: 'clinical', specimen: 'Breast core biopsy', assignee: 'Sample Pathologist',
    status: 'Review Complete', received: '', history: [], patient: null,
    slides: ['H&E', 'HER2', 'ER', 'PR', 'Ki-67'].map((stain, index) => ({
      id: `sample-breast-${index}`, label: `B${index + 1}`, stain, specimen: 'B', state: 'No scan registered',
    })),
    worklist: { group_name: 'Breast', priority: 'urgent', slide_state: ['missing_scan'], lis_data: 'conflict',
      lis_sources: [{ value: 'Released', source: 'Sample LIS A', received_at: accession },
        { value: 'Pending', source: 'Sample LIS B', received_at: accession }] } },
  { id: 'SAMPLE-004', source: 'files', specimen: 'Not Entered', assignee: '', status: 'Awaiting Assignment',
    received: '', history: [], patient: null,
    slides: [{ id: 'sample-file', label: 'B1', stain: 'H&E', specimen: 'B', state: 'Viewable',
      wsi: { id: 'sample-file', source: 'files', format: 'SVS' } }],
    worklist: { created_at: accession, slide_state: ['viewable'], has_storage: true } },
];

const allColumns = columns.map(({ id }) => ({ id, visible: true }));

export function WorklistColumnPreview({ currentColumns, onApply, onClose }: {
  currentColumns: ColumnSetting[]; onApply: (settings: ColumnSetting[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(allColumns);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(samples[0]);
  const shown = settings.filter(({ visible }) => visible).map(({ id }) => columns.find((column) => column.id === id)!);
  useEffect(() => { dialog.current?.showModal(); }, []);

  function selectLayout(layout: ColumnSetting[]) {
    setSettings(layout);
    setSearch('');
  }

  return <dialog ref={dialog} className="column-preview-dialog" aria-labelledby="column-preview-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="preview-label"><h2 id="column-preview-title">Worklist Column Preview</h2>
      <button type="button" className="button secondary" onClick={onClose}>Close Preview</button></div>
    <p>Synthetic cases and slide metadata for checking column display. No records are saved.</p>
    <div className="actions column-preview-actions">
      <details className="column-menu"><summary className="button secondary">Test Columns</summary>
        <div className="column-options"><ColumnPicker settings={settings} search={search} onSearch={setSearch} onChange={setSettings} /></div>
      </details>
      <button type="button" className="button secondary" onClick={() => selectLayout(allColumns)}>Show All Columns</button>
      <button type="button" className="button secondary" onClick={() => selectLayout(defaultColumns)}>Restore Default Columns</button>
      <button type="button" className="button secondary" onClick={() => selectLayout(currentColumns)}>Use Current Worklist Columns</button>
      <button type="button" className="button primary" onClick={() => onApply(settings)}>Apply Columns to Worklist</button>
    </div>
    <div className="table-scroll" tabIndex={0} aria-label="Scrollable sample table">
      <table aria-label="Sample Worklist">
        <thead><tr><th scope="col">Case ID</th>{shown.map(({ id, label }) => <th scope="col" key={id}>{label}</th>)}</tr></thead>
        <tbody>{samples.map((item) => <tr key={item.id} className={selected.id === item.id ? 'selected-row' : undefined}>
          <td><button type="button" className="case-id" aria-pressed={selected.id === item.id} onClick={() => setSelected(item)}>{item.id}</button></td>
          {shown.map(({ id }) => <td className="nowrap" key={id}>{columnValue(item, id)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <section className="column-preview-case" aria-labelledby="sample-case-title">
      <h3 id="sample-case-title">{selected.id} · Slide Metadata</h3>
      {selected.slides.length ? <ul className="column-preview-slides">{selected.slides.map((slide) => <li key={slide.id}>
        <strong>{slide.label}</strong> · {slide.stain} · {slide.wsi && <>{slide.wsi.format} · </>}{slide.state}
      </li>)}</ul> : <p>No slides are linked to this sample.</p>}
    </section>
    <p className="muted">Hover over a value for its source. A dash indicates missing data. Tags and Comments are not connected to the Worklist yet.</p>
  </dialog>;
}
