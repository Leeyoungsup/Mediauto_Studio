import type { DemoCase } from './demo';
import { stateLabel } from './worklist-api';

const actions: Record<string, string> = {
  registered: '케이스 등록', assigned: '담당자 배정', reassigned: '담당자 재배정',
  review_started: '검토 시작', review_completed: '검토 완료', patient_id_changed: '환자 연결 변경',
  external_identifier_linked: '외부 식별자 연결',
};
const sources: Record<string, string> = { manual: '수기 등록', file_intake: '슬라이드 등록', ims: 'IMS' };
const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'medium' });

export function CaseAudit({ item }: { item: DemoCase }) {
  if (!item.audit?.length) return item.history.length
    ? <ul className="timeline">{item.history.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul>
    : <p className="empty-inline">기록된 변경 이력이 없습니다.</p>;

  return <ul className="timeline audit-list">{item.audit.map((event) => {
    const statusChanged = event.before.status && event.after.status && event.before.status !== event.after.status;
    const assigneeChanged = event.before.assigned_to !== event.after.assigned_to && event.action !== 'registered';
    return <li key={event.id}>
      <div><strong>{actions[event.action] ?? event.action}</strong><time dateTime={event.occurred_at}>{date.format(new Date(event.occurred_at))}</time></div>
      {(statusChanged || assigneeChanged) && <dl className="key-values">
        {statusChanged && <div><dt>상태</dt><dd>{stateLabel(event.before.status!) ?? event.before.status} → {stateLabel(event.after.status!) ?? event.after.status}</dd></div>}
        {assigneeChanged && <div><dt>담당자</dt><dd>{event.before_assignee ?? event.before.assigned_to ?? '미배정'} → {event.after_assignee ?? event.after.assigned_to ?? '미배정'}</dd></div>}
      </dl>}
      {event.reason && <p className="audit-reason">{event.reason}</p>}
      {event.after.review_note && <p className="audit-reason"><strong>검토 메모</strong><br /><span>{event.after.review_note}</span></p>}
      <small>{event.actor_name ?? event.actor} · {sources[event.source] ?? event.source} · 버전 {event.version}</small>
    </li>;
  })}</ul>;
}
