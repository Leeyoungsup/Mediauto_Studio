import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api, jsonBody } from './session';

const events = {
  case_assignment: 'Case Assignment', request: 'Request Updates', mention: 'Mentions', case_comment: 'Case Comments',
} as const;
const channels = { in_app: 'In-app', email: 'Email', push: 'Push' } as const;
const states = {
  delivered: 'Delivered', queued: 'Queued', sending: 'Sending', retry_wait: 'Retry Scheduled', failed: 'Failed', blocked: 'Blocked',
} as const;
const issues: Record<string, string> = {
  channel_not_configured: 'Channel is not configured', missing_email: 'No verified email is registered',
  missing_subscription: 'Connect a browser for Push', subscription_expired: 'Browser subscription expired',
  subscription_invalid: 'Browser subscription is invalid', access_changed: 'Case or request access changed',
  preference_disabled: 'Channel disabled in preferences', provider_rejected: 'Delivery was rejected by the provider',
  provider_unavailable: 'Delivery provider is unavailable', delivery_interrupted: 'Delivery was interrupted',
};
const actions: Record<string, string> = {
  assigned: 'Case Assigned', reassigned: 'Case Reassigned', case_mention: 'You Were Mentioned',
  comment_created: 'New Case Comment', request_created: 'New Request', request_assigned: 'Request Assigned',
  request_reassigned: 'Request Reassigned', request_started: 'Request Started', request_completed: 'Request Completed',
  request_failed: 'Request Failed', request_reopened: 'Request Reopened', request_cancelled: 'Request Cancelled',
  assignment_removed: 'Request Assignment Removed',
};
type EventName = keyof typeof events;
type Channel = keyof typeof channels;
type Rules = Record<EventName, Record<Channel, boolean>>;
type Preference = {
  version: number; rules: Rules; email_configured: boolean; email_registered: boolean;
  push_configured: boolean; push_registered: boolean; push_public_key?: string;
};
type Delivery = {
  id: string; event: EventName; action: string; channel: Channel; status: keyof typeof states; error?: string;
  attempts?: number; created_at: string; read_at?: string; finished_at?: string; case_id?: string; request_id?: string; legacy?: boolean;
};
type Inbox = { unread: number; items: Delivery[]; deliveries: Delivery[] };
const stamp = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const pathFor = (organization: string) => `/api/clinical/${encodeURIComponent(organization)}/notifications`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unable to update notifications.';

function destination(item: Delivery) {
  if (item.request_id) return `#request/${item.request_id}`;
  if (item.case_id) return `#case/${item.case_id}${item.event === 'case_assignment' ? '' : '/notes'}`;
  return undefined;
}

export function NotificationCenter({ organization }: { organization: string }) {
  const path = pathFor(organization);
  const [data, setData] = useState<Inbox>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<Inbox>(path, { signal });
      if (!signal?.aborted) { setData(result); setError(''); }
    } catch (failure) {
      if (!signal?.aborted) setError(errorText(failure));
    }
  }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    const poll = () => void refresh(controller.signal);
    poll();
    const interval = window.setInterval(poll, 10000);
    window.addEventListener('mediauto-request-changed', poll);
    window.addEventListener('mediauto-notifications-changed', poll);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('mediauto-request-changed', poll);
      window.removeEventListener('mediauto-notifications-changed', poll);
    };
  }, [refresh]);

  async function act(item: Delivery, action: 'read' | 'retry', navigate = false) {
    if (pending) return false;
    setPending(item.id);
    setError('');
    try {
      const endpoint = item.legacy ? `/api/clinical/${encodeURIComponent(organization)}/request-notifications` : path;
      if (action !== 'read' || !item.read_at) await api(`${endpoint}/${item.id}/${action}`, { method: 'POST' });
      const target = destination(item);
      if (navigate && target) {
        location.hash = target;
        if (item.request_id) window.dispatchEvent(new Event('mediauto-request-changed'));
      }
      await refresh();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally { setPending(''); }
  }

  return <details className="request-inbox" onToggle={(event) => { if (event.currentTarget.open) void refresh(); }}>
    <summary className="button secondary"><Bell size={16} /> Notifications{data?.unread ? ` (${data.unread})` : ''}</summary>
    <section className="panel request-inbox-panel" aria-label="Request Inbox">
      <div className="actions">
        <button className="button secondary" type="button" onClick={() => void refresh()}>Refresh Notifications</button>
        <a href="#settings/notifications" className="button secondary" onClick={(event) => {
          const details = event.currentTarget.closest('details');
          if (details) details.open = false;
        }}>Notification Preferences</a>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      {data ? <>
        {data.items.length ? <ul className="request-list">{data.items.map((item) => <li key={item.id}>
          <strong>{actions[item.action] ?? events[item.event]}{!item.read_at && ' · Unread'}</strong>
          <small>{stamp.format(new Date(item.created_at))}</small>
          {item.request_id || item.case_id ? <button className="button secondary" type="button" disabled={!!pending} onClick={(event) => {
            const details = event.currentTarget.closest('details.request-inbox') as HTMLDetailsElement | null;
            void act(item, 'read', true).then((ok) => { if (ok && details) details.open = false; });
          }}>{item.request_id ? 'Open Request' : 'Open Case'}</button>
            : !item.read_at && <button className="button secondary" type="button" disabled={!!pending}
              onClick={() => void act(item, 'read')}>Mark as Read</button>}
        </li>)}</ul> : <p className="empty-inline">No in-app notifications.</p>}
        <details className="delivery-activity"><summary>Delivery Status</summary>
          {data.deliveries.length ? <ul className="request-list">{data.deliveries.map((item) => <li key={item.id}>
            <strong>{actions[item.action] ?? events[item.event]} · {channels[item.channel]} · {states[item.status]}</strong>
            <small>{stamp.format(new Date(item.finished_at ?? item.created_at))} · Attempts {item.attempts ?? 0}</small>
            {item.error && <p>{issues[item.error] ?? 'Unable to deliver the notification.'}</p>}
            {destination(item) && <a className="button secondary" href={destination(item)} onClick={(event) => {
              const details = event.currentTarget.closest('details.request-inbox') as HTMLDetailsElement | null;
              if (details) details.open = false;
            }}>{item.request_id ? 'Open Request' : 'Open Case'}</a>}
            {(item.status === 'blocked' || item.status === 'failed') && <button className="button secondary" type="button"
              disabled={!!pending} onClick={() => void act(item, 'retry')}>Retry Delivery</button>}
          </li>)}</ul> : <p className="empty-inline">No email or Push delivery attempts.</p>}
        </details>
      </> : !error && <p role="status">Loading notifications…</p>}
    </section>
  </details>;
}

