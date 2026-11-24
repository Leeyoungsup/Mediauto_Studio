import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Activity, ChevronRight, CircleHelp, ClipboardList, FlaskConical, LayoutList, Microscope, ScanLine, Settings2, UserRound, UserRoundCheck, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { CaseDetail } from './case-detail';
import { demoSlide, readyCount } from './demo';
import type { DemoCase, Doctor } from './demo';
import { IntakePage, IntakeSettings } from './intake';
import { buildFileCases, requestIntake } from './intake-api';
import type { SourceFile } from './intake-api';
import { Viewer } from './viewer';
import { Worklist } from './worklist';
import type { Scope } from './worklist';
import './style.css';

const emrLabels = { unconfigured: '미설정', disabled: '사용 중지', connected: '연결됨', unavailable: '연결 장애', unknown: '확인 불가' };
type Health = { status: 'ok' | 'degraded'; database: 'connected' | 'unavailable'; emr: keyof typeof emrLabels };
type Page = { view: 'worklist'; scope: Scope } | { view: 'case'; id: string; files: boolean }
  | { view: 'viewer'; id: string; slide?: string; files: boolean } | { view: 'scans' } | { view: 'settings' };
type Modal = 'register' | 'patient' | 'system' | null;

function readPage(): Page {
  const [view, id, slide] = location.hash.slice(1).split('/');
  if (view === 'scans' || view === 'settings') return { view };
  if ((view === 'case' || view === 'file-case') && id) return { view: 'case', id, files: view === 'file-case' };
  if ((view === 'viewer' || view === 'file-viewer') && id) return { view: 'viewer', id, slide, files: view === 'file-viewer' };
  return { view: 'worklist', scope: id === 'mine' || id === 'unassigned' ? id : 'all' };
}

