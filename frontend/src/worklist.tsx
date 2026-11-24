import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, CircleDashed, Columns3, Files, FolderOpen, Layers3, Plus, ScanLine, Search, UserRoundCheck, X } from 'lucide-react';
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
    case 'assignee': return item.assignee || <span className="muted">미배정</span>;
    case 'status': return <StatusLabel status={item.status} />;
    case 'slides': return <span className="slide-count"><Layers3 size={14} />{item.source === 'files' ? `${item.slides.length}개 파일` : `${readyCount(item)}/${item.slides.length}`}</span>;
    case 'received': return item.source === 'files' ? blank : item.received;
    case 'created': return item.received;
    case 'patient': return item.patient?.name || blank;
    case 'mrn': return item.patient?.number || blank;
    case 'birth': return item.patient?.birth || blank;
    case 'slideState': return item.slides.length ? [...new Set(item.slides.map(({ state }) => state))].join(' · ') : '미연결';
    case 'storage': return item.source === 'files' ? '로컬 파일' : blank;
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
    { label: '전체 케이스', count: counts.all, icon: Files, tone: 'violet', value: '' },
    { label: '배정 대기', count: counts.statuses.registered, icon: CircleDashed, tone: 'amber', value: '배정 대기' },
    { label: '검토 중', count: counts.statuses.in_review, icon: UserRoundCheck, tone: 'blue', value: '검토 중' },
    { label: '검토 완료', count: counts.statuses.reviewed, icon: CheckCircle2, tone: 'green', value: '검토 완료' },
  ] as const;

  function clearFilters() {
    setSearch(''); setStatus(''); setAssignee(''); setOffset(0);
  }

  return <>
    <div className="page-heading"><div><h1>Worklist</h1><p>케이스 배정과 슬라이드 검토 상태를 확인하세요.</p></div>
      {onRegister && <button className="button primary" onClick={onRegister}><Plus size={17} /> 케이스 등록</button>}
    </div>
    <SavedViewControls controller={saved} configuration={configuration} mayShare={mayShare} />
    <section className="metrics" aria-label="케이스 현황">
      {metrics.map(({ label, count, icon: Icon, tone, value }) => <button key={label} className="metric" aria-pressed={status === value} onClick={() => { edited.current = true; setStatus(status === value ? '' : value); setOffset(0); }}>
        <span className={`metric-icon ${tone}`}><Icon size={20} /></span><span className="metric-value"><span>{label}</span><strong>{count}</strong></span>
      </button>)}
    </section>
    <div className="worklist-layout">
      <section className="panel worklist-panel" aria-label="케이스 목록">
        <div className="panel-title"><div className="title-inline"><h2>{scope === 'mine' ? '내 배정 건' : scope === 'unassigned' ? '미배정 케이스' : '케이스 목록'}</h2><span className="count">{total}</span></div></div>
        <div className="filters" onChangeCapture={() => { edited.current = true; }} onClickCapture={() => { edited.current = true; }}>
          <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} maxLength={80} placeholder="Case ID 검색" aria-label="케이스 검색" />{search && <button className="icon-button" aria-label="검색어 지우기" onClick={() => { setSearch(''); setOffset(0); }}><X size={15} /></button>}</label>
          <select aria-label="검토 상태 필터" value={status} onChange={(event) => { setStatus(event.target.value as CaseStatus | ''); setOffset(0); }}><option value="">모든 상태</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="담당자 필터" value={assignee} onChange={(event) => { setAssignee(event.target.value); setOffset(0); }}><option value="">모든 담당자</option>{assignee && !assignees.some(({ id }) => id === assignee) && <option value={assignee}>저장된 담당자</option>}{assignees.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select>
          <SortControls order={order} onChange={(value) => { setOrder(value); setOffset(0); }} />
          <details className="column-menu"><summary className="button secondary"><Columns3 size={15} /> 열</summary><div className="column-options">
            <label className="search-field"><Search size={14} /><input aria-label="열 검색" placeholder="열 검색" value={columnSearch} onChange={(event) => setColumnSearch(event.target.value)} /></label>
            <div className="column-list">{columnSettings.map(({ id, visible }, index) => {
              const label = columns.find((column) => column.id === id)!.label;
              if (!label.toLowerCase().includes(columnSearch.trim().toLowerCase())) return null;
              return <div className="column-row" key={id}><label><input type="checkbox" checked={visible} onChange={() => setColumnSettings(columnSettings.map((column) => column.id === id ? { id, visible: !visible } : column))} />{label}</label>
                <button className="icon-button" aria-label={`${label} 위로`} disabled={index === 0} onClick={() => moveColumn(index, -1)}><ArrowUp size={14} /></button>
                <button className="icon-button" aria-label={`${label} 아래로`} disabled={index === columnSettings.length - 1} onClick={() => moveColumn(index, 1)}><ArrowDown size={14} /></button></div>;
            })}</div><button className="button secondary" onClick={() => { setColumnSettings(defaultColumns); setColumnSearch(''); }}>기본 열 복원</button>
            <button className="button secondary" onClick={() => setColumnSettings(loadLegacyColumns())}>기존 브라우저 열 가져오기</button>
            <button className="button secondary" disabled={saved.busy || !saved.ready} onClick={() => saved.saveColumns(columnSettings)}>내 기본 열 저장</button>
          </div></details>
        </div>
        <div className="table-scroll"><table><thead><tr><th scope="col">Case ID</th>{shownColumns.map(({ id, label }) => <th scope="col" key={id}>{label}</th>)}<th scope="col"><span className="sr-only">열기</span></th></tr></thead>
          <tbody>{cases.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : undefined} onClick={() => onSelect(item.id)}>
            <td><button className="case-id" onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} aria-pressed={selected?.id === item.id}>{item.id}</button></td>
            {shownColumns.map(({ id }) => <td className="nowrap" key={id}>{columnValue(item, id)}</td>)}
            <td><button className="icon-button" aria-label={`${item.id} 상세 열기`} onClick={(event) => { event.stopPropagation(); onOpen(item.id); }}><ArrowRight size={16} /></button></td>
          </tr>)}</tbody></table></div>
        {!cases.length && <div className="empty"><FolderOpen size={28} />
          <strong>{loading ? '케이스를 불러오는 중입니다.' : (search || status || assignee) ? '조건에 맞는 케이스가 없습니다.' : scope === 'mine' ? '내게 배정된 케이스가 없습니다.' : scope === 'unassigned' ? '미배정 케이스가 없습니다.' : '조회할 케이스가 없습니다.'}</strong>
          {!loading && (search || status || assignee) && <button className="button secondary" onClick={clearFilters}>필터 초기화</button>}
        </div>}
        <footer className="table-footer"><span>{total}건 중 {cases.length ? offset + 1 : 0}–{offset + cases.length}건 표시</span>
          {(offset > 0 || total > 50) && <div className="actions"><button className="button secondary" disabled={loading || offset === 0} onClick={() => setOffset(offset - 50)}>이전</button><button className="button secondary" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>다음</button></div>}
        </footer>
      </section>
      <aside className="panel case-preview" aria-label="선택한 케이스 미리보기">
        <div className="panel-title"><h2>케이스 미리보기</h2><ScanLine size={18} className="muted" /></div>
        {selected ? <div className="preview-content">
          <div className="preview-heading"><strong>{selected.id}</strong><StatusLabel status={selected.status} /></div>
          <dl className="key-values"><div><dt>검체</dt><dd>{selected.specimen}</dd></div><div><dt>담당자</dt><dd>{selected.assignee || '미배정'}</dd></div><div><dt>환자 정보</dt><dd>{selected.patient?.number || (selected.patient ? '등록됨' : '미입력')}</dd></div></dl>
          <div className="preview-label"><h3>슬라이드</h3><span>{selected.source === 'files' ? `${selected.slides.length}개 파일 등록` : `${readyCount(selected)}/${selected.slides.length} 열람 가능`}</span></div>
          {selected.slides.length ? <div className="preview-slides">{selected.slides.map((slide) => <button key={slide.id} className="slide-preview" disabled={!slide.wsi} onClick={() => onViewer(selected.id, slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><strong>{slide.label ?? slide.id}</strong><span>{slide.stain}</span>
          </button>)}</div> : <p className="empty-inline">연결된 슬라이드가 없습니다.</p>}
          <button className="button primary full" onClick={() => onOpen(selected.id)}>케이스 상세 열기 <ArrowRight size={16} /></button>
          {readyCount(selected) > 0 && <button className="button secondary full" onClick={() => onViewer(selected.id)}><ScanLine size={16} /> 뷰어 열기</button>}
        </div> : <p className="empty-inline">목록에서 케이스를 선택하세요.</p>}
      </aside>
    </div>
  </>;
}
