export const statuses = ['Awaiting Assignment', 'Assigned', 'In Review', 'Review Complete'] as const;
export type CaseStatus = typeof statuses[number];
export type Patient = { id?: string; number: string; name: string; birth: string; localRef?: string; sex?: 'female' | 'male' | 'intersex' | 'other' | 'unknown' | null; source?: string };
export type WsiScan = { id: string; source: 'files' | 'clinical'; format: 'NDPI' | 'SVS' };
export type Slide = {
  id: string; label?: string; stain: string; specimen: string; wsi?: WsiScan; intakeVersion?: number;
  state: 'Viewable' | 'No scan registered';
};
export type AuditEvent = {
  id: string; action: string; version: number; occurred_at: string; actor: string; actor_name?: string;
  source: string; reason?: string; before: { status?: string; assigned_to?: string | null; priority?: string | null; group_key?: string | null };
  after: { status?: string; assigned_to?: string | null; review_note?: string; priority?: string | null; group_key?: string | null }; before_assignee?: string; after_assignee?: string;
  transaction_id: string;
};
export type Candidate = { id: string; name: string; username: string };
export type WorklistData = {
  group_key?: string | null; group_name?: string | null;
  priority?: import('./workgroups').Priority | null; priority_source?: string | null;
  accessioned_at?: string | null; collection_date?: string | null; age?: number | null;
  last_opened?: string | null; created_at?: string;
  mrns?: { value: string; source: string }[]; lis_status?: string | null;
  lis_data?: 'available' | 'missing' | 'conflict';
  lis_sources?: { value: string; source: string; received_at: string }[];
  slide_state?: ('viewable' | 'missing_scan' | 'no_slides')[];
  request_count?: number | null; review_note?: string | null; has_storage?: boolean;
  specimens?: { id: string; number: string; collection_date: string | null; version: number }[];
};
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
  worklist?: WorklistData;

};

export const readyCount = (item: DemoCase) => item.slides.filter(({ state }) => state === 'Viewable').length;
