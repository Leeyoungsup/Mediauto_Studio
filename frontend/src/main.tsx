import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Activity, ChevronRight, CircleHelp, ClipboardList, FlaskConical, LayoutList, Microscope, ScanLine, Settings2, UserRound, UserRoundCheck, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { CaseDetail } from './case-detail';
import type { DemoCase } from './demo';
import { IntakePage, IntakeSettings } from './intake';
import { buildFileCases, requestIntake } from './intake-api';
import type { SourceFile } from './intake-api';
import { Viewer } from './viewer';
import { Worklist } from './worklist';
import type { Scope } from './worklist';
import { api, canWrite, jsonBody, SessionGate } from './session';
import type { User } from './session';
import { caseView, emptyResult, states } from './worklist-api';
import type { Result, WorklistEntry, WorklistQuery } from './worklist-api';
import './style.css';

const emrLabels = { unconfigured: '미설정', disabled: '사용 중지', connected: '연결됨', unavailable: '연결 장애', unknown: '확인 불가' };
type Health = { status: 'ok' | 'degraded'; database: 'connected' | 'unavailable'; emr: keyof typeof emrLabels };
type Page = { view: 'worklist'; scope: Scope } | { view: 'case'; id: string; files: boolean }
  | { view: 'viewer'; id: string; slide?: string; files: boolean } | { view: 'scans' } | { view: 'settings' };
type Modal = 'register' | 'system' | null;

