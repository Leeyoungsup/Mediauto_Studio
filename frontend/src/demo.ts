export const statuses = ['배정 대기', '배정됨', '검토 중', '검토 완료'] as const;
export type CaseStatus = typeof statuses[number];
export type Patient = { number: string; name: string; birth: string };
export type Slide = { id: string; label?: string; stain: string; specimen: string; image?: string; state: '열람 가능' | '준비 중' | '열기 오류' | '뷰어 연동 전' };
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
};

export const readyCount = (item: DemoCase) => item.slides.filter(({ state }) => state === '열람 가능').length;
