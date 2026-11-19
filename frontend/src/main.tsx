import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type EmrState = 'unconfigured' | 'disabled' | 'connected' | 'unavailable' | 'unknown';

type Health = {
  status: 'ok' | 'degraded';
  database: 'connected' | 'unavailable';
  emr: EmrState;
};

const emrLabels: Record<EmrState, string> = {
  unconfigured: '미설정',
  disabled: '사용 중지',
  connected: '연결됨',
  unavailable: '연결 장애',
  unknown: '확인 불가',
};

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok && response.status !== 503) throw new Error('Health check failed');
        const data: Health = await response.json();
        if (!controller.signal.aborted) setHealth(data);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, [attempt]);

  const pending = !health && !failed;

  return (
    <main>
      <header>
        <h1>Mediauto Studio</h1>
        <p>개발 환경</p>
      </header>
      <section aria-labelledby="status-heading">
        <div className="section-header">
          <h2 id="status-heading">서비스 상태</h2>
          <button type="button" disabled={pending} onClick={() => {
            setHealth(null);
            setFailed(false);
            setAttempt((current) => current + 1);
          }}>다시 확인</button>
        </div>
        <dl aria-live="polite">
          <div><dt>FastAPI</dt><dd>{failed ? '응답 없음' : health ? '응답 정상' : '확인 중'}</dd></div>
          <div><dt>PostgreSQL</dt><dd>{health ? (health.database === 'connected' ? '연결됨' : '연결 장애') : '—'}</dd></div>
          <div><dt>EMR</dt><dd>{health ? emrLabels[health.emr] : '—'}</dd></div>
        </dl>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
