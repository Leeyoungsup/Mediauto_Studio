import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { api, auditAttemptId, jsonBody } from './session';

type Participant = { id: string; username: string; name: string };
type Note = { id: string; body: string; author: string; created_at: string; mentions: { id: string; name: string }[] };
type Thread = Note & { comments: Note[] };
type NotesResult = { notes: Thread[]; can_post: boolean; participants: Participant[]; has_more: boolean };
const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function NotesDialog({ endpoint, onClose }: { endpoint: string; onClose: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = modal.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={modal} className="patient-history-dialog" aria-labelledby="case-notes-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="panel-title"><h2 id="case-notes-title">Case Notes</h2>
      <button type="button" className="icon-button" aria-label="Close Case Notes" onClick={onClose}><X size={18} /></button></div>
    <div className="dialog-content"><CaseNotes endpoint={endpoint} /></div>
  </dialog>;
}

export function CaseNotes({ endpoint }: { endpoint: string }) {
  const [data, setData] = useState<NotesResult>();
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [composer, setComposer] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError('');
    api<NotesResult>(`${endpoint}?offset=${page * 20}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint, page, refresh]);

  function saved(parent?: string) {
    setComposer(undefined);
    if (!parent) setPage(0);
    setRefresh((value) => value + 1);
    window.dispatchEvent(new Event('mediauto-notifications-changed'));
  }

  return <section className="case-notes" aria-label="Notes and Comments">
    <div className="preview-label"><h2>Notes and Comments</h2>
      <div className="actions">
        <button className="button secondary" type="button" disabled={composer !== undefined} onClick={() => setRefresh((value) => value + 1)}>Refresh Notes</button>
        {data?.can_post && composer === undefined && <button className="button primary" type="button" onClick={() => setComposer('')}>New Note</button>}
      </div>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : !data ? <p role="status">Loading case notes…</p> : <>
      {composer === '' && <NoteForm endpoint={endpoint} participants={data.participants} onSaved={() => saved()} onCancel={() => setComposer(undefined)} />}
      {data.notes.length ? data.notes.map((note) => <article className="case-note" key={note.id}>
        <NoteBody note={note} />
        {note.comments.length > 0 && <ul className="case-note-comments" aria-label="Comments">{note.comments.map((comment) => <li key={comment.id}>
          <NoteBody note={comment} />
        </li>)}</ul>}
        {composer === note.id ? <NoteForm endpoint={endpoint} parent={note.id} participants={data.participants}
          onSaved={() => saved(note.id)} onCancel={() => setComposer(undefined)} />
          : data.can_post && <button className="button secondary" type="button" disabled={composer !== undefined}
            onClick={() => setComposer(note.id)}>Add Comment</button>}
      </article>) : <p className="empty-inline">No notes on this page.</p>}
      {(page > 0 || data.has_more) && <div className="actions">
        <button className="button secondary" type="button" disabled={!page || composer !== undefined} onClick={() => setPage(page - 1)}>Previous Notes</button>
        <button className="button secondary" type="button" disabled={!data.has_more || composer !== undefined} onClick={() => setPage(page + 1)}>More Notes</button>
      </div>}
    </>}
  </section>;
}

function NoteBody({ note }: { note: Note }) {
  return <>
    <div className="case-note-meta"><strong>{note.author}</strong><time dateTime={note.created_at}>{when.format(new Date(note.created_at))}</time></div>
    <p>{note.body}</p>
    {!!note.mentions.length && <div className="case-note-mentions" aria-label="Mentions">{note.mentions.map((person) =>
      <span key={person.id}>{person.name}</span>)}</div>}
  </>;
}

function NoteForm({ endpoint, parent, participants, onSaved, onCancel }: {
  endpoint: string; parent?: string; participants: Participant[]; onSaved: () => void; onCancel: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef<{ text: string; key: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const payload = body.trim();
    if (!payload || busy) return;
    if (current.current?.text !== payload) current.current = { text: payload, key: auditAttemptId() };
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      await api(endpoint, { ...jsonBody('POST', { body: payload, parent_id: parent ?? null }, { 'Idempotency-Key': current.current.key }), signal: controller.signal });
      if (!controller.signal.aborted) onSaved();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to save the entry.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <form className="history-manual" aria-label={parent ? 'New Comment' : 'New Note'} onSubmit={(event) => void save(event)}>
    <label className="form-field">{parent ? 'Comment' : 'Note'}<textarea ref={text} value={body} rows={4} maxLength={4000}
      onChange={(event) => setBody(event.target.value)} required disabled={busy} /></label>
    <label className="form-field">Mention a User
      <select value="" disabled={busy} onChange={(event) => {
        const token = '@' + event.target.value;
        if (body.trimEnd().length + token.length + 2 <= 4000) setBody(`${body.trimEnd()}${body.trimEnd() ? ' ' : ''}${token} `);
        text.current?.focus();
      }}>
        <option value="" disabled>Select a Case Participant</option>
        {participants.map((person) => <option key={person.id} value={person.username}>{person.name} · @{person.username}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="actions"><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="button primary" type="submit" disabled={busy || !body.trim()}>{parent ? 'Post Comment' : 'Post Note'}</button></div>
  </form>;
}
