import { useEffect, useRef, useState } from 'react';
import { api, jsonBody } from './session';

export type Candidate = { id: string; category: string; bounds: [number, number, number, number]; confidence: number | null };
type Archive = {
  id: string; schema_version: string; preparation: 'conventional' | 'liquid_based'; analysis_version: string;
  exported_at: string; candidate_count: number;
  categories: { code: string; label: string; count: number }[];
  model: { name: string; version: string; checkpoint_sha256: string };
};
type Index = {
  status: 'stain_unverified' | 'not_received' | 'archive_error' | 'available'; archives: Archive[];
  cursor_version: number; partial_error?: boolean; resume_unavailable?: boolean;
  resume: { archive_id: string; candidate: Candidate; page: number } | null;
};
type CandidatePage = { total: number; page_size: number; candidates: Candidate[] };

export function usePapGallery(endpoint: string, ready: boolean) {
  const root = endpoint + '/pap';
  const [index, setIndex] = useState<Index>();
  const [archiveId, setArchive] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState<{ key: string; payload: CandidatePage }>();
  const [selected, setSelected] = useState<Candidate>();
  const [focus, setFocus] = useState<{ candidate: Candidate }>();
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const archive = index?.archives.find((item) => item.id === archiveId);
  const query = new URLSearchParams({ page: String(page), ...(category && { category }) });
  const listKey = archive ? `${root}/${archive.id}?${query}` : '';
  const candidates = pageData?.key === listKey ? pageData.payload : undefined;

  useEffect(() => {
    if (!ready) { setIndex(undefined); setSelected(undefined); setFocus(undefined); return; }
    const controller = new AbortController();
    setIndex(undefined);
    setError('');
    api<Index>(root, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      const resume = result.resume;
      setIndex(result);
      setVersion(result.cursor_version);
      setArchive(resume?.archive_id ?? result.archives[0]?.id ?? '');
      setCategory(resume?.candidate.category ?? '');
      setPage(resume?.page ?? 1);
      setSelected(resume?.candidate);
      setFocus(resume ? { candidate: resume.candidate } : undefined);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [root, ready, attempt]);

  useEffect(() => {
    if (!ready || !listKey) return;
    const controller = new AbortController();
    setListError('');
    api<CandidatePage>(listKey, { signal: controller.signal }).then((payload) => {
      if (!controller.signal.aborted) setPageData({ key: listKey, payload });
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setListError(error.message);
    });
    return () => controller.abort();
  }, [listKey, ready, attempt]);

  async function select(candidate: Candidate) {
    if (!archive || saving.current) return;
    saving.current = true;
    setSelected(candidate);
    setFocus({ candidate });
    setBusy(true);
    setSaveError('');
    try {
      const next = await api<{ version: number }>(root + '/selection', jsonBody('PUT', {
        archive_id: archive.id, candidate_id: candidate.id, expected_version: version,
      }));
      setVersion(next.version);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save the candidate selection.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return { root, index, archive, category, candidates, selected, focus, page, error, listError, saveError, busy, select, setPage,
    refresh() { setSaveError(''); setSelected(undefined); setFocus(undefined); setPageData(undefined); setAttempt((counter) => counter + 1); },
    reframe() { if (selected) setFocus({ candidate: selected }); },
    selectArchive(id: string) { setArchive(id); setCategory(''); setPage(1); setSelected(undefined); setFocus(undefined); setSaveError(''); },
    selectCategory(code: string) { setCategory(code); setPage(1); },
  };
}
export type PapState = ReturnType<typeof usePapGallery>;
