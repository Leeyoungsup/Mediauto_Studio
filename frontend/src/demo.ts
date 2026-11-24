export const statuses = ['배정 대기', '배정됨', '검토 중', '검토 완료'] as const;
export type CaseStatus = typeof statuses[number];
export const doctors = ['병리의 A', '병리의 B', '병리의 C'] as const;
export type Doctor = typeof doctors[number];
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

const sampleSlides: Slide[] = [
  { id: 'A1-01', stain: 'H&E', specimen: 'A1', image: '/samples/colon.webp', state: '열람 가능' },
  { id: 'A1-02', stain: 'H&E', specimen: 'A1', image: '/samples/colon-detail.webp', state: '열람 가능' },
];

export function demoSlide(sequence: number): Slide {
  return { ...sampleSlides[sequence % 2], id: `DEMO-A1-${String(sequence + 1).padStart(2, '0')}` };
}

export const readyCount = (item: DemoCase) => item.slides.filter(({ state }) => state === '열람 가능').length;
