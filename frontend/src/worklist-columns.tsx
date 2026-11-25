import { GripVertical, ArrowDown, ArrowUp, Layers3, Search } from 'lucide-react';
import { readyCount, statuses } from './demo';
import type { CaseStatus, DemoCase } from './demo';
import { columns } from './worklist-config';
import type { ColumnId, ColumnSetting } from './worklist-config';
import { priorityLabels } from './workgroups';
import { sexLabels, slideStates } from './worklist-filters';

export function StatusLabel({ status }: { status: CaseStatus }) {
  return <span className={`status-pill status-${statuses.indexOf(status)}`}><span />{status}</span>;
}

const worklistDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });

const stainLabels: Record<string, string> = {
  he: 'H&E', hne: 'H&E', her2: 'HER2', er: 'ER', pr: 'PR',
  erpr: 'ER / PR', prer: 'ER / PR', ki67: 'Ki-67', pdl1: 'PD-L1',
};
const codipaiSampleStains: Record<string, string> = { eb01: 'H&E', pd22: 'PD-L1' };

function listedStains(item: DemoCase) {
  const stains = new Map<string, string>();
  for (const slide of item.slides) {
    const label = slide.stain.trim();
    if (!label || label.toLowerCase() === 'not entered') continue;
    const key = label.toLowerCase().replace(/[^a-z0-9]/g, '');
    const labels = item.id.startsWith('CODIPAI-') && Object.hasOwn(codipaiSampleStains, key) ? codipaiSampleStains : stainLabels;
    const display = Object.hasOwn(labels, key) ? labels[key] : label;
    stains.set(display.toLowerCase(), display);
  }
  return [...stains.values()].join(' · ');
}

export function columnValue(item: DemoCase, id: ColumnId) {
  const data = item.worklist;
  const provenance = item.source === 'files' ? 'File Registration' : 'IMS Clinical Record';
  const blank = <span className="muted" title="Not recorded or not available">—<span className="sr-only">Not available</span></span>;
  const value = (text: string | number | null | undefined, source = provenance) =>
    text != null && text !== '' ? <span title={source}>{text}</span> : blank;
  const dateValue = (text: string | null | undefined, source: string) => value(text && worklistDate.format(new Date(text)), source);
  const synthetic = item.patient?.source === 'synthetic_demo';
  const patientSource = synthetic ? 'Synthetic Demo Metadata'
    : item.patient?.source === 'manual' ? 'Manual Patient Record' : item.patient?.source ?? provenance;
  switch (id) {
    case 'specimen': return item.specimen === 'Not Entered' ? blank : value(item.specimen);
    case 'assignee': return value(item.assignee || 'Unassigned', 'IMS Case Assignment');
    case 'status': return <span title="IMS Review Workflow"><StatusLabel status={item.status} /></span>;
    case 'slides': return <span className="slide-count" title={provenance}><Layers3 size={14} />{item.source === 'files' ? `${item.slides.length} files` : `${readyCount(item)}/${item.slides.length}`}</span>;
    case 'stains': return value(listedStains(item), `${provenance} · Registered slide stains`);
    case 'received': return dateValue(data?.accessioned_at, synthetic ? patientSource : 'Locally Entered Accession Time');
    case 'created': return dateValue(data?.created_at, item.source === 'files' ? 'File Registration Update' : 'IMS Registration Timestamp');
    case 'collected': return value(data?.collection_date, synthetic ? patientSource : 'Earliest Recorded Specimen Collection Date');
    case 'lastOpened': return dateValue(data?.last_opened, 'Your Last Case or Viewer Open');
    case 'patient': return value(item.patient?.name, patientSource);
    case 'mrn': return value(item.patient?.number, data?.mrns?.map(({ value, source }) => `${value}: ${source}`).join(' · ') || 'Linked External MRN');
    case 'localPatientId': return value(item.patient?.localRef, patientSource);
    case 'birth': return value(item.patient?.birth, patientSource);
    case 'sex': return value(item.patient?.sex ? sexLabels[item.patient.sex] : null, patientSource);
    case 'age': return value(data?.age, synthetic ? patientSource : 'Completed Years at Earliest Recorded Collection Date');
    case 'group': return value(data?.group_name, 'IMS Workgroup Classification');
    case 'priority': return data?.priority
      ? <span className={`priority-badge priority-${data.priority}`} title={data.priority_source === 'manual' ? 'Manual Classification' : 'IMS Classification'}>{priorityLabels[data.priority]}</span>
      : blank;
    case 'slideState': return value(data?.slide_state?.map((key) => slideStates[key]).join(' · '), provenance);
    case 'lis': return value(data?.lis_data === 'conflict' ? 'Conflicting Sources' : data?.lis_status,
      data?.lis_sources?.map(({ value, source, received_at }) => `${value} · ${source} · ${worklistDate.format(new Date(received_at))}`).join('; ') || 'No Linked LIS Status');
    case 'storage': return value(data?.has_storage ? 'Local WSI' : null, 'Registered Scan Location');
    case 'requests': return value(data?.request_count, 'IMS Case Requests');
    case 'notes': return value(data?.review_note, 'Latest IMS Review Note');
    case 'source': return synthetic ? value('Original WSI · Synthetic Case Fields') : value(provenance);
    default: return <span className="muted" title="Workflow not yet available">—<span className="sr-only">Not yet available</span></span>;
  }
}

export function ColumnPicker({ settings, search, onSearch, onChange }: {
  settings: ColumnSetting[]; search: string; onSearch: (search: string) => void; onChange: (settings: ColumnSetting[]) => void;
}) {
  function move(index: number, offset: number) {
    const next = [...settings];
    const [column] = next.splice(index, 1);
    next.splice(index + offset, 0, column);
    onChange(next);
  }

  return <>
    <label className="search-field"><Search size={14} /><input aria-label="Search Columns" placeholder="Search Columns"
      value={search} onChange={(event) => onSearch(event.target.value)} /></label>
    <div className="column-list">{settings.map(({ id, visible }, index) => {
      const label = columns.find((column) => column.id === id)!.label;
      if (!label.toLowerCase().includes(search.trim().toLowerCase())) return null;
      return <div className="column-row" key={id}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-mediauto-column')) event.preventDefault(); }}
        onDrop={(event) => {
          const source = event.dataTransfer.getData('application/x-mediauto-column');
          const from = settings.findIndex((column) => column.id === source);
          if (from < 0 || from === index) return;
          event.preventDefault();
          move(from, index - from);
        }}>
        <span className="column-drag-handle" title="Drag to reorder" aria-hidden="true" draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-mediauto-column', id);
            event.dataTransfer.effectAllowed = 'move';
          }}><GripVertical size={14} /></span>
        <label><input type="checkbox" checked={visible} onChange={() => onChange(settings.map((column) =>
          column.id === id ? { id, visible: !visible } : column))} />{label}</label>
        <button className="icon-button" aria-label={`${label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
        <button className="icon-button" aria-label={`${label} down`} disabled={index === settings.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
      </div>;
    })}</div>
  </>;
}
