import { useEffect, useRef, useState } from 'react';
import { auditAttemptId, jsonBody } from './session';
import type { Camera } from './viewer-tools';

type Frame = Camera & { scan_id: string };
type Account = { id: string; name: string };
type Participant = Account & { online: boolean; follow: boolean };
type Room = { id: string; you: string; driver_id: string; is_owner: boolean; follow: boolean; driver_online: boolean;
  epoch: number; sequence: number; frame: Frame | null; participants: Participant[]; candidates: Account[] };
type State = { state: 'available' | 'unavailable' | 'invited' | 'joined'; room: Room | null };

class ReviewError extends Error {
  constructor(readonly status: number, detail: string) { super(detail); }
}

async function call<T>(path: string, client: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set('X-Review-Client', client);
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ReviewError(response.status, typeof body.detail === 'string' ? body.detail : 'The review request failed.');
  }
  return response.json();
}

export function useCollaborativeReview(endpoint: string | undefined, identity: string) {
  const storageKey = 'mediauto-review-open:' + identity + ':' + (endpoint ?? '');
  const joinedKey = storageKey + ':joined';
  const [client] = useState(auditAttemptId);
  const pendingResume = useRef(sessionStorage.getItem(joinedKey) === '1');
  const [open, setOpen] = useState(() => pendingResume.current || sessionStorage.getItem(storageKey) === '1');
  const [state, setState] = useState<State>();
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'denied'>('connecting');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [revision, setRevision] = useState(0);
  const current = useRef<State | undefined>(undefined);
  const latestCamera = useRef<Frame | undefined>(undefined);
  const lastPublished = useRef('');
  const writeInFlight = useRef(false);
  const network = useRef(false);
  const joined = state?.state === 'joined';
  const enabled = !!endpoint && (open || joined);

  function receive(next: State) {
    const previous = current.current?.room;
    const room = next.room;
    if (room && previous?.id === room.id) {
      if (room.epoch < previous.epoch) return;
      if (room.epoch === previous.epoch && room.sequence < previous.sequence) room.sequence = previous.sequence;
    }
    current.current = next;
    setState(next);
  }

  useEffect(() => {
    if (!endpoint || !enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        let next = await call<State>(endpoint!, client, { signal: controller.signal });
        if (pendingResume.current && next.state === 'invited' && next.room) {
          try {
            await call(endpoint + '/' + next.room.id + '/join', client, { method: 'POST', signal: controller.signal });
            pendingResume.current = false;
            next = await call<State>(endpoint!, client, { signal: controller.signal });
          } catch (error) {
            if (error instanceof ReviewError && [401, 403, 404].includes(error.status)) pendingResume.current = false;
            throw error;
          }
        }
        if (next.state === 'joined') {
          pendingResume.current = false;
          sessionStorage.setItem(joinedKey, '1');
        } else if (!pendingResume.current || next.state === 'available' || next.state === 'unavailable') {
          pendingResume.current = false;
          sessionStorage.removeItem(joinedKey);
        }
        if (controller.signal.aborted) return;
        network.current = true;
        receive(next);
        setConnection('connected');
      } catch (error) {
        if (controller.signal.aborted) return;
        network.current = false;
        if (error instanceof ReviewError && [401, 403, 404].includes(error.status)) {
          current.current = undefined;
          pendingResume.current = false;
          sessionStorage.removeItem(joinedKey);
          setState(undefined);
          setConnection('denied');
          return;
        }
        setConnection('reconnecting');
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, network.current ? 375 : 900);
    }
    void poll();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, enabled, endpoint, joinedKey, revision]);

  useEffect(() => {
    if (!endpoint || !enabled) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      const active = current.current;
      const frame = latestCamera.current;
      const room = active?.room;
      if (!network.current || !room || active.state !== 'joined' || room.driver_id !== room.you || !frame || writeInFlight.current) return;
      const signature = JSON.stringify([room.id, room.epoch, frame]);
      if (lastPublished.current === signature) return;
      writeInFlight.current = true;
      try {
        const answer = await call<{ sequence: number }>(endpoint + '/' + room.id + '/camera', client, {
          ...jsonBody('PUT', { ...frame, epoch: room.epoch, sequence: room.sequence }), signal: controller.signal,
        });
        const currentRoom = current.current?.room;
        if (currentRoom?.id === room.id && currentRoom.epoch === room.epoch) {
          currentRoom.sequence = Math.max(currentRoom.sequence, answer.sequence);
          lastPublished.current = signature;
        }
      } catch {
        // The next poll reads the authoritative epoch and sequence before a retry.
        network.current = false;
      } finally { writeInFlight.current = false; }
    }, 150);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [client, enabled, endpoint]);

  async function act(path: string, method = 'POST', payload?: object) {
    if (!endpoint || busy) return;
    setBusy(true); setActionError('');
    try {
      await call(endpoint + path, client, payload ? jsonBody(method, payload) : { method });
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The review request failed.');
      setRevision((value) => value + 1);
    } finally { setBusy(false); }
  }

  const room = state?.room;
  const driving = !!(joined && room && room.driver_id === room.you);
  const following = !!(joined && room && !driving && room.follow);
  return { open, state, room, driving, following, connection, busy, actionError, act,
    toggle: () => { setOpen(!open); sessionStorage.setItem(storageKey, open ? '0' : '1'); },
    camera: (scan_id: string, value: Camera) => { latestCamera.current = { scan_id, x: value.x, y: value.y, zoom: value.zoom }; },
  };
}

