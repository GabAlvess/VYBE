import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SocialCharacter } from './SocialApp';
import { MaterialIcon } from './MaterialIcon';
import { VerificationAdminPage } from './VerificationAdminPage';
import { VybePlusPixSettings } from './VybePlusPixSettings';
import { SupportAdminPage } from './SupportAdminPage';
import './AdminPlatformPage.css';
import './CommunityCreationAdmin.css';

type Route = 'overview' | 'requests' | 'communities' | 'community-creations' | 'vybe-requests' | 'support' | 'verified' | 'pix' | 'cashflow' | 'support-inbox' | 'support-bugs' | 'support-suggestions' | 'support-direction' | 'support-history';
type CommunityRequest = { id: string; rpgName: string; slug: string; description: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; photoUrl: string; applicant?: { displayName: string; username: string } | null };
type ManagedCommunity = { id: string; name: string; slug: string; subdomain: string; description: string; coverUrl: string; memberCount: number; status: 'active' | 'archived' | 'suspended'; ownerEmail?: string };
type VerificationOverview = { requests: Array<{ status: string }>; stats: { newToday: number; awaitingSupport: number; awaitingPayment: number; proofsToReview: number; active: number; newRequests: number } };

const routes: Array<{ id: Route; title: string; path: string; icon: string; group: string; badge?: 'community' | 'support' | 'proofs' | 'tickets' }> = [
  { id: 'overview', title: 'Visão geral', path: '/administracao-vybe', icon: 'home', group: 'ADMINISTRAÇÃO VYBE' },
  { id: 'requests', title: 'Solicitações', path: '/administracao-vybe/solicitacoes', icon: 'assignment', group: 'COMUNIDADES', badge: 'community' },
  { id: 'community-creations', title: 'Solicitações de criação', path: '/administracao-vybe/comunidades/solicitacoes-criacao', icon: 'add', group: 'COMUNIDADES' },
  { id: 'communities', title: 'Gerenciar comunidades', path: '/administracao-vybe/comunidades', icon: 'groups', group: 'COMUNIDADES' },
  { id: 'vybe-requests', title: 'Solicitações VYBE+', path: '/administracao-vybe/vybe-plus/solicitacoes', icon: 'auto_awesome', group: 'VYBE+', badge: 'proofs' },
  { id: 'support', title: 'Atendimentos', path: '/administracao-vybe/vybe-plus/atendimentos', icon: 'forum', group: 'VYBE+', badge: 'support' },
  { id: 'verified', title: 'Verificados ativos', path: '/administracao-vybe/vybe-plus/verificados', icon: 'verified', group: 'VYBE+' },
  { id: 'pix', title: 'Configurar PIX', path: '/administracao-vybe/vybe-plus/pix', icon: 'payments', group: 'VYBE+' },
  { id: 'cashflow', title: 'Fluxo de caixa', path: '/administracao-vybe/vybe-plus/fluxo-de-caixa', icon: 'account_balance', group: 'PLATAFORMA' },
  { id: 'support-inbox', title: 'Caixa de entrada', path: '/administracao-vybe/atendimentos', icon: 'forum', group: 'CENTRAL DE AJUDA', badge: 'tickets' },
  { id: 'support-bugs', title: 'Problemas reportados', path: '/administracao-vybe/atendimentos/problemas', icon: 'bug_report', group: 'CENTRAL DE AJUDA' },
  { id: 'support-suggestions', title: 'Sugestões', path: '/administracao-vybe/atendimentos/sugestoes', icon: 'lightbulb', group: 'CENTRAL DE AJUDA' },
  { id: 'support-direction', title: 'Contato com a direção', path: '/administracao-vybe/atendimentos/direcao', icon: 'campaign', group: 'CENTRAL DE AJUDA' },
  { id: 'support-history', title: 'Histórico', path: '/administracao-vybe/atendimentos/historico', icon: 'history', group: 'CENTRAL DE AJUDA' },
];

const pageForPath = (path: string): Route => path.endsWith('/solicitacoes') && path.includes('/vybe-plus/') ? 'vybe-requests'
  : path.endsWith('/atendimentos/problemas') ? 'support-bugs'
  : path.endsWith('/atendimentos/sugestoes') ? 'support-suggestions'
  : path.endsWith('/atendimentos/direcao') ? 'support-direction'
  : path.endsWith('/atendimentos/historico') ? 'support-history'
  : path.includes('/vybe-plus/') && path.endsWith('/atendimentos') ? 'support'
  : path.endsWith('/atendimentos') ? 'support-inbox'
  : path.endsWith('/solicitacoes-criacao') ? 'community-creations'
    : path.endsWith('/verificados') ? 'verified'
      : path.endsWith('/fluxo-de-caixa') ? 'cashflow'
      : path.endsWith('/pix') ? 'pix'
      : path.endsWith('/comunidades') ? 'communities'
        : path.endsWith('/solicitacoes') ? 'requests' : 'overview';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar a administração.');
  return data;
}

