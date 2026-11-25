import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Activity, FileText, CheckCircle2, CircleDashed, Columns3, Files, FolderOpen, PanelRightClose, PanelRightOpen, Plus, ScanLine, Search, UserRoundCheck, X } from 'lucide-react';
import { readyCount, statuses } from './demo';
import type { CaseStatus, DemoCase, Slide } from './demo';
import type { Assignee, Counts, WorklistQuery } from './worklist-api';

import { columns, defaultColumns, defaultOrder, loadLegacyColumns, normalizeColumns } from './worklist-config';
import type { ColumnSetting, Preferences, Scope, ViewConfig } from './worklist-config';
import { SavedViewControls, SortControls, useSavedViews } from './worklist-preferences';
import { stateLabel, states } from './worklist-api';
import { QueueNavigation, Workload } from './workgroups';
import type { AssignmentLoad, Queue } from './workgroups';
import { MoreFilters, normalizeFilters } from './worklist-filters';
import type { AdvancedFilters } from './worklist-filters';

import { ColumnPicker, StatusLabel, columnValue } from './worklist-columns';
import { WorkspaceTabs } from './workspace-tabs';
import { WorklistColumnPreview } from './worklist-column-preview';

export { StatusLabel } from './worklist-columns';
export type { Scope } from './worklist-config';

export function slideEndpoint(scan: NonNullable<Slide['wsi']>) {
  return `/api/wsi/${scan.source}/${scan.id}`;
}

export function ScanReference({ scan }: { scan?: Slide['wsi'] }) {
  return scan ? <small className="scan-reference" title={`Scan ID ${scan.id}`}>Scan {scan.id.slice(0, 8)}</small> : null;
}

export function SlidePreview({ slide }: { slide: Slide }) {
  const [failed, setFailed] = useState(false);
  return slide.wsi && !failed
    ? <img src={slideEndpoint(slide.wsi) + '/overview.jpeg?size=160'} loading="lazy" alt="" onError={() => setFailed(true)} />
    : <ScanLine size={24} aria-hidden="true" />;
}

const previewTabs = [
  { key: 'slides', label: 'Slides', icon: ScanLine },
  { key: 'case', label: 'Case Summary', icon: FileText },
  { key: 'review', label: 'Review', icon: Activity },
] as const;
type PreviewTab = typeof previewTabs[number]['key'];

type Props = {
  navigation?: ReactNode;
  cases: DemoCase[];
  loading: boolean;
  total: number;
  counts: Counts;
  filteredCounts?: Counts['statuses'];
  queues: Queue[];
  workload?: AssignmentLoad[] | null;
  onQueueChanged: () => Promise<void>;
  assignees: Assignee[];
  onQuery: (query: WorklistQuery) => void;
  scope: Scope;
  onScope: (scope: Scope) => void;
  mayShare: boolean;
  current: DemoCase | undefined;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  canReportFrozen?: boolean;
  onViewer: (id: string, slide?: string) => void;
  onRegister?: () => void;
  onReference?: (item: DemoCase) => void;
};

