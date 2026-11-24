import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { DemoCase } from './demo';
import { api, jsonBody } from './session';

const channels = ['emr', 'lis'] as const;
type Channel = typeof channels[number];
const labels = {
  not_configured: '미설정', configured: '연결 확인 전', disabled: '사용 중지',
  connected: '연결됨', degraded: '연결 장애',
};
type Connection = {
  channel: Channel; mode: 'not_configured' | 'disabled' | 'mock'; scenario: 'normal' | 'unavailable' | 'timeout';
  state: keyof typeof labels; version: number; last_success_at: string | null;
};
export type IntegrationStatus = Record<Channel, Connection>;
type Message = { id: string; channel: Channel; message_id: string; state: string; attempts: number; delivery_conflicts: number; error: string | null };
const messageStates: Record<string, string> = {
  queued: '수신 대기', retry_wait: '재시도 대기', dead_letter: '재시도 한도 도달', applied: '외부 상태 반영',
  conflict: '충돌', duplicate: '중복', stale: '이전 버전', pending_link: '연결 검토 필요',
};
const messageErrors: Record<string, string> = {
  timeout: '응답 시간 초과', unavailable: '외부 장애', older_revision: '이전 버전',
  same_revision_different_data: '같은 버전의 데이터 불일치', patient_demographics_differ: '환자 정보 불일치',
  external_id_wrong_record_type: '레코드 종류 불일치',
};
const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
export const integrationPath = (org: string) => `/api/integration/${encodeURIComponent(org)}`;
export const integrationLabel = (connection: Connection | undefined) =>
  connection ? `${labels[connection.state]}${connection.mode === 'mock' ? ' (Mock)' : ''}` : '확인 중';
const readableError = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';

