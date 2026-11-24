import type { SortTerm } from './worklist-config';
import type { CaseStatus, DemoCase, Slide } from './demo';
import { formatIntakeDate } from './intake-api';

export const states = { '배정 대기': 'registered', '배정됨': 'assigned', '검토 중': 'in_review', '검토 완료': 'reviewed' } as const;
export type State = typeof states[CaseStatus];
export const stateLabel = (state: string) =>
  (Object.keys(states) as CaseStatus[]).find((label) => states[label] === state);
export type WorklistQuery = { q: string; status: CaseStatus | ''; assignee: string; order: SortTerm[]; offset: number };
export type Counts = { all: number; mine: number; unassigned: number; statuses: Record<State, number> };
export type Assignee = { id: string; name: string };
export type WorklistEntry = {
  record_id: string | null; case_number: string; status: State; source: 'files' | 'clinical';
  assignee: string | null; patient: DemoCase['patient']; specimen: string; slides: Slide[];
  created_at: string; history: string[]; version?: number; assigned_to?: string | null;
  candidates?: DemoCase['candidates']; audit?: DemoCase['audit'];
};
export type Result = { rows: WorklistEntry[]; counts: Counts; total: number; assignees: Assignee[] };
export const emptyResult: Result = { rows: [], total: 0, assignees: [],
  counts: { all: 0, mine: 0, unassigned: 0, statuses: { registered: 0, assigned: 0, in_review: 0, reviewed: 0 } } };

export function caseView(row: WorklistEntry): DemoCase {
  return { id: row.case_number, recordId: row.record_id ?? undefined, source: row.source,
    status: stateLabel(row.status) ?? '배정 대기',
    assignee: row.assignee ?? '', patient: row.patient, specimen: row.specimen || '미입력', slides: row.slides,
    received: formatIntakeDate(row.created_at), history: row.history,
    version: row.version, assignedTo: row.assigned_to, candidates: row.candidates, audit: row.audit };
}