export function Worklist({ navigation, cases, loading, total, counts, filteredCounts, queues, workload, onQueueChanged, assignees, onQuery, scope, onScope, mayShare, current, onSelect, onOpen, onViewer, onRegister, canReportFrozen, onReference }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [assignee, setAssignee] = useState('');
  const [filters, setFilters] = useState<AdvancedFilters>({});
  const [order, setOrder] = useState(defaultOrder);
  const [offset, setOffset] = useState(0);
  const [columnSettings, setColumnSettings] = useState(defaultColumns);
  const [showColumnPreview, setShowColumnPreview] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('slides');
  const [previewVisible, setPreviewVisible] = useState(true);
  const edited = useRef(false);
  const shownColumns = columnSettings.filter(({ visible }) => visible).map(({ id }) => columns.find((column) => column.id === id)!);
  const apply = useCallback((configuration: ViewConfig | undefined, base: Preferences, restoreScope = true, startup = false) => {
    if (startup && edited.current) return;
    const columns = configuration?.columns ?? base.columns;
    setColumnSettings(columns ? normalizeColumns(columns) : defaultColumns);
    setOrder(configuration?.order ?? base.sort_order ?? defaultOrder);
    if (startup && !configuration) return;
    setSearch(configuration?.q ?? '');
    setStatus(stateLabel(configuration?.status ?? '') ?? '');
    setAssignee(configuration?.assigned_to ?? '');
    setFilters(normalizeFilters(configuration?.filters));
    setColumnSearch('');
    setOffset(0);
    if (restoreScope) onScope(configuration?.scope ?? 'all');
    return true;
  }, [onScope]);
  const saved = useSavedViews(scope, apply);
  const configuration: ViewConfig = { scope, q: search, status: status ? states[status] : null,
    assigned_to: assignee || null, order, filters, columns: columnSettings };
  useEffect(() => setOffset(0), [scope]);
  useEffect(() => onQuery({ q: search, status, assignee, order, filters, offset }), [search, status, assignee, order, filters, offset, onQuery]);

  const selected = cases.find(({ id }) => current?.id === id) ?? cases[0];
  const metrics = [
    { label: 'All Cases', count: filteredCounts ? Object.values(filteredCounts).reduce((total, count) => total + count, 0) : counts.all, icon: Files, tone: 'violet', value: '' },
    { label: 'Awaiting Assignment', count: (filteredCounts ?? counts.statuses).registered, icon: CircleDashed, tone: 'amber', value: 'Awaiting Assignment' },
    { label: 'In Review', count: (filteredCounts ?? counts.statuses).in_review, icon: UserRoundCheck, tone: 'blue', value: 'In Review' },
    { label: 'Review Complete', count: (filteredCounts ?? counts.statuses).reviewed, icon: CheckCircle2, tone: 'green', value: 'Review Complete' },
  ] as const;

  const activeQueue = queues.find((queue) => queue.priority && queue.priority === filters.priority)?.key
    ?? queues.find((queue) => queue.group_key && queue.group_key === filters.group_key)?.key;

  function selectQueue(queue?: Queue) {
    edited.current = true;
    clearFilters();
    setFilters(normalizeFilters({ group_key: queue?.group_key, priority: queue?.priority }));
    if (queue) onScope('all');
    setOrder(queue?.priority ? [{ field: 'priority', direction: 'asc' }, { field: 'created_at', direction: 'desc' }]
      : saved.preferences.sort_order ?? defaultOrder);
  }

  function clearFilters() {
    setSearch(''); setStatus(''); setAssignee(''); setFilters({}); setOffset(0);
  }

  return <>
    <section className="panel worklist-masthead">
    <div className="page-heading worklist-heading"><div className="worklist-title"><span className="workspace-title-icon"><Files size={22} /></span><h1>Worklist</h1></div>
      <div className="actions">
        <button type="button" className="button secondary" onClick={() => setShowColumnPreview(true)}><Columns3 size={16} /> Column Preview</button>
        <button type="button" className="button secondary" aria-controls="worklist-preview" aria-expanded={previewVisible}
          onClick={() => setPreviewVisible(!previewVisible)}>
          {previewVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          {previewVisible ? 'Hide Case Preview' : 'Show Case Preview'}
        </button>
        {onRegister && <button className="button primary" onClick={onRegister}><Plus size={17} /> Register Case</button>}
      </div>
    </div>
    {navigation}
    </section>
    {showColumnPreview && <WorklistColumnPreview currentColumns={columnSettings} onClose={() => setShowColumnPreview(false)}
      onApply={(settings) => { edited.current = true; setColumnSettings(settings); setShowColumnPreview(false); }} />}
    <QueueNavigation queues={queues} active={activeQueue} isAdmin={mayShare} onSelect={selectQueue} onChanged={onQueueChanged} />
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
          <SortControls order={order} onChange={(value) => { setOrder(value); setOffset(0); }}
            onReset={() => { setOrder(saved.preferences.sort_order ?? defaultOrder); setOffset(0); }}
            onSave={() => saved.saveOrder(order)} busy={saved.busy || !saved.ready}
            onClear={saved.preferences.sort_order ? () => saved.saveOrder(null) : undefined} />
          <details className="column-menu"><summary className="button secondary"><Columns3 size={15} /> Columns</summary><div className="column-options">
            <ColumnPicker settings={columnSettings} search={columnSearch} onSearch={setColumnSearch} onChange={setColumnSettings} />
            <button className="button secondary" onClick={() => { setColumnSettings(defaultColumns); setColumnSearch(''); }}>Restore Default Columns</button>
            <button className="button secondary" onClick={() => setColumnSettings(loadLegacyColumns())}>Import Previous Browser Columns</button>
            <button className="button secondary" disabled={saved.busy || !saved.ready} onClick={() => saved.saveColumns(columnSettings)}>Save My Default Columns</button>
          </div></details>
        </div>
        {workload && <Workload rows={workload} />}
        <MoreFilters filters={filters} queues={queues} onApply={(value) => { edited.current = true; setFilters(value); setOffset(0); }} />
        <div className="table-scroll"><table><thead><tr><th scope="col">Case ID</th>{shownColumns.map(({ id, label }) => <th scope="col" key={id}>{label}</th>)}<th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{cases.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : undefined} onClick={() => onSelect(item.id)}>
            <td><button className="case-id" onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} aria-pressed={selected?.id === item.id}>{item.id}</button>{item.worklist?.priority && !shownColumns.some(({ id }) => id === 'priority') && <span className="case-priority-inline">{columnValue(item, 'priority')}</span>}</td>
            {shownColumns.map(({ id }) => <td className="nowrap" key={id}>{columnValue(item, id)}</td>)}
            <td><button className="icon-button" aria-label={`${item.id} details`} onClick={(event) => { event.stopPropagation(); onOpen(item.id); }}><ArrowRight size={16} /></button></td>
          </tr>)}</tbody></table></div>
        {!cases.length && <div className="empty"><FolderOpen size={28} />
          <strong>{loading ? 'Loading case…' : (search || status || assignee || Object.keys(filters).length) ? 'No cases match these filters.' : scope === 'mine' ? 'No cases are assigned to you.' : scope === 'unassigned' ? 'There are no unassigned cases.' : 'No cases are available.'}</strong>
          {!loading && (search || status || assignee || Object.keys(filters).length) && <button className="button secondary" onClick={clearFilters}>Clear Filters</button>}
        </div>}
        <footer className="table-footer"><span>{total} total · Showing {cases.length ? offset + 1 : 0}–{offset + cases.length} cases</span>
          {(offset > 0 || total > 50) && <div className="actions"><button className="button secondary" disabled={loading || offset === 0} onClick={() => setOffset(offset - 50)}>Previous</button><button className="button secondary" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Next</button></div>}
        </footer>
      </section>
      <aside className="panel case-preview" id="worklist-preview" aria-label="Selected Case Preview" hidden={!previewVisible}>
        <div className="panel-title"><h2>Case Preview</h2><ScanLine size={18} className="muted" /></div>
        {selected ? <div className="preview-content">
          <div className="preview-heading"><strong>{selected.id}</strong><StatusLabel status={selected.status} />{selected.worklist?.priority && columnValue(selected, 'priority')}</div>
          <WorkspaceTabs label="Case Preview Workspace" tabs={previewTabs} active={previewTab} onSelect={setPreviewTab} panelId="worklist-preview-panel" />
          <div id="worklist-preview-panel" role="tabpanel" aria-labelledby={'worklist-preview-panel-tab-' + previewTab}>
          {previewTab === 'slides' && <>
            <div className="preview-label"><h3>Slides</h3><span>{selected.source === 'files' ? `${selected.slides.length} files registered` : `${readyCount(selected)}/${selected.slides.length} Viewable`}</span></div>
            {selected.slides.length ? <div className="preview-slides">{selected.slides.map((slide) => <button key={slide.id} className="slide-preview" data-scan-id={slide.wsi?.id} title={slide.state} disabled={!slide.wsi} onClick={() => onViewer(selected.id, slide.id)}>
              <span className="slide-image"><SlidePreview slide={slide} /></span><span className="preview-scan-meta"><strong>{slide.label ?? slide.id}</strong>
              <span>{slide.stain} · {slide.wsi?.format ?? slide.state}</span><ScanReference scan={slide.wsi} /></span><ArrowRight size={14} className="preview-scan-arrow" />
            </button>)}</div> : <p className="empty-inline">No slides are linked to this case.</p>}
          </>}
          {previewTab === 'case' && <dl className="key-values">
            <div><dt>Specimen</dt><dd>{columnValue(selected, 'specimen')}</dd></div><div><dt>Assignee</dt><dd>{columnValue(selected, 'assignee')}</dd></div>
            <div><dt>Patient Name</dt><dd>{columnValue(selected, 'patient')}</dd></div><div><dt>Patient ID</dt><dd>{columnValue(selected, 'mrn')}</dd></div>
            <div><dt>Accessioned At</dt><dd>{columnValue(selected, 'received')}</dd></div><div><dt>Collection Date</dt><dd>{columnValue(selected, 'collected')}</dd></div>
          </dl>}
          {previewTab === 'review' && <dl className="key-values">
            <div><dt>Slide Status</dt><dd>{columnValue(selected, 'slideState')}</dd></div><div><dt>LIS Case Status</dt><dd>{columnValue(selected, 'lis')}</dd></div>
            <div><dt>Workgroup</dt><dd>{columnValue(selected, 'group')}</dd></div><div><dt>Requests</dt><dd>{columnValue(selected, 'requests')}</dd></div>
            <div><dt>Last Opened</dt><dd>{columnValue(selected, 'lastOpened')}</dd></div><div><dt>Latest Review Note</dt><dd>{columnValue(selected, 'notes')}</dd></div>
          </dl>}
          </div>
          <div className="preview-footer-actions">
          {canReportFrozen && selected.recordId && selected.worklist?.priority === 'frozen' &&
            <a className="button secondary full" href={`#case/${selected.recordId}/frozen`}>Frozen Report</a>}
          {onReference && selected.recordId && <button className="button secondary full" onClick={() => onReference(selected)}>Add to Collection or Board</button>}
          <button className="button primary full" onClick={() => onOpen(selected.id)}>Open Case Details <ArrowRight size={16} /></button>
          {readyCount(selected) > 0 && <button className="button secondary full" onClick={() => onViewer(selected.id)}><ScanLine size={16} /> Open Viewer</button>}
          </div>
        </div> : <p className="empty-inline">Select a case from the list.</p>}
      </aside>
    </div>
  </>;
}
