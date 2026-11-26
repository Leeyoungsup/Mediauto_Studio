import { useEffect, useRef, useState } from 'react';
import { api, jsonBody } from './session';
import type { Point } from './viewer-tools';

export type LandmarkRegistration = { reference: string; points: Record<string, Point[]> };
type TissueProfile = LandmarkRegistration & { saved_at: string };
type TissueCatalog = { version: number; profiles: Record<string, TissueProfile>; active: string | null; sync: boolean };

export function useTissueRegistrationStorage(caseId: string | undefined, selected: string[]) {
  const endpoint = caseId ? `/api/viewer/cases/${caseId}/tissue-registrations` : undefined;
  const params = new URLSearchParams([...selected].sort().map((id) => ['scan_ids', id]));
  const key = endpoint && `${endpoint}?${params}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [data, setData] = useState<{ key: string; catalog: TissueCatalog }>();
  const catalog = data?.key === key ? data?.catalog : undefined;
  const [fault, setFault] = useState<{ key: string; message: string }>();
  const [savePending, setSavePending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const error = fault?.key === key ? fault?.message : undefined;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    setFault(undefined);
    api<TissueCatalog>(key, { signal: controller.signal }).then((catalog) => {
      if (!controller.signal.aborted) setData({ key, catalog });
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setFault({ key, message: failure.message });
    });
    return () => controller.abort();
  }, [key, attempt]);

  async function save(active: string | null, sync: boolean, landmarks?: LandmarkRegistration) {
    if (!endpoint || !key || !catalog || savePending) return false;
    setSavePending(true);
    setFault(undefined);
    try {
      const response = await api<TissueCatalog>(endpoint, jsonBody('PUT', {
        version: catalog.version, scan_ids: selected, active, sync, ...(landmarks ? { landmarks } : {}),
      }));
      if (currentKey.current !== key) return false;
      setData({ key, catalog: response });
      return true;
    } catch (failure) {
      if (currentKey.current === key) setFault({ key, message: failure instanceof Error ? failure.message : 'Unable to save tissue registration.' });
      return false;
    } finally {
      setSavePending(false);
    }
  }
  return { key, catalog, save, error, savePending, reload: () => setAttempt((value) => value + 1) };
}