export function AdminPlatformPage({ character, onLogout }: { character: SocialCharacter; onLogout: () => void }) {
  const [path, setPath] = useState(window.location.pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<CommunityRequest[]>([]);
  const [communities, setCommunities] = useState<ManagedCommunity[]>([]);
  const [verification, setVerification] = useState<VerificationOverview | null>(null);
  const [supportUnread, setSupportUnread] = useState(0);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const activePage = pageForPath(path);
  const pageTitle = routes.find((item) => item.id === activePage)?.title ?? 'Visão geral';
  const communityPending = requests.filter((item) => item.status === 'pending').length;
  const supportCount = verification?.stats.awaitingSupport ?? 0;
  const proofCount = verification?.stats.proofsToReview ?? 0;

  const loadOverview = useCallback(async () => {
    try {
      await api('/api/platform/admin/me');
      setAuthorized(true);
    } catch {
      setAuthorized(false); setOverviewLoading(false); return;
    }
    try {
      const [communityRequests, managed, verified, supportTickets] = await Promise.all([
        api<CommunityRequest[]>('/api/platform/admin/community-requests'),
        api<ManagedCommunity[]>('/api/platform/admin/communities'),
        api<VerificationOverview>('/api/platform/vybe-plus/requests'),
        api<Array<{ unreadForAdmin: boolean; unreadMessageCount?: number }>>('/api/platform/admin/support/tickets'),
      ]);
      setRequests(communityRequests); setCommunities(managed); setVerification(verified); setSupportUnread(supportTickets.reduce((total, item) => total + (item.unreadMessageCount ?? (item.unreadForAdmin ? 1 : 0)), 0)); setOverviewError('');
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Não foi possível carregar os indicadores.');
    } finally { setOverviewLoading(false); }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => {
    const back = () => { setPath(window.location.pathname); setMobileOpen(false); };
    window.addEventListener('popstate', back);
    const delegateLinks = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/administracao-vybe"]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); window.history.pushState({}, '', link.href); setPath(window.location.pathname); setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    document.addEventListener('click', delegateLinks);
    return () => { window.removeEventListener('popstate', back); document.removeEventListener('click', delegateLinks); };
  }, []);

  const groups = useMemo(() => [...new Set(routes.map((item) => item.group))], []);
  if (authorized === false) return <main className="admin-platform-denied"><MaterialIcon name="lock"/><h1>Área restrita</h1><p>Esta área está disponível apenas para a equipe administrativa da plataforma VYBE.</p><a href="/universos">Voltar</a></main>;

  return <div className="admin-platform-shell">
    <aside className={`admin-platform-sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <a className="admin-platform-brand" href="/administracao-vybe"><span className="admin-platform-mark">V</span><span><strong>VYBE</strong><small>Administração</small></span></a>
      <nav aria-label="Navegação administrativa">
        {groups.map((group) => <section className="admin-platform-nav-group" key={group}><h2>{group}</h2>{routes.filter((item) => item.group === group).map((item) => <a key={item.id} href={item.path} className={activePage === item.id ? 'is-active' : ''} aria-current={activePage === item.id ? 'page' : undefined}>{item.group === 'VYBE+' ? <AdminRouteIcon id={item.id}/> : <MaterialIcon name={item.icon}/>}<span>{item.title}</span>{item.badge === 'community' && communityPending > 0 && <b>{communityPending}</b>}{item.badge === 'support' && supportCount > 0 && <b>{supportCount}</b>}{item.badge === 'proofs' && proofCount > 0 && <b>{proofCount}</b>}{item.badge === 'tickets' && supportUnread > 0 && <b>{supportUnread}</b>}</a>)}</section>)}
      </nav>
      <div className="admin-platform-sidebar-footer"><span>Plataforma VYBE</span><a href="/universos"><MaterialIcon name="arrow_back"/>Voltar ao VYBE</a></div>
    </aside>
    {mobileOpen && <button className="admin-platform-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}/>}
    <div className="admin-platform-main">
      <header className="admin-platform-header"><button className="admin-platform-menu-toggle" aria-label="Abrir navegação" onClick={() => setMobileOpen(true)}><MaterialIcon name="menu"/></button><div className="admin-platform-breadcrumb"><span>Administração VYBE</span>{activePage !== 'overview' && <><MaterialIcon name="chevron_right"/><strong>{activePage === 'cashflow' ? 'PLATAFORMA' : activePage.startsWith('vybe-') || activePage === 'support' || activePage === 'verified' || activePage === 'pix' ? 'VYBE+' : activePage.startsWith('support-') ? 'CENTRAL DE AJUDA' : 'Comunidades'}</strong><MaterialIcon name="chevron_right"/><strong>{pageTitle}</strong></>}</div><div className="admin-platform-account"><span className="admin-platform-user-avatar">{character.avatarUrl ? <img src={character.avatarUrl} alt=""/> : character.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{character.displayName}</strong><small>PLATFORM ADMIN</small></span><button type="button" onClick={onLogout} title="Sair"><MaterialIcon name="logout"/></button></div></header>
      <main className="admin-platform-content">
        {authorized === null && <div className="admin-platform-loading"><span className="admin-platform-spinner"/>Validando acesso à plataforma…</div>}
        {authorized && <>
          {activePage === 'overview' && <OverviewPage requests={requests} communities={communities} verification={verification} loading={overviewLoading} error={overviewError}/>}
          {activePage === 'requests' && <CommunityRequestsPage initialRequests={requests} onChanged={loadOverview}/>}
          {activePage === 'communities' && <CommunitiesPage initialCommunities={communities} onChanged={loadOverview}/>}
          {activePage === 'community-creations' && <CommunityCreationAdminPage/>}
          {activePage === 'vybe-requests' && <VerificationAdminPage view="requests"/>}
          {activePage === 'support' && <VerificationAdminPage view="inbox"/>}
        {activePage === 'verified' && <VerificationAdminPage view="active"/>}
        {activePage === 'pix' && <VybePlusPixSettings/>}
        {activePage === 'cashflow' && <CashFlowPage/>}
          {activePage === 'support-inbox' && <SupportAdminPage scope="inbox"/>}
          {activePage === 'support-bugs' && <SupportAdminPage scope="bugs"/>}
          {activePage === 'support-suggestions' && <SupportAdminPage scope="suggestions"/>}
          {activePage === 'support-direction' && <SupportAdminPage scope="direction"/>}
          {activePage === 'support-history' && <SupportAdminPage scope="history"/>}
        </>}
      </main>
    </div>
  </div>;
}

type PaidCreation = { id: string; rpgName: string; slug: string; description: string; category: string; status: string; paymentStatus: string; amountCents: number; currency: string; createdAt: string; applicant: { displayName: string; username: string; email: string }; photoUrl: string; logoUrl: string; proofs: Array<{ id: string; mimeType: string; size: number; uploadedAt: string; url: string }>; rejectionReason: string; paymentIssueReason: string; history: Array<{ action: string; createdAt: string; reason?: string; actorGlobalAccountId?: string; actorPlatformAccountId?: string }>; paymentConfirmedAt?: string | null; paymentConfirmedByPlatformId?: string; createdCommunityId: string | null };
type CreationSupportMessage = { id: string; content: string; messageType: 'text' | 'image' | 'file'; attachment?: { url: string; name: string; mimeType: string; size: number }; createdAt: string; isSupport: boolean; sender?: { displayName: string; username: string; avatarUrl?: string } | null };
function CommunityCreationAdminPage() {
  const [items, setItems] = useState<PaidCreation[]>([]); const [allItems, setAllItems] = useState<PaidCreation[]>([]); const [amount, setAmount] = useState(4990); const [filter, setFilter] = useState('all'); const [search, setSearch] = useState(''); const [category, setCategory] = useState(''); const [selected, setSelected] = useState<PaidCreation | null>(null); const [modal, setModal] = useState<'confirm' | 'approve' | 'reject' | 'issue' | 'refund' | null>(null); const [reason, setReason] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(''); const [chatOpen, setChatOpen] = useState(false); const [chatLoading, setChatLoading] = useState(false); const [chatBusy, setChatBusy] = useState(false); const [chatMessages, setChatMessages] = useState<CreationSupportMessage[]>([]); const [chatDraft, setChatDraft] = useState(''); const [chatError, setChatError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { const [data, all, settings] = await Promise.all([api<PaidCreation[]>(`/api/platform/admin/community-creation-requests?filter=${filter}`), api<PaidCreation[]>('/api/platform/admin/community-creation-requests?filter=all'), api<{ amountCents: number }>('/api/platform/admin/community-creation-settings')]); setItems(data); setAllItems(all); setAmount(settings.amountCents); setSelected((current) => current ? data.find((item) => item.id === current.id) ?? data[0] ?? null : data[0] ?? null); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar as solicitações.'); } finally { setLoading(false); } }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setChatOpen(false); setChatMessages([]); setChatDraft(''); setChatError(''); }, [selected?.id]);
  const formatMoney = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  async function savePrice(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); try { await api('/api/platform/admin/community-creation-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents: Math.round(Number(new FormData(event.currentTarget).get('price')) * 100) }) }); setSaved('Preço atualizado. As solicitações existentes mantêm o valor registrado.'); window.setTimeout(() => setSaved(''), 4000); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar o preço.'); } finally { setBusy(false); } }
  async function perform() { if (!selected || !modal) return; setBusy(true); setError(''); try { const base = `/api/platform/admin/community-creation-requests/${selected.id}`; if (modal === 'confirm') await api(`${base}/payment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) }); else if (modal === 'issue') await api(`${base}/payment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'issue', reason }) }); else if (modal === 'approve') await api(`${base}/approve`, { method: 'POST' }); else if (modal === 'reject') await api(`${base}/reject`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); else await api(`${base}/refund`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: reason }) }); setModal(null); setReason(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'A ação não foi concluída.'); } finally { setBusy(false); } }
  async function loadCreationSupport(requestId: string) { setChatLoading(true); setChatError(''); try { const data = await api<{ messages: CreationSupportMessage[] }>(`/api/platform/admin/community-creation-requests/${requestId}/support`); setChatMessages(data.messages); } catch (e) { setChatError(e instanceof Error ? e.message : 'Não foi possível carregar o atendimento.'); } finally { setChatLoading(false); } }
  async function openCreationSupport() { if (!selected) return; setChatOpen(true); await loadCreationSupport(selected.id); }
  async function sendCreationSupportMessage(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selected || !chatDraft.trim()) return; setChatBusy(true); setChatError(''); try { await api(`/api/platform/admin/community-creation-requests/${selected.id}/support/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: chatDraft.trim() }) }); setChatDraft(''); await loadCreationSupport(selected.id); } catch (e) { setChatError(e instanceof Error ? e.message : 'Não foi possível enviar a mensagem.'); } finally { setChatBusy(false); } }
  const labels: Record<string,string> = { all: 'Todas', new: 'Novas', awaiting_payment: 'Aguardando pagamento', confirmed: 'Pagamento confirmado', approved: 'Aprovados', rejected: 'Recusados', cancelled: 'Cancelados' };
  const requestLabel: Record<string,string> = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Recusada', cancelled: 'Cancelada' };
  const paymentLabel: Record<string,string> = { AWAITING_PAYMENT: 'Aguardando pagamento', PROOF_SENT: 'Comprovante enviado', PAYMENT_ISSUE: 'Não identificado', CONFIRMED: 'Confirmado', REFUND_REQUIRED: 'Reembolso pendente', REFUNDED: 'Reembolso registrado' };
  const categories = [...new Set(allItems.map((item) => item.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,'pt-BR'));
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const visibleItems = items.filter((item) => (!category || item.category === category) && (!query || `${item.rpgName} ${item.applicant.displayName} ${item.applicant.username} ${item.applicant.email} ${item.id}`.toLocaleLowerCase('pt-BR').includes(query)));
  const today = new Date().toLocaleDateString('pt-BR');
  const stats = { newToday: allItems.filter((item) => item.status === 'pending' && new Date(item.createdAt).toLocaleDateString('pt-BR') === today).length, newRequests: allItems.filter((item) => item.status === 'pending' && item.paymentStatus === 'AWAITING_PAYMENT').length, proofs: allItems.filter((item) => item.paymentStatus === 'PROOF_SENT').length, awaiting: allItems.filter((item) => item.paymentStatus === 'AWAITING_PAYMENT').length, approved: allItems.filter((item) => item.status === 'approved').length };
  return <section className="admin-creation-page">
    <header className="admin-page-title"><div><span>COMUNIDADES</span><h1>Solicitações de criação de comunidades</h1><p>Gerencie novos universos solicitados pelos usuários do VYBE.</p></div><button type="button" className="admin-creation-header-refresh" onClick={() => void load()}><AdminRefreshIcon/>Atualizar</button></header>
    <form className="admin-creation-price" onSubmit={(e) => void savePrice(e)}><div className="admin-creation-price-copy"><label htmlFor="community-creation-price">Preço de criação de comunidade</label><span>Somente PLATFORM_ADMIN · Pagamento único</span><p>O preço atualizado será aplicado apenas às novas solicitações.</p></div><div className="admin-creation-price-controls"><span>R$</span><input id="community-creation-price" name="price" type="number" min="0.01" step="0.01" key={amount} defaultValue={(amount / 100).toFixed(2)}/><button disabled={busy}>{busy ? 'Salvando…' : 'Salvar preço'}</button></div></form>
    <div className="admin-creation-stats"><article><small>Novas hoje</small><strong>{stats.newToday}</strong></article><article><small>Novas solicitações</small><strong>{stats.newRequests}</strong></article><article><small>Comprovantes para analisar</small><strong>{stats.proofs}</strong></article><article><small>Aguardando pagamento</small><strong>{stats.awaiting}</strong></article><article><small>Aprovadas</small><strong>{stats.approved}</strong></article></div>
    <nav className="admin-creation-filters" aria-label="Filtrar solicitações">{Object.entries(labels).map(([value,label]) => <button type="button" className={filter === value ? 'is-active' : ''} key={value} onClick={() => setFilter(value)}>{label}</button>)}</nav>
    <div className="admin-creation-search"><label><MaterialIcon name="search"/><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Buscar comunidade, solicitante ou ID da solicitação"/></label><select value={category} onChange={(event) => setCategory(event.currentTarget.value)} aria-label="Filtrar por categoria"><option value="">Todas as categorias</option>{categories.map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
    {error && <p className="admin-page-error" role="alert">{error}</p>}{saved && <p className="admin-page-success">{saved}</p>}
    <div className="admin-creation-workspace">
      <aside className="admin-creation-list" aria-label="Solicitações de criação">{loading ? <p className="admin-creation-empty">Carregando solicitações…</p> : visibleItems.length ? visibleItems.map((item) => <button type="button" key={item.id} className={selected?.id === item.id ? 'is-selected' : ''} onClick={() => setSelected(item)}><span className="admin-creation-avatar">{item.logoUrl ? <img src={item.logoUrl} alt=""/> : item.rpgName.slice(0,1).toLocaleUpperCase('pt-BR')}</span><span className="admin-creation-summary-copy"><strong>{item.rpgName}</strong><small>{item.applicant.displayName} · @{item.applicant.username}</small><small>{item.category || 'Comunidade'} · {new Date(item.createdAt).toLocaleString('pt-BR')}</small><span className="admin-creation-tags"><i>{requestLabel[item.status] ?? item.status}</i><i>{paymentLabel[item.paymentStatus] ?? item.paymentStatus}</i></span></span><MaterialIcon name="chevron_right"/></button>) : <p className="admin-creation-empty">Nenhuma solicitação neste filtro.</p>}</aside>
      <section className="admin-creation-preview" aria-label={chatOpen ? 'Conversa de atendimento' : 'Prévia da comunidade solicitada'}>{chatOpen && selected ? <div className="admin-creation-chat"><header className="admin-creation-chat-heading"><span className="admin-creation-chat-avatar">{selected.applicant.displayName.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><div><strong>{selected.applicant.displayName}</strong><small>@{selected.applicant.username} · {selected.rpgName}</small></div><button type="button" onClick={() => void loadCreationSupport(selected.id)} disabled={chatLoading}><AdminRefreshIcon/>Atualizar</button></header><div className="admin-creation-chat-messages">{chatLoading && !chatMessages.length ? <p className="admin-creation-empty">Carregando conversa…</p> : chatMessages.map((message) => <article key={message.id} className={message.isSupport ? 'is-support' : ''}><strong>{message.isSupport ? 'VYBE Suporte' : message.sender?.displayName ?? selected.applicant.displayName}</strong>{message.content && <p>{message.content}</p>}{message.attachment && <a href={message.attachment.url} target="_blank" rel="noreferrer">{message.attachment.name || 'Ver anexo'}</a>}<small>{new Date(message.createdAt).toLocaleString('pt-BR')}</small></article>)}{!chatLoading && !chatMessages.length && <p className="admin-creation-chat-empty">Esta conversa começa com você. Envie uma mensagem ao comprador como VYBE Suporte.</p>}</div>{chatError && <p className="admin-page-error" role="alert">{chatError}</p>}<form className="admin-creation-chat-compose" onSubmit={(event) => void sendCreationSupportMessage(event)}><textarea value={chatDraft} onChange={(event) => setChatDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Responder como VYBE Suporte…" maxLength={4000} required/><button type="submit" disabled={chatBusy || !chatDraft.trim()}><MaterialIcon name="send"/>{chatBusy ? 'Enviando…' : 'Enviar'}</button></form></div> : selected ? <><div className="admin-creation-cover" style={{ backgroundImage: `url("${selected.photoUrl}")` }}>{selected.logoUrl && <img src={selected.logoUrl} alt={`Logo de ${selected.rpgName}`}/>}</div><div className="admin-creation-preview-copy"><span>{selected.category || 'COMUNIDADE'}</span><h2>{selected.rpgName}</h2><p>{selected.description}</p><div><small>Solicitada por</small><strong>{selected.applicant.displayName}</strong><small>@{selected.applicant.username}</small></div></div></> : <div className="admin-creation-empty-state"><MaterialIcon name="groups"/><strong>Selecione uma solicitação</strong><span>Os dados do novo universo aparecerão aqui.</span></div>}</section>
      <aside className="admin-creation-detail-panel">{selected ? <><section><h3>Solicitação de criação</h3><span className={`admin-creation-status is-${selected.status}`}>{requestLabel[selected.status] ?? selected.status}</span><dl><dt>Pagamento</dt><dd>{paymentLabel[selected.paymentStatus] ?? selected.paymentStatus}</dd><dt>Solicitante</dt><dd>{selected.applicant.displayName} · @{selected.applicant.username}</dd><dt>E-mail</dt><dd>{selected.applicant.email}</dd><dt>Categoria</dt><dd>{selected.category || 'Comunidade'}</dd><dt>Valor</dt><dd>{formatMoney(selected.amountCents)} · pagamento único</dd><dt>Solicitação</dt><dd>{selected.id}</dd><dt>Enviada em</dt><dd>{new Date(selected.createdAt).toLocaleString('pt-BR')}</dd>{selected.paymentConfirmedAt && <><dt>Pagamento confirmado</dt><dd>{new Date(selected.paymentConfirmedAt).toLocaleString('pt-BR')}</dd><dt>Admin responsável</dt><dd>{selected.paymentConfirmedByPlatformId}</dd></>}{selected.paymentIssueReason && <><dt>Observação</dt><dd>{selected.paymentIssueReason}</dd></>}{selected.rejectionReason && <><dt>Motivo da recusa</dt><dd>{selected.rejectionReason}</dd></>}{selected.paymentStatus === 'REFUND_REQUIRED' && <><dt>Reembolso</dt><dd>Pendente de resolução administrativa</dd></>}</dl></section>
        <section><h3>Pagamento e comprovantes</h3>{selected.proofs.length ? selected.proofs.map((proof,index) => <a className="admin-creation-proof-link" key={proof.id} href={proof.url} target="_blank" rel="noreferrer"><MaterialIcon name={proof.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'image'}/>Comprovante {index + 1}<small>{new Date(proof.uploadedAt).toLocaleString('pt-BR')}</small></a>) : <p className="admin-creation-no-proof">Nenhum comprovante enviado.</p>}</section>
        <section><h3>Ações administrativas</h3><div className="admin-creation-actions"><button type="button" onClick={() => void openCreationSupport()}>Abrir atendimento</button>{selected.status === 'pending' && selected.paymentStatus !== 'CONFIRMED' && <><button type="button" onClick={() => setModal('confirm')} disabled={!selected.proofs.length}>Confirmar pagamento</button><button type="button" onClick={() => { setReason(''); setModal('issue'); }} disabled={!selected.proofs.length}>Pagamento não identificado</button></>}{selected.status === 'pending' && selected.paymentStatus === 'CONFIRMED' && <button type="button" onClick={() => setModal('approve')}>Aprovar criação</button>}{selected.status === 'pending' && <button type="button" className="is-danger" onClick={() => { setReason(''); setModal('reject'); }}>Recusar solicitação</button>}{selected.paymentStatus === 'REFUND_REQUIRED' && <button type="button" onClick={() => { setReason(''); setModal('refund'); }}>Registrar reembolso</button>}</div></section>
        <section><details><summary>Histórico</summary>{selected.history.slice().reverse().map((entry,index) => <p key={`${entry.action}-${index}`}>{new Date(entry.createdAt).toLocaleString('pt-BR')} · {entry.action.replaceAll('_',' ')}{entry.actorPlatformAccountId ? ` · admin ${entry.actorPlatformAccountId}` : ''}{entry.actorGlobalAccountId ? ` · usuário ${entry.actorGlobalAccountId}` : ''}{entry.reason ? ` · ${entry.reason}` : ''}</p>)}</details></section></> : <p className="admin-creation-empty">Selecione uma solicitação para ver detalhes e ações.</p>}</aside>
    </div>
    {modal && selected && <div className="admin-creation-modal-backdrop"><section className="admin-creation-modal" role="dialog" aria-modal="true"><button className="admin-creation-modal-x" onClick={() => setModal(null)} aria-label="Fechar">×</button><h2>{modal === 'confirm' ? 'Confirmar pagamento?' : modal === 'approve' ? 'Aprovar criação?' : modal === 'reject' ? 'Recusar solicitação?' : modal === 'issue' ? 'Pagamento não identificado' : 'Registrar reembolso'}</h2><p>{modal === 'confirm' ? <>Você está confirmando o pagamento de <strong>{formatMoney(selected.amountCents)}</strong> referente à criação de <strong>{selected.rpgName}</strong>, solicitada por {selected.applicant.displayName}.</> : modal === 'approve' ? `Você está autorizando a criação da comunidade ${selected.rpgName} para ${selected.applicant.displayName}.` : modal === 'reject' ? 'Informe o motivo da recusa. Pagamentos já confirmados ficam pendentes de tratamento de reembolso.' : modal === 'issue' ? 'Informe o motivo para notificar o solicitante e permitir um novo comprovante.' : 'Registre a referência ou observação do reembolso realizado.'}</p>{['reject','issue','refund'].includes(modal) && <textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={1000} placeholder="Motivo ou observação"/>}<footer><button onClick={() => setModal(null)}>Cancelar</button><button className="is-primary" disabled={busy || (['reject','issue','refund'].includes(modal) && reason.trim().length < 3)} onClick={() => void perform()}>{busy ? 'Processando…' : modal === 'confirm' ? 'Confirmar pagamento' : modal === 'approve' ? 'Aprovar criação' : modal === 'reject' ? 'Confirmar recusa' : modal === 'issue' ? 'Notificar solicitante' : 'Registrar reembolso'}</button></footer></section></div>}
  </section>;
}

type CashFlowPayment = { id: string; kind: 'VYBE_PLUS' | 'COMMUNITY_CREATION'; product: string; community: string; buyer: { displayName: string; username: string } | null; beneficiary: { displayName: string; username: string } | null; isGift: boolean; amount: number; currency: string; paymentConfirmedAt: string };
type CashFlowData = { month: string; count: number; totalAmount: number; currency: string; payments: CashFlowPayment[] };
function CashFlowPage() {
  const currentDate = new Date();
  const [month, setMonth] = useState(`${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`);
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError('');
    void api<CashFlowData>(`/api/platform/vybe-plus/cash-flow?month=${encodeURIComponent(month)}`)
      .then((result) => { if (current) setData(result); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o fluxo de caixa.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [month, refresh]);
  const formatMoney = (amount: number, currency: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  const average = data?.count ? data.totalAmount / data.count : 0;
  return <section className="admin-cashflow">
    <div className="admin-page-title"><span>PLATAFORMA</span><h1>Fluxo de caixa</h1><p>Compras de criação de comunidades e VYBE+ confirmadas por mês de recebimento.</p></div>
    <div className="admin-cashflow-toolbar"><CashFlowMonthPicker value={month} onChange={setMonth}/><button type="button" onClick={() => setRefresh((value) => value + 1)}><AdminRefreshIcon/>Atualizar</button></div>
    {error && <p className="admin-page-error" role="alert">{error}</p>}
    <div className="admin-cashflow-summary"><article><small>Total recebido no mês</small><strong>{loading ? '—' : formatMoney(data?.totalAmount ?? 0, data?.currency ?? 'BRL')}</strong><span>Somente pagamentos confirmados pela equipe VYBE</span></article><article><small>Pagamentos confirmados</small><strong>{loading ? '—' : (data?.count ?? 0).toLocaleString('pt-BR')}</strong><span>Compras de comunidades e VYBE+ no mês selecionado</span></article><article><small>Valor médio</small><strong>{loading ? '—' : formatMoney(average, data?.currency ?? 'BRL')}</strong><span>Média por pagamento confirmado</span></article></div>
    <section className="admin-cashflow-table-wrap"><header><div><h2>Recebimentos</h2><p>{data?.count ?? 0} pagamentos confirmados</p></div></header>{loading ? <div className="admin-empty"><span className="admin-platform-spinner"/><strong>Carregando recebimentos…</strong></div> : data?.payments.length ? <div className="admin-cashflow-table-scroll"><table><thead><tr><th>Confirmado em</th><th>Comprador</th><th>Produto</th><th>Comunidade / beneficiário</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td>{new Date(payment.paymentConfirmedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</td><td>{payment.buyer ? <>{payment.buyer.displayName}<small>@{payment.buyer.username}</small></> : '—'}</td><td>{payment.product}</td><td>{payment.kind === 'COMMUNITY_CREATION' ? payment.community : payment.beneficiary ? <>{payment.beneficiary.displayName}<small>@{payment.beneficiary.username} · {payment.community}</small></> : payment.community}</td><td><span className={`admin-cashflow-type ${payment.isGift ? 'is-gift' : ''}`}>{payment.kind === 'COMMUNITY_CREATION' ? 'Pagamento único' : payment.isGift ? 'Presente' : 'Para mim'}</span></td><td className="admin-cashflow-amount">{formatMoney(payment.amount, payment.currency)}</td></tr>)}</tbody></table></div> : <div className="admin-empty"><MaterialIcon name="receipt_long"/><strong>Nenhum pagamento confirmado neste mês.</strong><span>Compras de comunidades e VYBE+ aparecerão aqui.</span></div>}</section>
    <p className="admin-cashflow-note"><MaterialIcon name="info"/>Este resumo considera pagamentos reais confirmados de criação de comunidades e VYBE+. Não inclui saldo ou movimentações do VYBE Banco.</p>
  </section>;
}

function CashFlowMonthPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selectedDate = new Date(`${value}-01T12:00:00`);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(selectedDate.getFullYear());
  useEffect(() => { if (!open) setYear(selectedDate.getFullYear()); }, [value, open]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOnOutsideClick); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);
  const monthName = (index: number, style: 'short' | 'long' = 'short') => new Intl.DateTimeFormat('pt-BR', { month: style }).format(new Date(2020, index, 1)).replace('.', '');
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(selectedDate);
  return <div className="admin-cashflow-month-picker" ref={pickerRef}>
    <button className="admin-cashflow-month-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="admin-cashflow-month-icon"><MaterialIcon name="calendar_month"/></span>
      <span className="admin-cashflow-month-copy"><small>Mês de recebimento</small><strong>{label.charAt(0).toUpperCase() + label.slice(1)}</strong></span>
      <svg className={`admin-cashflow-month-chevron ${open ? 'is-open' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {open && <div className="admin-cashflow-month-popover" role="dialog" aria-label="Selecionar mês de recebimento">
      <header><div><small>SELECIONE O PERÍODO</small><strong>{year}</strong></div><span><button type="button" aria-label="Ano anterior" onClick={() => setYear((current) => current - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><button type="button" aria-label="Próximo ano" onClick={() => setYear((current) => current + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button><button className="admin-cashflow-month-close" type="button" aria-label="Fechar calendário" onClick={() => setOpen(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></span></header>
      <div className="admin-cashflow-month-grid">{Array.from({ length: 12 }, (_, index) => {
        const selected = selectedDate.getFullYear() === year && selectedDate.getMonth() === index;
        return <button className={selected ? 'is-selected' : ''} key={index} type="button" aria-pressed={selected} onClick={() => { onChange(`${year}-${String(index + 1).padStart(2, '0')}`); setOpen(false); }}><span>{monthName(index)}</span><small>{monthName(index, 'long')}</small></button>;
      })}</div>
      <footer><MaterialIcon name="info"/>Os dados serão filtrados pelo mês escolhido.</footer>
    </div>}
  </div>;
}

function OverviewPage({ requests, communities, verification, loading, error }: { requests: CommunityRequest[]; communities: ManagedCommunity[]; verification: VerificationOverview | null; loading: boolean; error: string }) {
  const cards = [
    { title: 'Solicitações de comunidades', value: requests.filter((item) => item.status === 'pending').length, description: 'Aguardando análise', href: '/administracao-vybe/solicitacoes', icon: 'assignment', tone: 'teal' },
    { title: 'Solicitações VYBE+', value: verification?.stats.newRequests ?? 0, description: 'Novos pedidos de verificação', href: '/administracao-vybe/vybe-plus/solicitacoes', icon: 'auto_awesome', tone: 'gold' },
    { title: 'Atendimentos', value: verification?.stats.awaitingSupport ?? 0, description: 'Aguardando atendimento', href: '/administracao-vybe/vybe-plus/atendimentos', icon: 'forum', tone: 'lilac' },
    { title: 'Comunidades ativas', value: communities.filter((item) => item.status === 'active').length, description: 'No diretório VYBE', href: '/administracao-vybe/comunidades', icon: 'groups', tone: 'coral' },
  ];
  return <section className="admin-overview"><div className="admin-page-title"><span>PAINEL DA PLATAFORMA</span><h1>Visão geral</h1><p>Um resumo do que precisa da atenção da equipe VYBE.</p></div>{error && <p className="admin-page-error" role="alert">{error}</p>}<div className="admin-overview-cards">{cards.map((card) => <a className={`admin-overview-card tone-${card.tone}`} href={card.href} key={card.title}><span className="admin-overview-icon"><MaterialIcon name={card.icon}/></span><span className="admin-overview-copy"><small>{card.title}</small><strong>{loading ? '—' : card.value.toLocaleString('pt-BR')}</strong><em>{card.description}</em></span><MaterialIcon className="admin-overview-arrow" name="arrow_forward"/></a>)}</div><article className="admin-overview-welcome"><span><MaterialIcon name="auto_awesome"/></span><div><h2>Administração da plataforma</h2><p>Use o menu lateral para acessar cada área. Solicitações de comunidades, VYBE+ e atendimentos ficam separados para facilitar o trabalho da equipe.</p></div></article></section>;
}

function CommunityRequestsPage({ initialRequests, onChanged }: { initialRequests: CommunityRequest[]; onChanged: () => void }) {
  const [items, setItems] = useState(initialRequests); const [selected, setSelected] = useState<CommunityRequest | null>(null); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const load = useCallback(async () => { try { const data = await api<CommunityRequest[]>('/api/platform/admin/community-requests'); setItems(data); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as solicitações.'); } }, []);
  useEffect(() => { setItems(initialRequests); void load(); }, [initialRequests, load]);
  async function decide(id: string, decision: 'approve' | 'reject') { setBusy(id); setError(''); try { await api(`/api/platform/admin/community-requests/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }); setSelected(null); await load(); onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível revisar a solicitação.'); } finally { setBusy(''); } }
  return <section className="admin-subpage"><div className="admin-page-title"><span>COMUNIDADES</span><h1>Solicitações de comunidades</h1><p>Revise pedidos para criar novos espaços na plataforma.</p></div>{error && <p className="admin-page-error" role="alert">{error}</p>}<div className="admin-list-heading"><strong>{items.length} solicitações pendentes</strong><button onClick={() => void load()}><AdminRefreshIcon/>Atualizar</button></div>{items.length ? <div className="admin-community-request-list">{items.map((item) => <article key={item.id} className={selected?.id === item.id ? 'is-selected' : ''}><button className="admin-community-request-select" onClick={() => setSelected(selected?.id === item.id ? null : item)}><span className="admin-community-request-photo">{item.photoUrl && <img src={item.photoUrl} alt=""/>}</span><span className="admin-community-request-summary"><strong>{item.rpgName}</strong><small>{item.slug}.vybe.com.br · por @{item.applicant?.username ?? 'usuário'}</small><small>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</small></span><span className="admin-pill is-pending">Aguardando análise</span><MaterialIcon name="chevron_right"/></button>{selected?.id === item.id && <div className="admin-community-request-details"><p>{item.description}</p><div><button className="is-danger" disabled={Boolean(busy)} onClick={() => void decide(item.id, 'reject')}>{busy === item.id ? 'Salvando…' : 'Recusar'}</button><button className="is-primary" disabled={Boolean(busy)} onClick={() => void decide(item.id, 'approve')}>{busy === item.id ? 'Salvando…' : 'Aprovar comunidade'}</button></div></div>}</article>)}</div> : <div className="admin-empty"><MaterialIcon name="assignment"/><strong>Nenhuma solicitação pendente.</strong><span>Novos pedidos de comunidades aparecerão aqui.</span></div>}</section>;
}

function CommunitiesPage({ initialCommunities, onChanged }: { initialCommunities: ManagedCommunity[]; onChanged: () => void }) {
  const [items, setItems] = useState(initialCommunities); const [query, setQuery] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setItems(await api<ManagedCommunity[]>('/api/platform/admin/communities')); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as comunidades.'); } }, []);
  useEffect(() => { setItems(initialCommunities); void load(); }, [initialCommunities, load]);
  const filtered = items.filter((item) => `${item.name} ${item.slug} ${item.subdomain} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  async function update(item: ManagedCommunity, status: 'active' | 'archived' | 'suspended' | 'deleted') { if (status === 'deleted' && !window.confirm(`Excluir ${item.name}? Ela deixará de aparecer no diretório e não poderá ser reativada por esta tela.`)) return; setBusy(item.id); try { await api(`/api/platform/admin/communities/${item.id}`, status === 'deleted' ? { method: 'DELETE' } : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); await load(); onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a comunidade.'); } finally { setBusy(''); } }
  return <section className="admin-subpage"><div className="admin-page-title"><span>COMUNIDADES</span><h1>Gerenciar comunidades</h1><p>Consulte e administre o estado das comunidades da plataforma.</p></div>{error && <p className="admin-page-error" role="alert">{error}</p>}<div className="admin-community-tools"><label><MaterialIcon name="search"/><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Buscar comunidade, endereço ou descrição"/></label><button onClick={() => void load()}><AdminRefreshIcon/>Atualizar</button></div>{filtered.length ? <div className="admin-communities-list">{filtered.map((item) => <article key={item.id}><span className="admin-community-emblem">{item.name.slice(0, 1).toUpperCase()}</span><div className="admin-community-info"><strong>{item.name}</strong><small>{item.subdomain}.vybe.com.br · {item.memberCount.toLocaleString('pt-BR')} membros</small><small>{item.ownerEmail ? `Owner · ${item.ownerEmail}` : 'Owner não identificado'}</small><p>{item.description}</p></div><span className={`admin-pill is-${item.status}`}>{item.status === 'active' ? 'Ativa' : item.status === 'suspended' ? 'Suspensa' : 'Arquivada'}</span><div className="admin-community-actions">{item.status === 'active' ? <><button onClick={() => void update(item, 'archived')} disabled={Boolean(busy)}>Arquivar</button><button className="is-danger" onClick={() => void update(item, 'suspended')} disabled={Boolean(busy)}>Suspender</button></> : <button onClick={() => void update(item, 'active')} disabled={Boolean(busy)}>Reativar</button>}<button className="is-danger" onClick={() => void update(item, 'deleted')} disabled={Boolean(busy)}>Excluir</button></div></article>)}</div> : <div className="admin-empty"><MaterialIcon name="groups"/><strong>{query ? 'Nenhuma comunidade encontrada.' : 'Nenhuma comunidade para gerenciar.'}</strong><span>As comunidades aparecerão aqui conforme forem criadas.</span></div>}</section>;
}

function AdminRefreshIcon() {
  return <svg className="admin-refresh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3M20 4v7h-7M4 20v-7h7"/></svg>;
}

function AdminRouteIcon({ id }: { id: Route }) {
  const paths: Partial<Record<Route, React.ReactNode>> = {
    'vybe-requests': <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/><path d="m5 15 .6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6L5 15Z"/></>,
    support: <><path d="M20 11.5a6.5 6.5 0 0 1-6.5 6.5H7l-4 3v-9.5A6.5 6.5 0 0 1 9.5 5H13"/><path d="M17 3v8M13 7h8"/></>,
    verified: <><path d="m12 3 2.2 1.5 2.7-.1.9 2.5 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.9 2.5-2.7-.1L12 20l-2.2-1.5-2.7.1-.9-2.5L4 14.5l.8-2.6L4 9.3l2.2-1.6.9-2.5 2.7.1L12 3Z"/><path d="m9 12 2 2 4-4"/></>,
    pix: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/></>,
    cashflow: <><path d="M3 10h18M5 10v9M9 10v9M15 10v9M19 10v9M2 20h20M12 3 2 8h20L12 3Z"/></>,
  };
  if (!paths[id]) return null;
  return <svg className="admin-route-icon" viewBox="0 0 24 24" width="19" height="19" style={{ flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }} aria-hidden="true" focusable="false">{paths[id]}</svg>;
}
