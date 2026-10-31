import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SocialApp, type SocialCharacter } from './SocialApp';
import './CommunityPickerPage.css';
import { notifySnack } from './SnackMessage';
import { MaterialIcon } from './MaterialIcon';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '@vybe/shared';
import { PrivacyPolicyPage, TermsOfUsePage } from './LegalPages';
import { VybeLogo } from './VybeLogo';
import { CareerApp } from './CareerApp';
import { CommunityJoinPage } from './CommunityJoinPage';
import { activateLocalCommunity, communityHomeHref } from './communityNavigation';

type AuthPayload = { account: { id: string; email: string }; character: SocialCharacter; globalAccount?: boolean };

function Logo() {
  return <a className="brand" href="/" aria-label="VYBE"><VybeLogo className="brand-reference-image"/></a>;
}

function PlatformHome() {
  return <main className="platform-home"><header><Logo/><span>A plataforma para comunidades de RPG</span><nav><a href="/?auth=login">Entrar</a><a href="/?auth=register">Criar conta</a></nav></header><section><p>UM UNIVERSO, MUITAS HISTÓRIAS</p><h1>Comunidades de RPG<br/>com vida própria.</h1><span>Crie sua conta VYBE e escolha em quais comunidades deseja participar.</span><a href="/?auth=register">Criar minha conta VYBE <b><MaterialIcon name="arrow_forward"/></b></a></section><footer>VYBE · Plataforma principal</footer></main>;
}

