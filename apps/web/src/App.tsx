import { useEffect, useState } from 'react';
import { apiInfo } from '@vybe/shared';

type ApiStatus = 'checking' | 'online' | 'offline';

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json() as Promise<{ status: string }>;
      })
      .then((data) => setApiStatus(data.status === 'ok' ? 'online' : 'offline'))
      .catch(() => {
        if (!controller.signal.aborted) setApiStatus('offline');
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="welcome">
      <div className="welcome-card">
        <div className="brand-mark" aria-hidden="true">v</div>
        <p className="eyebrow">CONECTE SEU UNIVERSO</p>
        <h1>O próximo capítulo começa aqui.</h1>
        <p className="description">
          A base do VYBE está pronta para construir comunidades, personagens e histórias.
        </p>
        <div className="status" role="status" aria-live="polite">
          <span className={`status-dot ${apiStatus}`} />
          {apiStatus === 'checking' && 'Conectando à API…'}
          {apiStatus === 'online' && 'Frontend conectado à API'}
          {apiStatus === 'offline' && 'API indisponível; inicie os projetos pela raiz do monorepo'}
        </div>
        <small className="version">{apiInfo.name} · {apiInfo.version}</small>
      </div>
    </main>
  );
}
