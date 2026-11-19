import { useState } from 'react';
import { ArrowDownWideNarrow, ArrowRight, CheckCircle2, CircleDashed, Columns3, Files, FolderOpen, Layers3, Plus, ScanLine, Search, UserRoundCheck, X } from 'lucide-react';
import { doctors, readyCount, statuses } from './demo';
import type { CaseStatus, DemoCase, Slide } from './demo';

const columns = [
  { id: 'specimen', label: '검체' }, { id: 'assignee', label: '담당자' },
  { id: 'status', label: '검토 상태' }, { id: 'slides', label: '슬라이드' }, { id: 'received', label: '접수 시각' },
] as const;
type ColumnId = typeof columns[number]['id'];

export type Scope = 'all' | 'mine' | 'unassigned';

export function StatusLabel({ status }: { status: CaseStatus }) {
  return <span className={`status-pill status-${statuses.indexOf(status)}`}><span />{status}</span>;
}

export function SlidePreview({ slide }: { slide: Slide }) {
  return slide.image ? <img src={slide.image} alt={`${slide.id} 조직 미리보기`} /> : <ScanLine size={24} aria-hidden="true" />;
}

type Props = {
  cases: DemoCase[];
  scope: Scope;
  current: DemoCase | undefined;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onViewer: (id: string, slide?: string) => void;
  onRegister: () => void;
};

