import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { SocialApp, type SocialCharacter } from './SocialApp';
import './CommunityPickerPage.css';
import { notifySnack } from './SnackMessage';
import { MaterialIcon } from './MaterialIcon';
import { CommunityCreationWizard } from './CommunityCreationWizard';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '@vybe/shared';
import { PrivacyPolicyPage, TermsOfUsePage } from './LegalPages';
import { VybeLogo } from './VybeLogo';
import { CommunityJoinPage } from './CommunityJoinPage';
import { AdminPlatformPage } from './AdminPlatformPage';
import { activateLocalCommunity, communityHomeHref } from './communityNavigation';
import { SupportUnreadIndicator } from './SupportUnreadIndicator';

type AuthPayload = { account: { id: string; email: string }; character: SocialCharacter; globalAccount?: boolean };

function Logo({ href = '/', selector = false }: { href?: string; selector?: boolean }) {
  return <a className={`brand ${selector ? 'brand-selector' : ''}`} href={href} aria-label="VYBE">{selector ? <><img className="brand-selector-symbol" src="/vybe-symbol-transparent.png" alt=""/><span>VYBE</span></> : <VybeLogo className="brand-reference-image"/>}</a>;
}

function LoginLogo() {
  return <a className="auth-new-logo" href="/" aria-label="VYBE"><img src="/vybe-entry-logo.png" alt="VYBE"/></a>;
}

function AppLoading() {
  const section = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
  const appNames: Record<string, string> = { eventos: 'Eventos', banco: 'Banco', match: 'Match', mensagens: 'Mensagens', academico: 'Acadêmico', noticias: 'Notícias', empresas: 'Empresas', echo: 'Echo', pulso: 'Echo' };
  const appName = appNames[section];
  return <main className="vybe-loading-screen" role="status" aria-live="polite"><div className="vybe-loading-card"><span className="vybe-loading-mark"><VybeLogo variant="symbol" label="VYBE"/></span><span className="vybe-loading-spinner" aria-hidden="true"/><span className="vybe-loading-copy"><strong>{appName ? `Abrindo ${appName}` : 'Preparando seu universo'}</strong><small>Estamos preparando seu espaço no VYBE.</small></span></div></main>;
}

function CommunityHomeRedirect() {
  useEffect(() => { window.location.replace('/'); }, []);
  return <AppLoading/>;
}

function PlatformHome() {
  return <main className="platform-home"><header><Logo/><span>A plataforma para comunidades de RPG</span><nav><a href="/?auth=login">Entrar</a><a href="/?auth=register">Criar conta</a></nav></header><section><p>UM UNIVERSO, MUITAS HISTÓRIAS</p><h1>Comunidades de RPG<br/>com vida própria.</h1><span>Crie sua conta VYBE e escolha em quais comunidades deseja participar.</span><a href="/?auth=register">Criar minha conta VYBE <b><MaterialIcon name="arrow_forward"/></b></a></section><footer>VYBE · Plataforma principal</footer></main>;
}

type CommunitySummary = { id: string; name: string; slug: string; subdomain: string; description: string; category?: string; coverUrl: string; logoUrl: string; memberCount: number; requiresApproval?: boolean; joinStatus?: 'MEMBER' | 'NONE' | 'PENDING' | 'NEEDS_INFORMATION' | 'REJECTED' };
type CommunityRequestSummary = { id: string; rpgName: string; slug: string; description: string; category?: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; createdAt: string; updatedAt?: string; photoUrl?: string; paymentRequired?: boolean; amountCents?: number; currency?: string; paymentStatus?: string; rejectionReason?: string; paymentIssueReason?: string; createdCommunityId?: string };
type MyJoinRequest = { id: string; communityId: string; communitySlug: string; characterName: string; requestedUsername: string; status: 'PENDING' | 'NEEDS_INFORMATION' | 'APPROVED' | 'REJECTED'; adminMessage: string; rejectionReason: string; createdAt: string; updatedAt: string };

const communityCardPalette = ['#246B6E', '#C96861', '#716BA9', '#927849', '#4A8C80', '#A85F5B'];

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? body?.message ?? 'Não foi possível concluir a solicitação.');
  return body as T;
}

