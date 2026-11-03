import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { MaterialIcon } from './MaterialIcon';
import './VerificationAdminPage.css';

type Status = 'PENDING' | 'CONTACTED' | 'AWAITING_PAYMENT' | 'PAYMENT_PROOF_SENT' | 'PAYMENT_ISSUE' | 'PAID' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SUSPENDED' | 'REVOKED';
type RequestItem = {
  id: string; tenantId: string; communityId: string; conversationId: string | null; requestedByUserId?: string; beneficiaryProfileId?: string; isGift?: boolean; source?: string; type: string; status: Status; statusLabel: string;
  paymentStatus: string; amount: number; currency: string; createdAt: string; updatedAt: string; paymentConfirmedAt?: string;
  paymentProofs: Array<{ id: string; mimeType: string; size: number; uploadedAt: string }>;
  community: { id: string; name: string; slug: string } | null;
  character: { id: string; username: string; displayName: string; avatarUrl: string } | null;
  beneficiary: { id: string; username: string; displayName: string; avatarUrl: string } | null;
  handledBy?: string | null; handler?: { displayName: string; username: string } | null;
};
type Detail = RequestItem & {
  accountId: string; profileId: string; adminCharacterId: string;
  history: Array<{ action: string; reason: string; createdAt: string; actor?: { displayName: string; username: string } | null }>;
  internalNotes: Array<{ content: string; createdAt: string; author?: { displayName: string; username: string } | null }>;
};
type ChatMessage = { id: string; content: string; messageType: 'text' | 'image' | 'file'; attachment?: { url: string; name: string; mimeType: string; size: number }; createdAt: string; isSupport: boolean; sender?: { displayName: string; username: string; avatarUrl: string } | null };
type StatusFilter = 'ALL' | Status;
type ListResponse = { requests: RequestItem[]; communities: Array<{ id: string; name: string; slug: string }>; stats: { newToday: number; awaitingSupport: number; awaitingPayment: number; proofsToReview: number; active: number; newRequests: number } };

const tabs: Array<{ status: StatusFilter; label: string }> = [
  { status: 'ALL', label: 'Todas' }, { status: 'PENDING', label: 'Novas solicitações' }, { status: 'CONTACTED', label: 'Em atendimento' },
  { status: 'AWAITING_PAYMENT', label: 'Aguardando pagamento' }, { status: 'PAYMENT_PROOF_SENT', label: 'Comprovantes para analisar' }, { status: 'PAYMENT_ISSUE', label: 'Problema no pagamento' }, { status: 'APPROVED', label: 'Ativas' },
  { status: 'SUSPENDED', label: 'Suspensas' }, { status: 'REJECTED', label: 'Recusadas' }, { status: 'REVOKED', label: 'Revogadas' },
];
const labels: Record<Status, string> = { PENDING: 'Nova', CONTACTED: 'Em atendimento', AWAITING_PAYMENT: 'Aguardando pagamento', PAYMENT_PROOF_SENT: 'Comprovante recebido', PAYMENT_ISSUE: 'Pagamento não identificado', PAID: 'Pagamento confirmado', APPROVED: 'Ativa', REJECTED: 'Recusada', CANCELLED: 'Cancelada', SUSPENDED: 'Suspensa', REVOKED: 'Revogada' };
const money = (amount: number, currency: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

function RequestAvatar({ src, name }: { src?: string | null; name: string }) {
  return <span className="vybe-plus-admin-avatar" aria-label={name} role="img"><MaterialIcon name="person"/>{src && <img src={src} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }}/>}</span>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Não foi possível concluir a ação.');
  return body;
}