function decodeRoute(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function readPage(): Page {
  const [view, id, slide] = location.hash.slice(1).split('/');
  if (view === 'scans' || view === 'settings') return { view };
  if ((view === 'case' || view === 'file-case') && id) return { view: 'case', id: decodeRoute(id), files: view === 'file-case' };
  if ((view === 'viewer' || view === 'file-viewer') && id) return { view: 'viewer', id: decodeRoute(id), slide: slide ? decodeRoute(slide) : undefined, files: view === 'file-viewer' };
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

function Workspace({ user, logout }: { user: User; logout: () => void }) {
  const [result, setResult] = useState<Result>(emptyResult);
  const [query, setQuery] = useState<WorklistQuery>({ q: '', status: '', assignee: '', sort: 'recent', offset: 0 });
  const [revision, setRevision] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<{ id: string; item?: DemoCase; error?: string }>();
  const [saving, setSaving] = useState(false);
  const registration = useRef<{ id: string; key: string } | null>(null);
  const writable = canWrite(user);
  const intakeAllowed = writable && user.organization === 'local';
  const settingsAllowed = intakeAllowed && user.role === 'admin';
  const [page, setPage] = useState(readPage);
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [formError, setFormError] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [serviceError, setServiceError] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [lastScope, setLastScope] = useState<Scope>('all');
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [fileProblem, setFileProblem] = useState('');
  const scope = page.view === 'worklist' ? page.scope : lastScope;
  const worklistCases = listLoading ? [] : result.rows.map(caseView);
  const selectedCase = worklistCases.find(({ id }) => id === selected);
  const casePage = page.view === 'case' || page.view === 'viewer' ? page : undefined;
  const detailId = casePage && !casePage.files ? casePage.id : undefined;
  const current = casePage?.files ? buildFileCases(files).find(({ id }) => id === casePage.id)
    : detail?.id === detailId ? detail?.item : undefined;
  const emr = health ? emrLabels[health.emr] : serviceError ? '확인 불가' : '확인 중';
  const worklistTabs = [
    { id: 'all', href: '#worklist/all', label: '전체 케이스', count: result.counts.all, icon: LayoutList },
    { id: 'mine', href: '#worklist/mine', label: '내 배정 건', count: result.counts.mine, icon: UserRoundCheck },
    { id: 'unassigned', href: '#worklist/unassigned', label: '미배정', count: result.counts.unassigned, icon: ClipboardList },
    ...(intakeAllowed ? [{ id: 'scans', href: '#scans', label: '슬라이드 등록', count: files.filter(({ entry }) => !entry).length, icon: ScanLine }] : []),
  ];

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ scope, q: query.q, sort: query.sort, offset: String(query.offset) });
    if (query.status) params.set('status', states[query.status]);
    if (query.assignee) params.set('assigned_to', query.assignee);
    setListLoading(true);
    setListError('');
    api<Result>('/api/worklist?' + params, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch(() => { if (!controller.signal.aborted) { setResult(emptyResult); setListError('Worklist를 불러오지 못했습니다.'); } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [scope, query, revision]);

  useEffect(() => {
    if (!detailId) return;
    const controller = new AbortController();
    api<WorklistEntry>('/api/worklist/' + encodeURIComponent(detailId), { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setDetail({ id: detailId, item: caseView(data) }); })
      .catch(() => { if (!controller.signal.aborted) setDetail({ id: detailId, error: '케이스를 불러올 수 없습니다.' }); });
    return () => controller.abort();
  }, [detailId, revision]);

  useEffect(() => {
    function sync() {
      const next = readPage();
      if (next.view === 'worklist') setLastScope(next.scope);
      else if (next.view === 'case' || next.view === 'viewer') setSelected(next.id);
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
      if (!signal?.aborted) { setFiles(result); if (!signal) setRevision((value) => value + 1); }
    } catch {
      if (!signal?.aborted) setFileProblem('스캔 파일 목록을 불러오지 못했습니다. 목록 갱신을 눌러 다시 시도하세요.');
    } finally { if (!signal?.aborted) setFilesLoading(false); }
  }, []);

  useEffect(() => {
    if (!intakeAllowed) return;
    const controller = new AbortController();
    void refreshFiles(controller.signal);
    return () => controller.abort();
  }, [refreshFiles, intakeAllowed]);

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
  function navigateCase(item: DemoCase) {
    location.hash = `${item.source === 'files' ? 'file-case' : 'case'}/${encodeURIComponent(item.recordId ?? item.id)}`;
  }
  function navigateViewer(item: DemoCase, slide?: string) {
    location.hash = `${item.source === 'files' ? 'file-viewer' : 'viewer'}/${encodeURIComponent(item.recordId ?? item.id)}${slide ? `/${encodeURIComponent(slide)}` : ''}`;
  }
  function goBack() { location.hash = `worklist/${lastScope}`; }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get('case-number')).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(id)) {
      setFormError('Case ID에 영문, 숫자, 점, 하이픈, 밑줄을 사용할 수 있습니다.');
      return;
    }
    if (registration.current?.id !== id) {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
      registration.current = { id, key };
    }
    setSaving(true);
    setFormError('');
    try {
      const record = await api<{ id: string }>(`/api/clinical/${encodeURIComponent(user.organization)}/cases`,
        jsonBody('POST', { case_number: id }, { 'Idempotency-Key': registration.current.key }));
      registration.current = null;
      setRevision((value) => value + 1);
      showModal(null);
      location.hash = `case/${record.id}`;
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : '케이스를 등록할 수 없습니다.');
    } finally { setSaving(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#worklist/all"><span className="brand-icon"><Microscope size={23} /></span><span>MeDIAuto<strong>Studio</strong></span></a>
      <nav aria-label="업무 목록" className="side-nav">
        <p>워크스페이스</p>
        <a href="#worklist/all" aria-current={page.view !== 'settings' ? 'location' : undefined}><LayoutList size={19} /> <span>Worklist</span><small>{result.counts.all}</small></a>
        {settingsAllowed && <a href="#settings" aria-current={page.view === 'settings' ? 'page' : undefined}><Settings2 size={19} /> <span>설정</span></a>}
      </nav>
      <div className="side-footer"><button onClick={() => showModal('system')}><Activity size={18} /><span>서비스 상태</span><i className={health?.status === 'ok' ? 'online' : ''} /></button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><span>병리 워크스페이스</span><ChevronRight size={15} /><strong>{{ viewer: 'WSI 뷰어', case: '케이스 상세', scans: '슬라이드 등록', settings: '설정', worklist: 'Worklist' }[page.view]}</strong></div>
        <div className="header-actions"><span className="demo-label"><FlaskConical size={15} /> 시연 환경</span><button className="emr-chip" onClick={() => showModal('system')}><span /> EMR {emr}</button><span className="identity"><UserRound size={17} />{user.display_name}</span><button className="button secondary" onClick={logout}>로그아웃</button></div>
      </header>
      <main className="workspace-main">
        {(page.view === 'worklist' || page.view === 'scans') && <nav aria-label="Worklist 하위 메뉴" className="worklist-nav">
          {worklistTabs.map(({ id, href, label, count, icon: Icon }) => <a key={id} href={href}
            aria-current={(page.view === 'scans' ? id === 'scans' : id === page.scope) ? 'page' : undefined}>
            <Icon size={16} />{label}<small>{count}</small>
          </a>)}
        </nav>}
        <div hidden={page.view !== 'worklist'}>
          {listError && <div className="notice" role="alert">{listError}<button className="button secondary" onClick={() => setRevision((value) => value + 1)}>다시 시도</button></div>}
          <Worklist cases={worklistCases} loading={listLoading} scope={scope} current={selectedCase} onSelect={setSelected}
            total={result.total} counts={result.counts} assignees={result.assignees} onQuery={setQuery}
            onOpen={(id) => { const item = worklistCases.find((row) => row.id === id); if (item) navigateCase(item); }}
            onViewer={(id, slide) => { const item = worklistCases.find((row) => row.id === id); if (item) navigateViewer(item, slide); }}
            onRegister={writable ? () => showModal('register') : undefined} />
        </div>
        {page.view === 'settings' && settingsAllowed && <IntakeSettings refresh={refreshFiles} emrConnected={health?.emr === 'connected'} />}
        {page.view === 'scans' && intakeAllowed && <IntakePage files={files} loading={filesLoading} problem={fileProblem} refresh={refreshFiles} />}
        {((page.view === 'settings' && !settingsAllowed) || (page.view === 'scans' && !intakeAllowed)) && <div className="panel empty"><strong>이 화면을 열 권한이 없습니다.</strong><button className="button secondary" onClick={goBack}>Worklist 돌아가기</button></div>}
        {casePage && (!current ? <div className="panel empty"><CircleHelp size={28} /><strong>{casePage.files
          ? (intakeAllowed && filesLoading ? '케이스를 불러오는 중입니다.' : '케이스를 불러올 수 없습니다.')
          : detail?.id === detailId ? detail?.error : '케이스를 불러오는 중입니다.'}</strong><button className="button secondary" onClick={goBack}>Worklist 돌아가기</button></div>
          : casePage.view === 'case' ? <CaseDetail key={current.id} item={current} emr={emr} onBack={goBack} onViewer={(slide) => navigateViewer(current, slide)} />
          : <Viewer key={current.id} item={current} activeSlide={casePage.slide} onSlide={(id) => navigateViewer(current, id)} onBack={() => navigateCase(current)} />)}
      </main>
    </div>
    {modal === 'register' && <ModalWindow title="케이스 등록" onClose={() => showModal(null)}><form onSubmit={(event) => void register(event)}>
      <label className="form-field">Case ID<input name="case-number" placeholder="IMS-26-0149" required maxLength={40} /></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => showModal(null)}>취소</button><button className="button primary" type="submit" disabled={saving}>등록</button></div>
    </form></ModalWindow>}
    {modal === 'system' && <ModalWindow title="서비스 상태" onClose={() => showModal(null)}>
      <dl className="key-values" aria-live="polite"><div><dt>FastAPI</dt><dd>{health ? '응답 정상' : serviceError ? '응답 없음' : '확인 중'}</dd></div><div><dt>PostgreSQL</dt><dd>{health ? health.database === 'connected' ? '연결됨' : '연결 장애' : '—'}</dd></div><div><dt>EMR</dt><dd>{emr}</dd></div></dl>
      <div className="dialog-actions"><button className="button secondary" disabled={!health && !serviceError} onClick={() => { setHealth(null); setServiceError(false); setCheckAttempt(checkAttempt + 1); }}>다시 확인</button></div>
    </ModalWindow>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><SessionGate>{(user, logout) => <Workspace user={user} logout={logout} />}</SessionGate></StrictMode>);
