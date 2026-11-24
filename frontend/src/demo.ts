export const statuses = ['배정 대기', '배정됨', '검토 중', '검토 완료'] as const;
export type CaseStatus = typeof statuses[number];
export type Patient = { id?: string; number: string; name: string; birth: string; localRef?: string };
export type WsiScan = { id: string; source: 'files' | 'clinical'; format: 'NDPI' | 'SVS' };
export type Slide = {
  id: string; label?: string; stain: string; specimen: string; wsi?: WsiScan; intakeVersion?: number;
  state: '열람 가능' | '스캔 미등록';
};
export type AuditEvent = {
  id: string; action: string; version: number; occurred_at: string; actor: string; actor_name?: string;
  source: string; reason?: string; before: { status?: string; assigned_to?: string | null };
  after: { status?: string; assigned_to?: string | null; review_note?: string }; before_assignee?: string; after_assignee?: string;
  transaction_id: string;
};
export type Candidate = { id: string; name: string; username: string };
export type DemoCase = {
  id: string;
  specimen: string;
  assignee: string;
  status: CaseStatus;
  received: string;
  patient: Patient | null;
  slides: Slide[];
  history: string[];
  source?: 'files' | 'clinical';
  recordId?: string;
  version?: number;
  assignedTo?: string | null;
  candidates?: Candidate[];
  audit?: AuditEvent[];

};

export const readyCount = (item: DemoCase) => item.slides.filter(({ state }) => state === '열람 가능').length;
