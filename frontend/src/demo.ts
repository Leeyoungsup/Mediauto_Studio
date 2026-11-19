export const statuses = ['배정 대기', '배정됨', '검토 중', '검토 완료'] as const;
export type CaseStatus = typeof statuses[number];
export const doctors = ['병리의 A', '병리의 B', '병리의 C'] as const;
export type Doctor = typeof doctors[number];
export type Patient = { number: string; name: string; birth: string };
export type Slide = { id: string; stain: string; specimen: string; image?: string; state: '열람 가능' | '준비 중' | '열기 오류' };
export type DemoCase = {
  id: string;
  specimen: string;
  assignee: Doctor | '';
  status: CaseStatus;
  received: string;
  patient: Patient | null;
  slides: Slide[];
  history: string[];
};

const sampleSlides: Slide[] = [
  { id: 'A1-01', stain: 'H&E', specimen: 'A1', image: '/samples/colon.webp', state: '열람 가능' },
  { id: 'A1-02', stain: 'H&E', specimen: 'A1', image: '/samples/colon-detail.webp', state: '열람 가능' },
  { id: 'A2-01', stain: '미지정', specimen: 'A2', state: '준비 중' },
];

export const seedCases: DemoCase[] = [
  { id: 'IMS-26-0148', specimen: '대장 조직', assignee: '병리의 A', status: '검토 중', received: '11.19 14:28', patient: { number: 'DEMO-0148', name: '시연 환자 01', birth: '' }, slides: sampleSlides.slice(0, 2), history: ['검토 시작 · 병리의 A', '담당자 배정 · 병리의 A', '케이스 등록'] },
  { id: 'IMS-26-0147', specimen: '대장 조직', assignee: '병리의 A', status: '배정됨', received: '11.19 13:54', patient: null, slides: sampleSlides, history: ['담당자 배정 · 병리의 A', '케이스 등록'] },
  { id: 'IMS-26-0146', specimen: '위 조직', assignee: '병리의 B', status: '배정됨', received: '11.19 13:20', patient: null, slides: [sampleSlides[2]], history: ['담당자 배정 · 병리의 B', '케이스 등록'] },
  { id: 'IMS-26-0145', specimen: '폐 조직', assignee: '병리의 C', status: '검토 중', received: '11.19 12:47', patient: null, slides: [{ id: 'B1-01', stain: 'H&E', specimen: 'B1', state: '열기 오류' }], history: ['검토 시작 · 병리의 C', '케이스 등록'] },
  { id: 'IMS-26-0144', specimen: '대장 조직', assignee: '병리의 A', status: '검토 완료', received: '11.19 11:32', patient: { number: 'DEMO-0144', name: '시연 환자 02', birth: '' }, slides: sampleSlides.slice(0, 2), history: ['검토 완료 · 병리의 A', '케이스 등록'] },
  { id: 'IMS-26-0143', specimen: '유방 조직', assignee: '', status: '배정 대기', received: '11.19 10:51', patient: null, slides: [], history: ['케이스 등록'] },
  { id: 'IMS-26-0142', specimen: '피부 조직', assignee: '', status: '배정 대기', received: '11.19 10:12', patient: null, slides: [sampleSlides[2]], history: ['케이스 등록'] },
  { id: 'IMS-26-0141', specimen: '대장 조직', assignee: '병리의 B', status: '검토 완료', received: '11.19 09:36', patient: { number: 'DEMO-0141', name: '시연 환자 03', birth: '' }, slides: sampleSlides.slice(1, 2), history: ['검토 완료 · 병리의 B', '케이스 등록'] },
];

export const readyCount = (item: DemoCase) => item.slides.filter(({ state }) => state === '열람 가능').length;
