import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SocialCharacter } from './SocialApp';
import { MaterialIcon } from './MaterialIcon';
import { VerificationAdminPage } from './VerificationAdminPage';
import { VybePlusPixSettings } from './VybePlusPixSettings';
import './AdminPlatformPage.css';

type Route = 'overview' | 'requests' | 'communities' | 'vybe-requests' | 'support' | 'verified' | 'pix' | 'cashflow';
type CommunityRequest = { id: string; rpgName: string; slug: string; description: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; photoUrl: string; applicant?: { displayName: string; username: string } | null };
type ManagedCommunity = { id: string; name: string; slug: string; subdomain: string; description: string; coverUrl: string; memberCount: number; status: 'active' | 'archived' | 'suspended'; ownerEmail?: string };
type VerificationOverview = { requests: Array<{ status: string }>; stats: { newToday: number; awaitingSupport: number; awaitingPayment: number; proofsToReview: number; active: number; newRequests: number } };

const routes: Array<{ id: Route; title: string; path: string; icon: string; group: string; badge?: 'community' | 'support' | 'proofs' }> = [
  { id: 'overview', title: 'Visão geral', path: '/administracao-vybe', icon: 'home', group: 'ADMINISTRAÇÃO VYBE' },
  { id: 'requests', title: 'Solicitações', path: '/administracao-vybe/solicitacoes', icon: 'assignment', group: 'COMUNIDADES', badge: 'community' },
  { id: 'communities', title: 'Gerenciar comunidades', path: '/administracao-vybe/comunidades', icon: 'groups', group: 'COMUNIDADES' },
  { id: 'vybe-requests', title: 'Solicitações VYBE+', path: '/administracao-vybe/vybe-plus/solicitacoes', icon: 'auto_awesome', group: 'VYBE+', badge: 'proofs' },
  { id: 'support', title: 'Atendimentos', path: '/administracao-vybe/vybe-plus/atendimentos', icon: 'forum', group: 'VYBE+', badge: 'support' },
  { id: 'verified', title: 'Verificados ativos', path: '/administracao-vybe/vybe-plus/verificados', icon: 'verified', group: 'VYBE+' },
  { id: 'pix', title: 'Configurar PIX', path: '/administracao-vybe/vybe-plus/pix', icon: 'payments', group: 'VYBE+' },
  { id: 'cashflow', title: 'Fluxo de caixa', path: '/administracao-vybe/vybe-plus/fluxo-de-caixa', icon: 'account_balance', group: 'PLATAFORMA' },
];

