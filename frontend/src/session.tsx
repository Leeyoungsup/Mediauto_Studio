import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Microscope } from 'lucide-react';

export type User = { id: string; organization: string; username: string; display_name: string; role: 'admin' | 'doctor' | 'labeler' | 'viewer' };
export const canWrite = (user: User) => user.role === 'admin' || user.role === 'labeler';
const expired = 'mediauto-session-expired';

export function auditAttemptId() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export async function request(path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  if (response.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event(expired));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : response.status === 422 ? 'Check the required fields and input format.' : 'Unable to process the request.');
  }
  return response;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  return (await request(path, options)).json();
}

export function jsonBody(method: string, data: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', ...headers } };
}

export function SessionGate({ children }: { children: (user: User, logout: () => void) => ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    function expire() { setUser(null); }
    window.addEventListener(expired, expire);
    api<User>('/api/auth/me', { signal: controller.signal })
      .then((identity) => { if (!controller.signal.aborted) setUser(identity); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); window.removeEventListener(expired, expire); };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      setUser(await api<User>('/api/auth/login', jsonBody('POST', Object.fromEntries(fields))));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to sign in.');
    } finally { setBusy(false); }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to sign out.'); }
  }

  if (user) return <>{error && <p className="notice" role="alert">{error}</p>}{children(user, () => void logout())}</>;
  return <main className="login-page"><section className="panel login-panel">
    <div className="title-inline"><span className="brand-icon"><Microscope size={23} /></span><h1>MeDIAuto Studio</h1></div>
    {loading ? <p role="status">Checking sign-in status…</p> : <form className="login-form" onSubmit={(event) => void login(event)}>
      <label className="form-field">Organization Code<input name="organization" defaultValue="local" required maxLength={64} /></label>
      <label className="form-field">Username<input name="username" autoComplete="username" required maxLength={80} /></label>
      <label className="form-field">Password<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign In'}</button>
    </form>}
  </section></main>;
}
