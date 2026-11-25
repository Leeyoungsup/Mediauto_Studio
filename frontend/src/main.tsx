import brandLogo from '../assets/logo.png';
import brandIcon from '../assets/app_icon.ico';
import { AddCaseReference, CollectionWorkspace } from './case-collections';
import { AnalysisSettings } from './analysis-execution';
import { RoiSearchPage } from './roi-search';
import type { RoiLocation } from './roi-search';
import { FrozenWorkflow, ORResults } from './frozen-workflow';
import { AccountsSettings, accountSettingsHref } from './accounts-settings';
import type { AccountTab } from './accounts-settings';
import { CaseReport } from './case-report';
import { NotificationCenter, NotificationSettings } from './notifications';
import { NavigationResizeHandle, useNavigationWidth } from './workspace-navigation-width';
import { lazy, Suspense, StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { Activity, Bell, ChevronRight, CircleHelp, ClipboardList, FlaskConical, FolderKanban, LayoutList, Microscope, PanelLeftClose, PanelLeftOpen, RadioTower, ScanLine, Settings2, UserRound, UserRoundCheck, UserRoundPlus, UsersRound, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { CaseEditor } from './case-editor';
import { PatientMatch } from './patient-match';
import type { PatientSelection } from './patient-match';
import { CaseDetail } from './case-detail';
import { caseHref, caseTab } from './case-navigation';
import { collectionHref, withCollection } from './workflow-navigation';
import type { CollectionOrigin } from './workflow-navigation';
import type { CaseTab } from './case-navigation';
import { CaseDates } from './case-dates';
import { CaseRequests, ReportDraftReferences, RequestPage } from './case-requests';
import type { DemoCase } from './demo';
import { IntakePage, IntakeSettings } from './intake';
import { IntegrationSettings, PatientIntegration, integrationLabel, integrationPath } from './integration';
import type { IntegrationStatus } from './integration';
import { buildFileCases, requestIntake } from './intake-api';
import type { SourceFile } from './intake-api';
import { Viewer } from './viewer';
import { Worklist } from './worklist';
import { CaseRouting, WorkgroupSettings } from './workgroups';
import type { Queue } from './workgroups';
import type { Scope } from './worklist';
import { defaultOrder } from './worklist-config';
import { accountRoleLabels, api, auditAttemptId, canWrite, jsonBody, SessionGate } from './session';
import type { User } from './session';
import { caseView, emptyResult, states } from './worklist-api';
import type { Result, WorklistEntry, WorklistQuery } from './worklist-api';
import './style.css';

const emrLabels = { unconfigured: 'Not Configured', disabled: 'Disabled', connected: 'Connected', unavailable: 'Connection Unavailable', unknown: 'Unavailable' };
type Health = { status: 'ok' | 'degraded'; database: 'connected' | 'unavailable'; emr: keyof typeof emrLabels };
const RelatedComparison = lazy(() => import('./related-comparison'));
const PapPolicySettings = lazy(() => import('./pap-policy-settings'));

const settingsSections = [
  { key: '', label: 'Intake and Integration', icon: ScanLine, admin: true },
  { key: 'groups', label: 'Manage Workgroups', icon: UsersRound, admin: true },
  { key: 'analysis', label: 'Analysis Pre-run Rules', icon: FlaskConical, admin: true },
  { key: 'accounts', label: 'Accounts', icon: UserRoundPlus, admin: true },
  { key: 'pap', label: 'Pap Review Policy', icon: Microscope, admin: true },
  { key: 'notifications', label: 'Notifications', icon: Bell, admin: false },
] as const;
type SettingsPage = { view: 'settings'; section?: Exclude<typeof settingsSections[number]['key'], ''>; accountTab?: AccountTab; noteCase?: string; noteScan?: string; requestReturn?: string };

const accountLinks = [
  { tab: 'directory', label: 'Account Management', name: 'Accounts', icon: UsersRound },
  { tab: 'requests', label: 'Account Approvals', name: 'Approvals', icon: UserRoundPlus },
  { tab: 'audit', label: 'Account Audit Log', name: 'Account Audit', icon: ClipboardList },
] as const;

type Page = ({ view: 'related-comparison'; id: string; anchor?: string; returnToPapReview?: boolean; returnPapScan?: string } | { view: 'worklist'; scope: Scope; collectionTarget?: string } | { view: 'case'; id: string; files: boolean; tab?: CaseTab; selectedScan?: string; focusIhc?: boolean } | { view: 'request'; id: string; sourceScan?: string; fromAnalysis?: boolean } | { view: 'or'; id?: string; scan?: string }
  | { view: 'viewer'; id: string; slide?: string; snapshot?: string; roi?: string; roiOrigin?: RoiLocation; files: boolean; openRequests?: boolean; openReview?: boolean; openAnalysis?: boolean; papMode?: 'gallery' | 'review' } | { view: 'roi-search'; location: RoiLocation } | { view: 'collections'; id?: string; entry?: string } | { view: 'scans' } | SettingsPage) & { collectionOrigin?: CollectionOrigin };
type WorkflowAction = 'assignment' | 'review' | 'confirm';
type Modal = 'register' | 'system' | null;

function decodeRoute(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function isUuid(value?: string): value is string {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value ?? '');
}

function readPage(): Page {
  const [route, query] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  const collection = params.get('collection') ?? undefined;
  const entry = params.get('entry') ?? undefined;
  const collectionOrigin = isUuid(collection) && isUuid(entry) ? { collection, entry } : undefined;
  const [view, id, slide, snapshot, roi, sourceScan, sourceRoi] = route.split('/');
  const pap = params.get('pap');
  const papMode: 'review' | 'gallery' | undefined = pap === 'review' || pap === 'gallery' ? pap : undefined;
  const viewerMode = { openRequests: params.get('requests') === '1', openReview: params.get('review') === '1',
    openAnalysis: params.get('analysis') === '1', papMode, collectionOrigin };
  if (view === 'roi-search' && isUuid(id) && isUuid(slide) && isUuid(snapshot)) {
    return { view, location: { caseId: id, scanId: slide, roiId: snapshot } };
  }
  if (view === 'viewer' && isUuid(id) && isUuid(slide) && snapshot === 'roi' && isUuid(roi)) {
    const roiOrigin = isUuid(sourceScan) && isUuid(sourceRoi) ? { caseId: id, scanId: sourceScan, roiId: sourceRoi } : undefined;
    return { view, id, slide, roi, roiOrigin, files: false, ...viewerMode };
  }
  if (view === 'related-comparison' && isUuid(id)) {
    const fromScan = params.get('scan') ?? undefined;
    return { view, id, anchor: isUuid(slide) ? slide : undefined, returnToPapReview: papMode === 'review',
      returnPapScan: papMode === 'review' && isUuid(fromScan) ? fromScan : undefined };
  }
  if (view === 'collections') return { view, id: isUuid(id) ? id : undefined, entry: isUuid(slide) ? slide : undefined };
  if (view === 'or') return { view, id: id ? decodeRoute(id) : undefined, scan: slide ? decodeRoute(slide) : undefined };
  if (view === 'scans') return { view };
  if (view === 'settings') {
    const section = settingsSections.find(({ key }) => key === id)?.key || undefined;
    const accountTab = section === 'accounts' ? accountLinks.find(({ tab }) => tab === slide)?.tab ?? 'directory' : undefined;
    const noteCase = section === 'notifications' && isUuid(slide) ? slide : undefined;
    const request = params.get('request') ?? undefined;
    const requestScan = params.get('scan') ?? undefined;
    const analysisReturn = params.get('return') === 'analysis';
    const requestReturn = section === 'notifications' && isUuid(request)
      ? withCollection(`#request/${request}${isUuid(requestScan) ? '?scan=' + requestScan + (analysisReturn ? '&return=analysis' : '') : ''}`, collectionOrigin) : undefined;
    return { view, section, accountTab, noteCase, requestReturn, noteScan: noteCase && snapshot ? decodeRoute(snapshot) : undefined };
  }
  if (view === 'request' && id) {
    const scan = params.get('scan') ?? undefined;
    return { view, id: decodeRoute(id), sourceScan: isUuid(scan) ? scan : undefined, fromAnalysis: params.get('return') === 'analysis', collectionOrigin };
  }
  if ((view === 'case' || view === 'file-case') && id) {
    const tab = caseTab(slide);
    return { view: 'case', id: decodeRoute(id), files: view === 'file-case', tab, collectionOrigin,
      selectedScan: tab && snapshot ? decodeRoute(snapshot) : undefined, focusIhc: params.get('ihc') === '1' };
  }
  if ((view === 'viewer' || view === 'file-viewer') && id) return { view: 'viewer', id: decodeRoute(id), slide: slide ? decodeRoute(slide) : undefined, snapshot: /^[a-f0-9]{64}$/.test(snapshot ?? '') ? snapshot : undefined, files: view === 'file-viewer', ...viewerMode };
  return { view: 'worklist', scope: id === 'mine' || id === 'unassigned' ? id : 'all',
    collectionTarget: slide === 'collection' && isUuid(snapshot) ? snapshot : undefined };
}

function ModalWindow({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={onClose}>
    <div className="panel-title"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button></div>
    <div className="dialog-content">{children}</div>
  </dialog>;
}

function Workspace({ user, logout }: { user: User; logout: () => void }) {
  const [result, setResult] = useState<Result>(emptyResult);
  const [query, setQuery] = useState<WorklistQuery>({ q: '', status: '', assignee: '', order: defaultOrder, offset: 0 });
  const [revision, setRevision] = useState(0);
  const [openRevision, setOpenRevision] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<{ key: string; item?: DemoCase; error?: string }>();
  const [saving, setSaving] = useState(false);
  const registration = useRef<{ id: string; key: string } | null>(null);
  const writable = canWrite(user);
  const intakeAllowed = writable && user.organization === 'local';
  const orAllowed = user.role === 'admin' || user.role === 'viewer';
  const settingsAllowed = user.role === 'admin';
  const requestAllowed = settingsAllowed || user.role === 'doctor';
  const [page, setPage] = useState(readPage);
  const roiSearchPreference = useRef<{ roi: string; organ: string }>(undefined);
  const [navigationCollapsed, setNavigationCollapsed] = useState<boolean>();
  const collapseNavigation = navigationCollapsed ?? page.view === 'viewer';
  const [navigationWidth, setNavigationWidth] = useNavigationWidth();
  const settingsPage = page.view === 'settings' ? page : undefined;
  const showsIntegrationSettings = settingsAllowed && !!settingsPage && !settingsPage.section;
  const accountTab = settingsPage?.accountTab;
  const accountLocation = accountLinks.find(({ tab }) => tab === accountTab);
  const [selected, setSelected] = useState('');
  const [referenceCase, setReferenceCase] = useState<{ id: string; title: string }>();
  const [modal, setModal] = useState<Modal>(null);
  const [formError, setFormError] = useState('');
  const [workflow, setWorkflow] = useState<{ item: DemoCase; action: WorkflowAction; loading?: boolean }>();
  const [workflowError, setWorkflowError] = useState('');
  const [intakePatient, setIntakePatient] = useState<PatientSelection>();
  const [health, setHealth] = useState<Health | null>(null);
  const [integration, setIntegration] = useState<IntegrationStatus>();
  const [queues, setQueues] = useState<Queue[]>([]);
  const [serviceError, setServiceError] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [lastScope, setLastScope] = useState<Scope>('all');
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [fileProblem, setFileProblem] = useState('');
  const setWorklistScope = useCallback((next: Scope) => {
    const current = readPage();
    if (current.view === 'worklist' && current.scope !== next) location.hash = `worklist/${next}`;
  }, []);
  const scope = page.view === 'worklist' ? page.scope : lastScope;
  const worklistCases = listLoading ? [] : result.rows.map(caseView);
  const selectedCase = worklistCases.find(({ id }) => id === selected);
  const casePage = page.view === 'case' || page.view === 'viewer' ? page : undefined;
  const detailId = casePage && !casePage.files ? casePage.id : undefined;
  const detailKey = detailId ? `${casePage?.view}/${detailId}` : undefined;
  const current = casePage?.files ? buildFileCases(files).find(({ id }) => id === casePage.id)
    : detail?.key === detailKey ? detail?.item : undefined;
  const mayAssign = writable && current?.recordId && current.status !== 'Review Complete';
  const mayReview = user.role === 'doctor' && current?.assignedTo === user.id &&
    (current.status === 'Assigned' || current.status === 'In Review');
  const emr = integration ? integrationLabel(integration.emr) : health ? emrLabels[health.emr] : serviceError ? 'Unavailable' : 'Checking…';
  const lis = integrationLabel(integration?.lis);
  const refreshIntegration = useCallback(() => {
    api<IntegrationStatus>(integrationPath(user.organization) + '/status').then(setIntegration).catch(() => {});
  }, [user.organization]);
  useEffect(() => {
    if (showsIntegrationSettings) return;
    refreshIntegration();
    const interval = window.setInterval(refreshIntegration, 5000);
    return () => window.clearInterval(interval);
  }, [refreshIntegration, showsIntegrationSettings]);

  const refreshQueues = useCallback(async () => setQueues(await api<Queue[]>('/api/worklist/queues')), []);
  useEffect(() => { refreshQueues().catch(() => {}); }, [refreshQueues]);

  function patientChanged() {
    setRevision((value) => value + 1);
    refreshIntegration();
  }
  const worklistTabs = [
    { id: 'all', href: '#worklist/all', sideLabel: 'Worklist', label: 'All Cases', count: result.counts.all, icon: LayoutList },
    ...(user.role !== 'labeler' ? [{ id: 'mine', href: '#worklist/mine', sideLabel: 'My Cases', label: 'Assigned to Me', count: result.counts.mine, icon: UserRoundCheck }] : []),
    ...(writable ? [{ id: 'unassigned', href: '#worklist/unassigned', sideLabel: 'Unassigned Cases', label: 'Unassigned', count: result.counts.unassigned, icon: ClipboardList }] : []),
    ...(intakeAllowed ? [{ id: 'scans', href: '#scans', sideLabel: 'Intake', label: 'Slide Registration', count: files.filter(({ entry }) => !entry).length, icon: ScanLine }] : []),
  ];

  useEffect(() => {
    const controller = new AbortController();
    const order = query.order.map((term) => `${term.field}:${term.direction}`);
    const filters = query.filters ?? {};
    const params = new URLSearchParams({ scope, q: query.q, offset: String(query.offset) });
    for (const term of order) params.append('order', term);
    if (query.status) params.set('status', states[query.status]);
    if (query.assignee) params.set('assigned_to', query.assignee);
    setListLoading(true);
    setListError('');
    const request = Object.keys(filters).length ? api<Result>('/api/worklist/search', {
      ...jsonBody('POST', { ...filters, scope, q: query.q, offset: query.offset, order,
        status: query.status ? states[query.status] : null, assigned_to: query.assignee || null }), signal: controller.signal,
    }) : api<Result>('/api/worklist?' + params, { signal: controller.signal });
    request
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((failure) => { if (!controller.signal.aborted) {
        setResult(emptyResult); setListError(failure instanceof Error ? failure.message : 'Unable to load the Worklist.');
      } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [scope, query, revision, openRevision]);

  useEffect(() => {
    if (!detailId || !detailKey) return;
    const controller = new AbortController();
    api<WorklistEntry>('/api/worklist/' + encodeURIComponent(detailId), { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSelected(data.case_number);
        setDetail({ key: detailKey, item: caseView(data) });
      })
      .catch(() => { if (!controller.signal.aborted) setDetail({ key: detailKey, error: 'Unable to load the case.' }); });
    return () => controller.abort();
  }, [detailId, detailKey, revision]);

  useEffect(() => {
    function sync() {
      const next = readPage();
      if (next.view === 'worklist') setLastScope(next.scope);
      else if ((next.view === 'case' || next.view === 'viewer') && next.files) setSelected(next.id);
      if (next.view !== 'worklist') setReferenceCase(undefined);
      setPage(next);
    }
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const openedCase = current && casePage && (current.recordId
    ? '/api/worklist/cases/' + encodeURIComponent(current.recordId) + '/opened'
    : '/api/worklist/file-cases/' + encodeURIComponent(current.id) + '/opened');
  const lastOpenRequest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!openedCase) {
      lastOpenRequest.current = undefined;
      return;
    }
    if (lastOpenRequest.current === openedCase) return;
    lastOpenRequest.current = openedCase;
    api(openedCase, { method: 'POST', keepalive: true, headers: { 'X-Audit-Attempt': auditAttemptId() } })
      .then(() => setOpenRevision((value) => value + 1))
      .catch(() => { if (lastOpenRequest.current === openedCase) lastOpenRequest.current = undefined; });
  }, [openedCase]);

  const refreshFiles = useCallback(async (signal?: AbortSignal) => {
    setFilesLoading(true);
    setFileProblem('');
    try {
      const result = await requestIntake<SourceFile[]>('/slides', 'GET', undefined, signal);
      if (!signal?.aborted) { setFiles(result); if (!signal) setRevision((value) => value + 1); }
    } catch {
      if (!signal?.aborted) setFileProblem('Unable to load scan files. Select Refresh List to retry.');
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

  const clinicalCaseEndpoint = current?.recordId ? `/api/clinical/${encodeURIComponent(user.organization)}/cases/${current.recordId}` : undefined;
  const historyEndpoint = requestAllowed && clinicalCaseEndpoint ? clinicalCaseEndpoint + '/patient-history' : undefined;
  const frozenEndpoint = requestAllowed && clinicalCaseEndpoint && current?.worklist?.priority === 'frozen' ? clinicalCaseEndpoint + '/frozen' : undefined;
  const logsEndpoint = requestAllowed && clinicalCaseEndpoint ? clinicalCaseEndpoint + '/logs' : undefined;
  const notesEndpoint = clinicalCaseEndpoint ? clinicalCaseEndpoint + '/notes' : undefined;
  const attachmentsEndpoint = clinicalCaseEndpoint ? clinicalCaseEndpoint + '/attachments' : undefined;

  function showModal(next: Modal) { setFormError(''); setModal(next); }
  function navigateCase(item: DemoCase, scan?: string) {
    location.hash = withCollection(`#${item.source === 'files' ? 'file-case' : 'case'}/${encodeURIComponent(item.recordId ?? item.id)}${scan ? `/slides/${encodeURIComponent(scan)}` : ''}`, page.collectionOrigin);
  }
  function navigateViewer(item: DemoCase, slide?: string) {
    location.hash = withCollection(`#${item.source === 'files' ? 'file-viewer' : 'viewer'}/${encodeURIComponent(item.recordId ?? item.id)}${slide ? `/${encodeURIComponent(slide)}` : ''}`, page.collectionOrigin);
  }
  function goBack() { location.hash = `worklist/${lastScope}`; }
  function openEditor(item: DemoCase, scan?: string) {
    if (!item.recordId) return;
    setSelected(item.id);
    location.hash = `case/${item.recordId}/editor${scan ? '/' + encodeURIComponent(scan) : ''}`;
  }

  async function continueIntake(caseNumber: string, signal: AbortSignal) {
    const params = new URLSearchParams({ q: caseNumber, scope: 'all', order: 'case_number:asc' });
    for (let offset = 0; !signal.aborted;) {
      params.set('offset', String(offset));
      const listing = await api<Result>('/api/worklist?' + params, { signal });
      if (signal.aborted) return;
      const existing = listing.rows.find((row) => row.record_id && row.case_number === caseNumber);
      if (existing) { openEditor(caseView(existing)); return; }
      offset += listing.rows.length;
      if (!listing.rows.length || offset >= listing.total) break;
    }
    if (signal.aborted) return;
    const item = buildFileCases(files).find(({ id }) => id === caseNumber);
    if (!item) throw new Error('Refresh the scan list and try again.');
    openWorkflow(item, 'confirm');
  }

  function openWorkflow(item: DemoCase, action: WorkflowAction) {
    setWorkflowError('');
    setIntakePatient(undefined);
    setWorkflow({ item, action });
  }

  const pendingAssignment = workflow?.loading ? workflow.item.recordId : undefined;
  useEffect(() => {
    if (!pendingAssignment) return;
    const controller = new AbortController();
    api<WorklistEntry>('/api/worklist/' + encodeURIComponent(pendingAssignment), { signal: controller.signal })
      .then((entry) => {
        if (controller.signal.aborted) return;
        const item = caseView(entry);
        if (item.status === 'Review Complete') setWorkflowError('This case is already review complete.');
        setWorkflow({ item, action: 'assignment' });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWorkflowError('Unable to load the latest assignment. Reload to try again.');
          setWorkflow((entry) => entry && { ...entry, item: { ...entry.item, candidates: undefined }, loading: false });
        }
      });
    return () => controller.abort();
  }, [pendingAssignment]);

  function refreshWorkflow() {
    setWorkflow(undefined);
    setRevision((value) => value + 1);
    if (workflow?.action === 'confirm') void refreshFiles();
  }

  async function saveWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workflow || workflow.loading || saving || (workflow.action === 'assignment' && !workflow.item.candidates?.some(({ id }) => id !== workflow.item.assignedTo))) return;
    const { item, action } = workflow;
    const fields = new FormData(event.currentTarget);
    const prefix = `/api/clinical/${encodeURIComponent(user.organization)}`;
    setSaving(true);
    setWorkflowError('');
    try {
      if (action === 'confirm') {
        const { id } = await api<{ id: string }>(`${prefix}/files/${encodeURIComponent(item.id)}/case`,
          jsonBody('POST', { files: item.slides.map((slide) => ({ id: slide.id, version: slide.intakeVersion })),
            patient_id: intakePatient?.id ?? null, patient_version: intakePatient?.version ?? null, confirm_patient: Boolean(intakePatient) }));
        setSelected(item.id);
        location.hash = `case/${id}/editor`;
      } else {
        const reason = String(fields.get('reason') ?? '').trim();
        if (action === 'review' && !reason) { setWorkflowError('Enter a reason for the change.'); return; }
        const data = action === 'assignment' ? { assignee_id: fields.get('assignee'), reason: reason || undefined }
          : { status: item.status === 'In Review' ? 'reviewed' : 'in_review', note: String(fields.get('note') ?? ''), reason };
        await api(`${prefix}/cases/${item.recordId}/${action}`, jsonBody('PATCH', { ...data, version: item.version }));
      }
      setWorkflow(undefined);
      setRevision((value) => value + 1);
    } catch (failure) {
      setWorkflowError(failure instanceof Error ? failure.message : 'Unable to save the case changes.');
    } finally { setSaving(false); }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get('case-number')).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(id)) {
      setFormError('Case IDs can contain letters, numbers, periods, hyphens, and underscores.');
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
      setSelected(id);
      location.hash = `case/${record.id}/editor`;
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Unable to register the case.');
    } finally { setSaving(false); }
  }

  const worklistNavigation = <nav aria-label="Worklist Navigation" className="worklist-nav">
    <div className="worklist-nav-scopes">{worklistTabs.map(({ id, href, label, count, icon: Icon }) => <a key={id} href={href}
      aria-current={(page.view === 'scans' ? id === 'scans' : page.view === 'worklist' && id === page.scope) ? 'page' : undefined}>
      <Icon size={16} aria-hidden="true" /><span>{label}</span><small>{count}</small>
    </a>)}</div>
    <div className="worklist-nav-destinations">
      {requestAllowed && <a href="#collections" aria-label="Open Tumor Board and Collections"><FolderKanban size={16} aria-hidden="true" /> Tumor Board</a>}
      {orAllowed && <a href="#or" aria-label="Open Operating Room Results"><RadioTower size={16} aria-hidden="true" /> OR Results</a>}
    </div>
  </nav>;

  return <div className="app-shell" data-view={page.view} data-navigation-collapsed={collapseNavigation}
    style={navigationWidth === undefined ? undefined : { '--sidebar-width': `${navigationWidth}px` } as CSSProperties}>
    <aside className="sidebar" id="main-navigation">
      <a className="brand" href="#worklist/all" aria-label="MeDIAuto Studio Home" title="MeDIAuto Studio Home">
        <img className="brand-logo" src={brandLogo} alt="" width={3776} height={1120} />
        <img className="brand-mark" src={brandIcon} alt="" width={32} height={32} />
      </a>
      <nav aria-label="Workspace Navigation" className="side-nav">
        <p className="side-nav-title">Workspace</p>
        <div className="side-nav-group" role="group" aria-label="Case Worklists">
          <p>Case Worklists</p>
          {worklistTabs.map(({ id, href, count, icon: Icon, sideLabel: label }) => {
            const selected = page.view === 'scans' ? id === 'scans'
              : ['worklist', 'case', 'viewer', 'related-comparison', 'request', 'roi-search'].includes(page.view) && id === scope;
            const accessibleLabel = id === 'scans' ? 'Open Slide Intake' : label;
            return <a key={id} href={href} aria-label={accessibleLabel} title={label} aria-current={selected ? 'location' : undefined}>
              <Icon size={18} aria-hidden="true" /><span>{label}</span><small>{count}</small>
            </a>;
          })}
        </div>
        {(orAllowed || requestAllowed) && <div className="side-nav-group" role="group" aria-label="Collaboration">
          <p>Collaboration</p>
          {orAllowed && <a href="#or" aria-label="OR Results" title="OR Results" aria-current={page.view === 'or' ? 'page' : undefined}><RadioTower size={18} /> <span>OR Results</span></a>}
          {requestAllowed && <a href="#collections" aria-label="Collections and Tumor Board" title="Collections and Tumor Board"
            aria-current={page.view === 'collections' ? 'page' : undefined}><FolderKanban size={18} /> <span>Collections and Tumor Board</span></a>}
        </div>}
        {settingsAllowed && <div className="side-nav-group" role="group" aria-label="Administration">
          <p>Administration</p>
          {accountLinks.map(({ tab, label, name, icon: Icon }) => <a key={tab} href={accountSettingsHref(tab)} aria-label={label}
            title={label} aria-current={accountTab === tab ? 'page' : undefined}><Icon size={18} aria-hidden="true" /><span>{name}</span></a>)}
          <a href="#settings" aria-label="Settings" title="Settings" aria-current={settingsPage && !accountTab && settingsPage.section !== 'notifications' ? 'page' : undefined}><Settings2 size={18} aria-hidden="true" /><span>Settings</span></a>
        </div>}
        <div className="side-nav-group" role="group" aria-label="Personal Settings">
          <p>Personal</p>
          <a href="#settings/notifications" aria-label="Notification Preferences" title="Notification Preferences"
            aria-current={settingsPage?.section === 'notifications' ? 'page' : undefined}><Bell size={18} aria-hidden="true" /><span>Preferences</span></a>
        </div>
      </nav>
      <div className="side-footer"><button aria-label="Service Status" title="Service Status" onClick={() => showModal('system')}><Activity size={18} /><span>Service Status</span><i className={health?.status === 'ok' ? 'online' : ''} /></button></div>
      {!collapseNavigation && <NavigationResizeHandle onResize={setNavigationWidth} />}
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs">
        <button className="icon-button navigation-toggle" type="button" aria-controls="main-navigation"
          aria-expanded={!collapseNavigation} aria-label={collapseNavigation ? 'Expand Navigation' : 'Collapse Navigation'}
          title={collapseNavigation ? 'Expand Navigation' : 'Collapse Navigation'} onClick={() => setNavigationCollapsed(!collapseNavigation)}>
          {collapseNavigation ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button><span>Pathology Workspace</span><ChevronRight size={15} /><strong>{{ viewer: 'WSI Viewer', 'related-comparison': 'Pap and Biopsy Comparison', 'roi-search': 'ROI Similarity Search', case: 'Case Details', request: 'Analysis and Consultation Requests', or: 'OR Results', collections: 'Collections and Tumor Board', scans: 'Slide Registration', settings: (settingsAllowed ? accountLocation?.label : undefined) ?? 'Settings', worklist: 'Worklist' }[page.view]}</strong></div>
        <div className="header-actions"><NotificationCenter key={user.id} organization={user.organization} requestId={page.view === 'request' ? page.id : undefined} /><span className="demo-label"><FlaskConical size={15} /> Demo Environment</span><button className="emr-chip" onClick={() => showModal('system')}><span /> EMR {emr} · LIS {lis}</button><span className="identity"><UserRound size={17} />{user.display_name}<small className="identity-role">{accountRoleLabels[user.role]}</small></span><button className="button secondary" onClick={logout}>Sign Out</button></div>
      </header>
      <main className="workspace-main" data-view={page.view}>
        {requestAllowed && page.collectionOrigin && <a className="back-link workspace-collection-back"
          href={collectionHref(page.collectionOrigin.collection, page.collectionOrigin.entry)}>Back to Collection</a>}
        {page.view === 'scans' && worklistNavigation}
        <div className="worklist-page" hidden={page.view !== 'worklist'}>
          {listError && <div className="notice" role="alert">{listError}<button className="button secondary" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
          <Worklist navigation={page.view === 'worklist' ? worklistNavigation : undefined} onScope={setWorklistScope} canReportFrozen={requestAllowed} mayShare={user.role === 'admin'} cases={worklistCases} loading={listLoading} scope={scope} current={selectedCase} onSelect={setSelected}
            total={result.total} counts={result.counts} filteredCounts={result.filtered_counts} queues={queues} workload={result.workload} onQueueChanged={refreshQueues} assignees={result.assignees} onQuery={setQuery}
            onOpen={(id) => { const item = worklistCases.find((row) => row.id === id); if (item) navigateCase(item); }}
            onViewer={(id, slide) => { const item = worklistCases.find((row) => row.id === id); if (item) navigateViewer(item, slide); }}
            onAssign={writable ? (item) => {
              setWorkflowError('');
              setWorkflow({ item, action: 'assignment', loading: true });
            } : undefined}
            onEdit={writable ? openEditor : undefined}
            onConfirm={intakeAllowed ? (item) => {
              const group = buildFileCases(files).find(({ id }) => id === item.id);
              if (group) openWorkflow(group, 'confirm');
              else navigateCase(item);
            } : undefined}
            onReference={requestAllowed ? (item) => { if (item.recordId) setReferenceCase({ id: item.recordId, title: item.id }); } : undefined}
            onRegister={writable ? () => showModal('register') : undefined} />
        </div>
        {page.view === 'settings' && (settingsAllowed || page.section === 'notifications') && <section className="panel settings-masthead">
          <div className="page-heading"><div className="worklist-title"><span className="workspace-title-icon"><Settings2 size={20} aria-hidden="true" /></span>
            <h1>{accountTab ? 'Accounts' : page.section === 'notifications' ? 'Preferences' : 'Settings'}</h1></div>
            {accountTab && <span className="settings-organization">{user.organization}</span>}
          </div>
          <nav className="worklist-nav" aria-label="Settings Navigation">
            {settingsSections.filter(({ admin }) => !admin || settingsAllowed).map(({ key, label, icon: Icon }) =>
              <a key={key} href={key ? '#settings/' + key : '#settings'} aria-current={(page.section ?? '') === key ? 'page' : undefined}>
                <Icon size={16} aria-hidden="true" /> {label}
              </a>)}
          </nav>
        </section>}
        {page.view === 'settings' && page.section === 'notifications' && <>
          {page.noteCase && <a className="back-link" href={caseHref(page.noteCase, 'notes', page.noteScan)}>Back to Case Notes</a>}
          {page.requestReturn && <a className="back-link" href={page.requestReturn}>Back to Request</a>}
          <NotificationSettings organization={user.organization} />
        </>}
        {page.view === 'settings' && page.section !== 'notifications' && settingsAllowed && (page.section === 'accounts' ? <AccountsSettings tab={accountTab ?? 'directory'} /> : page.section === 'groups'
          ? <WorkgroupSettings onChanged={refreshQueues} /> : page.section === 'analysis' ? <AnalysisSettings organization={user.organization} />
          : page.section === 'pap' ? <Suspense fallback={<p role="status">Loading Pap policy…</p>}>
            <PapPolicySettings organization={user.organization} /></Suspense> : <>
          {intakeAllowed && <IntakeSettings refresh={refreshFiles} emrConnected={integration?.emr.state === 'connected'} />}
          <IntegrationSettings org={user.organization} status={integration} onRefresh={refreshIntegration} />
        </>)}
        {page.view === 'scans' && intakeAllowed && <IntakePage files={files} loading={filesLoading} problem={fileProblem} refresh={refreshFiles} onContinue={continueIntake} emr={emr} />}
        {((page.view === 'settings' && page.section !== 'notifications' && !settingsAllowed) || (page.view === 'scans' && !intakeAllowed)) && <div className="panel empty"><strong>You do not have permission to open this page.</strong><button className="button secondary" onClick={goBack}>Back to Worklist</button></div>}
        {page.view === 'or' && (orAllowed ? <ORResults organization={user.organization} caseId={page.id} scan={page.scan} canOpenCase={settingsAllowed} />
          : <div className="panel empty"><strong>You do not have permission to open the OR view.</strong></div>)}
        {page.view === 'collections' && (requestAllowed ? <CollectionWorkspace organization={user.organization} selected={page.id} selectedEntry={page.entry} />
          : <div className="panel empty"><strong>You do not have permission to open Collections.</strong></div>)}
        {page.view === 'roi-search' && (requestAllowed
          ? <RoiSearchPage key={`${page.location.caseId}/${page.location.scanId}/${page.location.roiId}`} location={page.location}
            initialOrgan={roiSearchPreference.current?.roi === page.location.roiId ? roiSearchPreference.current.organ : undefined}
            onOrganChange={(organ) => { roiSearchPreference.current = { roi: page.location.roiId, organ }; }} />
          : <div className="panel empty"><strong>You do not have permission to search saved ROIs.</strong></div>)}
        {page.view === 'related-comparison' && <Suspense fallback={<p role="status">Loading comparison…</p>}>
          <RelatedComparison key={page.id + '/' + (page.anchor ?? '')} organization={user.organization} id={page.id} anchor={page.anchor} returnToPapReview={page.returnToPapReview} returnPapScan={page.returnPapScan} />
        </Suspense>}
        {page.view === 'request' && <RequestPage key={page.id} id={page.id} organization={user.organization} sourceScan={page.sourceScan} fromAnalysis={page.fromAnalysis} collectionOrigin={page.collectionOrigin} />}
        {casePage && (!current ? <div className="panel empty"><CircleHelp size={28} /><strong>{casePage.files
          ? (intakeAllowed && filesLoading ? 'Loading case…' : 'Unable to load the case.')
          : detail?.key === detailKey ? detail?.error : 'Loading case…'}</strong><button className="button secondary" onClick={goBack}>Back to Worklist</button></div>
          : casePage.view === 'case' ? <CaseDetail key={current.id} item={current} relatedEndpoint={requestAllowed && clinicalCaseEndpoint ? clinicalCaseEndpoint + '/related-cases' : undefined} selectedScan={casePage.selectedScan} historyEndpoint={historyEndpoint} attachmentsEndpoint={attachmentsEndpoint} logsEndpoint={logsEndpoint} notesEndpoint={notesEndpoint}
            initialTab={current.recordId ? casePage.tab : undefined} collectionOrigin={casePage.collectionOrigin}
            editor={current.recordId ? <CaseEditor key={casePage.selectedScan ?? ''} item={current} focusScan={casePage.tab === 'editor' ? casePage.selectedScan : undefined} organization={user.organization} editable={writable && current.status !== 'Review Complete'}
              canImport={user.role === 'admin'} onChanged={patientChanged}
              patient={<PatientIntegration item={current} org={user.organization} editable={writable} status={integration} onChanged={patientChanged} />} /> : undefined}
            frozen={frozenEndpoint && current.recordId ? <FrozenWorkflow caseId={current.recordId} scan={current.slides.find(({ id }) => id === casePage.selectedScan)?.id} endpoint={frozenEndpoint} /> : undefined}
            requests={requestAllowed && current.recordId ? <CaseRequests organization={user.organization} item={current} sourceScan={casePage.selectedScan} focusIhc={casePage.focusIhc} collectionOrigin={casePage.collectionOrigin} /> : undefined}
            report={requestAllowed && current.recordId && clinicalCaseEndpoint ? <>
              <CaseReport endpoint={clinicalCaseEndpoint + '/report'} caseId={current.recordId} caseVersion={current.version} caseChanged={patientChanged} />
              <ReportDraftReferences organization={user.organization} caseId={current.recordId} />
            </> : undefined} emr={emr} onBack={goBack} onViewer={(slide) => navigateViewer(current, slide)}
            patientIntegration={current.recordId ? <PatientIntegration item={current} org={user.organization}
              editable={writable} status={integration} onChanged={patientChanged} /> : undefined}
            dates={current.recordId ? <CaseDates item={current} organization={user.organization} editable={writable} onChanged={patientChanged} /> : undefined}
            routing={current.recordId ? <CaseRouting item={current} editable={writable} organization={user.organization}
              queues={queues} onChanged={patientChanged} /> : undefined}
            onAssign={mayAssign ? () => openWorkflow(current, 'assignment') : undefined}
            onReview={mayReview ? () => openWorkflow(current, 'review') : undefined}
            onConfirm={intakeAllowed && current.source === 'files' ? () => openWorkflow(current, 'confirm') : undefined} />
          : <Viewer key={current.id} item={current} relatedEndpoint={requestAllowed && clinicalCaseEndpoint ? clinicalCaseEndpoint + '/related-cases' : undefined} viewerAccount={user.id}
            analysisEndpoint={requestAllowed ? clinicalCaseEndpoint : undefined} organization={user.organization}
            openRequests={casePage.openRequests} openReview={casePage.openReview} openAnalysis={casePage.openAnalysis} papMode={casePage.papMode} collectionOrigin={casePage.collectionOrigin}
            reviewEndpoint={requestAllowed && clinicalCaseEndpoint ? clinicalCaseEndpoint + '/review-room' : undefined} activeSlide={casePage.slide} initialSnapshot={casePage.snapshot} initialRoi={casePage.roi} roiOrigin={casePage.roiOrigin} historyEndpoint={historyEndpoint} attachmentsEndpoint={attachmentsEndpoint} logsEndpoint={logsEndpoint} notesEndpoint={notesEndpoint} hasFrozenWorkflow={!!frozenEndpoint} canRequest={requestAllowed && !!current.recordId} onSlide={(id) => navigateViewer(current, id)} onBack={(scan) => navigateCase(current, scan)}
            onReview={mayReview ? () => openWorkflow(current, 'review') : undefined} />)}
      </main>
    </div>
    {referenceCase && <AddCaseReference organization={user.organization} record={referenceCase} initialDestination={page.view === 'worklist' ? page.collectionTarget : undefined} onClose={() => setReferenceCase(undefined)} />}
    {modal === 'register' && <ModalWindow title="Register Case" onClose={() => showModal(null)}><form onSubmit={(event) => void register(event)}>
      <label className="form-field">Case ID<input name="case-number" placeholder="IMS-26-0149" required maxLength={40} /></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => showModal(null)}>Cancel</button><button className="button primary" type="submit" disabled={saving}>Register</button></div>
    </form></ModalWindow>}
    {workflow && <ModalWindow title={workflow.action === 'confirm' ? 'Confirm Case from Registered Files'
      : workflow.action === 'assignment' ? (workflow.item.assignedTo ? 'Reassign Case' : 'Assign Case')
      : workflow.item.status === 'In Review' ? 'Review Complete' : 'Start Review'}
      onClose={() => { if (!saving) setWorkflow(undefined); }}>
      <form onSubmit={(event) => void saveWorkflow(event)}>
        {workflow.action === 'confirm' ? <>
          <p>{workflow.item.id} has {workflow.item.slides.length} registered scans to link to this case.</p>
          <PatientMatch item={workflow.item} organization={user.organization} selected={intakePatient} onSelect={setIntakePatient} />
        </> : <>
          {workflow.loading && <p role="status">Loading eligible pathologists…</p>}
          {workflow.action === 'assignment' && <label className="form-field">Assigned Pathologist
            <select name="assignee" required disabled={workflow.loading || !workflow.item.candidates?.length} defaultValue="">
              <option value="">Select the assigned pathologist</option>
              {workflow.item.candidates?.filter(({ id }) => id !== workflow.item.assignedTo)
                .map(({ id, name, username }) => <option key={id} value={id}>{name} ({username})</option>)}
            </select>
          </label>}
          {workflow.action === 'assignment' && !workflow.loading && !workflow.item.candidates?.some(({ id }) => id !== workflow.item.assignedTo) &&
            <p className="muted">No active pathologists are available.</p>}
          {workflow.action === 'assignment' && workflow.item.status === 'In Review' &&
            <p>Reassigning returns the case to Assigned so the new pathologist can start the review.</p>}
          {workflow.action === 'review' && workflow.item.status === 'In Review' &&
            <p>This sets the IMS review status to Review Complete.</p>}
          {workflow.action === 'review' && <label className="form-field">Reason for Change<textarea name="reason" required maxLength={240} rows={2} /></label>}
          {workflow.action === 'assignment' && workflow.item.assignedTo &&
            <label className="form-field">Reason for Change (Optional)<textarea name="reason" maxLength={240} rows={2} /></label>}
          {workflow.action === 'review' && <label className="form-field">Review Note (Optional)<textarea name="note" maxLength={2000} rows={3} /></label>}
        </>}
        {workflowError && <p className="form-error" role="alert">{workflowError}</p>}
        <div className="dialog-actions">
          {workflowError && <button type="button" className="button secondary" onClick={() => {
            if (workflow.action === 'assignment' && !casePage) {
              setWorkflowError('');
              setWorkflow({ ...workflow, loading: true });
            } else refreshWorkflow();
          }}>Reload Latest Status</button>}
          <button type="button" className="button secondary" disabled={saving} onClick={() => setWorkflow(undefined)}>Cancel</button>
          <button className="button primary" type="submit" disabled={saving || workflow.loading || (workflow.action === 'assignment' && !workflow.item.candidates?.some(({ id }) => id !== workflow.item.assignedTo))}>{workflow.action === 'confirm' ? 'Confirm' : 'Save'}</button>
        </div>
      </form>
    </ModalWindow>}
    {modal === 'system' && <ModalWindow title="Service Status" onClose={() => showModal(null)}>
      <dl className="key-values" aria-live="polite"><div><dt>FastAPI</dt><dd>{health ? 'Responding' : serviceError ? 'No Response' : 'Checking…'}</dd></div><div><dt>PostgreSQL</dt><dd>{health ? health.database === 'connected' ? 'Connected' : 'Connection Unavailable' : '—'}</dd></div><div><dt>EMR</dt><dd>{emr}</dd></div><div><dt>LIS</dt><dd>{lis}</dd></div></dl>
      <div className="dialog-actions"><button className="button secondary" disabled={!health && !serviceError} onClick={() => { setHealth(null); setServiceError(false); setCheckAttempt(checkAttempt + 1); }}>Check Again</button></div>
    </ModalWindow>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><SessionGate>{(user, logout) => <Workspace user={user} logout={logout} />}</SessionGate></StrictMode>);
