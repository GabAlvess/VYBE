import { useEffect, useState } from 'react';
import { MaterialIcon } from './MaterialIcon';
import './SnackMessage.css';

type SnackDetail = { message: string; tone?: 'error' | 'success' | 'info' };
type SnackItem = SnackDetail & { id: number };

export function notifySnack(message: string, tone: SnackDetail['tone'] = 'error') {
  if (!message.trim()) return;
  window.dispatchEvent(new CustomEvent<SnackDetail>('vybe:snack', { detail: { message: message.trim(), tone } }));
}

export function SnackMessage() {
  const [snack, setSnack] = useState<SnackItem | null>(null);
  useEffect(() => {
    const onSnack = (event: Event) => {
      const detail = (event as CustomEvent<SnackDetail>).detail;
      if (detail?.message) setSnack({ ...detail, id: Date.now() });
    };
    window.addEventListener('vybe:snack', onSnack);
    return () => window.removeEventListener('vybe:snack', onSnack);
  }, []);
  useEffect(() => {
    if (!snack) return;
    const timeout = window.setTimeout(() => setSnack(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [snack]);
  if (!snack) return null;
  const tone = snack.tone ?? 'error';
  const icon = tone === 'success' ? 'check_circle' : tone === 'info' ? 'info' : 'error';
  return <div className={`vybe-snack vybe-snack--${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} key={snack.id}>
    <span className="vybe-snack__icon" aria-hidden="true"><MaterialIcon name={icon}/></span><p>{snack.message}</p>
    <button type="button" className="vybe-snack__close" aria-label="Fechar aviso" onClick={() => setSnack(null)}><MaterialIcon name="close"/></button>
    <span className="vybe-snack__timer" aria-hidden="true"/>
  </div>;
}