const pageForPath = (path: string): Route => path.endsWith('/solicitacoes') && path.includes('/vybe-plus/') ? 'vybe-requests'
  : path.endsWith('/atendimentos') ? 'support'
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
      const [communityRequests, managed, verified] = await Promise.all([
        api<CommunityRequest[]>('/api/platform/admin/community-requests'),
        api<ManagedCommunity[]>('/api/platform/admin/communities'),
        api<VerificationOverview>('/api/platform/vybe-plus/requests'),
      ]);
      setRequests(communityRequests); setCommunities(managed); setVerification(verified); setOverviewError('');
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
        {groups.map((group) => <section className="admin-platform-nav-group" key={group}><h2>{group}</h2>{routes.filter((item) => item.group === group).map((item) => <a key={item.id} href={item.path} className={activePage === item.id ? 'is-active' : ''} aria-current={activePage === item.id ? 'page' : undefined}>{item.group === 'VYBE+' ? <AdminRouteIcon id={item.id}/> : <MaterialIcon name={item.icon}/>}<span>{item.title}</span>{item.badge === 'community' && communityPending > 0 && <b>{communityPending}</b>}{item.badge === 'support' && supportCount > 0 && <b>{supportCount}</b>}{item.badge === 'proofs' && proofCount > 0 && <b>{proofCount}</b>}</a>)}</section>)}
      </nav>
      <div className="admin-platform-sidebar-footer"><span>Plataforma VYBE</span><a href="/universos"><MaterialIcon name="arrow_back"/>Voltar ao VYBE</a></div>
    </aside>
    {mobileOpen && <button className="admin-platform-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}/>}
    <div className="admin-platform-main">
      <header className="admin-platform-header"><button className="admin-platform-menu-toggle" aria-label="Abrir navegação" onClick={() => setMobileOpen(true)}><MaterialIcon name="menu"/></button><div className="admin-platform-breadcrumb"><span>Administração VYBE</span>{activePage !== 'overview' && <><MaterialIcon name="chevron_right"/><strong>{activePage === 'cashflow' ? 'PLATAFORMA' : activePage.startsWith('vybe-') || activePage === 'support' || activePage === 'verified' || activePage === 'pix' ? 'VYBE+' : 'Comunidades'}</strong><MaterialIcon name="chevron_right"/><strong>{pageTitle}</strong></>}</div><div className="admin-platform-account"><span className="admin-platform-user-avatar">{character.avatarUrl ? <img src={character.avatarUrl} alt=""/> : character.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{character.displayName}</strong><small>PLATFORM ADMIN</small></span><button type="button" onClick={onLogout} title="Sair"><MaterialIcon name="logout"/></button></div></header>
      <main className="admin-platform-content">
        {authorized === null && <div className="admin-platform-loading"><span className="admin-platform-spinner"/>Validando acesso à plataforma…</div>}
        {authorized && <>
          {activePage === 'overview' && <OverviewPage requests={requests} communities={communities} verification={verification} loading={overviewLoading} error={overviewError}/>}
          {activePage === 'requests' && <CommunityRequestsPage initialRequests={requests} onChanged={loadOverview}/>}
          {activePage === 'communities' && <CommunitiesPage initialCommunities={communities} onChanged={loadOverview}/>}
          {activePage === 'vybe-requests' && <VerificationAdminPage view="requests"/>}
          {activePage === 'support' && <VerificationAdminPage view="inbox"/>}
        {activePage === 'verified' && <VerificationAdminPage view="active"/>}
        {activePage === 'pix' && <VybePlusPixSettings/>}
        {activePage === 'cashflow' && <CashFlowPage/>}
        </>}
      </main>
    </div>
  </div>;
}

type CashFlowData = { month: string; count: number; totalAmount: number; currency: string; payments: Array<{ id: string; community: string; buyer: { displayName: string; username: string } | null; beneficiary: { displayName: string; username: string } | null; isGift: boolean; amount: number; currency: string; paymentConfirmedAt: string }> };
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
    <div className="admin-page-title"><span>VYBE+</span><h1>Fluxo de caixa</h1><p>Pagamentos reais de VYBE+ confirmados manualmente por mês de recebimento.</p></div>
    <div className="admin-cashflow-toolbar"><CashFlowMonthPicker value={month} onChange={setMonth}/><button type="button" onClick={() => setRefresh((value) => value + 1)}><AdminRefreshIcon/>Atualizar</button></div>
    {error && <p className="admin-page-error" role="alert">{error}</p>}
    <div className="admin-cashflow-summary"><article><small>Total recebido no mês</small><strong>{loading ? '—' : formatMoney(data?.totalAmount ?? 0, data?.currency ?? 'BRL')}</strong><span>Somente pagamentos confirmados pela equipe VYBE</span></article><article><small>Pagamentos confirmados</small><strong>{loading ? '—' : (data?.count ?? 0).toLocaleString('pt-BR')}</strong><span>Transações VYBE+ no mês selecionado</span></article><article><small>Valor médio</small><strong>{loading ? '—' : formatMoney(average, data?.currency ?? 'BRL')}</strong><span>Média por pagamento confirmado</span></article></div>
    <section className="admin-cashflow-table-wrap"><header><div><h2>Recebimentos</h2><p>{data?.count ?? 0} pagamentos confirmados</p></div></header>{loading ? <div className="admin-empty"><span className="admin-platform-spinner"/><strong>Carregando recebimentos…</strong></div> : data?.payments.length ? <div className="admin-cashflow-table-scroll"><table><thead><tr><th>Confirmado em</th><th>Comprador</th><th>Beneficiário</th><th>Comunidade</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td>{new Date(payment.paymentConfirmedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</td><td>{payment.buyer ? <>{payment.buyer.displayName}<small>@{payment.buyer.username}</small></> : '—'}</td><td>{payment.beneficiary ? <>{payment.beneficiary.displayName}<small>@{payment.beneficiary.username}</small></> : '—'}</td><td>{payment.community}</td><td><span className={`admin-cashflow-type ${payment.isGift ? 'is-gift' : ''}`}>{payment.isGift ? 'Presente' : 'Para mim'}</span></td><td className="admin-cashflow-amount">{formatMoney(payment.amount, payment.currency)}</td></tr>)}</tbody></table></div> : <div className="admin-empty"><MaterialIcon name="receipt_long"/><strong>Nenhum pagamento confirmado neste mês.</strong><span>Pagamentos VYBE+ confirmados aparecerão aqui.</span></div>}</section>
    <p className="admin-cashflow-note"><MaterialIcon name="info"/>Este resumo considera somente pagamentos VYBE+ reais com confirmação administrativa. Não inclui saldo ou movimentações do VYBE Banco.</p>
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