type CommunitySummary = { id: string; name: string; slug: string; subdomain: string; description: string; coverUrl: string; logoUrl: string; memberCount: number; requiresApproval?: boolean; joinStatus?: 'MEMBER' | 'NONE' | 'PENDING' | 'NEEDS_INFORMATION' | 'REJECTED' };
type CommunityRequestSummary = { id: string; rpgName: string; slug: string; description: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; updatedAt?: string; photoUrl?: string };
type MyJoinRequest = { id: string; communityId: string; communitySlug: string; characterName: string; requestedUsername: string; status: 'PENDING' | 'NEEDS_INFORMATION' | 'APPROVED' | 'REJECTED'; adminMessage: string; rejectionReason: string; createdAt: string; updatedAt: string };
type JoinNotice = { id: string; status: 'NEEDS_INFORMATION' | 'APPROVED' | 'REJECTED'; message: string; createdAt: string; communityName: string; communitySlug: string };
type AdminCommunityRequest = CommunityRequestSummary & { applicant: { displayName: string; username: string } | null; photoUrl: string };
type ManagedCommunity = Omit<CommunitySummary, 'coverUrl'> & { coverUrl: string; status: 'active' | 'archived' | 'suspended' };

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem.'));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

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
  const [joinNotices, setJoinNotices] = useState<JoinNotice[]>([]);
  const [reviewQueue, setReviewQueue] = useState<AdminCommunityRequest[]>([]);
  const [managedCommunities, setManagedCommunities] = useState<ManagedCommunity[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [photoPreview, setPhotoPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [reviewingId, setReviewingId] = useState('');
  const isRequestsPage = window.location.pathname === '/minhas-solicitacoes';
  const isAdminPage = window.location.pathname === '/administracao-vybe';
  const isPlatformHost = ['vybe.com.br', 'www.vybe.com.br'].includes(window.location.hostname.toLowerCase());
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname.toLowerCase());

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  async function loadPage() {
    setLoading(true);
    try {
      const [directory, ownRequests, ownJoinRequests, notices] = await Promise.all([
        fetchJson<{ currentTenantSlug: string; communities: CommunitySummary[] }>('/api/communities'),
        fetchJson<CommunityRequestSummary[]>('/api/community-requests'),
        fetchJson<MyJoinRequest[]>('/api/my/community-join-requests'),
        isPlatformHost ? fetchJson<JoinNotice[]>('/api/notifications') : Promise.resolve([]),
      ]);
      setCommunities(directory.communities);
      setCurrentTenantSlug(directory.currentTenantSlug);
      setRequests(ownRequests);
      setJoinRequests(ownJoinRequests);
      setJoinNotices(notices);
      setError('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível carregar as comunidades.';
      setError(message);
      notifySnack(message);
    } finally { setLoading(false); }
    try {
      const queue = await fetchJson<AdminCommunityRequest[]>('/api/platform/community-requests');
      const managed = await fetchJson<ManagedCommunity[]>('/api/platform/communities');
      setReviewQueue(queue);
      setManagedCommunities(managed);
      setCanReview(true);
    } catch (reason) {
      setCanReview(false);
      setReviewQueue([]);
      setManagedCommunities([]);
    }
  }

  useEffect(() => {
    void loadPage();
  }, []);

  async function submitCommunityRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const photo = values.get('photo');
    if (!(photo instanceof File) || !photo.size) { notifySnack('Escolha uma foto de capa para o RPG.'); return; }
    if (photo.size > 3 * 1024 * 1024) { notifySnack('A foto deve ter no máximo 3 MB.'); return; }
    setSubmitting(true);
    setRequestMessage('');
    try {
      await fetchJson<CommunityRequestSummary>('/api/community-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpgName: values.get('rpgName'), description: values.get('description'), photo: await readFileAsDataUrl(photo) }),
      });
      setShowRequestForm(false);
      setPhotoPreview('');
      setRequestMessage('Solicitação enviada. A comunidade aparecerá no diretório depois da aprovação.');
      form.reset();
      await loadPage();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível enviar a solicitação.';
      notifySnack(message);
    } finally { setSubmitting(false); }
  }

  async function decideRequest(id: string, decision: 'approve' | 'reject') {
    setReviewingId(id);
    try {
      await fetchJson(`/api/platform/community-requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      setRequestMessage(decision === 'approve' ? 'Comunidade aprovada e publicada no diretório.' : 'Solicitação recusada.');
      await loadPage();
    } catch (reason) {
      notifySnack(reason instanceof Error ? reason.message : 'Não foi possível revisar a solicitação.');
    } finally { setReviewingId(''); }
  }

  async function updateCommunityStatus(community: ManagedCommunity, status: 'active' | 'archived' | 'suspended') {
    try {
      await fetchJson(`/api/platform/communities/${community.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      setRequestMessage(status === 'archived' ? `${community.name} foi arquivada.` : status === 'suspended' ? `${community.name} foi suspensa.` : `${community.name} foi reativada.`);
      await loadPage();
    } catch (reason) {
      notifySnack(reason instanceof Error ? reason.message : 'Não foi possível atualizar a comunidade.');
    }
  }

  async function deleteCommunity(community: ManagedCommunity) {
    if (!window.confirm(`Excluir ${community.name}? Ela deixará de aparecer e não poderá ser reativada por esta tela.`)) return;
    try {
      await fetchJson(`/api/platform/communities/${community.id}`, { method: 'DELETE' });
      setRequestMessage(`${community.name} foi excluída do diretório.`);
      await loadPage();
    } catch (reason) {
      notifySnack(reason instanceof Error ? reason.message : 'Não foi possível excluir a comunidade.');
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCommunities = communities.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(normalizedQuery));
  const requestStatus = { pending: 'Em análise', approved: 'Aprovada', rejected: 'Recusada' };
  return <main className="community-picker">
    <header className="picker-header"><Logo/><div className="picker-account">{character.avatarUrl ? <img src={character.avatarUrl} alt=""/> : <span>{character.displayName.slice(0, 1).toUpperCase()}</span>}<strong>{character.displayName}</strong><small>@{character.username}</small>{canReview && <a className="picker-admin-link" href="/administracao-vybe">Administração VYBE</a>}<button type="button" onClick={onLogout}><MaterialIcon name="logout"/>Sair</button></div></header>
    <section className={`picker-content ${isRequestsPage || isAdminPage ? 'is-subpage' : ''}`}>
      <p className="picker-eyebrow">{isRequestsPage ? 'ACOMPANHAMENTO' : isAdminPage ? 'ADMINISTRAÇÃO VYBE' : 'SEUS UNIVERSOS'}</p>
      <h1>{isRequestsPage ? 'Minhas solicitações' : isAdminPage ? 'Administração VYBE' : 'Escolha seu universo'}</h1>
      <p className="picker-description">{isRequestsPage ? 'Acompanhe as comunidades que você enviou para análise.' : isAdminPage ? 'Gerencie as solicitações e comunidades da plataforma.' : 'Entre em uma comunidade e continue sua história.'}</p>
      {!isRequestsPage && !isAdminPage && <div className="picker-controls"><label className="picker-search"><MaterialIcon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar comunidades..."/></label><button className="picker-create-button" type="button" onClick={() => { setShowRequestForm(true); setRequestMessage(''); }}><MaterialIcon name="add"/>Criar nova comunidade</button><a className="picker-requests-button" href="/minhas-solicitacoes">Minhas solicitações{requests.length > 0 && <span>{requests.length}</span>}</a></div>}
      {error && <p className="picker-error" role="alert">{error}</p>}
      {requestMessage && <p className="picker-success" role="status">{requestMessage}</p>}
      {!isRequestsPage && !isAdminPage && joinNotices.map((notice) => <p className="picker-success" role="status" key={notice.id}><strong>{notice.status === 'APPROVED' ? 'Entrada aprovada' : notice.status === 'REJECTED' ? 'Solicitação recusada' : 'Ajustes solicitados'}</strong> · {notice.communityName}{notice.message ? ` — ${notice.message}` : ''} <a href={`/comunidades/${notice.communitySlug}/solicitar-entrada`}>Ver solicitação</a></p>)}
      {!isRequestsPage && !isAdminPage && <div className="picker-grid">{visibleCommunities.map((item) => { const isCurrent = item.slug === currentTenantSlug; const isMember = item.joinStatus === 'MEMBER'; const localEntry = isLocalHost && isCurrent && isMember; const destination = localEntry ? communityHomeHref(item.subdomain) : isCurrent && isMember && !isLocalHost ? '/' : isMember ? communityHomeHref(item.subdomain) : `/comunidades/${item.slug}/solicitar-entrada`; const action = isMember ? 'Entrar' : item.joinStatus === 'PENDING' ? 'Acompanhar solicitação' : item.joinStatus === 'NEEDS_INFORMATION' ? 'Atualizar solicitação' : item.joinStatus === 'REJECTED' ? 'Ver resposta' : item.requiresApproval ? 'Solicitar entrada' : 'Entrar na comunidade'; return <a className="picker-community" href={destination} onClick={() => { if (localEntry) activateLocalCommunity(item.subdomain); }} aria-label={`${action} em ${item.name}`} key={item.id}><div className="picker-cover" style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")` } : undefined}/>{item.logoUrl ? <img className="picker-emblem-image" src={item.logoUrl} alt=""/> : <span className="picker-emblem">{item.name.slice(0, 1).toUpperCase()}</span>}<div className="picker-card-body"><h2>{item.name}</h2><p>{item.description}</p><div className="picker-members"><span className="picker-member-avatars"><i>Y</i><i>L</i><i>C</i></span><small>{item.memberCount.toLocaleString('pt-BR')} membros · {action}</small><b><MaterialIcon name="arrow_forward"/></b></div></div></a>; })}{loading && <p className="picker-empty">Carregando comunidades…</p>}{!loading && !error && !visibleCommunities.length && <p className="picker-empty">Nenhuma comunidade encontrada.</p>}</div>}
      {isRequestsPage && <section className="picker-own-requests is-dedicated"><a className="picker-page-back" href="/comunidades">← Voltar para comunidades</a><h2>Solicitações para criar comunidade</h2>{requests.length ? requests.map((item) => <article id={`solicitacao-${item.id}`} key={item.id}>{item.photoUrl ? <img className="picker-request-cover" src={item.photoUrl} alt={`Capa de ${item.rpgName}`}/> : <div className="picker-request-emblem">{item.rpgName.slice(0, 1).toUpperCase()}</div>}<div className="picker-request-info"><strong>{item.rpgName}</strong><small>{item.slug}.vybe.com.br · Enviada em {new Date(item.createdAt).toLocaleDateString('pt-BR')}</small><p>{item.description}</p><span>Última atualização: {new Date(item.updatedAt ?? item.createdAt).toLocaleDateString('pt-BR')}</span></div><div className="picker-request-action"><b className={`request-status is-${item.status}`}>{requestStatus[item.status]}</b>{item.status === 'approved' ? <a href={communityHomeHref(item.slug)} onClick={() => activateLocalCommunity(item.slug)}>Entrar na comunidade</a> : item.status === 'rejected' ? <button type="button" disabled title="O motivo não está disponível nesta versão.">Ver motivo</button> : <button type="button" onClick={() => void loadPage()}>Acompanhar</button>}</div></article>) : <p className="picker-empty">Você ainda não enviou solicitações para criar comunidades.</p>}<h2>Solicitações de entrada</h2>{joinRequests.length ? joinRequests.map((item) => <article id={`entrada-${item.id}`} key={item.id}><div className="picker-request-emblem">{item.characterName.slice(0, 1).toUpperCase()}</div><div className="picker-request-info"><strong>{item.characterName} <small>@{item.requestedUsername}</small></strong><small>{item.communitySlug}.vybe.com.br · Enviada em {new Date(item.createdAt).toLocaleDateString('pt-BR')}</small><span>Última atualização: {new Date(item.updatedAt).toLocaleDateString('pt-BR')}</span>{item.status === 'NEEDS_INFORMATION' && <p>{item.adminMessage}</p>}{item.status === 'REJECTED' && <p>{item.rejectionReason}</p>}</div><div className="picker-request-action"><b className={`request-status is-${item.status.toLowerCase()}`}>{item.status === 'PENDING' ? 'Aguardando análise' : item.status === 'NEEDS_INFORMATION' ? 'Alterações solicitadas' : item.status === 'APPROVED' ? 'Aprovada' : 'Recusada'}</b>{item.status === 'APPROVED' ? <a href={communityHomeHref(item.communitySlug)} onClick={() => activateLocalCommunity(item.communitySlug)}>Entrar na comunidade</a> : <a href={`/comunidades/${item.communitySlug}/solicitar-entrada`}>{item.status === 'NEEDS_INFORMATION' ? 'Atualizar ficha' : 'Acompanhar'}</a>}</div></article>) : <p className="picker-empty">Você ainda não solicitou entrada em comunidades.</p>}</section>}
      {isAdminPage && !canReview && <div className="picker-empty picker-restricted">Esta área está disponível apenas para a administração VYBE.</div>}
      {isAdminPage && canReview && <><section className="picker-review-queue"><header><div><p className="picker-eyebrow">ADMINISTRAÇÃO VYBE</p><h2>Solicitações para aprovação</h2></div><span>{reviewQueue.length}</span></header>{reviewQueue.length ? <div className="picker-review-grid">{reviewQueue.map((item) => <article className="picker-review-card" key={item.id}><img src={item.photoUrl} alt={`Capa proposta para ${item.rpgName}`}/><div><h3>{item.rpgName}</h3><small>{item.slug}.vybe.com.br · por @{item.applicant?.username ?? 'personagem'}</small><p>{item.description}</p><footer><button type="button" disabled={reviewingId === item.id} onClick={() => void decideRequest(item.id, 'reject')}>Recusar</button><button type="button" disabled={reviewingId === item.id} onClick={() => void decideRequest(item.id, 'approve')}>{reviewingId === item.id ? 'Aguarde…' : 'Aprovar'}</button></footer></div></article>)}</div> : <p className="picker-empty">Nenhuma solicitação aguardando aprovação.</p>}</section><section className="picker-community-management"><header><div><p className="picker-eyebrow">ADMINISTRAÇÃO VYBE</p><h2>Gerenciar comunidades</h2></div><span>{managedCommunities.length}</span></header>{managedCommunities.length ? <div className="picker-managed-list">{managedCommunities.map((item) => <article key={item.id}><span className="picker-managed-emblem">{item.name.slice(0, 1).toUpperCase()}</span><div className="picker-managed-info"><strong>{item.name}</strong><small>{item.subdomain}.vybe.com.br · {item.memberCount.toLocaleString('pt-BR')} membros</small></div><b className={`request-status is-${item.status === 'active' ? 'approved' : 'rejected'}`}>{item.status === 'active' ? 'Ativa' : item.status === 'suspended' ? 'Suspensa' : 'Arquivada'}</b><div className="picker-managed-actions">{item.status === 'active' ? <><button type="button" onClick={() => void updateCommunityStatus(item, 'archived')}>Arquivar</button><button className="is-danger" type="button" onClick={() => void updateCommunityStatus(item, 'suspended')}>Suspender</button></> : <button type="button" onClick={() => void updateCommunityStatus(item, 'active')}>Reativar</button>}<button className="is-danger" type="button" onClick={() => void deleteCommunity(item)}>Excluir</button></div></article>)}</div> : <p className="picker-empty">Nenhuma comunidade para gerenciar.</p>}</section></>}
      <footer className="picker-footer"><span>✳</span><p>MAIS QUE UMA REDE SOCIAL.<br/>UM UNIVERSO PARA CHAMAR DE SEU.</p></footer>
    </section>
    {showRequestForm && <div className="picker-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setShowRequestForm(false); }}><form className="picker-request-modal" onSubmit={(event) => void submitCommunityRequest(event)}><button className="picker-modal-close" type="button" aria-label="Fechar" disabled={submitting} onClick={() => setShowRequestForm(false)}><MaterialIcon name="close"/></button><p className="picker-eyebrow">NOVO UNIVERSO</p><h2>Solicitar comunidade</h2><p className="picker-modal-intro">Envie os dados do seu RPG. A equipe VYBE revisará a solicitação antes de publicar a comunidade.</p><label>Nome do RPG<input name="rpgName" required minLength={2} maxLength={80} placeholder="Ex.: Crônicas de Aurora"/></label><label>Sobre o RPG<textarea name="description" required minLength={10} maxLength={500} placeholder="Conte um pouco sobre o universo, o tema e a proposta da comunidade."/></label><label className="picker-photo-label">Foto de capa<span>PNG, JPG ou WebP · até 3 MB</span><input name="photo" type="file" accept="image/png,image/jpeg,image/webp" required onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) { setPhotoPreview(''); return; } if (file.size > 3 * 1024 * 1024) { event.currentTarget.value = ''; setPhotoPreview(''); notifySnack('A foto deve ter no máximo 3 MB.'); return; } setPhotoPreview(URL.createObjectURL(file)); }}/></label>{photoPreview && <img className="picker-photo-preview" src={photoPreview} alt="Prévia da foto de capa"/>}<div className="picker-form-actions"><button type="button" disabled={submitting} onClick={() => setShowRequestForm(false)}>Cancelar</button><button type="submit" disabled={submitting}>{submitting ? 'Enviando…' : 'Enviar para aprovação'}</button></div></form></div>}
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
    authPanelRef.current?.scrollTo({ top: 0 });
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
    setSession(null);
    window.location.assign('/');
  }

  const pathname = window.location.pathname;
  if (pathname === '/termos-de-uso') return <TermsOfUsePage/>;
  if (pathname === '/politica-de-privacidade') return <PrivacyPolicyPage/>;
  if (checkingSession) return <main className="auth-loading">Preparando seu universo…</main>;
  if (isPlatformDomain && !session && !new URLSearchParams(window.location.search).has('auth')) return <PlatformHome/>;
  if ((isPlatformDomain || isLocalDevelopmentHost) && session && pathname === '/' && (!isLocalDevelopmentHost || !sessionStorage.getItem('vybe_active_community'))) return <CommunityPickerPage character={session.character} onLogout={() => void logout()}/>;
  const joinRoute = pathname.match(/^\/comunidades\/([a-z0-9-]+)\/solicitar-entrada$/);
  if (session && joinRoute) return <CommunityJoinPage slug={joinRoute[1]}/>;
  if (isPlatformDomain && session) return <CommunityPickerPage character={session.character} onLogout={() => void logout()}/>;
  if (session && ['/comunidades', '/minhas-solicitacoes', '/administracao-vybe'].includes(pathname)) return <CommunityPickerPage character={session.character} onLogout={() => void logout()}/>;
  if (session && pathname.startsWith('/carreira')) return <CareerApp character={session.character}/>;
  if (session) return <SocialApp character={session.character} onCharacterUpdated={(character) => setSession({ ...session, character })} onLogout={() => void logout()}/>;

  return <main className={`login-page auth-split ${registerMode ? 'is-register' : ''}`}>
    <section ref={authPanelRef} className="auth-panel" aria-labelledby="login-title">
      <div className="auth-panel-inner">
        <div className="auth-brand"><Logo/></div>
        <div className="login-card auth-card">
          <div className="card-heading">
            <h1 id="login-title">{registerMode ? 'Crie sua conta' : 'Entre no seu universo'}</h1>
            <p className="card-subtitle">{registerMode ? 'Entre no VYBE e dê início à sua história.' : 'Acesse sua conta e continue sua história no VYBE.'}</p>
          </div>
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
        <footer className="auth-footer">
          <div className="auth-apps" aria-label="Aplicativos VYBE">
            <div className="auth-app auth-app-social"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3l1.4-2h7.2l1.4 2h3A2 2 0 0 1 22 10.5v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="14" r="4"/><path d="M18 11h.01"/></svg></span><small>Social</small></div>
            <div className="auth-app auth-app-pulse"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h4l2.2-7 4.2 13 2.2-7H21"/><path d="M4 20h16"/></svg></span><small>Echo</small></div>
            <div className="auth-app auth-app-match"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5-8.8 10.2-8.8 10.2S3.2 13.8 3.2 8.8A4.6 4.6 0 0 1 12 6.5a4.6 4.6 0 0 1 8.8 2.3Z"/></svg></span><small>Match</small></div>
            <div className="auth-app auth-app-messages"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-5.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/></svg></span><small>Mensagens</small></div>
            <div className="auth-app auth-app-bank"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-5 9 5v2H3V9ZM5 12v6m4-6v6m6-6v6m4-6v6M3 20h18"/></svg></span><small>Banco</small></div>
          </div>
          <p className="auth-tagline">CONEXÕES, MOMENTOS E NOVAS HISTÓRIAS EM UM SÓ LUGAR.</p>
        </footer>
      </div>
    </section>
    <aside className="auth-visual" aria-label="VYBE: conexões que viram histórias" />
  </main>;
}
