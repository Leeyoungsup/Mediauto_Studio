import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, CircleDashed, Columns3, Files, FolderOpen, Layers3, PanelRightClose, PanelRightOpen, Plus, ScanLine, Search, UserRoundCheck, X } from 'lucide-react';
import { readyCount, statuses } from './demo';
import type { CaseStatus, DemoCase, Slide } from './demo';
import type { Assignee, Counts, WorklistQuery } from './worklist-api';

import { columns, defaultColumns, defaultOrder, loadLegacyColumns, normalizeColumns } from './worklist-config';
import type { ColumnId, ColumnSetting, Scope, SortTerm, ViewConfig } from './worklist-config';
import { SavedViewControls, SortControls, useSavedViews } from './worklist-preferences';
import { stateLabel, states } from './worklist-api';

export type { Scope } from './worklist-config';

export function StatusLabel({ status }: { status: CaseStatus }) {
  return <span className={`status-pill status-${statuses.indexOf(status)}`}><span />{status}</span>;
}

export function slideEndpoint(scan: NonNullable<Slide['wsi']>) {
  return `/api/wsi/${scan.source}/${scan.id}`;
}

export function SlidePreview({ slide }: { slide: Slide }) {
  const [failed, setFailed] = useState(false);
  return slide.wsi && !failed
    ? <img src={slideEndpoint(slide.wsi) + '/overview.jpeg?size=160'} loading="lazy" alt="" onError={() => setFailed(true)} />
    : <ScanLine size={24} aria-hidden="true" />;
}

function columnValue(item: DemoCase, id: ColumnId) {
  const blank = <span className="muted">—</span>;
  switch (id) {
    case 'specimen': return item.specimen;
    case 'assignee': return item.assignee || <span className="muted">Unassigned</span>;
    case 'status': return <StatusLabel status={item.status} />;
    case 'slides': return <span className="slide-count"><Layers3 size={14} />{item.source === 'files' ? `${item.slides.length} files` : `${readyCount(item)}/${item.slides.length}`}</span>;
    case 'received': return item.source === 'files' ? blank : item.received;
    case 'created': return item.received;
    case 'patient': return item.patient?.name || blank;
    case 'mrn': return item.patient?.number || blank;
    case 'birth': return item.patient?.birth || blank;
    case 'slideState': return item.slides.length ? [...new Set(item.slides.map(({ state }) => state))].join(' · ') : 'Unlinked';
    case 'storage': return item.source === 'files' ? 'Local Files' : blank;
    default: return blank;
  }
}

type Props = {
  cases: DemoCase[];
  loading: boolean;
  total: number;
  counts: Counts;
  assignees: Assignee[];
  onQuery: (query: WorklistQuery) => void;
  scope: Scope;
  onScope: (scope: Scope) => void;
  mayShare: boolean;
  current: DemoCase | undefined;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onViewer: (id: string, slide?: string) => void;
  onRegister?: () => void;
};