function ModalWindow({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={onClose}>
    <div className="panel-title"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={19} /></button></div>
    <div className="dialog-content">{children}</div>
  </dialog>;
}

function App() {
  const [cases, setCases] = useState<DemoCase[]>([]);
  const [page, setPage] = useState(readPage);
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [serviceError, setServiceError] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [lastScope, setLastScope] = useState<Scope>('all');
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [fileProblem, setFileProblem] = useState('');
  const imported = buildFileCases(files);
  const importedIds = new Set(imported.map(({ id }) => id));
  const scope = page.view === 'worklist' ? page.scope : lastScope;
  const worklistCases = [...cases.filter(({ id }) => !importedIds.has(id)), ...imported];
  const selectedCase = worklistCases.find(({ id }) => id === selected);
  const current = page.view === 'case' || page.view === 'viewer'
    ? (page.files ? imported : cases).find(({ id }) => id === page.id) : undefined;
  const emr = health ? emrLabels[health.emr] : serviceError ? '확인 불가' : '확인 중';
  const mine = worklistCases.filter(({ assignee }) => assignee === '병리의 A').length;
  const unassigned = worklistCases.filter(({ assignee }) => !assignee).length;
  const worklistTabs = [
    { id: 'all', href: '#worklist/all', label: '전체 케이스', count: worklistCases.length, icon: LayoutList },
    { id: 'mine', href: '#worklist/mine', label: '내 배정 건', count: mine, icon: UserRoundCheck },
    { id: 'unassigned', href: '#worklist/unassigned', label: '미배정', count: unassigned, icon: ClipboardList },
    { id: 'scans', href: '#scans', label: '슬라이드 등록', count: files.filter(({ entry }) => !entry).length, icon: ScanLine },
  ];

  useEffect(() => {
    function sync() {
      const next = readPage();
      if (next.view === 'worklist') setLastScope(next.scope);
      else if (next.view === 'case' || next.view === 'viewer') setSelected(next.id);
      setNotice('');
      setPage(next);
    }
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const refreshFiles = useCallback(async (signal?: AbortSignal) => {
    setFilesLoading(true);
    setFileProblem('');
    try {
      const result = await requestIntake<SourceFile[]>('/slides', 'GET', undefined, signal);
      if (!signal?.aborted) setFiles(result);
    } catch {
      if (!signal?.aborted) setFileProblem('스캔 파일 목록을 불러오지 못했습니다. 목록 갱신을 눌러 다시 시도하세요.');
    } finally { if (!signal?.aborted) setFilesLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshFiles(controller.signal);
    return () => controller.abort();
  }, [refreshFiles]);

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok && response.status !== 503) throw new Error('Health check failed');
        const data: Health = await response.json();
        if (!controller.signal.aborted) setHealth(data);
      } catch {
        if (!controller.signal.aborted) setServiceError(true);
      }
    }
    void check();
    return () => controller.abort();
  }, [checkAttempt]);

  function showModal(next: Modal) { setFormError(''); setModal(next); }
  function navigateCase(id: string, fromFiles = false) { location.hash = `${fromFiles ? 'file-case' : 'case'}/${id}`; }
  function navigateViewer(id: string, slide?: string, fromFiles = false) { location.hash = `${fromFiles ? 'file-viewer' : 'viewer'}/${id}${slide ? `/${slide}` : ''}`; }
  function goBack() { location.hash = `worklist/${lastScope}`; }

  function updateCase(id: string, changes: Partial<DemoCase>, log: string) {
    setCases((items) => items.map((item) => item.id === id ? { ...item, ...changes, history: [log, ...item.history] } : item));
  }

  function assign(item: DemoCase, assignee: Doctor | '') {
    if (assignee === item.assignee) return;
    if (assignee && !readyCount(item)) { setNotice('배정하려면 열람 가능한 슬라이드가 한 장 이상 필요합니다.'); return; }
    setNotice('');
    updateCase(item.id, { assignee, status: assignee ? '배정됨' : '배정 대기' }, assignee ? `담당자 배정 · ${assignee}` : '담당자 배정 해제');
  }

  function review(item: DemoCase) {
    if (!item.slides.length || (item.status === '검토 중' ? readyCount(item) < item.slides.length : !readyCount(item))) {
      setNotice(item.status === '검토 중' ? '필수 슬라이드가 모두 열람 가능해지면 검토를 완료할 수 있습니다.' : '열람 가능한 슬라이드가 필요합니다.');
      return;
    }
    const status = item.status === '검토 중' ? '검토 완료' : '검토 중';
    setNotice('');
    updateCase(item.id, { status }, `${status === '검토 중' ? '검토 시작' : status} · ${item.assignee}`);
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const id = String(values.get('case-number')).trim().toUpperCase();
    const specimen = String(values.get('specimen')).trim();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(id) || !specimen) {
      setFormError('Case ID와 검체를 입력하세요. ID는 영문, 숫자, 점, 하이픈, 밑줄을 사용할 수 있습니다.');
      return;
    }
    if (worklistCases.some((item) => item.id === id)) { setFormError('이미 등록된 Case ID입니다.'); return; }
    const received = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace('-', '.');
    setCases((items) => [{ id, specimen, received, status: '배정 대기', assignee: '', patient: null, slides: [], history: ['케이스 등록'] }, ...items]);
    showModal(null);
    navigateCase(id);
  }

  function savePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const values = new FormData(event.currentTarget);
    const patient = { name: String(values.get('name')).trim(), number: String(values.get('patient-number')).trim(), birth: String(values.get('birth')) };
    if (!patient.name && !patient.number) { setFormError('시연용 환자명 또는 환자번호를 입력하세요.'); return; }
    updateCase(current.id, { patient }, '환자 정보 수기 저장');
    showModal(null);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#worklist/all"><span className="brand-icon"><Microscope size={23} /></span><span>MeDIAuto<strong>Studio</strong></span></a>
      <nav aria-label="업무 목록" className="side-nav">
        <p>워크스페이스</p>
        <a href="#worklist/all" aria-current={page.view !== 'settings' ? 'location' : undefined}><LayoutList size={19} /> <span>Worklist</span><small>{worklistCases.length}</small></a>
        <a href="#settings" aria-current={page.view === 'settings' ? 'page' : undefined}><Settings2 size={19} /> <span>설정</span></a>
      </nav>
      <div className="side-footer"><button onClick={() => showModal('system')}><Activity size={18} /><span>서비스 상태</span><i className={health?.status === 'ok' ? 'online' : ''} /></button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><span>병리 워크스페이스</span><ChevronRight size={15} /><strong>{{ viewer: 'WSI 뷰어', case: '케이스 상세', scans: '슬라이드 등록', settings: '설정', worklist: 'Worklist' }[page.view]}</strong></div>
        <div className="header-actions"><span className="demo-label"><FlaskConical size={15} /> 시연 환경</span><button className="emr-chip" onClick={() => showModal('system')}><span /> EMR {emr}</button><div className="account" aria-label="시연 사용자 병리의 A"><UserRound size={17} /></div></div>
      </header>
      <main className="workspace-main">
        {(page.view === 'worklist' || page.view === 'scans') && <nav aria-label="Worklist 하위 메뉴" className="worklist-nav">
          {worklistTabs.map(({ id, href, label, count, icon: Icon }) => <a key={id} href={href}
            aria-current={(page.view === 'scans' ? id === 'scans' : id === page.scope) ? 'page' : undefined}>
            <Icon size={16} />{label}<small>{count}</small>
          </a>)}
        </nav>}
        {notice && <div role="alert" className="notice">{notice}<button className="icon-button" aria-label="안내 닫기" onClick={() => setNotice('')}><X size={17} /></button></div>}
        <div hidden={page.view !== 'worklist'}>
          {fileProblem && <div className="notice" role="alert">{fileProblem}<button className="button secondary" onClick={() => void refreshFiles()}>목록 갱신</button></div>}
          <Worklist cases={worklistCases} loading={filesLoading} scope={scope} current={selectedCase} onSelect={setSelected}
            onOpen={(id) => navigateCase(id, importedIds.has(id))} onViewer={(id, slide) => navigateViewer(id, slide, importedIds.has(id))} onRegister={() => showModal('register')} />
        </div>
        {page.view === 'settings' && <IntakeSettings refresh={refreshFiles} emrConnected={health?.emr === 'connected'} />}
        {page.view === 'scans' && <IntakePage files={files} loading={filesLoading} problem={fileProblem} refresh={refreshFiles} />}
        {(page.view === 'case' || page.view === 'viewer') && (!current ? <div className="panel empty"><CircleHelp size={28} /><strong>{page.files && filesLoading ? '케이스를 불러오는 중입니다.' : '케이스를 찾을 수 없습니다.'}</strong><button className="button secondary" onClick={goBack}>Worklist 돌아가기</button></div>
          : page.view === 'case' ? <CaseDetail key={current.id} item={current} emr={emr} onBack={goBack} onViewer={(slide) => navigateViewer(current.id, slide, page.files)} onPatient={() => showModal('patient')} onAssign={(doctor) => assign(current, doctor)} onReview={() => review(current)} onAddSlide={() => {
            setNotice('');
            const slide = demoSlide(current.slides.length);
            updateCase(current.id, { slides: [...current.slides, slide] }, `샘플 슬라이드 연결 · ${slide.id}`);
          }} />
          : <Viewer key={current.id} item={current} activeSlide={page.slide} onSlide={(id) => navigateViewer(current.id, id, page.files)} onBack={() => navigateCase(current.id, page.files)} onReview={() => review(current)} />)}
      </main>
    </div>
    {modal === 'register' && <ModalWindow title="케이스 등록" onClose={() => showModal(null)}><form onSubmit={register}>
      <label className="form-field">Case ID<input name="case-number" placeholder="IMS-26-0149" required maxLength={40} /></label>
      <label className="form-field">검체<input name="specimen" placeholder="예: 대장 조직" required maxLength={80} /></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => showModal(null)}>취소</button><button className="button primary" type="submit">등록</button></div>
    </form></ModalWindow>}
    {modal === 'patient' && current && <ModalWindow title="환자 정보 직접 입력" onClose={() => showModal(null)}><form onSubmit={savePatient}>
      <p className="muted">시연용 환자 정보만 입력하세요.</p>
      <label className="form-field">환자명<input name="name" maxLength={80} defaultValue={current.patient?.name} placeholder="시연 환자" /></label>
      <label className="form-field">환자번호<input name="patient-number" maxLength={40} defaultValue={current.patient?.number} placeholder="DEMO-0000" /></label>
      <label className="form-field">생년월일<input name="birth" type="date" defaultValue={current.patient?.birth} /></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => showModal(null)}>취소</button><button className="button primary" type="submit">저장</button></div>
    </form></ModalWindow>}
    {modal === 'system' && <ModalWindow title="서비스 상태" onClose={() => showModal(null)}>
      <dl className="key-values" aria-live="polite"><div><dt>FastAPI</dt><dd>{health ? '응답 정상' : serviceError ? '응답 없음' : '확인 중'}</dd></div><div><dt>PostgreSQL</dt><dd>{health ? health.database === 'connected' ? '연결됨' : '연결 장애' : '—'}</dd></div><div><dt>EMR</dt><dd>{emr}</dd></div></dl>
      <div className="dialog-actions"><button className="button secondary" disabled={!health && !serviceError} onClick={() => { setHealth(null); setServiceError(false); setCheckAttempt(checkAttempt + 1); }}>다시 확인</button></div>
    </ModalWindow>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
