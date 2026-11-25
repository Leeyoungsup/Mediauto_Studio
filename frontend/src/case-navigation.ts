export const caseTabs = {
  slides: 'Slides',
  patient: 'Patient Information',
  history: 'History',
  media: 'Media',
  gross: 'Gross Images',
  notes: 'Notes',
  logs: 'Case Logs',
  editor: 'Case Editor',
  requests: 'Requests',
  report: 'Report Draft',
  frozen: 'Frozen Section',
} as const;

export type CaseTab = keyof typeof caseTabs;

export function caseTab(value?: string): CaseTab | undefined {
  return value && Object.hasOwn(caseTabs, value) ? value as CaseTab : undefined;
}

export function caseHref(caseId: string, tab: CaseTab, scan?: string) {
  return `#case/${encodeURIComponent(caseId)}/${tab}${scan ? '/' + encodeURIComponent(scan) : ''}`;
}

export function notificationPreferencesHref(caseId: string, scan?: string) {
  return `#settings/notifications/${encodeURIComponent(caseId)}${scan ? '/' + encodeURIComponent(scan) : ''}`;
}
