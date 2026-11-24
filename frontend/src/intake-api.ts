import type { DemoCase } from './demo';

export type SlideFields = {
  case_id: string;
  slide_id: string;
  specimen: string;
  stain: string;
  patient_number: string;
  patient_name: string;
};
export type Entry = { fields: SlideFields; source: 'manual' | 'rule'; version: number; updated_at: string; rule?: string };
export type SourceFile = { id: string; filename: string; format: string; size: number; modified: string; entry: Entry | null };
export type FilenameRule = Omit<SlideFields, 'patient_name'> & { name: string; pattern: string };
export type RuleSet = { rules: FilenameRule[]; version: number };
export type Match = Pick<SourceFile, 'id' | 'filename' | 'format'> & { match: { rule: string; fields: SlideFields } | null };

export const emptyFields: SlideFields = { case_id: '', slide_id: '', specimen: '', stain: '', patient_number: '', patient_name: '' };
export const fieldLabels: Record<keyof SlideFields, string> = {
  case_id: 'Case ID', slide_id: 'Slide ID', specimen: '검체', stain: '염색 코드', patient_number: '환자번호 (MRN)', patient_name: '환자명',
};
export const codipaiRule: FilenameRule = {
  name: 'CODIPAI 예제', pattern: 'CODIPAI-{organ}-{series}-{case_no}-{prep}-{stain}-{slide_no}',
  case_id: '{organ}-{series}-{case_no}', slide_id: '{prep}-{stain}-{slide_no}', specimen: '', stain: '{stain}', patient_number: '',
};

export async function requestIntake<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/intake' + path, {
    method, signal, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = typeof failure.detail === 'string' ? failure.detail
      : response.status === 422 ? '필수값과 입력 형식을 확인하세요.' : '요청을 처리하지 못했습니다. 다시 시도하세요.';
    throw new Error(detail);
  }
  return response.json();
}

const dateLabel = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export const formatIntakeDate = (date: string) => dateLabel.format(new Date(date)).replace('-', '.');

type FileCaseGroup = { item: DemoCase; patients: Map<string, DemoCase['patient']>; specimens: Set<string> };

export function buildFileCases(files: SourceFile[]): DemoCase[] {
  const groups = new Map<string, FileCaseGroup>();
  for (const file of files) {
    const entry = file.entry;
    if (!entry) continue;
    const input = entry.fields;
    const group: FileCaseGroup = groups.get(input.case_id) ?? {
      item: { id: input.case_id, specimen: '미입력', status: '배정 대기', assignee: '', patient: null,
        received: formatIntakeDate(entry.updated_at), slides: [], history: [], source: 'files' } satisfies DemoCase,
      patients: new Map(), specimens: new Set<string>(),
    };
    groups.set(input.case_id, group);
    if (input.specimen) group.specimens.add(input.specimen);
    if (input.patient_number || input.patient_name) {
      group.patients.set(JSON.stringify([input.patient_number, input.patient_name]), { number: input.patient_number, name: input.patient_name, birth: '' });
    }
    group.item.slides.push({
      id: file.id, label: input.slide_id, stain: input.stain || '미입력', specimen: input.specimen || '미입력', state: '뷰어 연동 전',
    });
    group.item.history.push(`${entry.source === 'manual' ? '수기 등록' : '파일명 규칙 등록'} · ${input.slide_id} (${file.format})`);
  }
  return [...groups.values()].map(({ item, specimens, patients }) => {
    if (patients.size > 1) item.history.push('파일별 환자 정보가 다릅니다. 슬라이드 목록에서 확인하세요.');
    return { ...item, specimen: [...specimens].join(', ') || '미입력', patient: patients.size === 1 ? [...patients.values()][0] : null };
  });
}
