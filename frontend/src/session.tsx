import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Microscope } from 'lucide-react';

export type User = { id: string; organization: string; username: string; display_name: string; role: 'admin' | 'doctor' | 'labeler' | 'viewer' };
export const canWrite = (user: User) => user.role === 'admin' || user.role === 'labeler';
const expired = 'mediauto-session-expired';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  if (response.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event(expired));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : '요청을 처리하지 못했습니다.');
  }
  return response.json();
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
      setError(failure instanceof Error ? failure.message : '로그인할 수 없습니다.');
    } finally { setBusy(false); }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '로그아웃할 수 없습니다.'); }
  }

  if (user) return <>{error && <p className="notice" role="alert">{error}</p>}{children(user, () => void logout())}</>;
  return <main className="login-page"><section className="panel login-panel">
    <div className="title-inline"><span className="brand-icon"><Microscope size={23} /></span><h1>MeDIAuto Studio</h1></div>
    {loading ? <p role="status">로그인 상태 확인 중</p> : <form className="login-form" onSubmit={(event) => void login(event)}>
      <label className="form-field">기관 코드<input name="organization" defaultValue="local" required maxLength={64} /></label>
      <label className="form-field">계정<input name="username" autoComplete="username" required maxLength={80} /></label>
      <label className="form-field">비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={busy}>{busy ? '확인 중' : '로그인'}</button>
    </form>}
  </section></main>;
}
