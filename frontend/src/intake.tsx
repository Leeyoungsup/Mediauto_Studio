import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowUp, FileImage, FolderOpen, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { codipaiRule, emptyFields, fieldLabels, formatIntakeDate, requestIntake } from './intake-api';
import type { Entry, FilenameRule, Match, RuleSet, SlideFields, SourceFile } from './intake-api';

function message(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}

export function IntakePage({ files, loading, problem, refresh }: {
  files: SourceFile[]; loading: boolean; problem: string; refresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<{ id: string; version: number } | null>(null);
  const [draft, setDraft] = useState<SlideFields>(emptyFields);
  const [problemForm, setProblemForm] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const caseField = useRef<HTMLInputElement>(null);
  const edited = files.find(({ id }) => id === opened?.id);
  const pending = files.filter(({ entry }) => !entry).length;
  const matching = files.filter((file) => (filter === 'all' || (filter === 'pending' ? !file.entry : file.entry))
    && `${file.filename} ${file.entry?.fields.case_id ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => { if (opened) caseField.current?.focus(); }, [opened]);

  function edit(file: SourceFile) {
    setOpened({ id: file.id, version: file.entry?.version ?? 0 }); setDraft(file.entry?.fields ?? { ...emptyFields }); setNotice(''); setProblemForm('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edited || !opened) return;
    setSaving(true); setProblemForm(''); setNotice('');
    try {
      await requestIntake<Entry>(`/slides/${edited.id}`, 'PUT', { fields: draft, version: opened.version });
      await refresh();
      setOpened(null);
      setNotice('슬라이드 정보를 저장했습니다.');
    } catch (error) {
      setProblemForm(message(error));
    } finally { setSaving(false); }
  }

  return <>
    <div className="page-heading"><div><h1>슬라이드 등록</h1><p>data/ 폴더의 NDPI·SVS 파일을 확인하고 케이스에 연결합니다.</p></div>
      <div className="actions"><button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} /> 목록 갱신</button><a className="button primary" href="#settings"><Settings2 size={16} /> 파일명 규칙</a></div>
    </div>
    {problem && <p className="notice" role="alert">{problem}</p>}
    {notice && <p className="success-note" role="status">{notice}</p>}
    <section className="panel">
      <div className="panel-title"><div className="title-inline"><h2>스캔 파일</h2><span className="count">{files.length}</span></div></div>
      <div className="filters intake-filters">
        <div className="actions" aria-label="슬라이드 등록 상태">
          {[['pending', `미입력 슬라이드 (${pending})`], ['registered', `등록됨 (${files.length - pending})`], ['all', '모든 파일']].map(([value, label]) =>
            <button key={value} className={filter === value ? 'button primary' : 'button secondary'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <label className="search-field"><input aria-label="스캔 파일 검색" placeholder="파일명 또는 Case ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      <div className="table-scroll"><table className="file-table"><thead><tr><th scope="col">파일명</th><th scope="col">형식</th><th scope="col">Case ID</th><th scope="col">Slide ID</th><th scope="col">등록 출처</th><th scope="col">수정</th></tr></thead>
        <tbody>{matching.map((file) => <tr key={file.id}>
          <td><strong className="file-name"><FileImage size={15} />{file.filename}</strong><small className="muted">{(file.size / 2 ** 20).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB · {formatIntakeDate(file.modified)}</small></td>
          <td>{file.format}</td><td>{file.entry?.fields.case_id || '—'}</td><td>{file.entry?.fields.slide_id || '—'}</td>
          <td><span className={file.entry ? 'status-pill status-3' : 'status-pill status-0'}>{file.entry ? file.entry.source === 'rule' ? '파일명 규칙' : '직접 입력' : '미입력'}</span></td>
          <td><button className="button secondary" onClick={() => edit(file)} aria-label={`${file.filename} ${file.entry ? '정보 수정' : '직접 입력'}`}>{file.entry ? '정보 수정' : '직접 입력'}</button></td>
        </tr>)}</tbody>
      </table></div>
      {!matching.length && <div className="empty" role="status"><FolderOpen size={24} /><p>{loading ? '파일 목록을 불러오는 중입니다.' : '이 조건의 스캔 파일이 없습니다.'}</p></div>}
    </section>
    {edited && <section className="panel intake-editor" aria-label="슬라이드 정보 입력">
      <div className="panel-title"><h2>슬라이드 정보 입력</h2><button className="button secondary" onClick={() => setOpened(null)} disabled={saving}>닫기</button></div>
      <form className="detail-content" onSubmit={(event) => void submit(event)}>
        <p className="file-name">{edited.filename}</p>
        <div className="form-grid">
          {(Object.keys(fieldLabels) as (keyof SlideFields)[]).map((key) => <label key={key} className="form-field">{fieldLabels[key]}
            <input ref={key === 'case_id' ? caseField : undefined} value={draft[key]} required={key === 'case_id' || key === 'slide_id'} maxLength={key === 'case_id' || key === 'slide_id' ? 80 : 120}
              pattern={key === 'case_id' || key === 'slide_id' ? '[A-Za-z0-9][A-Za-z0-9._\\-]{0,79}' : undefined}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        </div>
        {problemForm && <p className="form-error" role="alert">{problemForm}</p>}
        <div className="actions"><button className="button primary" type="submit" disabled={saving}>{saving ? '저장 중' : '슬라이드 정보 저장'}</button></div>
      </form>
    </section>}
  </>;
}

const ruleFields: { key: keyof FilenameRule; label: string; hint?: string }[] = [
  { key: 'name', label: '규칙 이름' },
  { key: 'pattern', label: '파일명 패턴 (확장자 제외)', hint: '예: 병원-{case}-{block}-{slide}' },
  { key: 'case_id', label: 'Case ID 형식', hint: '{case}' },
  { key: 'slide_id', label: 'Slide ID 형식', hint: '{block}-{slide}' },
  { key: 'specimen', label: '검체 형식' }, { key: 'stain', label: '염색 코드 형식' },
  { key: 'patient_number', label: '환자번호 형식' },
];

export function IntakeSettings({ refresh, emrConnected }: { refresh: () => Promise<void>; emrConnected: boolean }) {
  const [saved, setSaved] = useState<RuleSet | null>(null);
  const [rules, setRules] = useState<FilenameRule[]>([]);
  const [preview, setPreview] = useState<Match[] | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const dirty = Boolean(saved && JSON.stringify(saved.rules) !== JSON.stringify(rules));

  useEffect(() => {
    const controller = new AbortController();
    requestIntake<RuleSet>('/rules', 'GET', undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setSaved(result); setRules(result.rules); }
    }).catch((error) => { if (!controller.signal.aborted) setProblem(message(error)); });
    return () => controller.abort();
  }, []);

  function update(next: FilenameRule[]) { setRules(next); setPreview(null); setProblem(''); setNotice(''); }
  function move(index: number, direction: number) {
    const next = [...rules];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    update(next);
  }

  async function act(action: 'preview' | 'save' | 'apply') {
    if (!saved) return;
    setWorking(true); setProblem(''); setNotice('');
    try {
      if (action === 'preview') {
        setPreview(await requestIntake<Match[]>('/rules/preview', 'POST', { rules }));
      } else if (action === 'save') {
        const result = await requestIntake<RuleSet>('/rules', 'PUT', { rules, version: saved.version });
        setSaved(result); setRules(result.rules); setNotice('파일명 규칙을 저장했습니다.');
      } else {
        const result = await requestIntake<{ applied: number; unchanged: number; unmatched: number }>('/rules/apply', 'POST', { version: saved.version });
        await refresh();
        setNotice(`신규 등록 ${result.applied}건 · 기존 등록 유지 ${result.unchanged}건 · 미입력 유지 ${result.unmatched}건`);
      }
    } catch (error) { setProblem(message(error)); }
    finally { setWorking(false); }
  }

  return <>
    <div className="page-heading"><div><h1>설정</h1><p>EMR 연결 없이 사용할 파일명 규칙을 정의합니다.</p></div><a className="button secondary" href="#scans">슬라이드 등록으로</a></div>
    {problem && <p className="notice" role="alert">{problem}</p>}
    {notice && <p className="success-note" role="status">{notice}</p>}
    <section className="panel" aria-label="파일명 규칙">
      <div className="panel-title"><div className="title-inline"><h2>파일명 규칙</h2><span className="count">{rules.length}</span></div>
        <div className="actions"><button className="button secondary" disabled={!saved || working || rules.length >= 20 || rules.some(({ name }) => name === codipaiRule.name)} onClick={() => update([...rules, codipaiRule])}>CODIPAI 예제 불러오기</button>
          <button className="button secondary" disabled={!saved || working || rules.length >= 20} onClick={() => update([...rules, { name: '', pattern: '', case_id: '', slide_id: '', specimen: '', stain: '', patient_number: '' }])}><Plus size={15} /> 규칙 추가</button></div>
      </div>
      <div className="detail-content">
        <p className="muted">파일명의 일부를 중괄호로 지정한 뒤 출력 형식에 넣으세요. 위쪽 규칙부터 미입력 파일에 적용합니다. 기존 등록 정보는 유지됩니다.</p>
        {saved && !rules.length && <p className="empty-inline">저장한 규칙이 없습니다. 예제를 불러오거나 규칙을 추가하세요.</p>}
        {rules.map((rule, index) => <fieldset className="rule-card" key={index} disabled={working}>
          <legend>{rule.name || '새 파일명 규칙'}</legend>
          <div className="actions rule-order">
            <button type="button" className="icon-button" aria-label={`규칙 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="icon-button" aria-label={`규칙 ${index + 1} 아래로`} disabled={index === rules.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
            <button type="button" className="icon-button" aria-label={`규칙 ${index + 1} 삭제`} onClick={() => update(rules.filter((_, position) => position !== index))}><Trash2 size={16} /></button>
          </div>
          <div className="form-grid">{ruleFields.map(({ key, label, hint }) => <label className={`form-field ${key === 'pattern' ? 'pattern-field' : ''}`} key={key}>{label}
            <input value={rule[key]} placeholder={hint} maxLength={120} onChange={(event) => update(rules.map((item, position) => position === index ? { ...item, [key]: event.target.value } : item))} />
          </label>)}</div>
        </fieldset>)}
        <div className="actions">
          <button className="button secondary" disabled={working || !rules.length} onClick={() => void act('preview')}>미리보기</button>
          <button className="button secondary" disabled={working || !dirty} onClick={() => void act('save')}>규칙 저장</button>
          <button className="button primary" disabled={working || dirty || emrConnected || !saved?.rules.length} onClick={() => void act('apply')}>미입력 슬라이드에 적용</button>
        </div>
        {emrConnected && <p className="muted">파일명 규칙은 EMR 미연결 상태에서 적용할 수 있습니다.</p>}
      </div>
    </section>
    {preview && <section className="panel intake-editor"><div className="panel-title"><h2>파일명 규칙 미리보기</h2><span className="count">{preview.filter(({ match }) => match).length}/{preview.length} 일치</span></div>
      <div className="table-scroll"><table className="file-table"><thead><tr><th scope="col">파일명</th><th scope="col">적용될 규칙</th><th scope="col">Case ID</th><th scope="col">Slide ID</th></tr></thead>
        <tbody>{preview.map(({ id, filename, match }) => <tr key={id}><td>{filename}</td><td>{match?.rule ?? '규칙 불일치'}</td><td>{match?.fields.case_id ?? '—'}</td><td>{match?.fields.slide_id ?? '—'}</td></tr>)}</tbody></table></div>
    </section>}
  </>;
}
