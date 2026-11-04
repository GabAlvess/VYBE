import { useEffect, useState } from 'react';
import { MaterialIcon } from './MaterialIcon';
import './SupportUnreadIndicator.css';

type SupportUnreadTicket = { unreadForUser?: boolean; unreadMessageCountForUser?: number };

export function SupportUnreadIndicator() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch('/api/support/tickets/me', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return;
        const tickets = await response.json() as SupportUnreadTicket[];
        if (!active) return;
        setUnreadCount(tickets.reduce((total, ticket) => total + (ticket.unreadMessageCountForUser ?? (ticket.unreadForUser ? 1 : 0)), 0));
      } catch { /* A falha de rede não interrompe a navegação. */ }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  if (!unreadCount) return null;
  const label = unreadCount === 1 ? '1 nova mensagem' : `${unreadCount} novas mensagens`;
  return <span className="support-unread-indicator" role="img" aria-label={`${label} na Central de Ajuda`} title={`${label} na Central de Ajuda`}><MaterialIcon name="mail"/></span>;
}