function CommunityPickerPage({ character, onLogout }: { character: SocialCharacter; onLogout: () => void }) {
  const [communities, setCommunities] = useState<CommunitySummary[]>([]);
  const [currentTenantSlug, setCurrentTenantSlug] = useState('community');
  const [requests, setRequests] = useState<CommunityRequestSummary[]>([]);
  const [joinRequests, setJoinRequests] = useState<MyJoinRequest[]>([]);
  const [canReview, setCanReview] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [paymentRequestId, setPaymentRequestId] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const isRequestsPage = window.location.pathname === '/minhas-solicitacoes';
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname.toLowerCase());

  async function loadPage() {
    setLoading(true);
    try {
      const [directory, ownRequests, ownJoinRequests] = await Promise.all([
        fetchJson<{ currentTenantSlug: string; communities: CommunitySummary[] }>('/api/communities'),
        fetchJson<CommunityRequestSummary[]>('/api/community-requests'),
        fetchJson<MyJoinRequest[]>('/api/my/community-join-requests'),
      ]);
      setCommunities(directory.communities);
      setCurrentTenantSlug(directory.currentTenantSlug);
      setRequests(ownRequests);
      setJoinRequests(ownJoinRequests);
      setError('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível carregar as comunidades.';
      setError(message);
      notifySnack(message);
    } finally { setLoading(false); }
    try {
      await fetchJson<{ isPlatformAdmin: true }>('/api/platform/admin/me');
      setCanReview(true);
    } catch {
      setCanReview(false);
    }
  }

  useEffect(() => {
    void loadPage();
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCommunities = communities.filter((item) => `${item.name} ${item.description} ${item.category ?? ''}`.toLowerCase().includes(normalizedQuery));
  const helpCommunity = communities.find((item) => item.joinStatus === 'MEMBER');
  const helpHref = helpCommunity ? `${communityHomeHref(helpCommunity.subdomain)}${communityHomeHref(helpCommunity.subdomain) === '/' ? 'ajuda' : '/ajuda'}` : '/ajuda';
  const requestStatus: Record<CommunityRequestSummary['status'], string> = { pending: 'Em análise', approved: 'Aprovada', rejected: 'Recusada', cancelled: 'Cancelada' };
  const isUniversePicker = !isRequestsPage;
  return <main className="community-picker is-universe-picker">
    <header className="picker-header"><Logo href="/universos" selector/><div className="picker-account"><span className="picker-avatar"><span>{character.displayName.slice(0, 1).toUpperCase()}</span>{character.avatarUrl && <img src={character.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }}/>}</span><span className="picker-account-copy"><strong>{character.displayName}</strong><small>@{character.username}</small></span><a className="picker-help-link support-unread-anchor" href={helpHref} onClick={() => { if (helpCommunity) activateLocalCommunity(helpCommunity.subdomain); }}><MaterialIcon name="help_outline"/>Central de Ajuda<SupportUnreadIndicator/></a>{canReview && <a className="picker-admin-link" href="/administracao-vybe"><MaterialIcon name="settings"/>Administração VYBE</a>}<button type="button" onClick={onLogout}><MaterialIcon name="logout"/>Sair</button></div></header>
    <section className={`picker-content ${isRequestsPage ? 'is-subpage' : ''}`}>
      <p className="picker-eyebrow">{isRequestsPage ? 'ACOMPANHAMENTO' : 'SEUS UNIVERSOS'}</p>
      <h1 className={isUniversePicker ? 'picker-title' : undefined}>{isRequestsPage ? 'Minhas solicitações' : <><span>Escolha seu </span><em>universo</em><i aria-hidden="true">✦</i></>}</h1>
      <p className="picker-description">{isRequestsPage ? 'Acompanhe as comunidades que você enviou para análise.' : 'Entre em uma comunidade e continue sua história.'}</p>
      {!isRequestsPage && <div className="picker-controls"><label className="picker-search"><MaterialIcon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar comunidades..."/></label><button className="picker-create-button" type="button" onClick={() => { setShowRequestForm(true); setRequestMessage(''); }}><MaterialIcon name="add"/>Criar nova comunidade</button><a className="picker-requests-button" href="/minhas-solicitacoes"><span className="picker-request-list-icon" aria-hidden="true"><i/><i/><i/></span>Minhas solicitações{requests.length > 0 && <span className="picker-request-count">{requests.length}</span>}</a></div>}
      {error && <p className="picker-error" role="alert">{error}</p>}
      {requestMessage && <p className="picker-success" role="status">{requestMessage}</p>}
      {!isRequestsPage && <div className="picker-grid">{visibleCommunities.map((item, index) => { const isCurrent = item.slug === currentTenantSlug; const isMember = item.joinStatus === 'MEMBER'; const localEntry = isLocalHost && isCurrent && isMember; const destination = localEntry ? communityHomeHref(item.subdomain) : isCurrent && isMember && !isLocalHost ? '/' : isMember ? communityHomeHref(item.subdomain) : `/comunidades/${item.slug}/solicitar-entrada`; const action = isMember ? 'Entrar' : item.joinStatus === 'PENDING' ? 'Em análise' : item.joinStatus === 'NEEDS_INFORMATION' ? 'Atualizar solicitação' : item.joinStatus === 'REJECTED' ? 'Ver resposta' : item.requiresApproval ? 'Solicitar entrada' : 'Entrar'; const actionIcon = item.joinStatus === 'PENDING' ? 'schedule' : 'arrow_forward'; const accent = communityCardPalette[index % communityCardPalette.length]; return <a className="picker-community" href={destination} style={{ '--community-accent': accent } as CSSProperties} onClick={() => { if (isLocalHost && isMember) activateLocalCommunity(item.subdomain); }} aria-label={`${action} em ${item.name}`} key={item.id}><div className="picker-cover" style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")` } : undefined} aria-hidden="true"/>{item.logoUrl ? <img className="picker-emblem-image" src={item.logoUrl} alt=""/> : <span className="picker-emblem">{item.name.slice(0, 1).toUpperCase()}</span>}<div className="picker-card-body"><div className="picker-card-heading"><h2>{item.name}</h2><p className="picker-card-category">{item.category || 'Comunidade'}</p></div><p className="picker-community-description">{item.description}</p><div className="picker-card-footer"><span className="picker-members"><MaterialIcon name="groups"/><small>{item.memberCount.toLocaleString('pt-BR')} membros</small></span><span className={`picker-card-action ${item.joinStatus === 'PENDING' ? 'is-pending' : ''}`}>{action}<MaterialIcon name={actionIcon}/></span></div></div></a>; })}{loading && <p className="picker-empty">Carregando comunidades…</p>}{!loading && !error && !visibleCommunities.length && <p className="picker-empty">{communities.length ? 'Nenhuma comunidade encontrada.' : 'Você ainda não participa de nenhum universo.'}</p>}</div>}
    {isRequestsPage && <section className="picker-own-requests is-dedicated"><a className="picker-page-back" href="/comunidades">← Voltar para comunidades</a><h2>Solicitações para criar comunidade</h2>{requests.length ? requests.map((item) => <article id={`solicitacao-${item.id}`} key={item.id}>{item.photoUrl ? <img className="picker-request-cover" src={item.photoUrl} alt={`Capa de ${item.rpgName}`}/> : <div className="picker-request-emblem">{item.rpgName.slice(0, 1).toUpperCase()}</div>}<div className="picker-request-info"><strong>{item.rpgName}</strong><small>{item.slug}.vybe.com.br · Enviada em {new Date(item.createdAt).toLocaleDateString('pt-BR')}</small><p>{item.description}</p><span>Valor: {new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((item.amountCents ?? 0)/100)} · Pagamento: {item.paymentStatus === 'CONFIRMED' ? 'Confirmado' : item.paymentStatus === 'PROOF_SENT' ? 'Em análise' : item.paymentStatus === 'PAYMENT_ISSUE' ? 'Não identificado' : item.paymentStatus === 'REFUND_REQUIRED' ? 'Reembolso pendente' : item.paymentStatus === 'REFUNDED' ? 'Reembolso registrado' : item.paymentRequired ? 'Aguardando pagamento' : 'Legada'}</span>{item.paymentIssueReason && <p>{item.paymentIssueReason}</p>}{item.rejectionReason && <p>Motivo da recusa: {item.rejectionReason}</p>}{item.status === 'rejected' && item.paymentStatus === 'REFUND_REQUIRED' && <p>O valor pago aguarda tratamento administrativo de reembolso.</p>}<span>Criação: {item.status === 'approved' ? 'Aprovada' : item.status === 'rejected' ? 'Recusada' : item.status === 'cancelled' ? 'Cancelada' : item.paymentStatus === 'CONFIRMED' ? 'Aguardando aprovação' : 'Aguardando pagamento'}</span></div><div className="picker-request-action"><b className={`request-status is-${item.status}`}>{requestStatus[item.status] ?? (item.status === 'cancelled' ? 'Cancelada' : 'Em análise')}</b>{item.status === 'approved' ? <a href={communityHomeHref(item.slug)} onClick={() => activateLocalCommunity(item.slug)}>Entrar na comunidade</a> : item.paymentRequired && item.status === 'pending' && <button type="button" onClick={() => { setPaymentRequestId(item.id); setShowRequestForm(true); }}>Pagar / acompanhar</button>}</div></article>) : <p className="picker-empty">Você ainda não enviou solicitações para criar comunidades.</p>}<h2>Solicitações de entrada</h2>{joinRequests.length ? joinRequests.map((item) => <article id={`entrada-${item.id}`} key={item.id}><div className="picker-request-emblem">{item.characterName.slice(0, 1).toUpperCase()}</div><div className="picker-request-info"><strong>{item.characterName} <small>@{item.requestedUsername}</small></strong><small>{item.communitySlug}.vybe.com.br · Enviada em {new Date(item.createdAt).toLocaleDateString('pt-BR')}</small><span>Última atualização: {new Date(item.updatedAt).toLocaleDateString('pt-BR')}</span>{item.status === 'NEEDS_INFORMATION' && <p>{item.adminMessage}</p>}{item.status === 'REJECTED' && <p>{item.rejectionReason}</p>}</div><div className="picker-request-action"><b className={`request-status is-${item.status.toLowerCase()}`}>{item.status === 'PENDING' ? 'Aguardando análise' : item.status === 'NEEDS_INFORMATION' ? 'Alterações solicitadas' : item.status === 'APPROVED' ? 'Aprovada' : 'Recusada'}</b>{item.status === 'APPROVED' ? <a href={communityHomeHref(item.communitySlug)} onClick={() => activateLocalCommunity(item.communitySlug)}>Entrar na comunidade</a> : <a href={`/comunidades/${item.communitySlug}/solicitar-entrada`}>{item.status === 'NEEDS_INFORMATION' ? 'Atualizar ficha' : 'Acompanhar'}</a>}</div></article>) : <p className="picker-empty">Você ainda não solicitou entrada em comunidades.</p>}</section>}
      <footer className="picker-footer"><span aria-hidden="true">✦</span><p>MAIS QUE UMA REDE SOCIAL.<br/>UM UNIVERSO PARA CHAMAR DE SEU.</p></footer>
    </section>
    {isUniversePicker && <div className="picker-mascot" aria-hidden="true"><svg viewBox="0 0 100 120"><path d="M50 23c-3-9 1-15 9-20M56 13c8-9 17-8 21-6-2 9-9 14-21 13" fill="#a8d8d2" stroke="#246b6e" strokeWidth="3" strokeLinecap="round"/><path d="M50 22v10" stroke="#246b6e" strokeWidth="4" strokeLinecap="round"/><rect x="18" y="33" width="64" height="61" rx="23" fill="#fffaf0" stroke="#246b6e" strokeWidth="4"/><rect x="27" y="43" width="46" height="34" rx="15" fill="#17494b"/><circle cx="40" cy="59" r="3" fill="#a8d8d2"/><circle cx="60" cy="59" r="3" fill="#a8d8d2"/><path d="M42 68q8 7 16 0" fill="none" stroke="#a8d8d2" strokeWidth="3" strokeLinecap="round"/><path d="M31 94v10m38-10v10M18 56h-7m78 0h-7" stroke="#246b6e" strokeWidth="5" strokeLinecap="round"/><path d="M38 104h-9m42 0h-9" stroke="#17494b" strokeWidth="5" strokeLinecap="round"/></svg></div>}
    {showRequestForm && <CommunityCreationWizard requestId={paymentRequestId || undefined} onClose={() => { setShowRequestForm(false); setPaymentRequestId(''); }} onCreated={() => { void loadPage(); }}/>}
  </main>;
}

export function App() {
  const hostname = window.location.hostname.toLowerCase();
  const isLocalDevelopmentHost = ['localhost', '127.0.0.1'].includes(hostname);
  const isPlatformDomain = ['vybe.com.br', 'www.vybe.com.br'].includes(hostname);
  const [session, setSession] = useState<AuthPayload | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [bootError, setBootError] = useState('');
  const [registerMode, setRegisterMode] = useState(() => new URLSearchParams(window.location.search).get('auth') === 'register');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const authPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const rememberHelpOrigin = (event: MouseEvent) => {
      const origin = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!origin) return;
      try {
        const destination = new URL(origin.href, window.location.href);
        if (destination.origin !== window.location.origin || destination.pathname !== '/ajuda') return;
        if (window.location.pathname !== '/ajuda') sessionStorage.setItem('vybe_help_return_to', `${window.location.pathname}${window.location.search}${window.location.hash}`);
      } catch { /* Ignore malformed or external anchors. */ }
    };
    document.addEventListener('click', rememberHelpOrigin, true);
    return () => document.removeEventListener('click', rememberHelpOrigin, true);
  }, []);

  useEffect(() => {
    authPanelRef.current?.scrollTo({ top: 0 });
    window.scrollTo(0, 0);
  }, [registerMode]);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (response) => {
        if (response.ok) setSession(await response.json() as AuthPayload);
        else if (response.status !== 401) {
          const errorMessage = await response.json().then((body: { error?: string; message?: string }) => body.error ?? body.message ?? 'Comunidade indisponível.').catch(() => 'Comunidade indisponível.');
          setBootError(errorMessage);
          notifySnack(errorMessage);
        }
      })
      .catch(() => {
        const errorMessage = 'Não foi possível conectar ao servidor. Verifique se a API e o banco estão disponíveis.';
        setBootError(errorMessage);
        notifySnack(errorMessage);
      })
      .finally(() => setCheckingSession(false));
  }, [isPlatformDomain]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') ?? '');
    if (registerMode && password !== String(values.get('confirmPassword') ?? '')) {
      setMessage('As senhas não coincidem. Confira os campos e tente novamente.');
      setSubmitting(false);
      return;
    }
    const payload = registerMode
      ? { email: values.get('email'), password, displayName: values.get('name'), termsAccepted: values.get('terms') === 'on', termsVersion: LEGAL_TERMS_VERSION, privacyVersion: LEGAL_PRIVACY_VERSION }
      : { email: values.get('email'), password };
    try {
      const response = await fetch(registerMode ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as AuthPayload | { error?: string; message?: string; pending?: boolean } | null;
      if (!response.ok) throw new Error(body && ('error' in body || 'message' in body) ? body.error ?? body.message : 'Não foi possível acessar sua conta.');
      if (body && 'pending' in body && body.pending) {
        const pendingMessage = body.message ?? 'Seu pedido de entrada está aguardando aprovação da equipe.';
        setMessage(pendingMessage);
        notifySnack(pendingMessage);
        return;
      }
      setSession(body as AuthPayload);
      window.location.assign('/comunidades');
    } catch (error) {
      const errorMessage = error instanceof TypeError
        ? 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.'
        : error instanceof Error ? error.message : 'Não foi possível acessar sua conta.';
      setMessage(errorMessage);
      notifySnack(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    sessionStorage.removeItem('vybe_active_community');
    document.cookie = 'vybe_dev_tenant=; Path=/; Max-Age=0; SameSite=Lax';
    setSession(null);
    window.location.assign('/');
  }

  const pathname = window.location.pathname;
  if (pathname === '/termos-de-uso') return <TermsOfUsePage/>;
  if (pathname === '/politica-de-privacidade') return <PrivacyPolicyPage/>;
  if (checkingSession) return <AppLoading/>;
  if (session && pathname.startsWith('/administracao-vybe')) return <AdminPlatformPage character={session.character} onLogout={() => void logout()}/>;
  if (isPlatformDomain && !session && !new URLSearchParams(window.location.search).has('auth')) return <PlatformHome/>;
  if (session && pathname === '/ajuda') return <SocialApp character={session.character} onCharacterUpdated={(character) => setSession({ ...session, character })} onLogout={() => void logout()}/>;
  if (session && pathname === '/universos') return <CommunityPickerPage character={session.character} onLogout={() => void logout()}/>;
  if ((isPlatformDomain || isLocalDevelopmentHost) && session && pathname === '/' && (!isLocalDevelopmentHost || !sessionStorage.getItem('vybe_active_community'))) return <CommunityPickerPage character={session.character} onLogout={() => void logout()}/>;
  const joinRoute = pathname.match(/^\/comunidades\/([a-z0-9-]+)\/solicitar-entrada$/);
  if (session && joinRoute) return <CommunityJoinPage slug={joinRoute[1]}/>;
  if (isPlatformDomain && session) return <CommunityPickerPage character={session.character} onLogout={() => void logout()}/>;
  if (session && ['/comunidades', '/minhas-solicitacoes'].includes(pathname)) return <CommunityPickerPage character={session.character} onLogout={() => void logout()}/>;
  if (session && (pathname.startsWith('/carreira') || pathname.startsWith('/empresas'))) return <CommunityHomeRedirect/>;
  if (session) return <SocialApp character={session.character} onCharacterUpdated={(character) => setSession({ ...session, character })} onLogout={() => void logout()}/>;

  return <main className={`auth-universe-page auth-entry-redesign ${registerMode ? 'is-register' : 'is-login'}`}>
    <header className="auth-universe-header">
      <div className="auth-brand"><LoginLogo/></div>
      <h1 id="login-title">{registerMode ? 'Crie sua conta' : 'Entre no seu universo'}</h1>
      <p>{registerMode ? 'Entre no VYBE e dê início à sua história.' : 'Acesse sua conta e continue sua história no VYBE.'}</p>
    </header>
    <section ref={authPanelRef} className="auth-universe-stage" aria-labelledby="login-title">
      <div className="auth-promo-column auth-promo-left" aria-hidden="true">
        <article className="auth-promo-card auth-promo-social">
          <img src="/vybe-social-friends.png" alt=""/>
          <div className="auth-promo-copy"><span className="auth-promo-icon social"><MaterialIcon name="photo_camera"/></span><div><strong>Social</strong><small>Compartilhe momentos com a sua comunidade.</small></div></div>
        </article>
        <article className="auth-promo-card auth-promo-echo"><span className="auth-promo-icon echo"><MaterialIcon name="graphic_eq"/></span><div><strong>Echo</strong><small>Troque ideias e acompanhe o que está acontecendo.</small></div><span className="auth-echo-wave">▂ ▅ ▇ ▄ ▆ ▂</span></article>
        <article className="auth-promo-card auth-promo-match"><div className="auth-match-photo"><img src="/vybe-match-couple.png" alt=""/></div><div className="auth-promo-copy"><span className="auth-promo-icon match"><MaterialIcon name="favorite"/></span><div><strong>Match</strong><small>Encontre novas conexões.</small></div></div></article>
      </div>
      <div className="login-card auth-card auth-center-card">
        <nav className="auth-mode-tabs" aria-label="Acesso à conta">
          <button type="button" className={!registerMode ? 'active' : ''} aria-current={!registerMode ? 'page' : undefined} onClick={() => { if (registerMode) { setRegisterMode(false); setMessage(''); setShowPassword(false); setShowConfirmPassword(false); } }}><MaterialIcon name="person"/>Entrar</button>
          <button type="button" className={registerMode ? 'active' : ''} aria-current={registerMode ? 'page' : undefined} onClick={() => { if (!registerMode) { setRegisterMode(true); setMessage(''); setShowPassword(false); setShowConfirmPassword(false); } }}><MaterialIcon name="person_add"/>Criar conta</button>
        </nav>
        <form onSubmit={(event) => void handleSubmit(event)}>
            {registerMode && <><label htmlFor="name">Nome</label><div className="input-wrap"><MaterialIcon name="person"/><input id="name" name="name" type="text" placeholder="Seu nome" autoComplete="name" required minLength={2} maxLength={60}/></div></>}
            <label className={registerMode ? '' : 'auth-visually-hidden'} htmlFor="email">E-mail</label>
            <div className="input-wrap"><MaterialIcon name="mail"/><input id="email" name="email" type="email" placeholder={registerMode ? 'seu@email.com' : 'E-mail'} autoComplete="email" required/></div>
            <div className="password-label"><label className={registerMode ? '' : 'auth-visually-hidden'} htmlFor="password">Senha</label></div>
            <div className="input-wrap"><MaterialIcon name="lock"/><input id="password" name="password" type={showPassword ? 'text' : 'password'} placeholder={registerMode ? 'Crie uma senha' : 'Senha'} autoComplete={registerMode ? 'new-password' : 'current-password'} required minLength={registerMode ? 8 : undefined}/><button className="visibility-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}><MaterialIcon name={showPassword ? 'visibility_off' : 'visibility'}/></button></div>
            {registerMode && <p className="auth-hint password-hint">Use pelo menos 8 caracteres.</p>}
            {registerMode && <><label htmlFor="confirmPassword">Confirmar senha</label><div className="input-wrap"><MaterialIcon name="lock"/><input id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} placeholder="Repita sua senha" autoComplete="new-password" required/><button className="visibility-toggle" type="button" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? 'Ocultar confirmação' : 'Mostrar confirmação'}><MaterialIcon name={showConfirmPassword ? 'visibility_off' : 'visibility'}/></button></div><label className="terms-row"><input type="checkbox" name="terms" required/><span>Li e concordo com os <a href="/termos-de-uso">Termos de Uso</a> e a <a href="/politica-de-privacidade">Política de Privacidade</a> do VYBE.</span></label></>}
            {message && <p className="form-message" role="alert">{bootError || message}</p>}{bootError && !message && <p className="form-message" role="alert">{bootError}</p>}
            <button className="submit-button" type="submit" disabled={submitting}>{submitting ? 'Aguarde…' : registerMode ? 'Criar minha conta' : 'Entrar no VYBE'} <MaterialIcon name="arrow_forward"/></button>
          </form>
        <p className="auth-switch">{registerMode ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'} <button type="button" onClick={() => { setRegisterMode((value) => !value); setMessage(''); setShowPassword(false); setShowConfirmPassword(false); }}>{registerMode ? 'Entrar no VYBE' : 'Criar conta'}</button></p>
      </div>
      <div className="auth-promo-column auth-promo-right" aria-hidden="true">
        <article className="auth-promo-card auth-promo-message"><span className="auth-promo-icon messages"><MaterialIcon name="chat_bubble"/></span><div><strong>Lívia <small>agora</small></strong><p>Te enviei as fotos! 💜</p></div></article>
        <article className="auth-promo-card auth-promo-bank"><div className="auth-bank-top"><span className="auth-promo-icon bank"><MaterialIcon name="credit_card"/></span><strong>VYBE Banco</strong></div><small>Saldo disponível</small><b>R$ 4.850,00</b><span className="auth-bank-button">Transferir <MaterialIcon name="arrow_forward"/></span></article>
        <article className="auth-promo-card auth-promo-event"><span className="auth-promo-icon events"><MaterialIcon name="calendar_month"/></span><div><strong>Evento da semana</strong><b>Festa no campus</b><small>32 confirmados</small></div></article>
      </div>
    </section>
    <footer className="auth-universe-footer">
          <div className="auth-apps" aria-label="Aplicativos VYBE">
            <div className="auth-app auth-app-social"><span><MaterialIcon name="photo_camera"/></span><small>Social</small></div>
            <div className="auth-app auth-app-pulse"><span><MaterialIcon name="graphic_eq"/></span><small>Echo</small></div>
            <div className="auth-app auth-app-match"><span><MaterialIcon name="favorite"/></span><small>Match</small></div>
            <div className="auth-app auth-app-messages"><span><MaterialIcon name="chat_bubble"/></span><small>Mensagens</small></div>
            <div className="auth-app auth-app-bank"><span><MaterialIcon name="credit_card"/></span><small>Banco</small></div>
            <div className="auth-app auth-app-events"><span><MaterialIcon name="calendar_month"/></span><small>Eventos</small></div>
          </div>
          <p className="auth-tagline">CONEXÕES, MOMENTOS E NOVAS HISTÓRIAS EM UM SÓ LUGAR.</p>
    </footer>
  </main>;
}