export function Worklist({ cases, scope, current, onSelect, onOpen, onViewer, onRegister }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [assignee, setAssignee] = useState('');
  const [sort, setSort] = useState('recent');
  const [visible, setVisible] = useState<ColumnId[]>(columns.map(({ id }) => id));
  const matching = cases.filter((item) => {
    const matchesScope = scope === 'all' || (scope === 'mine' ? item.assignee === '병리의 A' : !item.assignee);
    const keyword = search.trim().toLowerCase();
    return matchesScope && (!status || item.status === status) && (!assignee || item.assignee === assignee)
      && (!keyword || `${item.id} ${item.specimen} ${item.patient?.number ?? ''}`.toLowerCase().includes(keyword));
  });
  if (sort === 'oldest') matching.sort((a, b) => a.received.localeCompare(b.received));
  if (sort === 'case') matching.sort((a, b) => a.id.localeCompare(b.id));
  const selected = matching.find(({ id }) => current?.id === id) ?? matching[0];
  const metrics = [
    { label: '전체 케이스', count: cases.length, icon: Files, tone: 'violet', value: '' },
    { label: '배정 대기', count: cases.filter((item) => item.status === '배정 대기').length, icon: CircleDashed, tone: 'amber', value: '배정 대기' },
    { label: '검토 중', count: cases.filter((item) => item.status === '검토 중').length, icon: UserRoundCheck, tone: 'blue', value: '검토 중' },
    { label: '검토 완료', count: cases.filter((item) => item.status === '검토 완료').length, icon: CheckCircle2, tone: 'green', value: '검토 완료' },
  ] as const;

  function clearFilters() {
    setSearch(''); setStatus(''); setAssignee('');
  }

  return <>
    <div className="page-heading"><div><h1>Worklist</h1><p>케이스 배정과 슬라이드 검토 상태를 확인하세요.</p></div>
      <button className="button primary" onClick={onRegister}><Plus size={17} /> 케이스 등록</button>
    </div>
    <section className="metrics" aria-label="케이스 현황">
      {metrics.map(({ label, count, icon: Icon, tone, value }) => <button key={label} className="metric" aria-pressed={status === value} onClick={() => setStatus(status === value ? '' : value)}>
        <span className={`metric-icon ${tone}`}><Icon size={20} /></span><span className="metric-value"><span>{label}</span><strong>{count}</strong></span>
      </button>)}
    </section>
    <div className="worklist-layout">
      <section className="panel worklist-panel" aria-label="케이스 목록">
        <div className="panel-title"><div className="title-inline"><h2>{scope === 'mine' ? '내 배정 건' : scope === 'unassigned' ? '미배정 케이스' : '케이스 목록'}</h2><span className="count">{matching.length}</span></div></div>
        <div className="filters">
          <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Case ID, 검체 또는 환자번호" aria-label="케이스 검색" />{search && <button className="icon-button" aria-label="검색어 지우기" onClick={() => setSearch('')}><X size={15} /></button>}</label>
          <select aria-label="검토 상태 필터" value={status} onChange={(event) => setStatus(event.target.value as CaseStatus | '')}><option value="">모든 상태</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="담당자 필터" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">모든 담당자</option>{doctors.map((value) => <option key={value}>{value}</option>)}</select>
          <label className="sort-field"><ArrowDownWideNarrow size={16} /><select aria-label="정렬" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">최근 접수순</option><option value="oldest">오래된 순</option><option value="case">Case ID순</option></select></label>
          <details className="column-menu"><summary className="button secondary"><Columns3 size={15} /> 열</summary><div className="column-options">{columns.map(({ id, label }) => <label key={id}><input type="checkbox" checked={visible.includes(id)} onChange={() => setVisible(visible.includes(id) ? visible.filter((column) => column !== id) : [...visible, id])} />{label}</label>)}</div></details>
        </div>
        <div className="table-scroll"><table><thead><tr><th scope="col">Case ID</th>{columns.filter(({ id }) => visible.includes(id)).map(({ id, label }) => <th scope="col" key={id}>{label}</th>)}<th scope="col"><span className="sr-only">열기</span></th></tr></thead>
          <tbody>{matching.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : undefined} onClick={() => onSelect(item.id)}>
            <td><button className="case-id" onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} aria-pressed={selected?.id === item.id}>{item.id}</button></td>
            {visible.includes('specimen') && <td>{item.specimen}</td>}
            {visible.includes('assignee') && <td>{item.assignee || <span className="muted">미배정</span>}</td>}
            {visible.includes('status') && <td><StatusLabel status={item.status} /></td>}
            {visible.includes('slides') && <td><span className="slide-count"><Layers3 size={14} />{readyCount(item)}/{item.slides.length}</span></td>}
            {visible.includes('received') && <td className="muted nowrap">{item.received}</td>}
            <td><button className="icon-button" aria-label={`${item.id} 상세 열기`} onClick={(event) => { event.stopPropagation(); onOpen(item.id); }}><ArrowRight size={16} /></button></td>
          </tr>)}</tbody></table></div>
        {!matching.length && <div className="empty"><FolderOpen size={28} /><strong>조건에 맞는 케이스가 없습니다.</strong><button className="button secondary" onClick={clearFilters}>필터 초기화</button></div>}
        <footer className="table-footer">{cases.length}건 중 {matching.length}건 표시<span>시연 데이터</span></footer>
      </section>
      <aside className="panel case-preview" aria-label="선택한 케이스 미리보기">
        <div className="panel-title"><h2>케이스 미리보기</h2><ScanLine size={18} className="muted" /></div>
        {selected ? <div className="preview-content">
          <div className="preview-heading"><strong>{selected.id}</strong><StatusLabel status={selected.status} /></div>
          <dl className="key-values"><div><dt>검체</dt><dd>{selected.specimen}</dd></div><div><dt>담당자</dt><dd>{selected.assignee || '미배정'}</dd></div><div><dt>환자 정보</dt><dd>{selected.patient?.number || '미입력'}</dd></div></dl>
          <div className="preview-label"><h3>슬라이드</h3><span>{readyCount(selected)}/{selected.slides.length} 열람 가능</span></div>
          {selected.slides.length ? <div className="preview-slides">{selected.slides.map((slide) => <button key={slide.id} className="slide-preview" onClick={() => onViewer(selected.id, slide.id)}>
            <span className="slide-image"><SlidePreview slide={slide} /></span><strong>{slide.id}</strong><span>{slide.stain}</span>
          </button>)}</div> : <p className="empty-inline">연결된 슬라이드가 없습니다.</p>}
          <button className="button primary full" onClick={() => onOpen(selected.id)}>케이스 상세 열기 <ArrowRight size={16} /></button>
          {selected.slides.length > 0 && <button className="button secondary full" onClick={() => onViewer(selected.id)}><ScanLine size={16} /> 뷰어 열기</button>}
        </div> : <p className="empty-inline">목록에서 케이스를 선택하세요.</p>}
      </aside>
    </div>
  </>;
}