export function NotificationSettings({ organization }: { organization: string }) {
  const path = pathFor(organization);
  const [data, setData] = useState<Preference>();
  const [rules, setRules] = useState<Rules>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<Preference>(path + '/preferences', { signal });
      if (!signal?.aborted) { setData(result); setRules(result.rules); setError(''); }
    } catch (failure) { if (!signal?.aborted) setError(errorText(failure)); }
  }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    setError('');
    try { await task(); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }

  function save() {
    if (!data || !rules) return;
    void perform(async () => {
      const saved = await api<Preference>(path + '/preferences', jsonBody('PUT', { rules, version: data.version }));
      setData(saved);
      setRules(saved.rules);
      setNotice('Notification preferences saved.');
    });
  }

  function subscribe() {
    if (!supported || !data?.push_public_key) return;
    const encoded = data.push_public_key;
    void perform(async () => {
      if (await Notification.requestPermission() !== 'granted') throw new Error('Allow browser notifications to connect Push.');
      await navigator.serviceWorker.register('/notification-sw.js');
      const registration = await navigator.serviceWorker.ready;
      const buffer = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
      let subscription = await registration.pushManager.getSubscription();
      const previous = subscription?.options.applicationServerKey;
      if (subscription && previous && new Uint8Array(previous).some((value, index) => value !== buffer[index])) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: buffer });
      const { endpoint, keys } = subscription.toJSON();
      await api(path + '/push-subscription', jsonBody('PUT', { endpoint, keys }));
      setData((value) => value && { ...value, push_registered: true });
      setNotice('Browser Push connected.');
    });
  }

  function disconnect() {
    void perform(async () => {
      await api(path + '/push-subscription', { method: 'DELETE' });
      if (supported) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
      }
      setData((value) => value && { ...value, push_registered: false });
      setNotice('Browser Push disconnected.');
    });
  }

  return <>
    <div className="page-heading"><div><h1>Notification Preferences</h1></div></div>
    <section className="panel notification-settings" aria-label="Notification Settings">
      {error && <div role="alert" className="form-error">{error} <button className="button secondary" type="button"
        onClick={() => void refresh()}>Reload Saved Preferences</button></div>}
      {notice && <p role="status">{notice}</p>}
      {data && rules ? <>
        <form onSubmit={(event) => { event.preventDefault(); save(); }}>
          <div className="case-log-table"><table>
            <thead><tr><th>Event</th>{Object.entries(channels).map(([channel, label]) => <th key={channel} scope="col">{label}</th>)}</tr></thead>
            <tbody>{(Object.keys(events) as EventName[]).map((event) => <tr key={event}>
              <th scope="row">{events[event]}</th>
              {(Object.keys(channels) as Channel[]).map((channel) => <td key={channel}>
                <input type="checkbox" aria-label={`${events[event]} ${channels[channel]}`} checked={rules[event][channel]} disabled={busy}
                  onChange={(value) => setRules({ ...rules, [event]: { ...rules[event], [channel]: value.target.checked } })} />
              </td>)}
            </tr>)}</tbody>
          </table></div>
          <button className="button primary" disabled={busy} type="submit">Save Preferences</button>
        </form>
        <dl className="history-connections">
          <div><dt>Email</dt><dd>{data.email_configured ? 'SMTP configured' : 'SMTP not configured'}</dd>
            <dd>{data.email_registered ? 'Verified account email registered' : 'No verified account email registered'}</dd></div>
          <div><dt>Push</dt><dd>{data.push_configured ? 'Push configured' : 'Push not configured on this server'}</dd>
            <dd>{data.push_registered ? 'A browser is connected to this account' : 'No browser connected'}</dd>
            {!supported && <dd>Push registration requires a supported browser on HTTPS or localhost.</dd>}
            <dd className="actions">
              <button className="button secondary" type="button" disabled={busy || !supported || !data.push_configured} onClick={subscribe}>Connect Browser Push</button>
              {data.push_registered && <button className="button secondary" type="button" disabled={busy} onClick={disconnect}>Disconnect Push</button>}
            </dd></div>
        </dl>
      </> : !error && <p role="status">Loading notification preferences…</p>}
    </section>
  </>;
}