export function Worklist({ cases, loading, total, counts, assignees, onQuery, scope, onScope, mayShare, current, onSelect, onOpen, onViewer, onRegister }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [assignee, setAssignee] = useState('');
  const [order, setOrder] = useState(defaultOrder);
  const [offset, setOffset] = useState(0);
  const [columnSettings, setColumnSettings] = useState(defaultColumns);
  const [columnSearch, setColumnSearch] = useState('');
  const [previewVisible, setPreviewVisible] = useState(true);
  const edited = useRef(false);
  const shownColumns = columnSettings.filter(({ visible }) => visible).map(({ id }) => columns.find((column) => column.id === id)!);
  const apply = useCallback((configuration: ViewConfig | undefined, base: ColumnSetting[] | null, restoreScope = true, startup = false) => {
    if (startup && edited.current) return;
    const columns = configuration?.columns ?? base;
    setColumnSettings(columns ? normalizeColumns(columns) : defaultColumns);
    if (startup && !configuration) return;
    setSearch(configuration?.q ?? '');
    setStatus(stateLabel(configuration?.status ?? '') ?? '');
    setAssignee(configuration?.assigned_to ?? '');
    setOrder(configuration?.order ?? defaultOrder);
    setColumnSearch('');
    setOffset(0);
    if (restoreScope) onScope(configuration?.scope ?? 'all');
    return true;
  }, [onScope]);
  const saved = useSavedViews(scope, apply);
  const configuration: ViewConfig = { scope, q: search, status: status ? states[status] : null,
    assigned_to: assignee || null, order, columns: columnSettings };
  useEffect(() => setOffset(0), [scope]);
  useEffect(() => onQuery({ q: search, status, assignee, order, offset }), [search, status, assignee, order, offset, onQuery]);

  function moveColumn(index: number, offset: number) {
    const next = [...columnSettings];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setColumnSettings(next);
  }

  const selected = cases.find(({ id }) => current?.id === id) ?? cases[0];
  const metrics = [
    { label: 'All Cases', count: counts.all, icon: Files, tone: 'violet', value: '' },
    { label: 'Awaiting Assignment', count: counts.statuses.registered, icon: CircleDashed, tone: 'amber', value: 'Awaiting Assignment' },
    { label: 'In Review', count: counts.statuses.in_review, icon: UserRoundCheck, tone: 'blue', value: 'In Review' },
    { label: 'Review Complete', count: counts.statuses.reviewed, icon: CheckCircle2, tone: 'green', value: 'Review Complete' },
  ] as const;

  function clearFilters() {
    setSearch(''); setStatus(''); setAssignee(''); setOffset(0);
  }

  return <>
    <div className="page-heading worklist-heading"><h1>Worklist</h1>
      <div className="actions">
        <button type="button" className="button secondary" aria-controls="worklist-preview" aria-expanded={previewVisible}
          onClick={() => setPreviewVisible(!previewVisible)}>
          {previewVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          {previewVisible ? 'Hide Case Preview' : 'Show Case Preview'}
        </button>
        {onRegister && <button className="button primary" onClick={onRegister}><Plus size={17} /> Register Case</button>}
      </div>
    </div>
    <SavedViewControls controller={saved} configuration={configuration} mayShare={mayShare} />
    <div className="worklist-layout" data-preview={previewVisible}>
      <section className="panel worklist-panel" aria-label="Case List">
        <div className="panel-title worklist-panel-title">
          <div className="title-inline"><h2>{scope === 'mine' ? 'Assigned to Me' : scope === 'unassigned' ? 'Unassigned Cases' : 'Case List'}</h2><span className="count">{total}</span></div>
          <div className="metrics" role="group" aria-label="Case Summary">
            {metrics.map(({ label, count, icon: Icon, tone, value }) => <button key={label} className="metric"
              aria-pressed={status === value} onClick={() => { edited.current = true; setStatus(status === value ? '' : value); setOffset(0); }}>
              <span className={`metric-icon ${tone}`}><Icon size={14} /></span><span className="metric-value">{label}<strong>{count}</strong></span>
            </button>)}
          </div>
        </div>
        <div className="filters" onChangeCapture={() => { edited.current = true; }} onClickCapture={() => { edited.current = true; }}>
          <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} maxLength={80} placeholder="Search Case ID" aria-label="Search Cases" />{search && <button className="icon-button" aria-label="Clear Search" onClick={() => { setSearch(''); setOffset(0); }}><X size={15} /></button>}</label>
          <select aria-label="Filter by Review Status" value={status} onChange={(event) => { setStatus(event.target.value as CaseStatus | ''); setOffset(0); }}><option value="">All Statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="Filter by Assignee" value={assignee} onChange={(event) => { setAssignee(event.target.value); setOffset(0); }}><option value="">All Assignees</option>{assignee && !assignees.some(({ id }) => id === assignee) && <option value={assignee}>Saved Assignee</option>}{assignees.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select>
          <SortControls order={order} onChange={(value) => { setOrder(value); setOffset(0); }} />
          <details className="column-menu"><summary className="button secondary"><Columns3 size={15} /> Columns</summary><div className="column-options">
            <label className="search-field"><Search size={14} /><input aria-label="Search Columns" placeholder="Search Columns" value={columnSearch} onChange={(event) => setColumnSearch(event.target.value)} /></label>
            <div className="column-list">{columnSettings.map(({ id, visible }, index) => {
              const label = columns.find((column) => column.id === id)!.label;
              if (!label.toLowerCase().includes(columnSearch.trim().toLowerCase())) return null;
              return <div className="column-row" key={id}><label><input type="checkbox" checked={visible} onChange={() => setColumnSettings(columnSettings.map((column) => column.id === id ? { id, visible: !visible } : column))} />{label}</label>
                <button className="icon-button" aria-label={`${label} up`} disabled={index === 0} onClick={() => moveColumn(index, -1)}><ArrowUp size={14} /></button>
                <button className="icon-button" aria-label={`${label} down`} disabled={index === columnSettings.length - 1} onClick={() => moveColumn(index, 1)}><ArrowDown size={14} /></button></div>;
            })}</div><button className="button secondary" onClick={() => { setColumnSettings(defaultColumns); setColumnSearch(''); }}>Restore Default Columns</button>
            <button className="button secondary" onClick={() => setColumnSettings(loadLegacyColumns())}>Import Previous Browser Columns</button>
            <button className="button secondary" disabled={saved.busy || !saved.ready} onClick={() => saved.saveColumns(columnSettings)}>Save My Default Columns</button>
          </div></details>
        </div>
        <div className="table-scroll"><table><thead><tr><th scope="col">Case ID</th>{shownColumns.map(({ id, label }) => <th scope="col" key={id}>{label}</th>)}<th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{cases.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : undefined} onClick={() => onSelect(item.id)}>
            <td><button className="case-id" onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} aria-pressed={selected?.id === item.id}>{item.id}</button></td>
            {shownColumns.map(({ id }) => <td className="nowrap" key={id}>{columnValue(item, id)}</td>)}
            <td><button className="icon-button" aria-label={`${item.id} details`} onClick={(event) => { event.stopPropagation(); onOpen(item.id); }}><ArrowRight size={16} /></button></td>
          </tr>)}</tbody></table></div>
        {!cases.length && <div className="empty"><FolderOpen size={28} />
          <strong>{loading ? 'Loading case…' : (search || status || assignee) ? 'No cases match these filters.' : scope === 'mine' ? 'No cases are assigned to you.' : scope === 'unassigned' ? 'There are no unassigned cases.' : 'No cases are available.'}</strong>
          {!loading && (search || status || assignee) && <button className="button secondary" onClick={clearFilters}>Clear Filters</button>}
        </div>}
        <footer className="table-footer"><span>{total} total · Showing {cases.length ? offset + 1 : 0}–{offset + cases.length} cases</span>
          {(offset > 0 || total > 50) && <div className="actions"><button className="button secondary" disabled={loading || offset === 0} onClick={() => setOffset(offset - 50)}>Previous</button><button className="button secondary" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Next</button></div>}
        </footer>
      </section>
      <aside className="panel case-preview" id="worklist-preview" aria-label="Selected Case Preview" hidden={!previewVisible}>
        <div className="panel-title"><h2>Case Preview</h2><ScanLine size={18} className="muted" /></div>
        {selected ? <div className="preview-content">
          <div className="preview-heading"><strong>{selected.id}</strong><StatusLabel status={selected.status} /></div>
          <dl className="key-values"><div><dt>Specimen</dt><dd>{selected.specimen}</dd></div><div><dt>Assignee</dt><dd>{selected.assignee || 'Unassigned'}</dd></div><div><dt>Patient Information</dt><dd>{selected.patient?.number || (selected.patient ? 'Registered' : 'Not Entered')}</dd></div></dl>
          <div className="preview-label"><h3>Slides</h3><span>{selected.source === 'files' ? `${selected.slides.length} files registered` : `${readyCount(selected)}/${selected.slides.length} Viewable`}</span></div>
          {selected.slides.length ? <div className="preview-slides">{selected.slides.map((slide) => <button key={slide.id} className="slide-preview" disabled={!slide.wsi} onClick={() => onViewer(selected.id, slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><strong>{slide.label ?? slide.id}</strong><span>{slide.stain}{slide.wsi && ` · ${slide.wsi.format}`}</span>
          </button>)}</div> : <p className="empty-inline">No slides are linked to this case.</p>}
          <button className="button primary full" onClick={() => onOpen(selected.id)}>Open Case Details <ArrowRight size={16} /></button>
          {readyCount(selected) > 0 && <button className="button secondary full" onClick={() => onViewer(selected.id)}><ScanLine size={16} /> Open Viewer</button>}
        </div> : <p className="empty-inline">Select a case from the list.</p>}
      </aside>
    </div>
  </>;
}
