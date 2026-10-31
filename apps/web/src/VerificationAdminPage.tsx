import { useEffect, useMemo, useState } from 'react';
import { MaterialIcon } from './MaterialIcon';
import './VerificationAdminPage.css';

type Status = 'PENDING' | 'CONTACTED' | 'AWAITING_PAYMENT' | 'PAID' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type RequestItem = { id: string; tenantId: string; community: { name: string; slug: string } | null; character: { id: string; username: string; displayName: string; avatarUrl: string } | null; status: Status; statusLabel: string; paymentStatus: string; amount: number; currency: string; createdAt: string; rejectionReason?: string };
const tabs: Array<{ status: Status | 'ALL'; label: string }> = [{ status: 'PENDING', label: 'Pendentes' }, { status: 'CONTACTED', label: 'Em atendimento' }, { status: 'AWAITING_PAYMENT', label: 'Aguardando pagamento' }, { status: 'PAID', label: 'Pagamento confirmado' }, { status: 'APPROVED', label: 'Aprovadas' }, { status: 'REJECTED', label: 'Recusadas' }, { status: 'CANCELLED', label: 'Canceladas' }, { status: 'ALL', label: 'Todas' }];

export function VerificationAdminPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [tab, setTab] = useState<Status | 'ALL'>('PENDING');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  async function load() {
    setLoading(true);
    try { const response = await fetch('/api/verification/admin', { credentials: 'same-origin' }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Acesso indisponível.'); setRequests(body.requests as RequestItem[]); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar as solicitações.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => tab === 'ALL' ? requests : requests.filter((item) => item.status === tab), [requests, tab]);
  async function update(item: RequestItem, status: Status, withReason = false) {
    const detail = withReason ? reason.trim() : '';
    if (withReason && detail.length < 5) { setError('Informe um motivo com pelo menos 5 caracteres.'); return; }
    setBusy(item.id); setError('');
    try { const response = await fetch(`/api/verification/admin/${item.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, reason: detail }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Não foi possível atualizar a solicitação.'); setReason(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível atualizar a solicitação.'); }
    finally { setBusy(''); }
  }
  async function remove(item: RequestItem) {
    const detail = reason.trim(); if (detail.length < 5) { setError('Informe um motivo para remover o selo.'); return; }
    setBusy(item.id); setError('');
    try { const response = await fetch(`/api/verification/admin/${item.id}/remove`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: detail }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Não foi possível remover o selo.'); setReason(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível remover o selo.'); }
    finally { setBusy(''); }
  }
  return <section className="social-page-card verification-admin-page"><header className="social-page-title"><span>ADMINISTRAÇÃO CENTRAL VYBE</span><h1>Verificações</h1><p>Revise solicitações e confirme pagamentos manualmente. Nenhum dado bancário é armazenado.</p></header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <nav className="verification-admin-tabs" aria-label="Filtrar solicitações">{tabs.map((item) => <button type="button" key={item.status} className={tab === item.status ? 'active' : ''} onClick={() => setTab(item.status)}>{item.label}<span>{item.status === 'ALL' ? requests.length : requests.filter((request) => request.status === item.status).length}</span></button>)}</nav>
    {loading ? <div className="blank-state">Carregando solicitações…</div> : !filtered.length ? <div className="blank-state">Nenhuma solicitação nesta categoria.</div> : <div className="verification-request-list">{filtered.map((item) => <article key={item.id}>
      <header><span className="verification-admin-avatar">{item.character?.avatarUrl ? <img src={item.character.avatarUrl} alt=""/> : <MaterialIcon name="person"/>}</span><div><h2>{item.character?.displayName ?? 'Personagem indisponível'}</h2><p>@{item.character?.username ?? '—'} · {item.community?.name ?? 'Comunidade indisponível'}</p></div><span className={`verification-status status-${item.status.toLowerCase()}`}>{item.statusLabel}</span></header>
      <div className="verification-request-meta"><span>Solicitado em <strong>{new Date(item.createdAt).toLocaleString('pt-BR')}</strong></span><span>Valor <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.amount)}</strong></span>{item.paymentStatus === 'confirmed' && <span className="payment-confirmed"><MaterialIcon name="check_circle"/> Pagamento confirmado</span>}</div>
      {item.status === 'REJECTED' && item.rejectionReason && <p className="verification-rejection-reason">Motivo da recusa: {item.rejectionReason}</p>}
      {(item.status === 'APPROVED' || ['PENDING', 'CONTACTED', 'AWAITING_PAYMENT'].includes(item.status)) && <label className="verification-admin-reason">{item.status === 'APPROVED' ? 'Motivo para remover selo' : 'Motivo para recusar ou cancelar (obrigatório nessas ações)'}<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Descreva o motivo"/></label>}
      <div className="verification-admin-actions">{item.status === 'PENDING' && <><button type="button" onClick={() => void update(item, 'CONTACTED')} disabled={Boolean(busy)}>Marcar em atendimento</button><button className="danger" type="button" onClick={() => void update(item, 'REJECTED', true)} disabled={Boolean(busy)}>Recusar</button></>}{item.status === 'CONTACTED' && <><button type="button" onClick={() => void update(item, 'AWAITING_PAYMENT')} disabled={Boolean(busy)}>Aguardar pagamento</button><button className="danger" type="button" onClick={() => void update(item, 'REJECTED', true)} disabled={Boolean(busy)}>Recusar</button></>}{item.status === 'AWAITING_PAYMENT' && <><button type="button" onClick={() => void update(item, 'PAID')} disabled={Boolean(busy)}>Marcar pagamento recebido</button><button className="danger" type="button" onClick={() => void update(item, 'REJECTED', true)} disabled={Boolean(busy)}>Recusar</button></>}{item.status === 'PAID' && <button type="button" onClick={() => void update(item, 'APPROVED')} disabled={Boolean(busy)}>Aprovar verificação</button>}{item.status === 'APPROVED' && <button className="danger" type="button" onClick={() => void remove(item)} disabled={Boolean(busy)}>Remover selo</button>}{['PENDING', 'CONTACTED', 'AWAITING_PAYMENT'].includes(item.status) && <button className="quiet" type="button" onClick={() => void update(item, 'CANCELLED', true)} disabled={Boolean(busy)}>Cancelar solicitação</button>}</div>
    </article>)}</div>}
  </section>;
}