export function VerificationAdminPage({ view = 'inbox' }: { view?: 'requests' | 'inbox' | 'active' }) {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [communities, setCommunities] = useState<ListResponse['communities']>([]);
  const [stats, setStats] = useState<ListResponse['stats']>({ newToday: 0, awaitingSupport: 0, awaitingPayment: 0, proofsToReview: 0, active: 0, newRequests: 0 });
  const [status, setStatus] = useState<StatusFilter>(view === 'active' ? 'APPROVED' : 'ALL');
  const [communityId, setCommunityId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('requestId') ?? '');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  async function loadList() {
    const query = new URLSearchParams();
    if (status !== 'ALL') query.set('status', status);
    if (communityId) query.set('communityId', communityId);
    if (search.trim()) query.set('q', search.trim());
    try {
      const result = await api<ListResponse>(`/api/platform/vybe-plus/requests?${query.toString()}`);
      setRequests(result.requests); setCommunities(result.communities); setStats(result.stats); setError('');
      setSelectedId((current) => result.requests.some((item) => item.id === current) ? current : result.requests[0]?.id ?? '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as solicitações.'); }
    finally { setLoading(false); }
  }
  async function loadDetail(requestId: string) {
    if (!requestId) { setDetail(null); setMessages([]); return; }
    try {
      const result = await api<{ request: Detail; messages: ChatMessage[] }>(`/api/platform/vybe-plus/requests/${requestId}${view === 'inbox' ? '?read=1' : ''}`);
      setDetail(result.request); setMessages(result.messages);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o atendimento.'); }
  }
  useEffect(() => { setLoading(true); const timeout = window.setTimeout(() => void loadList(), 220); return () => window.clearTimeout(timeout); }, [status, communityId, search]);
  useEffect(() => { const interval = window.setInterval(() => void loadList(), view === 'requests' ? 5000 : 30000); return () => window.clearInterval(interval); }, [status, communityId, search, view]);
  useEffect(() => {
    void loadDetail(selectedId);
    if (!selectedId) return;
    const interval = window.setInterval(() => void loadDetail(selectedId), 10000);
    return () => window.clearInterval(interval);
  }, [selectedId]);

  const selected = useMemo(() => requests.find((item) => item.id === selectedId) ?? null, [requests, selectedId]);
  async function assume() {
    if (!selectedId) return;
    setBusy('assign'); setError('');
    try { await api(`/api/platform/vybe-plus/requests/${selectedId}/assign`, { method: 'POST' }); await Promise.all([loadList(), loadDetail(selectedId)]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível assumir o atendimento.'); }
    finally { setBusy(''); }
  }
  async function changeStatus(next: Status, requiresReason = false) {
    if (!selectedId) return;
    const needsReason = requiresReason || ['REJECTED', 'SUSPENDED', 'REVOKED'].includes(next);
    if (needsReason && reason.trim().length < 5) { setError('Informe o motivo com pelo menos 5 caracteres.'); return; }
    if (['APPROVED', 'SUSPENDED', 'REVOKED'].includes(next) && !window.confirm(`${next === 'APPROVED' ? 'Ativar' : next === 'SUSPENDED' ? 'Suspender' : 'Revogar'} o VYBE Verificado de ${selected?.beneficiary?.displayName ?? selected?.character?.displayName ?? 'este perfil'} em ${selected?.community?.name ?? 'esta comunidade'}?`)) return;
    setBusy(next); setError('');
    try { await api(`/api/platform/vybe-plus/requests/${selectedId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next, reason: needsReason ? reason.trim() : '' }) }); setReason(''); await Promise.all([loadList(), loadDetail(selectedId)]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o status.'); }
    finally { setBusy(''); }
  }
  async function confirmPayment() {
    if (!selectedId || !detail) return;
    setBusy('confirm-payment'); setError('');
    try { await api(`/api/platform/vybe-plus/requests/${selectedId}/confirm-payment`, { method: 'POST' }); setConfirmingPayment(false); await Promise.all([loadList(), loadDetail(selectedId)]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o pagamento.'); }
    finally { setBusy(''); }
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft.trim() || !selectedId) return;
    setBusy('message'); setError('');
    try { await api(`/api/platform/vybe-plus/requests/${selectedId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: draft.trim() }) }); setDraft(''); await Promise.all([loadDetail(selectedId), loadList()]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.'); }
    finally { setBusy(''); }
  }
  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!noteDraft.trim() || !selectedId) return;
    setBusy('note'); setError('');
    try { await api(`/api/platform/vybe-plus/requests/${selectedId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: noteDraft.trim() }) }); setNoteDraft(''); await loadDetail(selectedId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a nota interna.'); }
    finally { setBusy(''); }
  }

  const title = view === 'requests' ? 'Solicitações VYBE+' : view === 'active' ? 'Verificados ativos' : 'Atendimentos VYBE+';
  const subtitle = view === 'requests' ? 'Solicitações do VYBE Verificado em todas as comunidades.' : view === 'active' ? 'Perfis com VYBE Verificado ativo em suas comunidades.' : 'Conversas entre usuários e o VYBE Suporte relacionadas ao VYBE+.';
  const visibleTabs = view === 'active' ? [] : tabs.filter((item) => view !== 'requests' || ['ALL', 'PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE', 'APPROVED', 'REJECTED'].includes(item.status));

  return <section className={`vybe-plus-admin is-${view}`}>
    <header className="vybe-plus-admin-heading"><div><span>VYBE+</span><h2>{title}</h2><p>{subtitle}</p></div><button type="button" onClick={() => { setLoading(true); void loadList(); }}><VerificationRefreshIcon/>Atualizar</button></header>
    <div className="vybe-plus-admin-stats"><article><small>{view === 'active' ? 'Ativadas hoje' : 'Novas hoje'}</small><strong>{stats.newToday}</strong></article><article><small>Novas solicitações</small><strong>{stats.newRequests}</strong></article><article><small>Comprovantes para analisar</small><strong>{stats.proofsToReview}</strong></article><article><small>Aguardando pagamento</small><strong>{stats.awaitingPayment}</strong></article><article><small>Ativas</small><strong>{stats.active}</strong></article></div>
    {error && <p className="vybe-plus-admin-error" role="alert">{error}</p>}
    {visibleTabs.length > 0 && <nav className="vybe-plus-admin-tabs" aria-label="Filtrar solicitações">{visibleTabs.map((item) => <button type="button" key={item.status} className={status === item.status ? 'is-active' : ''} onClick={() => setStatus(item.status)}>{view === 'requests' && item.status === 'APPROVED' ? 'Aprovadas' : item.label}{item.status === 'PENDING' && stats.newRequests > 0 && <b>{stats.newRequests}</b>}</button>)}</nav>}
    <div className="vybe-plus-admin-filters"><label><MaterialIcon name="search"/><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Buscar nome, @username ou ID da solicitação"/></label><select value={communityId} onChange={(event) => setCommunityId(event.currentTarget.value)} aria-label="Filtrar por comunidade"><option value="">Todas as comunidades</option>{communities.map((community) => <option value={community.id} key={community.id}>{community.name}</option>)}</select></div>
    <div className="vybe-plus-admin-workspace">
      <aside className="vybe-plus-admin-list" aria-label="Solicitações VYBE+">{loading ? <p className="vybe-plus-admin-empty">Carregando solicitações…</p> : requests.length ? requests.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? 'is-selected' : ''} onClick={() => setSelectedId(item.id)}><RequestAvatar src={item.character?.avatarUrl} name={item.character?.displayName ?? 'Perfil indisponível'}/><span className="vybe-plus-admin-summary"><strong>{item.character?.displayName ?? 'Perfil indisponível'}</strong><small>Comprador · @{item.character?.username ?? '—'}</small><small>{item.isGift ? `Presente para ${item.beneficiary?.displayName ?? 'perfil'}` : `Para si · ${item.beneficiary?.displayName ?? item.character?.displayName ?? 'perfil'}`}</small><small>{item.community?.name ?? 'Comunidade'} · {dateTime(item.createdAt)}</small><small className={`vybe-plus-admin-badge status-${item.status.toLowerCase()}`}>{labels[item.status]}</small></span><MaterialIcon name="chevron_right"/></button>) : <p className="vybe-plus-admin-empty">Nenhuma solicitação neste filtro.</p>}</aside>
      {!detail ? <main className="vybe-plus-admin-conversation vybe-plus-admin-placeholder"><MaterialIcon name="forum"/><strong>Selecione uma solicitação</strong><span>{view === 'inbox' ? 'A conversa com o VYBE Suporte aparecerá aqui.' : 'Os dados e as ações desta solicitação aparecerão aqui.'}</span></main> : <>
        {view !== 'inbox' ? <main className="vybe-plus-admin-conversation vybe-plus-admin-placeholder"><MaterialIcon name={view === 'active' ? 'verified' : 'fact_check'}/><strong>{view === 'active' ? 'Verificação do perfil' : 'Solicitação VYBE+'}</strong><span>{detail.character?.displayName ?? 'Perfil'} · {detail.community?.name ?? 'Comunidade'} · {labels[detail.status]}</span><a className="vybe-plus-admin-open-chat" href={`/administracao-vybe/vybe-plus/atendimentos?requestId=${detail.id}`}>Abrir atendimento <MaterialIcon name="arrow_forward"/></a></main> : <main className="vybe-plus-admin-conversation"><header className="vybe-plus-chat-heading"><RequestAvatar src={detail.character?.avatarUrl} name={detail.character?.displayName ?? 'Perfil indisponível'}/><div><strong>{detail.character?.displayName ?? 'Perfil indisponível'}</strong><small>@{detail.character?.username ?? '—'} · {detail.community?.name ?? 'Comunidade'}</small></div><button type="button" onClick={() => void assume()} disabled={busy === 'assign'}>{detail.handler ? `Atendimento: ${detail.handler.displayName}` : busy === 'assign' ? 'Assumindo…' : 'Assumir atendimento'}</button></header>
          <div className="vybe-plus-chat-messages">{messages.map((message) => <article key={message.id} className={message.isSupport ? 'is-support' : ''}><strong>{message.isSupport ? 'VYBE Suporte' : message.sender?.displayName ?? detail.character?.displayName ?? 'Usuário'}</strong>{message.content && <p>{message.content}</p>}{message.attachment && <a href={message.attachment.url} target="_blank" rel="noreferrer">{message.attachment.name || 'Ver anexo'}</a>}<small>{dateTime(message.createdAt)}</small></article>)}{!messages.length && <p className="vybe-plus-admin-empty">Esta conversa ainda não tem mensagens.</p>}</div>
          <form className="vybe-plus-chat-compose" onSubmit={(event) => void sendMessage(event)}><textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="Responder como VYBE Suporte…" maxLength={4000} required/><button type="submit" disabled={busy === 'message' || !draft.trim()}><MaterialIcon name="send"/>{busy === 'message' ? 'Enviando…' : 'Enviar'}</button></form>
        </main>}
        <aside className="vybe-plus-admin-details"><section><h3>Solicitação VYBE+</h3><span className={`vybe-plus-admin-badge status-${detail.status.toLowerCase()}`}>{labels[detail.status]}</span><dl><dt>Benefício</dt><dd>VYBE Verificado ({detail.type})</dd><dt>Tipo</dt><dd>{detail.isGift ? 'Presente' : 'Para mim'}</dd><dt>Comprador</dt><dd>{detail.character?.displayName ?? '—'} · @{detail.character?.username ?? '—'}</dd><dt>Beneficiário</dt><dd>{detail.beneficiary?.displayName ?? '—'} · @{detail.beneficiary?.username ?? '—'}</dd><dt>Comunidade</dt><dd>{detail.community?.name ?? '—'}</dd><dt>communityId</dt><dd>{detail.communityId}</dd><dt>Perfil beneficiário</dt><dd>{detail.profileId}</dd><dt>Valor</dt><dd>{money(detail.amount, detail.currency)}</dd><dt>Solicitado</dt><dd>{dateTime(detail.createdAt)}</dd><dt>Atendente</dt><dd>{detail.handler?.displayName ?? 'Não atribuído'}</dd><dt>Pagamento</dt><dd>{detail.paymentStatus === 'confirmed' ? `Confirmado · ${detail.paymentConfirmedAt ? dateTime(detail.paymentConfirmedAt) : ''}` : 'Não confirmado'}</dd></dl>{detail.paymentProofs?.length ? <div className="vybe-plus-admin-proofs"><strong>Comprovante recebido</strong>{detail.paymentProofs.map((proof, index) => <a key={proof.id} href={`/api/platform/vybe-plus/requests/${detail.id}/proofs/${proof.id}`} target="_blank" rel="noreferrer"><MaterialIcon name={proof.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'image'}/>Ver comprovante {index + 1} · {dateTime(proof.uploadedAt)}</a>)}</div> : null}{detail.conversationId && <small className="vybe-plus-admin-conversation-id">Conversa: {detail.conversationId}</small>}</section>
          <section><h3>Ações administrativas</h3>{error && <p className="vybe-plus-admin-error" role="alert">{error}</p>}<div className="vybe-plus-admin-actions">{detail.status === 'PENDING' && <button type="button" onClick={() => void changeStatus('CONTACTED')} disabled={Boolean(busy)}>Marcar em atendimento</button>}{['PENDING', 'CONTACTED'].includes(detail.status) && <button type="button" onClick={() => void changeStatus('AWAITING_PAYMENT')} disabled={Boolean(busy)}>Aguardando pagamento</button>}{detail.status === 'AWAITING_PAYMENT' && <button type="button" onClick={() => setConfirmingPayment(true)} disabled={Boolean(busy)}>Aceitar solicitação</button>}{detail.status === 'PAYMENT_PROOF_SENT' && <><button type="button" onClick={() => setConfirmingPayment(true)} disabled={Boolean(busy)}>Aceitar solicitação</button><button className="is-danger" type="button" onClick={() => void changeStatus('PAYMENT_ISSUE')} disabled={Boolean(busy)}>Pagamento não identificado</button></>}{detail.status === 'PAYMENT_ISSUE' && <button type="button" onClick={() => void changeStatus('AWAITING_PAYMENT')} disabled={Boolean(busy)}>Solicitar novo comprovante</button>}{detail.status === 'PAID' && <button type="button" onClick={() => void changeStatus('APPROVED')} disabled={Boolean(busy)}>Aceitar solicitação</button>}{detail.status === 'APPROVED' && <><button className="is-danger" type="button" onClick={() => void changeStatus('SUSPENDED', true)} disabled={Boolean(busy)}>Suspender</button><button className="is-danger" type="button" onClick={() => void changeStatus('REVOKED', true)} disabled={Boolean(busy)}>Revogar</button></>}{detail.status === 'SUSPENDED' && <><button type="button" onClick={() => void changeStatus('APPROVED')} disabled={Boolean(busy)}>Reativar</button><button className="is-danger" type="button" onClick={() => void changeStatus('REVOKED', true)} disabled={Boolean(busy)}>Revogar</button></>}{['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE', 'PAID'].includes(detail.status) && <button className="is-danger" type="button" onClick={() => void changeStatus('REJECTED', true)} disabled={Boolean(busy)}>Recusar solicitação</button>}</div>{['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE', 'PAID', 'APPROVED', 'SUSPENDED'].includes(detail.status) && <label className="vybe-plus-admin-reason">Motivo para recusar, suspender ou revogar<input value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="Obrigatório nessas ações" maxLength={500}/></label>}</section>
          <section><h3>Notas internas</h3><form className="vybe-plus-note-form" onSubmit={(event) => void addNote(event)}><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.currentTarget.value)} placeholder="Nota visível apenas à equipe VYBE" maxLength={2000} required/><button type="submit" disabled={busy === 'note' || !noteDraft.trim()}>{busy === 'note' ? 'Salvando…' : 'Adicionar nota'}</button></form><div className="vybe-plus-notes">{detail.internalNotes.map((note, index) => <article key={`${note.createdAt}-${index}`}><p>{note.content}</p><small>{note.author?.displayName ?? 'Equipe VYBE'} · {dateTime(note.createdAt)}</small></article>)}</div></section>
          <section><h3>Histórico</h3><ol className="vybe-plus-admin-history">{detail.history.slice().reverse().map((entry, index) => <li key={`${entry.action}-${entry.createdAt}-${index}`}><strong>{entry.action.replaceAll('_', ' ')}</strong><small>{entry.actor?.displayName ?? 'Sistema'} · {dateTime(entry.createdAt)}</small>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol></section></aside>
      </>}
    </div>
    {confirmingPayment && detail && <div className="vybe-plus-payment-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== 'confirm-payment') setConfirmingPayment(false); }}><section role="dialog" aria-modal="true" aria-labelledby="vybe-plus-payment-confirm-title"><button type="button" className="vybe-plus-payment-confirm-close" aria-label="Fechar" onClick={() => setConfirmingPayment(false)}><MaterialIcon name="close"/></button><span>CONFIRMAÇÃO ADMINISTRATIVA</span><h3 id="vybe-plus-payment-confirm-title">Aceitar solicitação?</h3><p>Confirme que conferiu o comprovante de pagamento de <strong>{money(detail.amount, detail.currency)}</strong> enviado pelo solicitante.</p><dl><div><dt>Beneficiário</dt><dd>{detail.beneficiary?.displayName ?? '—'} · @{detail.beneficiary?.username ?? '—'}</dd></div><div><dt>Comunidade</dt><dd>{detail.community?.name ?? '—'}</dd></div></dl><p>Ao aceitar, o pagamento será marcado como confirmado e o VYBE Verificado será ativado para esse perfil nesta comunidade.</p><footer><button type="button" onClick={() => setConfirmingPayment(false)} disabled={busy === 'confirm-payment'}>Cancelar</button><button type="button" className="is-primary" onClick={() => void confirmPayment()} disabled={busy === 'confirm-payment'}>{busy === 'confirm-payment' ? 'Aceitando…' : 'Aceitar e ativar'}</button></footer></section></div>}
  </section>;
}

function VerificationRefreshIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" style={{ flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }} aria-hidden="true" focusable="false"><path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3M20 4v7h-7M4 20v-7h7"/></svg>;
}
