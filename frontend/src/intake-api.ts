import type { DemoCase } from './demo';
import { api } from './session';

export type SlideFields = {
  case_id: string;
  slide_id: string;
  specimen: string;
  stain: string;
  block_number: string;
  barcode: string;
  patient_number: string;
  patient_name: string;
};
export type Entry = { fields: SlideFields; source: 'manual' | 'rule'; version: number; updated_at: string; rule?: string };
export type SourceFile = { id: string; filename: string; format: 'NDPI' | 'SVS'; size: number; modified: string; entry: Entry | null };
export type FilenameRule = Omit<SlideFields, 'patient_name'> & { name: string; pattern: string };
export type RuleSet = { rules: FilenameRule[]; version: number };
export type Match = Pick<SourceFile, 'id' | 'filename' | 'format'> & { match: { rule: string; fields: SlideFields } | null };

export const emptyFields: SlideFields = { case_id: '', slide_id: '', specimen: '', stain: '', block_number: '', barcode: '', patient_number: '', patient_name: '' };
export const fieldLabels: Record<keyof SlideFields, string> = {
  case_id: 'Case ID', slide_id: 'Slide ID', specimen: 'Specimen', stain: 'Stain Code', block_number: 'Block Number', barcode: 'Barcode', patient_number: 'Medical Record Number (MRN)', patient_name: 'Patient Name',
};
export const codipaiRule: FilenameRule = {
  name: 'CODIPAI Example', pattern: 'CODIPAI-{organ}-{series}-{case_no}-{prep}-{stain}-{slide_no}',
  case_id: '{organ}-{series}-{case_no}', slide_id: '{prep}-{stain}-{slide_no}', specimen: '', stain: '{stain}', block_number: '', barcode: '', patient_number: '',
};

export async function requestIntake<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  return api('/api/intake' + path, {
    method, signal, body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  });
}

const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const formatIntakeDate = (date: string) => dateLabel.format(new Date(date));

type FileCaseGroup = { item: DemoCase; patients: Map<string, DemoCase['patient']>; specimens: Set<string> };

export function buildFileCases(files: SourceFile[]): DemoCase[] {
  const groups = new Map<string, FileCaseGroup>();
  for (const file of files) {
    const entry = file.entry;
    if (!entry) continue;
    const input = entry.fields;
    const group: FileCaseGroup = groups.get(input.case_id) ?? {
      item: { id: input.case_id, specimen: 'Not Entered', status: 'Awaiting Assignment', assignee: '', patient: null,
        received: formatIntakeDate(entry.updated_at), slides: [], history: [], source: 'files' } satisfies DemoCase,
      patients: new Map(), specimens: new Set<string>(),
    };
    groups.set(input.case_id, group);
    if (input.specimen) group.specimens.add(input.specimen);
    if (input.patient_number || input.patient_name) {
      group.patients.set(JSON.stringify([input.patient_number, input.patient_name]), { number: input.patient_number, name: input.patient_name, birth: '' });
    }
    group.item.slides.push({
      id: file.id, label: input.slide_id, stain: input.stain || 'Not Entered', specimen: input.specimen || 'Not Entered', state: 'Viewable',
      wsi: { id: file.id, source: 'files', format: file.format }, intakeVersion: entry.version,
    });
    group.item.history.push(`${entry.source === 'manual' ? 'Manual Registration' : 'Filename Rule Registration'} · ${input.slide_id} (${file.format})`);
  }
  return [...groups.values()].map(({ item, specimens, patients }) => {
    if (patients.size > 1) item.history.push('Patient details differ between files. Check the slide list.');
    return { ...item, specimen: [...specimens].join(', ') || 'Not Entered', patient: patients.size === 1 ? [...patients.values()][0] : null };
  });
}