export function IntegrationSettings({ org, status, onRefresh }: { org: string; status?: IntegrationStatus; onRefresh: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const root = integrationPath(org);
  const base = root + '/connections/';
  useEffect(() => {
    const controller = new AbortController();
    const poll = () => {
      api<Message[]>(root + '/messages', { signal: controller.signal }).then(setMessages).catch(() => {});
      onRefresh();
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [root, onRefresh]);

  async function act(path: string, options: RequestInit) {
    setBusy(true);
    setError('');
    try {
      await api(path, options);
      setMessages(await api<Message[]>(root + '/messages'));
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(false); onRefresh(); }
  }

  return <section className="panel integration-panel" aria-label="EMR·LIS 설정">
    <div className="panel-title"><h2>EMR·LIS 연동</h2></div>
    <div className="detail-content">
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="integration-grid">{channels.map((channel) => {
        const connection = status?.[channel];
        if (!connection) return null;
        return <form key={`${channel}-${connection.version}`} onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void act(base + channel, jsonBody('PUT', { version: connection.version, mode: form.get('mode'), scenario: form.get('scenario') }));
        }}>
          <h3>{channel.toUpperCase()} · {integrationLabel(connection)}</h3>
          <label className="form-field">모드<select name="mode" defaultValue={connection.mode}>
            <option value="not_configured">미설정</option><option value="disabled">사용 중지</option><option value="mock">개발 Mock</option>
          </select></label>
          <label className="form-field">Mock 응답<select name="scenario" defaultValue={connection.scenario}>
            <option value="normal">정상</option><option value="unavailable">연결 장애</option><option value="timeout">응답 지연</option>
          </select></label>
          <p className="muted">마지막 성공 {connection.last_success_at ? date.format(new Date(connection.last_success_at)) : '기록 없음'}</p>
          <div className="actions"><button className="button primary" disabled={busy}>저장</button>
            <button type="button" className="button secondary" disabled={busy || connection.mode !== 'mock'}
              onClick={() => void act(base + channel + '/probe', { method: 'POST' })}>연결 확인</button></div>
        </form>;
      })}</div>
      <h3>외부 수신함</h3>
      {messages.length ? <div className="table-scroll"><table><thead><tr>
        <th>채널</th><th>메시지 ID</th><th>처리 상태</th><th>시도 / ID 충돌</th><th>조작</th>
      </tr></thead><tbody>{messages.map((message) => <tr key={message.id}>
        <td>{message.channel.toUpperCase()}</td><td>{message.message_id}</td>
        <td>{messageStates[message.state] ?? message.state}{message.error && ` · ${messageErrors[message.error] ?? message.error}`}</td>
        <td>{message.attempts} / {message.delivery_conflicts}</td>
        <td>{['retry_wait', 'dead_letter'].includes(message.state) && <button className="button secondary" disabled={busy}
          onClick={() => void act(`${root}/messages/${message.id}/retry`, { method: 'POST' })}>재처리</button>}</td>
      </tr>)}</tbody></table></div> : <p className="muted">수신된 메시지가 없습니다.</p>}
    </div>
  </section>;
}

type Match = { match: 'not_found' } | {
  match: 'found' | 'conflict'; external_id: string; case_version: number; patient_version: number | null;
  revision: number; received_at: string; differences: string[]; data: { display_name?: string; birth_date?: string };
};
type SourceLink = { external_id: string; system: string; state: string; last_synced_at: string | null; external_state: string | null };

export function PatientIntegration({ item, org, editable, status, onChanged }: {
  item: DemoCase; org: string; editable: boolean; status?: IntegrationStatus; onChanged: () => void;
}) {
  const [candidate, setCandidate] = useState<Match>();
  const [links, setLinks] = useState<SourceLink[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const sourceUrl = integrationPath(org) + '/sources';
  const caseUrl = integrationPath(org) + '/cases/' + item.recordId;
  useEffect(() => {
    if (!item.recordId) return;
    const controller = new AbortController();
    const resources = [`${sourceUrl}/case/${item.recordId}`];
    if (item.patient?.id) resources.push(`${sourceUrl}/patient/${item.patient.id}`);
    Promise.all(resources.map((url) => api<SourceLink[]>(url, { signal: controller.signal })))
      .then((rows) => { if (!controller.signal.aborted) setLinks(rows.flat()); })
      .catch(() => {});
    return () => controller.abort();
  }, [item.recordId, item.patient?.id, item.version, sourceUrl, status?.emr.last_success_at]);

  async function submit(event: FormEvent<HTMLFormElement>, action: 'manual-patient' | 'patient-lookup' | 'patient-confirm') {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (action === 'manual-patient') {
        await api(caseUrl + '/' + action, jsonBody('POST', {
          case_version: item.version, display_name: fields.get('name') || null,
          local_reference: fields.get('reference') || null, birth_date: fields.get('birth') || null,
        }));
        setManual(false);
        setCandidate(undefined);
        onChanged();
      } else if (action === 'patient-lookup') {
        setCandidate(undefined);
        setCandidate(await api<Match>(caseUrl + '/' + action, jsonBody('POST', { external_id: fields.get('number') })));
        onChanged();
      } else if (candidate?.match === 'found') {
        const link = await api<SourceLink>(caseUrl + '/' + action, jsonBody('POST', {
          external_id: candidate.external_id, case_version: candidate.case_version, patient_version: candidate.patient_version,
          source_revision: candidate.revision, confirm_differences: fields.has('confirm-differences'), reason: fields.get('reason'),
        }));
        setLinks((rows) => [...rows.filter((value) => value.external_id !== candidate.external_id || value.system !== link.system),
          { ...link, external_id: candidate.external_id, state: 'linked' }]);
        setCandidate(undefined);
        onChanged();
      }
    } catch (failure) { setError(readableError(failure)); onChanged(); }
    finally { setBusy(false); }
  }

  if (!item.recordId) return null;
  return <div className="patient-integration">
    <p className="integration-note">EMR {integrationLabel(status?.emr)} · LIS {integrationLabel(status?.lis)}</p>
    {links.map((link) => <p key={link.system + link.external_id}>
      {link.system} · {link.external_id} · {link.state === 'needs_review' ? '대조 필요' : '연결됨'}
      {link.external_state && ` · 외부 상태 ${link.external_state}`}
      {link.last_synced_at && ` · 마지막 동기화 ${date.format(new Date(link.last_synced_at))}`}
    </p>)}
    {editable && <>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!item.patient && <button className="button secondary" onClick={() => setManual(!manual)}>환자 직접 입력</button>}
      {manual && <form className="integration-form" onSubmit={(event) => void submit(event, 'manual-patient')}>
        <label className="form-field">환자명<input name="name" maxLength={120} /></label>
        <label className="form-field">로컬 환자번호<input name="reference" maxLength={80} /></label>
        <label className="form-field">생년월일<input type="date" name="birth" /></label>
        <button className="button primary" disabled={busy}>환자 등록</button>
      </form>}
      {status?.emr.mode === 'mock' && <form className="integration-form" onSubmit={(event) => void submit(event, 'patient-lookup')}>
        <label className="form-field">EMR 환자번호<input name="number" required maxLength={160} /></label>
        <button className="button secondary" disabled={busy}>EMR 조회</button>
      </form>}
      {candidate?.match === 'not_found' && <p role="status">외부에 일치하는 환자가 없습니다.</p>}
      {candidate && candidate.match !== 'not_found' && <div className="integration-match">
        <h3>EMR 대조 결과</h3>
        <dl className="key-values"><div><dt>외부 환자번호</dt><dd>{candidate.external_id}</dd></div>
          <div><dt>외부 환자명</dt><dd>{candidate.data.display_name ?? '미입력'}</dd></div>
          <div><dt>외부 생년월일</dt><dd>{candidate.data.birth_date ?? '미입력'}</dd></div>
          <div><dt>수신 시각</dt><dd>{date.format(new Date(candidate.received_at))}</dd></div>
        </dl>
        {candidate.match === 'conflict' ? <p role="alert">이 외부 식별자가 다른 환자 기록에 연결되어 있습니다.</p>
          : candidate.patient_version === null ? <p>연결하려면 환자 정보를 먼저 등록하세요.</p>
          : <form className="integration-form" onSubmit={(event) => void submit(event, 'patient-confirm')}>
            {candidate.differences.length > 0 && <label><input type="checkbox" name="confirm-differences" required /> 불일치 항목을 확인했습니다 ({candidate.differences.map((field) => field === 'display_name' ? '환자명' : '생년월일').join(', ')})</label>}
            <label className="form-field">연결 사유<input name="reason" required maxLength={240} /></label>
            <button className="button primary" disabled={busy}>동일 환자 확인 후 연결</button>
          </form>}
      </div>}
    </>}
  </div>;
}
