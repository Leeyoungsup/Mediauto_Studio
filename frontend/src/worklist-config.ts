export const columns = [
  { id: 'specimen', label: 'Specimen' }, { id: 'assignee', label: 'Assignee' },
  { id: 'status', label: 'Review Status' }, { id: 'slides', label: 'Slides' }, { id: 'received', label: 'Received At' },
  { id: 'patient', label: 'Patient Name' }, { id: 'mrn', label: 'Medical Record Number (MRN)' },
  { id: 'sex', label: 'Sex' }, { id: 'birth', label: 'Date of Birth' }, { id: 'age', label: 'Age at Collection' },
  { id: 'slideState', label: 'Slide Status' }, { id: 'group', label: 'Group' }, { id: 'lis', label: 'LIS Case Status' },
  { id: 'storage', label: 'Storage Status' }, { id: 'tags', label: 'Tags' }, { id: 'created', label: 'Registered At' },
  { id: 'comments', label: 'Comments' }, { id: 'requests', label: 'Requests' }, { id: 'notes', label: 'Case Notes' },
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
  created_at: 'Registered At', case_number: 'Case ID', status: 'Review Status', assignee: 'Assignee', slide_count: 'Slide Count',
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