type Review = ReturnType<typeof useCollaborativeReview>;

export function CollaborativeReview({ review }: { review: Review }) {
  const { state, room, busy, connection, actionError, act } = review;
  const [invite, setInvite] = useState('');
  const [nextDriver, setNextDriver] = useState('');
  const network = connection === 'connected';
  const joined = state?.state === 'joined';
  const localPath = room ? '/' + room.id : '';
  const drivers = room?.participants.filter((person) => person.online && person.id !== room.you) ?? [];
  const actor = room?.participants.find((person) => person.id === room.driver_id);
  const mayAct = network && !busy;
  return <section className="panel detail-content review-room" aria-label="Collaborative Review">
    <div className="preview-label"><h2>Collaborative Review</h2>
      <span role="status">{({ connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting…', denied: 'Case Access Unavailable' })[connection]}</span>
    </div>
    {actionError && <p role="alert" className="form-error">{actionError}</p>}
    {state?.state === 'available' && <button className="button primary" disabled={!mayAct} onClick={() => void act('')}>Start Review Session</button>}
    {state?.state === 'unavailable' && <p>No review invitation is available for this account.</p>}
    {state?.state === 'invited' && <button className="button primary" disabled={!mayAct} onClick={() => void act(localPath + '/join')}>Join Review Session</button>}
    {joined && room && <div className="review-room-layout">
      <div>
        <p><strong>{review.driving ? 'Driving' : review.following ? 'Following' : 'Independent View'}</strong>
          {' · '}{actor ? `Driver: ${actor.name}` : 'Driver unavailable'}{!room.driver_online && ' · Offline'}</p>
        <ul className="review-people" aria-label="Participants">{room.participants.map((person) => <li key={person.id}>
          <strong>{person.name}{person.id === room.you ? ' (You)' : ''}</strong>
          <small>{person.id === room.driver_id ? 'Driver' : person.follow ? 'Following' : 'Independent'} · {person.online ? 'Online' : 'Offline'}</small>
          {room.is_owner && person.id !== room.you && <button type="button" className="button secondary" disabled={!mayAct}
            onClick={() => void act(localPath + '/participants/' + person.id, 'PUT', { active: false })}>Revoke {person.name}</button>}
        </li>)}</ul>
      </div>
      <div className="review-room-controls">
        <div className="actions">
          {!review.driving && <button type="button" className="button primary" disabled={!mayAct || !room.driver_online && !review.following}
            aria-pressed={review.following} onClick={() => void act(localPath + '/follow', 'PUT', { follow: !review.following })}>
            {review.following ? 'Stop Following' : 'Follow Driver'}</button>}
          {!review.driving && room.is_owner && !room.driver_online && <button type="button" className="button secondary" disabled={!mayAct}
            onClick={() => void act(localPath + '/drive', 'PUT', { epoch: room.epoch, driver_id: room.you })}>Take Drive</button>}
          <button type="button" className="button secondary" disabled={!mayAct} onClick={() => void act(localPath + '/leave')}>Leave Session</button>
          {room.is_owner && <button type="button" className="button secondary" disabled={!mayAct}
            onClick={() => void act(localPath + '/end')}>End Session</button>}
        </div>
        {room.is_owner && <form className="actions" onSubmit={(event) => {
          event.preventDefault();
          void act(localPath + '/participants/' + invite, 'PUT', { active: true }); setInvite('');
        }}>
          <label className="form-field">Invite Participant<select value={invite} required onChange={(event) => setInvite(event.target.value)}>
            <option value="">Select a user</option>{room.candidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          <button className="button secondary" disabled={!invite || !mayAct}>Invite</button>
        </form>}
        {review.driving && <form className="actions" onSubmit={(event) => {
          event.preventDefault();
          void act(localPath + '/drive', 'PUT', { epoch: room.epoch, driver_id: nextDriver }); setNextDriver('');
        }}>
          <label className="form-field">Next Driver<select value={nextDriver} required onChange={(event) => setNextDriver(event.target.value)}>
            <option value="">Select a connected participant</option>{drivers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          <button className="button secondary" disabled={!nextDriver || !mayAct}>Hand Off Drive</button>
        </form>}
      </div>
    </div>}
  </section>;
}
