export const columns = [
  { id: 'specimen', label: '검체' }, { id: 'assignee', label: '담당자' },
  { id: 'status', label: '검토 상태' }, { id: 'slides', label: '슬라이드' }, { id: 'received', label: '접수 시각' },
  { id: 'patient', label: '환자명' }, { id: 'mrn', label: '환자번호 (MRN)' },
  { id: 'sex', label: '성별' }, { id: 'birth', label: '생년월일' }, { id: 'age', label: '채취 시 나이' },
  { id: 'slideState', label: '슬라이드 상태' }, { id: 'group', label: '그룹' }, { id: 'lis', label: 'LIS 케이스 상태' },
  { id: 'storage', label: '보관 상태' }, { id: 'tags', label: '태그' }, { id: 'created', label: '등록 시각' },
  { id: 'comments', label: '댓글' }, { id: 'requests', label: '요청' }, { id: 'notes', label: '케이스 메모' },
] as const;
export type ColumnId = typeof columns[number]['id'];
export type ColumnSetting = { id: ColumnId; visible: boolean };
export const defaultColumns: ColumnSetting[] = columns.map(({ id }, index) => ({ id, visible: index < 5 }));
const preferenceKey = 'mediauto.worklist.columns.v1';

export function loadLegacyColumns(): ColumnSetting[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
    if (!Array.isArray(saved)) return defaultColumns;
    return normalizeColumns(saved);
  } catch { return defaultColumns; }
}

export function normalizeColumns(saved: ColumnSetting[]): ColumnSetting[] {
  const keys = new Set<ColumnId>();
  const result: ColumnSetting[] = [];
  for (const row of saved) {
    if (!row || typeof row.visible !== 'boolean' || keys.has(row.id) || !columns.some(({ id }) => id === row.id)) continue;
    keys.add(row.id);
    result.push({ id: row.id, visible: row.visible });
  }
  return [...result, ...defaultColumns.filter(({ id }) => !keys.has(id))];
}

export type Scope = 'all' | 'mine' | 'unassigned';

export const sortFields = {
  created_at: '등록 시각', case_number: 'Case ID', status: '검토 상태', assignee: '담당자', slide_count: '슬라이드 수',
} as const;
export type SortField = keyof typeof sortFields;
export type SortTerm = { field: SortField; direction: 'asc' | 'desc' };
export const defaultOrder: SortTerm[] = [{ field: 'created_at', direction: 'desc' }];

export type ViewConfig = {
  scope: Scope; q: string; status: import('./worklist-api').State | null;
  assigned_to: string | null; order: SortTerm[]; columns: ColumnSetting[] | null;
};
export type SavedView = {
  id: string; name: string; visibility: 'private' | 'shared'; version: number; configuration: ViewConfig; can_edit: boolean;
};
export type Preferences = { default_view_id: string | null; columns: ColumnSetting[] | null; version: number };
export const initialPreferences: Preferences = { default_view_id: null, columns: null, version: 0 };
