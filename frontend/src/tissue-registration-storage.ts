import { useEffect, useRef, useState } from 'react';
import { api, jsonBody } from './session';
import type { Camera, Point } from './viewer-tools';

export type LandmarkRegistration = { reference: string; points: Record<string, Point[]> };
export type TissueRegistration = LandmarkRegistration | { anchors: Record<string, Camera> };
type TissueProfile = TissueRegistration & { saved_at: string };
type TissueCatalog = { version: number; profiles: Record<string, TissueProfile>; active: string | null; sync: boolean; inherited?: boolean };

export function useTissueRegistrationStorage(endpoint: string | undefined, selected: string[]) {
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

  async function save(active: string | null, sync: boolean, registration?: TissueRegistration) {
    if (!endpoint || !key || !catalog || savePending) return false;
    setSavePending(true);
    setFault(undefined);
    try {
      const response = await api<TissueCatalog>(endpoint, jsonBody('PUT', {
        version: catalog.version, scan_ids: selected, active, sync, ...(registration && ('anchors' in registration ? registration : { landmarks: registration })),
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


type ComparisonPosition = {
  profile: string | null;
  sync: boolean;
  savedAt?: number;
  positions: Record<string, Camera>;
  anchors?: Record<string, Camera>;
};

export function useComparisonPosition(account: string, scope: string, selected: string[]) {
  const prefix = `comparison-position:${account}:${scope}:`;
  const key = prefix + [...selected].sort().join(',');
  const pending = useRef<{ key: string; value: ComparisonPosition }>(undefined);
  const timer = useRef<number>(undefined);

  function flush() {
    window.clearTimeout(timer.current);
    const entry = pending.current;
    pending.current = undefined;
    if (entry) {
      try { sessionStorage.setItem(entry.key, JSON.stringify(entry.value)); }
      catch { /* The comparison remains usable with browser storage disabled. */ }
    }
  }

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key]);

  return {
    read(profile: string | null) {
      try {
        const entries = Object.keys(sessionStorage).filter((entry) => entry.startsWith(prefix));
        const matches = entries.flatMap((entry) => {
          const saved = JSON.parse(sessionStorage.getItem(entry) ?? 'null') as ComparisonPosition | null;
          return saved?.profile === profile && selected.every((id) => saved.positions[id])
            ? [{ entry, saved }] : [];
        });
        matches.sort((a, b) => Number(Boolean(b.saved.anchors)) - Number(Boolean(a.saved.anchors))
          || Number(b.entry === key) - Number(a.entry === key)
          || Object.keys(a.saved.positions).length - Object.keys(b.saved.positions).length
          || (b.saved.savedAt ?? 0) - (a.saved.savedAt ?? 0));
        const match = matches[0]?.saved;
        if (match) return { ...match, positions: Object.fromEntries(selected.map((id) => [id, match.positions[id]])),
          anchors: match.anchors && Object.fromEntries(selected.map((id) => [id, match.anchors![id]])) };
      } catch { /* A missing or invalid browser entry starts a new comparison. */ }
    },
    remember(value: ComparisonPosition) {
      if (pending.current && pending.current.key !== key) flush();
      pending.current = { key, value: { ...value, savedAt: Date.now() } };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 180);
    },
    discard() {
      flush();
      try { sessionStorage.removeItem(key); }
      catch { /* Browser storage is optional. */ }
    },
  };
}
