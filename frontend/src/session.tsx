import brandLogo from '../assets/logo.png';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowLeft, ClipboardCopy, Clock3, LogIn, UserPlus } from 'lucide-react';

export type User = { id: string; organization: string; username: string; display_name: string; role: 'admin' | 'doctor' | 'labeler' | 'viewer' };
export const accountRoleLabels: Record<User['role'], string> = {
  admin: 'Administrator', doctor: 'Pathologist', labeler: 'Slide Registration Staff', viewer: 'Viewer',
};
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
  const [registering, setRegistering] = useState(false);
  const [organization, setOrganization] = useState('local');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [submittedUsername, setSubmittedUsername] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [error, setError] = useState('');
  const formHeading = useRef<HTMLHeadingElement>(null);
  const codeOutput = useRef<HTMLOutputElement>(null);
  const focusHeading = useRef(false);

  useEffect(() => {
    if (!focusHeading.current) return;
    formHeading.current?.focus();
    focusHeading.current = false;
  }, [registering, confirmationCode]);

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
      setSubmittedUsername('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to sign in.');
    } finally { setBusy(false); }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (fields.get('password') !== fields.get('confirm_password')) {
      setError('The passwords do not match.');
      return;
    }
    fields.delete('confirm_password');
    setBusy(true); setError('');
    try {
      const result = await api<{ code: string }>('/api/auth/register', jsonBody('POST', Object.fromEntries(fields)));
      setSubmittedUsername(String(fields.get('username') ?? ''));
      focusHeading.current = true;
      setConfirmationCode(result.code);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to submit the registration request.');
    } finally { setBusy(false); }
  }

  function changeMode(open: boolean) {
    focusHeading.current = true;
    setRegistering(open);
    setConfirmationCode('');
    setCopyStatus('');
    setError('');
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(confirmationCode);
      setCopyStatus('Confirmation code copied.');
    } catch {
      const selection = window.getSelection();
      if (selection && codeOutput.current) {
        const range = document.createRange();
        range.selectNodeContents(codeOutput.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopyStatus('Copy the selected code with your browser.');
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to sign out.'); }
  }

  if (user) return <>{error && <p className="notice" role="alert">{error}</p>}{children(user, () => void logout())}</>;
  const organizationField = <label className="form-field">Organization Code
    <input name="organization" value={organization} onChange={(event) => setOrganization(event.target.value)} required maxLength={64} />
  </label>;
  const heading = confirmationCode ? 'Registration Confirmation Code' : registering ? 'Request an Account' : 'Sign In';

  return <main className="login-page">
    <section className="login-panel panel" aria-labelledby="auth-heading">
      <div className="login-brand">
        <h1><img src={brandLogo} alt="MeDIAuto Studio" width={3776} height={1120} /></h1>
        <p>Pathology Workspace</p>
      </div>
      <div className="login-content">
        {loading ? <p role="status">Checking sign-in status…</p> : <>
          {confirmationCode && <span className="login-pending"><Clock3 size={15} aria-hidden="true" /> Pending Approval</span>}
          <h2 id="auth-heading" ref={formHeading} tabIndex={-1}>{heading}</h2>
          {confirmationCode ? <div className="login-form">
            <p>Share this code with your organization administrator. You can sign in after they approve your request.</p>
            <div className="login-code-row">
              <output ref={codeOutput} className="registration-code">{confirmationCode}</output>
              <button type="button" className="button secondary" onClick={() => void copyCode()}><ClipboardCopy size={16} aria-hidden="true" /> Copy Code</button>
            </div>
            <p className="muted login-copy-status" role="status">{copyStatus || 'Keep this code for your administrator.'}</p>
            <button type="button" className="button primary" onClick={() => changeMode(false)}>Back to Sign In</button>
          </div> : registering ? <form key="register" className="login-form" aria-labelledby="auth-heading" onSubmit={(event) => void register(event)}>
            <p>Your organization administrator approves the request and assigns your role.</p>
            {organizationField}
            <label className="form-field">Display Name<input name="display_name" autoComplete="name" required maxLength={120} /></label>
            <label className="form-field">Username<input name="username" autoComplete="username" required minLength={3} maxLength={80} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,79}" /></label>
            <label className="form-field">Password<input name="password" type="password" autoComplete="new-password" aria-describedby="registration-password-requirement" required minLength={12} maxLength={256} /></label>
            <small className="muted" id="registration-password-requirement">Use at least 12 characters.</small>
            <label className="form-field">Confirm Password<input name="confirm_password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button primary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit Registration Request'}</button>
            <button className="button secondary" type="button" disabled={busy} onClick={() => changeMode(false)}><ArrowLeft size={16} aria-hidden="true" /> Back to Sign In</button>
          </form> : <form key="login" className="login-form" aria-labelledby="auth-heading" onSubmit={(event) => void login(event)}>
            {organizationField}
            <label className="form-field">Username<input name="username" autoComplete="username" defaultValue={submittedUsername} required maxLength={80} /></label>
            <label className="form-field">Password<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button primary" type="submit" disabled={busy}><LogIn size={16} aria-hidden="true" /> {busy ? 'Checking…' : 'Sign In'}</button>
            <div className="login-switch"><span>New to your workspace?</span>
              <button className="button secondary" type="button" disabled={busy} onClick={() => changeMode(true)}><UserPlus size={16} aria-hidden="true" /> Request an Account</button></div>
          </form>}
        </>}
      </div>
    </section>
  </main>;
}
