import type { DemoCase } from './demo';
import { priorityLabels } from './workgroups';
import type { Priority } from './workgroups';
import { stateLabel } from './worklist-api';

const actions: Record<string, string> = {
  registered: 'Register Case', assigned: 'Assign Case', reassigned: 'Reassign Case',
  review_started: 'Start Review', review_completed: 'Review Complete', patient_id_changed: 'Patient Link Changed',
  external_identifier_linked: 'External Identifier Linked', classification_changed: 'Workgroup and Priority Changed',
};
const sources: Record<string, string> = { manual: 'Manual Registration', file_intake: 'Slide Registration', ims: 'IMS' };
const date = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'medium' });

export function CaseAudit({ item }: { item: DemoCase }) {
  if (!item.audit?.length) return item.history.length
    ? <ul className="timeline">{item.history.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul>
    : <p className="empty-inline">No changes have been recorded.</p>;

  return <ul className="timeline audit-list">{item.audit.map((event) => {
    const statusChanged = event.before.status && event.after.status && event.before.status !== event.after.status;
    const groupChanged = event.action === 'classification_changed' && event.before.group_key !== event.after.group_key;
    const priorityChanged = event.action === 'classification_changed' && event.before.priority !== event.after.priority;
    const priority = (key?: string | null) => key ? priorityLabels[key as Priority] ?? key : 'Not Set';
    const assigneeChanged = event.before.assigned_to !== event.after.assigned_to && event.action !== 'registered';
    return <li key={event.id}>
      <div><strong>{actions[event.action] ?? event.action}</strong><time dateTime={event.occurred_at}>{date.format(new Date(event.occurred_at))}</time></div>
      {(statusChanged || assigneeChanged || groupChanged || priorityChanged) && <dl className="key-values">
        {groupChanged && <div><dt>Workgroup</dt><dd>{event.before.group_key ?? 'Unclassified'} → {event.after.group_key ?? 'Unclassified'}</dd></div>}
        {priorityChanged && <div><dt>Priority</dt><dd>{priority(event.before.priority)} → {priority(event.after.priority)}</dd></div>}
        {statusChanged && <div><dt>Status</dt><dd>{stateLabel(event.before.status!) ?? event.before.status} → {stateLabel(event.after.status!) ?? event.after.status}</dd></div>}
        {assigneeChanged && <div><dt>Assignee</dt><dd>{event.before_assignee ?? event.before.assigned_to ?? 'Unassigned'} → {event.after_assignee ?? event.after.assigned_to ?? 'Unassigned'}</dd></div>}
      </dl>}
      {event.reason && <p className="audit-reason">{event.reason}</p>}
      {event.after.review_note && <p className="audit-reason"><strong>Review Note</strong><br /><span>{event.after.review_note}</span></p>}
      <small>{event.actor_name ?? event.actor} · {sources[event.source] ?? event.source} · Version {event.version}</small>
    </li>;
  })}</ul>;
}
