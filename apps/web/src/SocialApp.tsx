import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type SyntheticEvent } from 'react';
import './SocialApp.css';
import './SupportCenter.css';
import './VybePlus.css';
import './VybePlusManage.css';
import { notifySnack } from './SnackMessage';
import { MaterialIcon } from './MaterialIcon';
import { FormattedText, TextFormattingEditor } from './TextFormatting';
import { HelpHeaderLink } from './HelpHeaderLink';
import { isHexNameColor, ProfileNameColorPicker } from './ProfileNameColorPicker';
import { VybeLogo } from './VybeLogo';
import { EmojiButton, useEmojiInsertion } from './EmojiPicker';
import { EventsAdminPage, EventsPage } from './EventsPage';
import { MatchApp } from './MatchApp';
import { MessagesApp, MessagesHomePage } from './MessagesApp';
import { MessageServerRequestGate, MessageServerInviteGate, MessageServersRail, MessageServerWorkspace } from './MessageServers';
import { MessageServerSettings, type Section as MessageServerSettingsSection } from './MessageServerSettings';
import { UniverseBackLink } from './UniverseBackLink';
import { BankApp } from './BankApp';
import { ProfilePhotoEditor } from './ProfilePhotoEditor';
import { AcademicApp } from './AcademicApp';
import { NewsApp } from './NewsApp';
import { activateLocalCommunity, communityHomeHref, isLocalVybeHost } from './communityNavigation';
import { connectConversationRealtime } from './conversationRealtime';
import { getVybeFont, normalizeVybeFontId, VYBE_DEFAULT_FONT_ID } from '@vybe/shared';
import { loadVybeGoogleFont, ProfileFontPicker, ProfileFontText } from './ProfileFontPicker';
import { soundManager } from './soundManager';
import { SoundSettingsPage } from './SoundSettingsPage';

export type SocialCharacter = {
  id: string;
  username: string;
  displayName: string;
  communityFunction?: string;
  bio: string;
  age?: number;
  photoplayerName?: string;
  photoplayerImageUrl?: string;
  avatarUrl: string;
  coverUrl: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  photoPostCount?: number;
  own?: boolean;
  following?: boolean;
  verified?: boolean;
  profileCustomization?: { nameColor?: string; primaryFontId?: string; secondaryFontId?: string; nameFont?: string; fontId?: string; avatarFrame?: string; profileTheme?: string };
};
type SocialPoll = { question: string; options: { id: string; text: string; votesCount: number }[]; myVote: string | null };
type SocialPost = { id: string; content: string; imageUrl: string; imageUrls?: string[]; kind: 'post' | 'pulse'; likesCount: number; commentsCount: number; viewsCount?: number; repostCount?: number; reposted?: boolean; poll?: SocialPoll; createdAt: string; liked: boolean; saved?: boolean; canDelete?: boolean; author: SocialCharacter };
type StoryItem = { id: string; imageUrl: string; createdAt: string };
type StoryGroup = { character: SocialCharacter; own: boolean; unseen: boolean; stories: StoryItem[] };
type SocialEvent = { id: string; title: string; description: string; startsAt: string; location: string; imageUrl: string; category?: string; participantLimit?: number | null; allowComments?: boolean; status?: string; statusLabel?: string; official?: boolean; rejectedReason?: string; cancellationReason?: string; confirmedCount?: number; going?: boolean; canManage?: boolean; canEdit?: boolean; creator?: { id: string; username: string; displayName: string; avatarUrl: string } | null };
type CommunityFeatures = { feed?: boolean; pulse?: boolean; stories?: boolean; conversations?: boolean; messages?: boolean; events?: boolean; match?: boolean; bank?: boolean; academic?: boolean; career?: boolean; news?: boolean; companies?: boolean };
type TenantInfo = { id?: string; name: string; slug?: string; subdomain?: string; description: string; memberCount: number; rules: string[]; coverUrl?: string; wallpaperUrl?: string; logoUrl?: string; settings?: { features?: CommunityFeatures }; administrators?: SocialCharacter[]; brand?: { primary: string; dark: string; medium: string; soft: string; lilac: string; white: string; graphite: string } };
type CommentItem = { id: string; content: string; createdAt: string; own: boolean; replyToCommentId?: string | null; author: SocialCharacter | null };

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  return body?.error ?? body?.message ?? `Não foi possível concluir a solicitação (${response.status}).`;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...init });
    if (!response.ok) {
      const message = await readError(response);
      notifySnack(message);
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof TypeError) notifySnack('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    throw error;
  }
}

function Avatar({ character, className = '' }: { character?: Pick<SocialCharacter, 'displayName' | 'avatarUrl' | 'verified' | 'profileCustomization'> | null; className?: string }) {
  const initial = character?.displayName?.slice(0, 1).toUpperCase() ?? '?';
  const name = character?.displayName ?? 'VYBE';
  const frame = character?.verified ? character.profileCustomization?.avatarFrame?.toLowerCase() : '';
  const frameStyle = frame && isHexNameColor(frame) ? { outline: `3px solid ${frame}`, outlineOffset: '2px' } : undefined;
  return <span style={frameStyle} className={`social-avatar ${className} ${frame && frame !== 'none' && !isHexNameColor(frame) ? `social-avatar-frame-${frame}` : ''} ${character?.avatarUrl ? '' : 'social-avatar--sample'}`} aria-label={name} role="img"><span className="avatar-fallback-initial" aria-hidden="true">{initial}</span>{character?.avatarUrl && <img className="social-avatar-image" src={character.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }}/>}</span>;
}

function relativeTime(date: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function VerifiedName({ character, children, showBadge = true }: { character: Pick<SocialCharacter, 'verified' | 'profileCustomization'>; children: ReactNode; showBadge?: boolean }) {
  const color = character.verified ? character.profileCustomization?.nameColor?.toLowerCase() : '';
  const fontId = character.verified ? normalizeVybeFontId(character.profileCustomization?.primaryFontId ?? character.profileCustomization?.nameFont ?? character.profileCustomization?.fontId) : VYBE_DEFAULT_FONT_ID;
  const font = getVybeFont(fontId);
  const customStyle = color && isHexNameColor(color) ? { color } : undefined;
  useEffect(() => { if (font) loadVybeGoogleFont(font.id); }, [font?.id]);
  return <span style={{ ...customStyle, ...(font ? { fontFamily: `"${font.family}", var(--vybe-profile-font, sans-serif)` } : {}) }} className={`verified-name ${color && color !== 'default' && !customStyle ? `verified-name-color-${color}` : ''}`.trim()}>{children}{showBadge && character.verified && <span className="verification-badge" role="img" aria-label="Conta verificada" title="Conta verificada">✓</span>}</span>;
}

type Customization = { nameColor: string; primaryFontId: string; secondaryFontId: string; avatarFrame: string; profileTheme: string };
function VerifiedCustomizationPanel({ character, app = 'SOCIAL', communityId, onSaved, onPreviewChange, openByDefault = false }: { character: SocialCharacter; app?: 'SOCIAL' | 'ECHO'; communityId: string; onSaved?: (value: Customization) => void; onPreviewChange?: (value: Customization) => void; openByDefault?: boolean }) {
  const [open, setOpen] = useState(openByDefault || new URLSearchParams(window.location.search).get('personalizar') === app.toLowerCase());
  const [saving, setSaving] = useState(false);
  const [colorValid, setColorValid] = useState(true);
  const [frameColorValid, setFrameColorValid] = useState(true);
  const [themeColorValid, setThemeColorValid] = useState(true);
  const [primaryFontOpen, setPrimaryFontOpen] = useState(false);
  const [secondaryFontOpen, setSecondaryFontOpen] = useState(false);
  const [value, setValue] = useState<Customization>({ nameColor: character.profileCustomization?.nameColor ?? 'DEFAULT', primaryFontId: normalizeVybeFontId(character.profileCustomization?.primaryFontId ?? character.profileCustomization?.nameFont ?? character.profileCustomization?.fontId), secondaryFontId: normalizeVybeFontId(character.profileCustomization?.secondaryFontId), avatarFrame: character.profileCustomization?.avatarFrame ?? 'NONE', profileTheme: character.profileCustomization?.profileTheme ?? 'DEFAULT' });
  useEffect(() => {
    const saved = character.profileCustomization;
    setValue({ nameColor: saved?.nameColor ?? 'DEFAULT', primaryFontId: normalizeVybeFontId(saved?.primaryFontId ?? saved?.nameFont ?? saved?.fontId), secondaryFontId: normalizeVybeFontId(saved?.secondaryFontId), avatarFrame: saved?.avatarFrame ?? 'NONE', profileTheme: saved?.profileTheme ?? 'DEFAULT' });
  }, [app, communityId, character.id, character.profileCustomization?.nameColor, character.profileCustomization?.primaryFontId, character.profileCustomization?.secondaryFontId, character.profileCustomization?.nameFont, character.profileCustomization?.fontId, character.profileCustomization?.avatarFrame, character.profileCustomization?.profileTheme]);
  if (!character.own || !character.verified) return null;
  function updateValue(key: keyof Customization, nextValue: string) {
    const next = { ...value, [key]: nextValue };
    setValue(next);
    onPreviewChange?.(next);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!colorValid || !frameColorValid || !themeColorValid) return; setSaving(true);
    try { const result = await apiRequest<{ customization: Customization }>('/api/social/profile-customization', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, customization: value }) }); setValue(result.customization); onSaved?.(result.customization); soundManager.play('success', `customization:${app}:${Date.now()}`); notifySnack(`Personalização do ${app === 'SOCIAL' ? 'Social' : 'Echo'} salva nesta comunidade.`, 'success'); }
    catch { /* apiRequest apresenta o erro da API. */ }
    finally { setSaving(false); }
  }
  return <section className="verified-customization"><header><div><strong>Personalização VYBE Verificado</strong><small>Visível para as pessoas desta comunidade.</small></div><button type="button" onClick={() => setOpen((state) => !state)}>{open ? 'Fechar' : 'Personalizar'}</button></header>{open && <form onSubmit={(event) => void save(event)}><div style={isHexNameColor(value.profileTheme) ? { background: `color-mix(in srgb, ${value.profileTheme} 14%, white)` } : undefined} className={`verified-customization-preview vybe-theme-${value.profileTheme.toLowerCase()}`}><Avatar character={{ ...character, profileCustomization: value }}/><ProfileFontText character={{ ...character, profileCustomization: value }} role="primary"><VerifiedName character={{ verified: true, profileCustomization: value }} showBadge={false}>{character.displayName}</VerifiedName></ProfileFontText><small>@{character.username}</small><ProfileFontText character={{ ...character, profileCustomization: value }} role="primary" className="verified-preview-stats">1 publicação · 1 seguidores · 0 seguindo</ProfileFontText><ProfileFontText character={{ ...character, profileCustomization: value }} role="secondary" className="verified-preview-secondary">Bio e comentário de exemplo na fonte secundária.</ProfileFontText></div><ProfileNameColorPicker value={value.nameColor} onChange={(next) => updateValue('nameColor', next)} onValidityChange={setColorValid}/><details className="verified-font-settings" onToggle={(event) => setPrimaryFontOpen(event.currentTarget.open)}><summary><span><strong>Fonte principal</strong><small>Usada no seu nome, publicações, seguidores e seguindo.</small></span><b>Escolher fonte</b></summary>{primaryFontOpen && <ProfileFontPicker app={app} profileId={character.id} communityId={communityId} currentFont={value.primaryFontId} profileName={character.displayName} title="Fonte principal" description="Usada no seu nome, publicações, seguidores e seguindo." resetLabel="Restaurar fonte principal" onChange={(fontId) => updateValue('primaryFontId', fontId)}/>}</details><details className="verified-font-settings" onToggle={(event) => setSecondaryFontOpen(event.currentTarget.open)}><summary><span><strong>Fonte secundária</strong><small>Usada na sua bio, descrição e comentários.</small></span><b>Escolher fonte</b></summary>{secondaryFontOpen && <ProfileFontPicker app={app} profileId={character.id} communityId={communityId} currentFont={value.secondaryFontId} profileName="Bio e comentário de exemplo" title="Fonte secundária" description="Usada na sua bio, descrição e comentários." resetLabel="Restaurar fonte secundária" onChange={(fontId) => updateValue('secondaryFontId', fontId)}/>}</details><ProfileNameColorPicker label="Moldura do avatar" defaultValue="NONE" resetLabel="Usar moldura padrão" value={value.avatarFrame} onChange={(next) => updateValue('avatarFrame', next)} onValidityChange={setFrameColorValid}/><ProfileNameColorPicker label="Tema do perfil" defaultValue="DEFAULT" resetLabel="Usar tema padrão" value={value.profileTheme} onChange={(next) => updateValue('profileTheme', next)} onValidityChange={setThemeColorValid}/><button type="submit" disabled={saving || !colorValid || !frameColorValid || !themeColorValid}>{saving ? 'Salvando…' : 'Salvar personalização'}</button></form>}</section>;
}

type BenefitsStatus = { community: string; communityLogoUrl?: string | null; username: string; verification: { active: boolean; type: string | null; status: string | null; activatedAt: string | null; source?: string | null }; request: { id: string; status: string; statusLabel: string; createdAt: string; conversationId: string | null; rejectionReason?: string; isGift?: boolean; beneficiary?: { username: string; displayName: string } | null; paymentProofs?: Array<{ id: string; mimeType: string; size: number; uploadedAt: string }> } | null; payment: { pixKey: string; pixKeyType: string; recipientName: string; qrCodeDataUrl: string } | null; amount: number; currency: string; supportUsername: string | null };
type VerificationBeneficiary = { id: string; username: string; displayName: string; avatarUrl: string; verified: boolean; hasActiveRequest: boolean };

const vybePlusBenefits = [
  { icon: 'verified', title: 'Selo de verificado', text: 'Destaque oficial no seu perfil.', color: 'teal' },
  { icon: 'palette', title: 'Personalização da cor do nome', text: 'Deixe sua identidade ainda mais única.', color: 'coral' },
  { icon: 'edit', title: 'Fontes exclusivas', text: 'Escolha entre estilos especiais.', color: 'coral' },
  { icon: 'image', title: 'Molduras de avatar', text: 'Molduras exclusivas para o seu perfil.', color: 'lilac' },
  { icon: 'bar_chart', title: 'Destaque no VYBE Social', text: 'Mais visibilidade e descoberta.', color: 'lilac' },
  { icon: 'tag', title: 'Prioridade no VYBE Echo', text: 'Mais relevância moderada em Trends e descoberta.', color: 'gold' },
  { icon: 'favorite', title: 'Destaque no VYBE Match', text: 'Mais chances de ser descoberto.', color: 'coral' },
  { icon: 'auto_awesome', title: 'Benefícios exclusivos futuros', text: 'Novas vantagens e personalizações em breve.', color: 'gold' },
];

function BenefitsPage({ tenant, character, onLogout }: { tenant: TenantInfo | null; character: SocialCharacter; onLogout: () => void }) {
  const [data, setData] = useState<BenefitsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);
  const [requestModal, setRequestModal] = useState<'confirm' | 'success' | null>(null);
  const [isGift, setIsGift] = useState(false);
  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [beneficiaries, setBeneficiaries] = useState<VerificationBeneficiary[]>([]);
  const [beneficiariesLoading, setBeneficiariesLoading] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<VerificationBeneficiary | null>(null);
  const [confirmedRecipient, setConfirmedRecipient] = useState(false);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<HomeNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [allNotificationsOpen, setAllNotificationsOpen] = useState(false);
  const [allNotifications, setAllNotifications] = useState<HomeNotification[]>([]);
  async function load() {
    setError('');
    try { setData(await apiRequest<BenefitsStatus>('/api/verification/status')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o VYBE+.'); }
  }
  useEffect(() => {
    if (window.location.pathname === '/beneficios-vybe') window.history.replaceState({}, '', '/vybe-plus' + window.location.search + window.location.hash);
    void load();
  }, []);
  useEffect(() => {
    const query = beneficiarySearch.trim().replace(/^@/, '');
    if (requestModal !== 'confirm' || !isGift || query.length < 2 || selectedBeneficiary) { setBeneficiaries([]); setBeneficiariesLoading(false); return; }
    const timer = window.setTimeout(() => {
      setBeneficiariesLoading(true);
      void apiRequest<VerificationBeneficiary[]>(`/api/verification/beneficiaries?q=${encodeURIComponent(query)}`)
        .then(setBeneficiaries)
        .catch(() => setBeneficiaries([]))
        .finally(() => setBeneficiariesLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [requestModal, isGift, beneficiarySearch, selectedBeneficiary]);
  function beginRequest() {
    setError(''); setIsGift(false); setBeneficiarySearch(''); setBeneficiaries([]); setSelectedBeneficiary(null); setConfirmedRecipient(false); setRequestModal('confirm');
  }
  async function requestVerification() {
    setBusy(true); setError('');
    try {
      await apiRequest('/api/verification/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isGift, ...(isGift ? { beneficiaryProfileId: selectedBeneficiary?.id } : {}) }) });
      await load();
      setRequestModal('success');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir sua solicitação. Tente novamente ou fale com o suporte.'); }
    finally { setBusy(false); }
  }
  async function uploadPaymentProof(file?: File) {
    if (!file || !data?.request) return;
    if (file.size > 5 * 1024 * 1024) { setError('O comprovante deve ter até 5 MB.'); return; }
    setProofBusy(true); setError('');
    try {
      const dataUrl = await fileAsDataUrl(file);
      await apiRequest(`/api/verification/requests/${encodeURIComponent(data.request.id)}/proof`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o comprovante.'); }
    finally { setProofBusy(false); }
  }
  async function copyPixKey() {
    if (!data?.payment?.pixKey) return;
    try { await navigator.clipboard.writeText(data.payment.pixKey); setPixCopied(true); window.setTimeout(() => setPixCopied(false), 2200); }
    catch { setError('Não foi possível copiar a chave PIX. Selecione e copie a chave manualmente.'); }
  }
  async function openSupportConversation(requestId?: string) {
    const query = new URLSearchParams({ category: 'VYBE_PLUS' });
    if (requestId) query.set('verificationRequestId', requestId);
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    sessionStorage.setItem('vybe_help_return_to', returnTo);
    query.set('returnTo', returnTo);
    window.location.assign(`/ajuda?${query.toString()}`);
  }
  async function toggleNotifications() {
    const nextOpen = !notificationsOpen;
    setNotificationsOpen(nextOpen);
    if (nextOpen && notifications.length === 0) {
      setNotificationsLoading(true);
      try { setNotifications(await apiRequest<HomeNotification[]>('/api/notifications?limit=4')); }
      catch { setNotifications([]); }
      finally { setNotificationsLoading(false); }
    }
  }
  async function showAllNotifications() {
    setNotificationsOpen(false);
    setAllNotificationsOpen(true);
    setNotificationsLoading(true);
    try {
      const items = await apiRequest<HomeNotification[]>('/api/notifications');
      setAllNotifications(items);
      setNotifications(items.slice(0, 4));
      await apiRequest('/api/notifications/read', { method: 'PATCH' });
    } catch { setAllNotifications([]); }
    finally { setNotificationsLoading(false); }
  }
  const price = data ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: data.currency }).format(data.amount) : '';
  const requestStatus = data?.request?.status;
  const active = data?.verification.active === true;
  const suspended = data?.verification.status === 'SUSPENDED' || requestStatus === 'SUSPENDED';
  const revoked = data?.verification.status === 'REVOKED' || requestStatus === 'REVOKED';
  const awaitingPayment = requestStatus === 'AWAITING_PAYMENT';
  const proofSent = requestStatus === 'PAYMENT_PROOF_SENT';
  const paymentIssue = requestStatus === 'PAYMENT_ISSUE';
  const paymentConfirmed = requestStatus === 'PAID';
  const submitted = ['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE'].includes(requestStatus ?? '');
  const rejected = requestStatus === 'REJECTED';
  const statusTitle = active ? 'VYBE Verificado ativo' : suspended ? 'Verificação suspensa' : revoked ? 'Verificação revogada' : proofSent ? 'Comprovante enviado' : paymentIssue ? 'Problema no pagamento' : awaitingPayment ? 'Aguardando pagamento' : paymentConfirmed ? 'Pagamento confirmado' : submitted ? 'Solicitação enviada' : rejected ? 'Solicitação recusada' : 'Ainda não verificado';
  const statusDescription = active ? 'Seus benefícios estão ativos nesta comunidade.' : suspended ? 'Seu VYBE Verificado está temporariamente suspenso. Fale com o suporte para mais informações.' : revoked ? 'O VYBE Verificado não está ativo nesta comunidade. Fale com o suporte para receber orientação.' : proofSent ? 'Seu comprovante está sendo analisado pela equipe VYBE.' : paymentIssue ? 'Não conseguimos confirmar seu pagamento. Confira o comprovante ou fale com o VYBE Suporte.' : awaitingPayment ? 'Sua solicitação foi recebida. Faça o PIX e envie o comprovante para análise.' : paymentConfirmed ? 'Recebemos a confirmação do pagamento. Aguarde a ativação pela equipe VYBE.' : submitted ? 'Recebemos sua solicitação. Status: ' + (data?.request?.statusLabel ?? 'Aguardando atendimento') + '.' : rejected ? (data?.request?.rejectionReason || 'Sua solicitação foi recusada. Fale com o suporte se precisar de ajuda.') : 'Torne-se VYBE Verificado e aproveite todos os benefícios.';
  const statusIcon = active ? 'verified' : suspended ? 'pause_circle' : revoked || rejected || paymentIssue ? 'info' : awaitingPayment || proofSent || paymentConfirmed || submitted ? 'schedule' : 'check_circle';
  const showRequestButton = !active && !suspended && !awaitingPayment && !paymentConfirmed && !submitted;
  const communityName = data?.community || tenant?.name || 'Sua comunidade';
  const heroStyle = tenant?.coverUrl ? { backgroundImage: 'linear-gradient(90deg, #fff8ef 0%, #fff8efe8 37%, #fff8ef65 68%, #17494b26 100%), url("' + tenant.coverUrl + '")' } : undefined;

  return <main className="vybe-plus-page">
    <header className="vybe-plus-global-header">
      <Logo/><span className="home-topbar-divider"/>
      <details className="home-community-menu vybe-plus-community-menu"><summary><span className="home-community-mark">{tenant?.logoUrl ? <img src={tenant.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span><strong>{tenant?.name ?? 'Sua comunidade'}</strong><MaterialIcon name="expand_more"/></summary><div><a href="/comunidades">Trocar de universo</a></div></details>
      <div className="home-topbar-spacer"/>
      <nav className="vybe-plus-global-nav" aria-label="Navegação principal">
        <a href="/"><MaterialIcon name="home"/><span>Início</span></a>
        <details className="vybe-plus-app-menu"><summary><MaterialIcon name="apps"/><span>Apps</span></summary><div><a href="/feed">VYBE Social</a><a href="/echo">VYBE Echo</a><a href="/match">VYBE Match</a><a href="/mensagens">Mensagens</a><a href="/eventos">Eventos</a></div></details>
        <div className="vybe-plus-notification-menu"><button type="button" aria-label="Abrir notificações" aria-expanded={notificationsOpen} onClick={() => void toggleNotifications()}><MaterialIcon name="notifications"/><span>Notificações</span>{notifications.some((item) => !item.readAt) && <i aria-label="Notificações não lidas"/>}</button>{notificationsOpen && <section className="vybe-plus-notification-popover" aria-label="Notificações recentes"><header><strong>Notificações</strong><button type="button" aria-label="Fechar notificações" onClick={() => setNotificationsOpen(false)}><MaterialIcon name="close"/></button></header>{notificationsLoading ? <p className="vybe-plus-notification-empty">Carregando notificações…</p> : notifications.length ? notifications.map((item) => <a href={homeNotificationHref(item)} key={item.id} onClick={() => { setNotificationsOpen(false); if (item.type === 'community_creation_update' && item.status === 'APPROVED' && item.communitySlug) activateLocalCommunity(item.communitySlug); }}><span className="vybe-plus-notification-icon"><MaterialIcon name={homeNotificationIcon(item)}/></span><span><strong>{homeNotificationMessage(item)}</strong><small>{item.type === 'community_creation_update' && item.status === 'APPROVED' ? 'Acessar minha comunidade →' : `há ${relativeTime(item.createdAt)}`}</small></span></a>) : <p className="vybe-plus-notification-empty">Você está em dia com as notificações.</p>}<button className="vybe-plus-notification-all" type="button" onClick={() => void showAllNotifications()}>Ver todas as notificações</button></section>}</div>
      </nav>
      <details className="vybe-plus-profile-menu"><summary aria-label="Abrir menu do perfil"><Avatar character={character}/><MaterialIcon name="expand_more"/></summary><div><a href={`/@${character.username}`}>Perfil</a><a href="/vybe-plus">VYBE+</a><a href="/comunidades">Meus universos</a><button type="button" onClick={onLogout}>Sair</button></div></details>
    </header>
    {allNotificationsOpen && <div className="vybe-plus-all-notifications-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAllNotificationsOpen(false); }}><section className="vybe-plus-all-notifications" role="dialog" aria-modal="true" aria-label="Todas as notificações"><header><h2>Notificações</h2><button type="button" aria-label="Fechar notificações" onClick={() => setAllNotificationsOpen(false)}><MaterialIcon name="close"/></button></header><div>{notificationsLoading ? <p className="vybe-plus-notification-empty">Carregando notificações…</p> : allNotifications.map((item) => <a href={homeNotificationHref(item)} key={item.id} onClick={() => setAllNotificationsOpen(false)}><span className="vybe-plus-notification-icon"><MaterialIcon name={homeNotificationIcon(item)}/></span><span><strong>{homeNotificationMessage(item)}</strong><small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small></span><MaterialIcon name="chevron_right"/></a>)}{!notificationsLoading && allNotifications.length === 0 && <p className="vybe-plus-notification-empty">Nenhuma notificação por enquanto.</p>}</div></section></div>}
    <header className="vybe-plus-hero" style={heroStyle}>
      <div><span className="vybe-plus-wordmark">VYBE<span>+</span></span><p>Recursos exclusivos para deixar sua experiência ainda mais completa.</p><i aria-hidden="true"/></div>
    </header>
    <div className="vybe-plus-community"><span>{tenant?.logoUrl ? <img src={tenant.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}<span>Benefícios para: <strong>{communityName}</strong></span></span><i aria-hidden="true"/><small><MaterialIcon name="info"/>A verificação é válida apenas nesta comunidade.</small></div>
    {error && data && <p className="inline-error" role="alert">{error}</p>}
    {!data ? error ? <section className="vybe-plus-loading vybe-plus-load-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Tentar novamente</button></section> : <section className="vybe-plus-loading">Carregando VYBE+…</section> : <>
      <div className="vybe-plus-layout">
        <div className="vybe-plus-main">
          <section className="vybe-plus-product">
            <div className="vybe-plus-product-art" aria-hidden="true"><div><MaterialIcon name="verified"/></div><i/><b>✦</b><em>✦</em></div>
            <div className="vybe-plus-product-content">
              <span className="vybe-plus-pill">VYBE+</span>
              <h1>VYBE Verificado <i>✦</i></h1>
              <p>Destaque sua identidade e desbloqueie benefícios exclusivos em {communityName}.</p>
              <div className="vybe-plus-price"><strong>{price}</strong><span>Pagamento único</span></div>
              <div className="vybe-plus-actions">
                {active ? <a className="vybe-plus-primary" href="/vybe-plus/gerenciar"><MaterialIcon name="auto_awesome"/>Gerenciar benefícios</a>
                  : showRequestButton ? <button className="vybe-plus-primary" type="button" disabled={busy} onClick={beginRequest}><MaterialIcon name="auto_awesome"/>Quero ser verificado</button>
                    : submitted || awaitingPayment || paymentConfirmed ? <button className="vybe-plus-primary" type="button" onClick={() => void openSupportConversation(data.request?.id)}><MaterialIcon name="chat_bubble"/>Falar sobre a solicitação</button>
                      : null}
                <button className="vybe-plus-secondary" type="button" onClick={() => void openSupportConversation()}><MaterialIcon name="chat_bubble"/>Falar com o suporte</button>
              </div>
            </div>
          </section>
          {data.request && !active && ['PENDING', 'CONTACTED', 'AWAITING_PAYMENT', 'PAYMENT_PROOF_SENT', 'PAYMENT_ISSUE', 'PAID'].includes(data.request.status) && <section className="vybe-plus-payment-card" aria-labelledby="vybe-plus-payment-title">
            <div className="vybe-plus-payment-heading"><div><span>PAGAMENTO</span><h2 id="vybe-plus-payment-title">Pague via PIX</h2><p>O comprovante será analisado manualmente pela equipe VYBE.</p></div><strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: data.currency }).format(data.amount)}</strong></div>
            <dl><div><dt>Solicitação</dt><dd>#{data.request.id}</dd></div><div><dt>Comunidade</dt><dd>{communityName}</dd></div><div><dt>Beneficiário</dt><dd>@{data.request.beneficiary?.username ?? data.username}</dd></div><div><dt>Tipo</dt><dd>{data.request.isGift ? 'Presente' : 'Para mim'}</dd></div></dl>
            {data.payment ? <div className="vybe-plus-pix-details"><div><label>{data.payment.pixKeyType === 'PIX_COPY_PASTE' ? 'PIX Copia e Cola' : 'Chave PIX'} <small>({data.payment.pixKeyType === 'PIX_COPY_PASTE' ? 'código para copiar no app do banco' : data.payment.pixKeyType.replace('_', ' ')})</small></label><div><code>{data.payment.pixKey}</code><button type="button" onClick={() => void copyPixKey()}><MaterialIcon name={pixCopied ? 'check' : 'content_copy'}/>{pixCopied ? 'Código PIX copiado.' : 'Copiar código PIX'}</button></div><small>Recebedor: {data.payment.recipientName}</small></div></div> : <p className="vybe-plus-pix-unconfigured">As instruções PIX ainda não estão disponíveis. Fale com o VYBE Suporte para receber ajuda.</p>}
            {data.request.status === 'PAYMENT_PROOF_SENT' ? <p className="vybe-plus-proof-received"><MaterialIcon name="check_circle"/><span><strong>Comprovante enviado ✓</strong><small>Seu pagamento está sendo analisado pela equipe VYBE.</small></span></p> : data.request.status === 'PAYMENT_ISSUE' ? <p className="vybe-plus-payment-issue">Não conseguimos confirmar seu pagamento. Confira o comprovante ou fale com o VYBE Suporte; você pode enviar outro comprovante.</p> : <p className="vybe-plus-proof-instruction"><strong>Já fez o pagamento?</strong><span>Envie o comprovante para que a equipe VYBE possa confirmar sua solicitação.</span></p>}
            {(data.request.paymentProofs ?? []).map((proof, index) => <a className="vybe-plus-proof-link" key={proof.id} href={`/api/verification/requests/${encodeURIComponent(data.request!.id)}/proofs/${encodeURIComponent(proof.id)}`} target="_blank" rel="noreferrer">Comprovante {index + 1} · {proof.mimeType === 'application/pdf' ? 'PDF' : 'Imagem'} · {new Date(proof.uploadedAt).toLocaleString('pt-BR')}</a>)}
            {(['PENDING', 'CONTACTED', 'AWAITING_PAYMENT'].includes(data.request.status) || paymentIssue) && <label className="vybe-plus-proof-upload"><input type="file" accept="image/png,image/jpeg,.jpg,.jpeg,.png,application/pdf,.pdf" disabled={proofBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void uploadPaymentProof(file); }}/><MaterialIcon name="upload_file"/>{proofBusy ? 'Enviando comprovante…' : paymentIssue ? 'Enviar novo comprovante' : 'Enviar comprovante'}</label>}
          </section>}
          <section className="vybe-plus-benefits"><h2>Seus benefícios</h2><div>{vybePlusBenefits.map((benefit) => <article key={benefit.title}><span className={'vybe-plus-benefit-icon is-' + benefit.color}><MaterialIcon name={benefit.icon}/></span><div><strong>{benefit.title}</strong><small>{benefit.text}</small></div></article>)}</div></section>
        </div>
        <aside className="vybe-plus-aside">
          <section className="vybe-plus-status"><h2>Seu status nesta comunidade</h2><div className={'vybe-plus-status-state' + (active ? ' is-active' : suspended ? ' is-suspended' : '')}><MaterialIcon name={statusIcon}/><div><strong>{statusTitle}{active && ' ✓'}</strong><p>{statusDescription}</p></div></div></section>
          <section className="vybe-plus-important"><MaterialIcon name="auto_awesome"/><div><strong>Importante</strong><p>O VYBE Verificado é por comunidade. Se você também participa de outros universos, poderá adquiri-lo em cada um deles.</p></div></section>
          <section className="vybe-plus-apps" id="vybe-plus-apps"><h2>Onde seus benefícios valem</h2><p>O VYBE Verificado ativa vantagens em todos os apps do seu universo:</p><div>{[['forum','VYBE Social','social'],['graphic_eq','VYBE Echo','echo'],['favorite','VYBE Match','match']].map(([icon,name,color]) => <article className={'is-' + color} key={name}><span><MaterialIcon name={icon}/></span><strong>{name}</strong><small>{active ? 'Ativo ✓' : 'Disponível com VYBE+'}</small></article>)}</div></section>
        </aside>
      </div>
    </>}
    {requestModal && <div className="vybe-plus-request-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRequestModal(null); }}><section className="vybe-plus-request-modal" role="dialog" aria-modal="true" aria-labelledby="vybe-plus-request-title"><button className="vybe-plus-request-close" type="button" aria-label="Fechar" disabled={busy} onClick={() => setRequestModal(null)}><MaterialIcon name="close"/></button>{requestModal === 'confirm' ? <>
      <span className="vybe-plus-pill">VYBE+</span><h2 id="vybe-plus-request-title">Solicitar VYBE Verificado <i>✦</i></h2>
      <div className="vybe-plus-request-community"><span>{tenant?.logoUrl ? <img src={tenant.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span><div><small>Você está adquirindo o VYBE Verificado nesta comunidade:</small><strong>{communityName}</strong><em>O benefício será válido somente nesta comunidade.</em></div></div>
      <fieldset className="vybe-plus-recipient-choice"><legend>Para quem é o VYBE Verificado?</legend><label><input type="radio" name="verification-recipient" checked={!isGift} onChange={() => { setIsGift(false); setSelectedBeneficiary(null); setConfirmedRecipient(false); }}/>Para mim</label><label><input type="radio" name="verification-recipient" checked={isGift} onChange={() => { setIsGift(true); setSelectedBeneficiary(null); setBeneficiarySearch(''); setConfirmedRecipient(false); }}/>Presentear outra pessoa</label></fieldset>
      {!isGift ? <section className="vybe-plus-beneficiary-preview"><strong>Perfil que receberá o benefício</strong><div><span>{character.avatarUrl ? <img src={character.avatarUrl} alt=""/> : <MaterialIcon name="person"/>}</span><p><b>{character.displayName}</b><small>@{character.username}</small></p></div></section> : <section className="vybe-plus-gift-search"><label htmlFor="vybe-plus-beneficiary-search">Quem você quer presentear?</label>{selectedBeneficiary ? <div className="vybe-plus-beneficiary-preview is-selected"><strong>Você está presenteando</strong><div><span>{selectedBeneficiary.avatarUrl ? <img src={selectedBeneficiary.avatarUrl} alt=""/> : <MaterialIcon name="person"/>}</span><p><b>{selectedBeneficiary.displayName}</b><small>@{selectedBeneficiary.username}</small></p><button type="button" onClick={() => { setSelectedBeneficiary(null); setBeneficiarySearch(''); setConfirmedRecipient(false); }}>Trocar</button></div></div> : <><input id="vybe-plus-beneficiary-search" value={beneficiarySearch} onChange={(event) => setBeneficiarySearch(event.currentTarget.value)} placeholder="Buscar por nome ou @username" autoComplete="off"/><small>Resultados somente de perfis desta comunidade.</small>{beneficiariesLoading && <p className="vybe-plus-beneficiary-empty">Buscando perfis…</p>}{!beneficiariesLoading && beneficiarySearch.trim().replace(/^@/, '').length >= 2 && <div className="vybe-plus-beneficiary-results">{beneficiaries.map((candidate) => <button type="button" key={candidate.id} disabled={candidate.verified || candidate.hasActiveRequest} onClick={() => { setSelectedBeneficiary(candidate); setConfirmedRecipient(false); }}><span>{candidate.avatarUrl ? <img src={candidate.avatarUrl} alt=""/> : <MaterialIcon name="person"/>}</span><span><b>{candidate.displayName}</b><small>@{candidate.username}</small></span><em>{candidate.verified ? 'Já verificado' : candidate.hasActiveRequest ? 'Solicitação ativa' : 'Selecionar'}</em></button>)}{beneficiaries.length === 0 && <p className="vybe-plus-beneficiary-empty">Nenhum perfil encontrado nesta comunidade.</p>}</div>}</>}</section>}
      <div className="vybe-plus-request-price"><span>Preço</span><strong>{price}</strong><em>Pagamento único</em></div>
      <aside className="vybe-plus-request-important"><strong>Importante</strong><span>{isGift ? 'O VYBE Verificado será ativado no perfil selecionado desta comunidade.' : 'O VYBE Verificado será ativado no seu perfil desta comunidade.'}</span><span>Após a ativação, o benefício não poderá ser transferido para outro perfil ou outra comunidade.</span></aside>
      <label className="vybe-plus-request-confirm"><input type="checkbox" checked={confirmedRecipient} onChange={(event) => setConfirmedRecipient(event.currentTarget.checked)}/><span>{isGift ? 'Confirmo que selecionei corretamente o perfil que receberá o benefício.' : 'Confirmo que estou solicitando o VYBE Verificado para o meu perfil nesta comunidade.'}</span></label>
      {error && <p className="vybe-plus-request-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={() => setRequestModal(null)}>Cancelar</button><button className="is-primary" type="button" disabled={busy || !confirmedRecipient || (isGift && !selectedBeneficiary)} onClick={() => void requestVerification()}>{busy ? 'Enviando…' : 'Enviar solicitação'}</button></footer>
    </> : <><span className="vybe-plus-request-success-mark">✦</span><h2 id="vybe-plus-request-title">Solicitação enviada ✦</h2><p>{isGift ? <>A equipe VYBE recebeu seu pedido para presentear <strong>{selectedBeneficiary?.displayName ?? 'o perfil selecionado'}</strong> com VYBE Verificado em <strong>{communityName}</strong>.</> : <>A equipe VYBE recebeu seu pedido de VYBE Verificado para <strong>{communityName}</strong>.</>}</p><p>Você pode continuar o atendimento pelo VYBE Suporte.</p><footer><button type="button" disabled={busy} onClick={() => setRequestModal(null)}>Fechar</button><button className="is-primary" type="button" disabled={busy} onClick={() => void openSupportConversation(data?.request?.id)}>Abrir atendimento</button></footer></>}</section></div>}
  </main>;
}

function ManageVybePlusPage({ tenant }: { tenant: TenantInfo | null }) {
  const [data, setData] = useState<BenefitsStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void apiRequest<BenefitsStatus>('/api/verification/status').then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seus benefícios.')); }, []);
  function contactSupport() {
    const query = new URLSearchParams({ category: 'VYBE_PLUS' });
    if (data?.request?.id) query.set('verificationRequestId', data.request.id);
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    sessionStorage.setItem('vybe_help_return_to', returnTo);
    query.set('returnTo', returnTo);
    window.location.assign(`/ajuda?${query.toString()}`);
  }
  const sourceLabels: Record<string, string> = { SELF_PURCHASE: 'Compra própria', GIFT: 'Presente', GIVEAWAY: 'Sorteio', PROMOTION: 'Promoção', ADMIN_GRANT: 'Concedido pela equipe VYBE' };
  const retry = () => { setError(''); void apiRequest<BenefitsStatus>('/api/verification/status').then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seus benefícios.')); };
  const source = data?.verification.source ?? (data?.request?.isGift ? 'GIFT' : null);
  return <main className="vybe-plus-manage-page">
    <nav className="vybe-plus-manage-breadcrumb" aria-label="Navegação VYBE+"><a href="/vybe-plus">← Voltar para o VYBE+</a><span>VYBE+ <b>/</b> Gerenciar benefícios</span></nav>
    <header className="vybe-plus-manage-heading"><span>ÁREA PREMIUM</span><h1>Seu VYBE+</h1><p>Gerencie os benefícios ativos nos seus aplicativos.</p></header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!data ? <section className="vybe-plus-manage-empty">{error ? <><p>{error}</p><button type="button" onClick={retry}>Tentar novamente</button></> : 'Carregando seus benefícios…'}</section> : !data.verification.active ? <section className="vybe-plus-manage-empty"><MaterialIcon name="verified_user"/><strong>VYBE Verificado não está ativo neste perfil</strong><p>Acompanhe sua solicitação ou conheça o benefício VYBE+.</p><a className="vybe-plus-manage-cta" href="/vybe-plus">Ver status da solicitação <MaterialIcon name="arrow_forward"/></a></section> : <div className="vybe-plus-manage-layout">
      <div className="vybe-plus-manage-primary">
        <section className="vybe-plus-manage-status"><div className="vybe-plus-manage-status-icon"><MaterialIcon name="verified"/></div><div><small>VYBE Verificado</small><h2>Ativo <span>✓</span></h2><p>Benefícios liberados para seu perfil nesta comunidade.</p></div><dl><div><dt>Ativado em</dt><dd>{data.verification.activatedAt ? new Date(data.verification.activatedAt).toLocaleDateString('pt-BR') : 'Ativação confirmada'}</dd></div><div><dt>Origem do benefício</dt><dd>{source ? sourceLabels[source] ?? source : 'Não informada'}</dd></div></dl></section>
        {source === 'GIFT' && <p className="vybe-plus-manage-gift"><MaterialIcon name="card_giftcard"/>Você recebeu este VYBE Verificado como presente.</p>}
        <section className="vybe-plus-manage-apps"><header><span>VANTAGENS ATIVAS</span><h2>Benefícios por aplicativo</h2><p>Seus benefícios estão ativos nos apps disponíveis nesta comunidade.</p></header><div>{[
          { name: 'VYBE Social', icon: 'forum', href: '/feed', personalize: '/personalizacao-vybe-verificado?app=social', description: 'Selo verificado, personalização do perfil e destaque nas descobertas.' },
          { name: 'VYBE Echo', icon: 'graphic_eq', href: '/echo', personalize: '/personalizacao-vybe-verificado?app=echo', description: 'Selo verificado e mais relevância em Trends e descoberta.' },
          { name: 'VYBE Match', icon: 'favorite', href: '/match', personalize: '/match/perfil?personalizar=match', description: 'Selo verificado e destaque para seu perfil no Match.' },
        ].map((app) => <article key={app.name}><span><MaterialIcon name={app.icon}/></span><div><h3>{app.name}</h3><p>{app.description}</p><strong>ACTIVE <i>✓</i></strong><a href={app.href}>Abrir aplicativo <MaterialIcon name="arrow_forward"/></a><a href={app.personalize}>Personalizar {app.name.replace('VYBE ', '')} <MaterialIcon name="arrow_forward"/></a></div></article>)}</div></section>
      </div>
      <aside className="vybe-plus-manage-secondary">
        <section className="vybe-plus-manage-community"><span>{(data.communityLogoUrl || tenant?.logoUrl) ? <img src={data.communityLogoUrl || tenant?.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span><div><small>COMUNIDADE</small><strong>{data.community || tenant?.name || 'Sua comunidade'}</strong><em>Benefício válido neste universo</em></div></section>
        <section className="vybe-plus-manage-history"><header><MaterialIcon name="history"/><h2>Histórico resumido</h2></header><ol>{data.request?.createdAt && <li><i/><span><strong>Solicitação recebida</strong><small>{new Date(data.request.createdAt).toLocaleString('pt-BR')}</small></span></li>}<li><i/><span><strong>{source === 'GIFT' ? 'Benefício recebido' : 'VYBE Verificado ativado'}</strong><small>{data.verification.activatedAt ? new Date(data.verification.activatedAt).toLocaleString('pt-BR') : 'Ativo nesta comunidade'}</small></span></li></ol></section>
        <section className="vybe-plus-manage-support"><div><MaterialIcon name="chat_bubble"/><span><strong>Precisa de ajuda?</strong><small>Fale com a equipe oficial do VYBE.</small></span></div><button type="button" onClick={contactSupport}>Falar com o suporte</button></section>
      </aside>
    </div>}
  </main>;
}

function useFallbackImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.visibility = 'hidden';
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem.'));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function cropAvatarImage(source: string, crop: { x: number; y: number; zoom: number }) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 512;
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * crop.zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) { reject(new Error('Não foi possível preparar o recorte da foto.')); return; }
      context.drawImage(image, (size - width) * crop.x, (size - height) * crop.y, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    image.onerror = () => reject(new Error('Não foi possível abrir a foto para ajustar o recorte.'));
    image.src = source;
  });
}

function Logo() {
  return <a className="social-logo" href="/" aria-label="VYBE"><VybeLogo variant="symbol"/><span>VYBE</span></a>;
}

function NavIcon({ name }: { name: 'home' | 'explore' | 'trend' | 'community' | 'notifications' | 'messages' | 'conversations' | 'profile' | 'pulse' | 'create' | 'event' }) {
  if (name === 'trend') return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2.5c3.5 2.1 5.6 5.9 5.6 10v2l2.1 2.1v1.1h-5l-2.7 3-2.7-3h-5v-1.1l2.1-2.1v-2c0-4.1 2.1-7.9 5.6-10Z"/><circle cx="12" cy="9" r="1.7"/><path d="m8.1 18-1 3 3.4-1.3M15.9 18l1 3-3.4-1.3"/></svg>;
  const names = { home: 'home', explore: 'explore', community: 'groups', notifications: 'notifications', messages: 'mail', conversations: 'forum', profile: 'person', pulse: 'edit_note', create: 'add_box', event: 'calendar_month' } as const;
  return <MaterialIcon name={names[name]} className="nav-icon"/>;
}

function SidebarItem({ href, icon, label, active = false, unread = false, onClick, className = '' }: { href?: string; icon: ReactNode; label: string; active?: boolean; unread?: boolean; onClick?: () => void; className?: string }) {
  const activeForeground = active ? { color: '#fff' } : undefined;
  const content = <><span className="sidebar-item-icon" style={activeForeground}>{icon}{unread && <i className="sidebar-unread-dot" aria-label="Mensagens não lidas"/>}</span><span className="sidebar-item-label" style={activeForeground}>{label}</span></>;
  return href ? <a className={`sidebar-item ${active ? 'active' : ''} ${className}`} href={href} title={label} style={activeForeground}>{content}</a>
    : <button className={`sidebar-item ${className}`} type="button" onClick={onClick} title={label}>{content}</button>;
}

function AppSidebar({ character, tenant, onCreate, echo = false, hideCommunity = false }: { character: SocialCharacter; tenant: TenantInfo | null; onCreate: () => void; echo?: boolean; hideCommunity?: boolean }) {
  const currentPath = window.location.pathname;
  const profilePath = `/@${character.username}`;
  const customizationHref = `/personalizacao-vybe-verificado${echo ? '?app=echo' : ''}`;
  if (echo) return <aside className="social-sidebar echo-sidebar">
    <div className="sidebar-brand-row"><Logo/></div><div className="echo-brand"><MaterialIcon name="graphic_eq"/><strong>VYBE ECHO</strong></div>
    <nav aria-label="Navegação do Echo" className="social-nav">
      <SidebarItem href="/echo" icon={<NavIcon name="home"/>} label="Início" active={currentPath === '/echo'}/>
      <SidebarItem href="/echo/explorar" icon={<NavIcon name="explore"/>} label="Explorar" active={currentPath.startsWith('/echo/explorar')}/>
      <SidebarItem href="/echo/notificacoes" icon={<NavIcon name="notifications"/>} label="Notificações" active={currentPath === '/echo/notificacoes'}/>
      <SidebarItem href={`/echo/perfil`} icon={<NavIcon name="profile"/>} label="Perfil" active={currentPath === '/echo/perfil'}/>
      <SidebarItem href={customizationHref} icon={<MaterialIcon name="palette"/>} label="Personalização VYBE+" active={currentPath === '/personalizacao-vybe-verificado'}/>
    </nav>
    <UniverseBackLink className="social-universe-back"/>
  </aside>;
  return <aside className="social-sidebar">
    <div className="sidebar-brand-row"><Logo/></div>
    {!hideCommunity && <div className="community-switcher"><span className="community-badge-mark"><MaterialIcon name="groups"/></span><span className="community-badge-copy"><strong>{tenant?.name ?? 'Sua comunidade'}</strong></span></div>}
    <nav aria-label="Menu da comunidade" className="social-nav">
      <SidebarItem href="/feed" icon={<NavIcon name="home"/>} label="Início" active={currentPath === '/feed' || currentPath === '/'} />
      <SidebarItem href="/explorar" icon={<NavIcon name="trend"/>} label="Trend" active={currentPath === '/explorar'} />
      <SidebarItem icon={<NavIcon name="create"/>} label="Criar" onClick={onCreate} className="sidebar-create"/>
      <SidebarItem href="/notificacoes" icon={<NavIcon name="notifications"/>} label="Notificações" active={currentPath === '/notificacoes'} />
      <SidebarItem href={profilePath} icon={<NavIcon name="profile"/>} label="Perfil" active={currentPath === profilePath} />
      <SidebarItem href="/personalizacao-vybe-verificado" icon={<MaterialIcon name="palette"/>} label="Personalização VYBE+" active={currentPath === '/personalizacao-vybe-verificado'} />
    </nav>
    <UniverseBackLink className="social-universe-back"/>
  </aside>;
}

function CustomizationPage({ character, tenant, app }: { character: SocialCharacter; tenant: TenantInfo | null; app: 'SOCIAL' | 'ECHO' }) {
  const [identity, setIdentity] = useState({ ...character, own: true });
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    if (app !== 'ECHO') { setIdentity({ ...character, own: true }); return; }
    void apiRequest<{ profile: SocialCharacter }>('/api/echo/profile').then((result) => setIdentity({ ...result.profile, own: true })).catch(() => setIdentity({ ...character, own: true }));
  }, [app, character]);
  useEffect(() => {
    let current = true;
    void apiRequest<{ verification: { active: boolean } }>('/api/verification/status')
      .then((result) => { if (current) setVerified(result.verification.active); })
      .catch(() => { if (current) setVerified(Boolean(character.verified)); });
    return () => { current = false; };
  }, [character.id, character.verified]);
  const communityContext = tenant?.subdomain ?? tenant?.slug;
  const upgradeHref = `/vybe-plus${communityContext ? `?community=${encodeURIComponent(communityContext)}` : ''}`;
  const preview: SocialCharacter = { ...identity, displayName: identity.displayName || 'Seu nome', username: identity.username || 'seuusuario', profileCustomization: { nameColor: '#9B70D6', primaryFontId: 'playfair-display', secondaryFontId: 'lora', avatarFrame: 'lilac', profileTheme: '#F1E9FA' } };
  return <section className="customization-page">
    <header className="customization-page-heading"><span><MaterialIcon name="auto_awesome"/> VYBE VERIFICADO</span><h1>Personalização VYBE Verificado</h1><p>Dê ainda mais personalidade ao seu perfil.</p></header>
    {verified === null ? <div className="customization-premium-card" role="status">Verificando o status do VYBE Verificado…</div> : verified ? <VerifiedCustomizationPanel key={`${app}-${identity.id}`} character={{ ...identity, own: true, verified: true }} app={app} communityId={tenant?.id ?? ''} openByDefault/> : <>
      <section className="customization-premium-card"><div className="customization-lock-mark"><MaterialIcon name="verified"/></div><div><h2>Desbloqueie um perfil com a sua identidade</h2><p>Com o VYBE Verificado você pode personalizar seu perfil neste universo.</p></div><a href={upgradeHref} onClick={() => { if (communityContext) activateLocalCommunity(communityContext); }} className="customization-upgrade-button">Tornar-se verificado <MaterialIcon name="arrow_forward"/></a></section>
      <div className="customization-preview-layout"><section className="customization-preview-card"><div className="customization-preview-top"><span>PRÉVIA DO PERFIL</span><MaterialIcon name="lock"/></div><div className="customization-sample-profile"><Avatar character={preview} className="large-avatar"/><div className="customization-sample-identity"><strong style={{ color: '#9B70D6', fontFamily: 'Georgia, serif' }}>{identity.displayName || 'Seu nome'}</strong><small>@{identity.username || 'seuusuario'}</small></div><p style={{ fontFamily: 'Georgia, serif' }}>Sua bio pode ter a sua personalidade também.</p></div></section><section className="customization-locked-controls"><h2>O que você pode personalizar</h2>{[['palette','Cor do nome'],['edit','Fonte principal'],['edit','Fonte secundária'],['image','Moldura do avatar'],['person','Personalização de nome'],['edit','Personalização de bio']].map(([icon,label])=><div className="customization-locked-row" key={label}><span className="customization-control-icon"><MaterialIcon name={icon}/></span><strong>{label}</strong><small><MaterialIcon name="lock"/> Disponível com VYBE Verificado</small></div>)}<p>Novos recursos específicos de cada app também poderão aparecer por aqui.</p></section></div>
    </>}
  </section>;
}

function Stories({ groups, current, onOpen, onCreate }: { groups: StoryGroup[]; current: SocialCharacter; onOpen: (group: StoryGroup) => void; onCreate: () => void }) {
  const ownStory = groups.find((group) => group.own);
  return <section className="social-panel stories-panel" aria-label="Stories"><div className="stories-row">
    <div className="story-own-control"><button className="story-item" type="button" onClick={() => ownStory && onOpen(ownStory)}><span className={`story-ring own-story ${ownStory ? 'has-story' : ''}`}><Avatar character={current}/></span><small>Seu story</small></button><button className="story-add-button" type="button" aria-label="Criar story" onClick={onCreate}><MaterialIcon name="add"/></button></div>
    {groups.filter((group) => !group.own).map((group) => <button className="story-item" type="button" key={group.character.id} onClick={() => onOpen(group)}><span className={`story-ring ${group.unseen ? 'is-unseen' : 'is-seen'}`}><Avatar character={group.character}/></span><small>{group.character.username}</small></button>)}
  </div></section>;
}

function StoryViewer({ group, groups, onClose }: { group: StoryGroup; groups: StoryGroup[]; onClose: () => void }) {
  const [groupIndex, setGroupIndex] = useState(() => Math.max(0, groups.findIndex((item) => item.character.id === group.character.id)));
  const [index, setIndex] = useState(0);
  const activeGroup = groups[groupIndex] ?? group;
  const story = activeGroup.stories[index];
  useEffect(() => { if (story) void apiRequest(`/api/stories/${story.id}/view`, { method: 'POST' }).catch(() => undefined); }, [story?.id]);
  if (!story) return null;
  const move = (step: number) => {
    const next = index + step;
    if (next >= 0 && next < activeGroup.stories.length) { setIndex(next); return; }
    const nextGroupIndex = groupIndex + step;
    const nextGroup = groups[nextGroupIndex];
    if (!nextGroup) { onClose(); return; }
    setGroupIndex(nextGroupIndex);
    setIndex(step > 0 ? 0 : Math.max(0, nextGroup.stories.length - 1));
  };
  const close = () => { window.dispatchEvent(new Event('vybe:refresh-stories')); onClose(); };
  return <div className="story-overlay" role="presentation" onClick={close}><section className="story-viewer story-viewer-real" role="dialog" aria-modal="true" aria-label={`Story de ${activeGroup.character.displayName}`} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); if (event.key === 'Escape') close(); }} onClick={(event) => event.stopPropagation()}><div className="story-progress">{activeGroup.stories.map((item, itemIndex) => <i className={itemIndex <= index ? 'is-active' : ''} key={item.id}/>)}</div><header><Avatar character={activeGroup.character}/><span><strong><VerifiedName character={activeGroup.character}>{activeGroup.character.displayName}</VerifiedName></strong><small>{relativeTime(story.createdAt)}</small></span><button type="button" aria-label="Fechar story" onClick={close}><MaterialIcon name="close"/></button></header><img src={story.imageUrl} alt={`Story de ${activeGroup.character.displayName}`}/><button className="story-prev" type="button" aria-label="Story anterior" onClick={() => move(-1)}><MaterialIcon name="chevron_left"/></button><button className="story-next" type="button" aria-label="Próximo story" onClick={() => move(1)}><MaterialIcon name="chevron_right"/></button></section></div>;
}

function Composer({ character, kind, onPosted }: { character: SocialCharacter; kind: 'post' | 'story'; onPosted: () => void }) {
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  async function selectImages(files: FileList | null) {
    if (!files?.length) return;
    const selected = [...files];
    if (kind === 'story' && selected.length > 1 || kind === 'post' && selected.length + images.length > 4) { setError(kind === 'story' ? 'Stories aceitam uma imagem por vez.' : 'Escolha até 4 imagens.'); return; }
    if (selected.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024)) { setError('Use imagens PNG, JPEG ou WebP de até 3 MB cada.'); return; }
    try { const loaded = await Promise.all(selected.map(fileAsDataUrl)); setImages((current) => [...current, ...loaded]); setError(''); }
    catch { setError('Não foi possível abrir uma das imagens.'); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!images.length) { setError(kind === 'story' ? 'Escolha uma imagem para o story.' : 'Escolha pelo menos uma imagem.'); return; }
    setPosting(true); setError('');
    try {
      await apiRequest(kind === 'story' ? '/api/stories' : '/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'story' ? { image: images[0] } : { content, images }) });
      setContent(''); setImages([]); onPosted();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Não foi possível publicar.'); }
    finally { setPosting(false); }
  }
  return <form className="social-panel composer" onSubmit={(event) => void submit(event)}>
    <div className="composer-identity"><Avatar character={character}/><span><strong>{character.displayName}</strong><small>@{character.username}</small></span></div>
    {kind === 'post' && <TextFormattingEditor value={content} onChange={setContent} maxLength={5000} placeholder="Escreva uma legenda..."/>}
    <input ref={imageInput} className="composer-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple={kind === 'post'} onChange={(event) => { void selectImages(event.currentTarget.files); event.currentTarget.value = ''; }}/>
    <button className="composer-upload" type="button" onClick={() => imageInput.current?.click()}><MaterialIcon name="add_a_photo"/><strong>{images.length ? 'Adicionar mais imagens' : 'Selecionar imagem'}</strong><small>{kind === 'story' ? 'Uma imagem · disponível por 24 horas' : '4:5 recomendado (1080 × 1350) · 3:4 (1080 × 1440) · quadrado (1080 × 1080)'}</small></button>
    {!!images.length && <div className={`composer-image-previews ${kind === 'story' ? 'composer-image-previews--story' : ''}`}>{images.map((image, index) => <figure key={`${index}-${image.slice(-12)}`}><img src={image} alt={`Prévia ${index + 1}`}/><button type="button" aria-label={`Remover imagem ${index + 1}`} onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}><MaterialIcon name="close"/></button></figure>)}</div>}
    {error && <p className="inline-error" role="alert">{error}</p>}<footer><span>{kind === 'story' ? 'Seu story desaparece após 24 horas.' : `${content.length}/5000`}</span><button className="primary-button" type="submit" disabled={posting || !images.length}>{posting ? 'Publicando…' : 'Publicar'}</button></footer>
  </form>;
}

type ComposerChoice = 'choose' | 'post' | 'story';
function ComposerModal({ character, choice, onChoose, onClose, onPosted }: { character: SocialCharacter; choice: ComposerChoice; onChoose: (choice: ComposerChoice) => void; onClose: () => void; onPosted: () => void }) {
  if (choice === 'choose') return <div className="composer-modal-backdrop" role="presentation" onClick={onClose}><section className="composer-modal-picker" role="dialog" aria-modal="true" aria-labelledby="create-title" onClick={(event) => event.stopPropagation()}>
    <header><div><span>CRIAR</span><h2 id="create-title">O que deseja compartilhar?</h2></div><button type="button" className="modal-x profile-edit-close" aria-label="Fechar sem salvar" title="Fechar sem salvar" onClick={onClose}><MaterialIcon name="close"/></button></header>
    <div className="create-choice-grid"><button type="button" onClick={() => onChoose('post')}><MaterialIcon name="image"/><strong>Publicação</strong><small>Uma ou mais imagens com legenda</small></button><button type="button" onClick={() => onChoose('story')}><MaterialIcon name="add_a_photo"/><strong>Story</strong><small>Um momento por 24 horas</small></button></div>
  </section></div>;
  return <div className="composer-modal-backdrop" role="presentation" onClick={onClose}><section className="composer-modal-editor" role="dialog" aria-modal="true" aria-labelledby="create-editor-title" onClick={(event) => event.stopPropagation()}><header><div><span>{choice === 'story' ? 'STORY' : 'FEED'}</span><h2 id="create-editor-title">{choice === 'story' ? 'Compartilhe um momento' : 'Nova publicação'}</h2></div><button type="button" className="modal-x" aria-label="Fechar" onClick={onClose}><MaterialIcon name="close"/></button></header><Composer character={character} kind={choice} onPosted={() => { onPosted(); onClose(); }}/></section></div>;
}

function PostCard({ post, onRefresh, onComments, onOpen, currentCharacter }: { post: SocialPost; onRefresh: () => void; onComments: (post: SocialPost) => void; onOpen?: (post: SocialPost) => void; currentCharacter?: SocialCharacter }) {
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [commentDraft, setCommentDraft] = useState('');
  const images = post.imageUrls?.length ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];
  async function toggleLike() {
    setPending(true);
    try { await apiRequest(`/api/posts/${post.id}/like`, { method: post.liked ? 'DELETE' : 'PUT' }); onRefresh(); }
    finally { setPending(false); }
  }
  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = commentDraft.trim();
    if (!content) return;
    await apiRequest(`/api/posts/${post.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    setCommentDraft('');
    onRefresh();
  }
  async function deletePost() {
    setPending(true);
    try { await apiRequest(`/api/posts/${post.id}`, { method: 'DELETE' }); setConfirmDelete(false); setMenuOpen(false); onRefresh(); }
    catch { /* apiRequest displays the server message in the VYBE snack. */ }
    finally { setPending(false); }
  }
  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    setPending(true);
    try {
      await apiRequest(`/api/posts/${post.id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      setReportOpen(false);
      notifySnack('Denúncia enviada para a administração da comunidade.', 'success');
    } catch (error) { notifySnack(error instanceof Error ? error.message : 'Não foi possível enviar a denúncia.'); }
    finally { setPending(false); }
  }
  const ownPost = currentCharacter?.id === post.author.id;
  return <><article className="social-panel post-card post-card--visual"><header className="post-header"><a href={`/@${post.author.username}`}><Avatar character={post.author}/></a><div><span className="post-author-title"><a href={`/@${post.author.username}`} className="post-author-name"><VerifiedName character={post.author}>{post.author.displayName}</VerifiedName></a></span><span>@{post.author.username} · {relativeTime(post.createdAt)}</span></div>{(post.canDelete || !ownPost) && <div className="post-menu-wrap"><button className="post-more" type="button" aria-label="Mais opções" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MaterialIcon name="more_horiz"/></button>{menuOpen && <div className="post-options-menu" role="menu">{post.canDelete && <button type="button" role="menuitem" disabled={pending} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}><MaterialIcon name="delete"/>Excluir publicação</button>}{!ownPost && <button className="report-post-action" type="button" role="menuitem" disabled={pending} onClick={() => { setMenuOpen(false); setReportOpen(true); }}><MaterialIcon name="flag"/>Denunciar publicação</button>}</div>}</div>}</header>
    {images.length > 0 && <div className="post-carousel"><img className="post-image" src={images[imageIndex]} alt={`Imagem ${imageIndex + 1} da publicação`} onClick={() => onOpen?.(post)} onError={useFallbackImage}/>{images.length > 1 && <><span className="carousel-count">{imageIndex + 1}/{images.length}</span><button type="button" className="carousel-arrow carousel-prev" aria-label="Imagem anterior" onClick={() => setImageIndex((index) => (index - 1 + images.length) % images.length)}><MaterialIcon name="chevron_left"/></button><button type="button" className="carousel-arrow carousel-next" aria-label="Próxima imagem" onClick={() => setImageIndex((index) => (index + 1) % images.length)}><MaterialIcon name="chevron_right"/></button></>}</div>}
    {images.length > 1 && <div className="carousel-dots" aria-label={`${images.length} imagens`}>{images.map((image, index) => <button className={index === imageIndex ? 'is-active' : ''} type="button" key={`${index}-${image.slice(-12)}`} aria-label={`Mostrar imagem ${index + 1}`} onClick={() => setImageIndex(index)}/>)}</div>}
    <footer className="post-actions"><button className={post.liked ? 'liked' : ''} type="button" disabled={pending} aria-label={post.liked ? 'Descurtir' : 'Curtir'} onClick={() => void toggleLike()}><MaterialIcon name="favorite" filled={post.liked}/></button><button type="button" aria-label="Comentar" onClick={() => onComments(post)}><MaterialIcon name="comment"/></button></footer>
    <div className="post-content"><strong className="post-likes-count">{post.likesCount.toLocaleString('pt-BR')} curtidas</strong>{post.content && <div className="post-copy"><a href={`/@${post.author.username}`}>{post.author.username}</a> <FormattedText text={post.content}/></div>}{post.commentsCount > 0 && <button className="post-comments-link" type="button" onClick={() => onComments(post)}>Ver todos os {post.commentsCount} comentários</button>}</div>
    <form className="post-inline-comment" onSubmit={(event) => void submitComment(event)}>{currentCharacter && <Avatar character={currentCharacter}/>}<TextFormattingEditor value={commentDraft} onChange={setCommentDraft} maxLength={1000} rows={1} placeholder="Adicione um comentário..."/><button type="submit" disabled={!commentDraft.trim()}>Publicar</button></form>
  </article>{confirmDelete && <div className="composer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setConfirmDelete(false); }}><section className="delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby={`delete-post-title-${post.id}`} aria-describedby={`delete-post-description-${post.id}`}><span className="delete-confirm-icon"><MaterialIcon name="delete"/></span><h2 id={`delete-post-title-${post.id}`}>Excluir publicação?</h2><p id={`delete-post-description-${post.id}`}>Esta publicação e as interações relacionadas serão removidas. Esta ação não pode ser desfeita.</p><div><button type="button" className="delete-cancel-button" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancelar</button><button type="button" className="delete-confirm-button" disabled={pending} onClick={() => void deletePost()}>{pending ? 'Excluindo…' : 'Excluir publicação'}</button></div></section></div>}{reportOpen && <div className="composer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setReportOpen(false); }}><section className="post-report-modal" role="dialog" aria-modal="true" aria-labelledby={`report-post-title-${post.id}`}><button className="modal-x" type="button" aria-label="Fechar" disabled={pending} onClick={() => setReportOpen(false)}><MaterialIcon name="close"/></button><span className="post-report-icon"><MaterialIcon name="flag"/></span><h2 id={`report-post-title-${post.id}`}>Denunciar publicação</h2><p>Conte à administração da comunidade por que esta publicação pode violar as diretrizes.</p><form onSubmit={(event) => void submitReport(event)}><label htmlFor={`report-reason-${post.id}`}>Motivo da denúncia</label><textarea id={`report-reason-${post.id}`} name="reason" minLength={3} maxLength={500} placeholder="Descreva o que há de inadequado nesta publicação..." required/><small>Até 500 caracteres. A denúncia será analisada pela administração.</small><div><button type="button" className="delete-cancel-button" disabled={pending} onClick={() => setReportOpen(false)}>Cancelar</button><button type="submit" className="post-report-submit" disabled={pending}>{pending ? 'Enviando…' : 'Enviar denúncia'}</button></div></form></section></div>}</>;
}

function CurrentProfile({ character }: { character: SocialCharacter }) {
  const [profile, setProfile] = useState(character);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void apiRequest<SocialCharacter>('/api/me/character').then((latest) => { if (mounted) setProfile(latest); }).catch(() => undefined); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { mounted = false; window.removeEventListener('focus', refresh); };
  }, []);
  return <section className="right-profile-preview"><div className="right-profile-details"><Avatar character={profile}/><h2><VerifiedName character={profile} showBadge={false}>{profile.displayName}</VerifiedName></h2><small>@{profile.username}{profile.verified && <span className="verification-badge" role="img" aria-label="Conta verificada" title="Conta verificada">✓</span>}</small><ProfileFontText as="div" className="right-profile-stats" character={profile} role="primary"><span><strong>{profile.postCount.toLocaleString('pt-BR')}</strong>Publicações</span><span><strong>{profile.followerCount.toLocaleString('pt-BR')}</strong>Seguidores</span><span><strong>{profile.followingCount.toLocaleString('pt-BR')}</strong>Seguindo</span></ProfileFontText><a className="right-profile-edit" href={`/@${profile.username}`}>Ver perfil</a></div></section>;
}

function SocialInfoRail({ character }: { character: SocialCharacter }) {
  const [topics, setTopics] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void apiRequest<{ posts: SocialPost[] }>('/api/explore').then(({ posts }) => {
      const counts = new Map<string, number>();
      for (const post of posts) for (const tag of post.content.match(/#[\p{L}\p{N}_]{2,40}/gu) ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      if (active) setTopics([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag));
    }).catch(() => { if (active) setTopics([]); });
    return () => { active = false; };
  }, []);
  return <aside className="social-right-column social-info-rail">
    <CurrentProfile character={character}/>
    <section className="social-panel social-explore-card"><h2>Explore o Social <span aria-hidden="true">✦</span></h2>
      <div><i className="social-rail-icon social-rail-icon--teal"><MaterialIcon name="photo_camera"/></i><p><strong>Compartilhe momentos</strong><small>Publique fotos, vídeos e atualizações.</small></p></div>
      <div><i className="social-rail-icon social-rail-icon--lilac"><MaterialIcon name="groups"/></i><p><strong>Conecte-se</strong><small>Acompanhe pessoas da comunidade.</small></p></div>
      <div><i className="social-rail-icon social-rail-icon--coral"><MaterialIcon name="trending_up"/></i><p><strong>Acompanhe as trends</strong><small>Veja os assuntos em alta na comunidade.</small></p></div>
    </section>
    <section className="social-panel social-trending-card"><h2><MaterialIcon name="trending_up"/> Tópicos em alta</h2>{topics.length ? topics.map((tag) => <a key={tag} href={`/explorar?q=${encodeURIComponent(tag)}`}><i>#</i><span><strong>{tag}</strong><small>Na sua comunidade</small></span></a>) : <p className="social-trends-empty">Os tópicos com hashtags aparecerão aqui conforme a comunidade publicar.</p>}</section>
  </aside>;
}

function HomePage({ character, stories, onCreate, showInfoRail = false }: { character: SocialCharacter; stories: StoryGroup[]; onCreate: (choice?: 'post' | 'story') => void; showInfoRail?: boolean }) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [story, setStory] = useState<StoryGroup | null>(null);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [error, setError] = useState('');
  async function loadFeed() {
    try { const result = await apiRequest<SocialPost[]>('/api/feed?tab=for-you'); setPosts(result); const postId = new URLSearchParams(window.location.search).get('post'); if (postId) setSelectedPost(result.find((post) => post.id === postId) ?? null); setError(''); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o feed.'); }
  }
  useEffect(() => {
    void loadFeed();
    const refresh = () => { void loadFeed(); };
    window.addEventListener('vybe:refresh-feed', refresh);
    return () => window.removeEventListener('vybe:refresh-feed', refresh);
  }, []);
  return <div className="social-content-grid"><div className="social-main-column">
    <header className="social-feed-heading"><div><span>VYBE SOCIAL <b aria-hidden="true">✦</b></span><h1>Compartilhe o que acontece</h1><p>Momentos, ideias e tudo o que acontece na sua comunidade.</p></div></header>
    <Stories groups={stories} current={character} onOpen={setStory} onCreate={() => onCreate('story')}/>
    <section className="social-panel social-home-composer"><Avatar character={character}/><button type="button" onClick={() => onCreate('post')}>No que você está pensando?</button><button type="button" aria-label="Criar publicação com foto ou vídeo" onClick={() => onCreate('post')}><MaterialIcon name="image"/></button><button className="social-publish-shortcut" type="button" onClick={() => onCreate('post')}>Publicar</button></section>
    <>
      {error && <div className="inline-error">{error}</div>}
      {posts.map((post) => <PostCard key={post.id} post={post} currentCharacter={character} onRefresh={() => void loadFeed()} onComments={(selected) => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: selected }))}/>)}
      {posts.length === 0 && !error && <div className="social-panel blank-state">Ainda não há publicações por aqui.</div>}
    </>
  </div>{showInfoRail && <SocialInfoRail character={character} />}{story && <StoryViewer group={story} groups={stories} onClose={() => setStory(null)}/>}{selectedPost && <div className="profile-post-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPost(null); }}><section className="profile-post-modal" role="dialog" aria-modal="true" aria-label={`Publicação de ${selectedPost.author.displayName}`}><button className="modal-x" type="button" aria-label="Fechar publicação" onClick={() => setSelectedPost(null)}><MaterialIcon name="close"/></button><PostCard post={selectedPost} currentCharacter={character} onRefresh={() => void loadFeed()} onComments={(post) => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: post }))}/></section></div>}</div>;
}

function ExplorePage({ current }: { current: SocialCharacter }) {
  const query = new URLSearchParams(window.location.search).get('q') ?? '';
  const [people, setPeople] = useState<SocialCharacter[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [trendingPosts, setTrendingPosts] = useState<SocialPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim());
      const result = await apiRequest<{ people: SocialCharacter[]; posts: SocialPost[]; trendingPosts?: SocialPost[] }>(`/api/explore${params.size ? `?${params}` : ''}`);
      setPeople(result.people); setPosts(result.posts); setTrendingPosts(result.trendingPosts ?? result.posts.filter((post) => post.likesCount >= 10));
    } finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 220); return () => window.clearTimeout(timer); }, [query]);
  async function toggleFollow(person: SocialCharacter) { await apiRequest(`/api/characters/${person.username}/follow`, { method: person.following ? 'DELETE' : 'POST' }); await load(); }
  const trendingIds = new Set(trendingPosts.map((post) => post.id));
  const otherPosts = posts.filter((post) => !trendingIds.has(post.id));
  const renderPostTile = (post: SocialPost) => <button type="button" className="explore-image-tile" key={post.id} onClick={() => setSelectedPost(post)}><img src={post.imageUrls?.[0] || post.imageUrl} alt={post.content || `Publicação de ${post.author.displayName}`}/>{post.likesCount >= 10 && <b className="trend-image-badge">Em alta</b>}{(post.imageUrls?.length ?? 0) > 1 && <span><MaterialIcon name="filter_none"/></span>}<i><MaterialIcon name="favorite" filled/>{post.likesCount}<MaterialIcon name="comment"/>{post.commentsCount}</i></button>;
  return <section className="explore-page">
    {query && people.length > 0 && <section className="explore-people"><h2>Pessoas</h2>{people.map((person) => <article key={person.id}><a href={`/@${person.username}`}><Avatar character={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></a><button type="button" className={person.following ? 'following' : ''} onClick={() => void toggleFollow(person)}>{person.following ? 'Seguindo' : 'Seguir'}</button></article>)}</section>}
    <h2 className="explore-grid-title">Em alta · 10 curtidas ou mais</h2>{trendingPosts.length > 0 ? <div className="explore-image-grid">{trendingPosts.map(renderPostTile)}</div> : !loading && <div className="trend-empty-state">As fotos entram em alta ao atingir 10 curtidas.</div>}
    {otherPosts.length > 0 && <><h2 className="explore-grid-title explore-more-title">Mais fotos</h2><div className="explore-image-grid">{otherPosts.map(renderPostTile)}</div></>}
    {loading && <p className="muted-copy">Carregando…</p>}{!loading && posts.length === 0 && people.length === 0 && <div className="blank-state">Não encontramos publicações ou pessoas nesta comunidade.</div>}
    {selectedPost && <div className="profile-post-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPost(null); }}><section className="profile-post-modal" role="dialog" aria-modal="true" aria-label={`Publicação de ${selectedPost.author.displayName}`}><button className="modal-x" type="button" aria-label="Fechar publicação" onClick={() => setSelectedPost(null)}><MaterialIcon name="close"/></button><PostCard post={selectedPost} currentCharacter={current} onRefresh={() => void load()} onComments={(post) => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: post }))}/></section></div>}
  </section>;
}

function EchoCopy({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]{2,40}|@[a-zA-Z0-9._]{3,24})/gu);
  return <p className="echo-copy">{parts.map((part, index) => part.startsWith('#') ? <a key={index} href={`/echo/explorar?q=${encodeURIComponent(part)}`}>{part}</a> : part.startsWith('@') ? <a key={index} href={`/echo/perfil?u=${encodeURIComponent(part.slice(1))}`}>{part}</a> : part)}</p>;
}

function splitEchoLocation(text: string) {
  const match = text.match(/(?:^|\n\n)📍\s*([^\n]+)$/u);
  if (!match) return { text, location: '' };
  return { text: text.slice(0, text.length - match[0].length).trimEnd(), location: match[1].trim() };
}

function EchoLocationCard({ location }: { location: string }) {
  const [city, ...stateParts] = location.split(',');
  const state = stateParts.join(',').trim();
  return <section className="echo-location-card" aria-label={`Localização: ${city.trim()}${state ? `, ${state}` : ''}`}><span><MaterialIcon name="location_on"/></span><div><strong>{city.trim()}</strong>{state && <p>{state}</p>}</div></section>;
}

function EchoPost({ post, refresh, currentCharacter }: { post: SocialPost; refresh: () => void; currentCharacter: SocialCharacter }) {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [viewsCount, setViewsCount] = useState(post.viewsCount ?? 0);
  const [poll, setPoll] = useState<SocialPoll | undefined>(post.poll);
  const articleRef = useRef<HTMLElement>(null);
  useEffect(() => setPoll(post.poll), [post.poll]);
  useEffect(() => {
    const article = articleRef.current;
    if (!article || typeof IntersectionObserver === 'undefined') return;
    let sent = false;
    const observer = new IntersectionObserver((entries) => {
      if (sent || !entries.some((entry) => entry.isIntersecting)) return;
      sent = true;
      observer.disconnect();
      void apiRequest<{ viewsCount: number }>(`/api/posts/${post.id}/view`, { method: 'POST' }).then((result) => setViewsCount(result.viewsCount)).catch(() => undefined);
    }, { threshold: 0.5 });
    observer.observe(article);
    return () => observer.disconnect();
  }, [post.id]);
  async function action(path: string, method: string) { setBusy(true); try { await apiRequest(path, { method }); refresh(); } finally { setBusy(false); } }
  async function vote(optionId: string) {
    if (!poll || poll.myVote || busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ poll: SocialPoll }>(`/api/posts/${post.id}/poll/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }) });
      setPoll(result.poll);
    } finally { setBusy(false); }
  }
  async function deletePost() {
    setBusy(true);
    try { await apiRequest(`/api/posts/${post.id}`, { method: 'DELETE' }); setConfirmDelete(false); refresh(); }
    catch { /* apiRequest displays the server message. */ }
    finally { setBusy(false); }
  }
  async function reportPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(`/api/posts/${post.id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reportReason.trim() }) });
      setReportOpen(false); setReportReason(''); notifySnack('Denúncia enviada para a administração da comunidade.', 'success');
    } catch { /* apiRequest displays the server message. */ }
    finally { setBusy(false); }
  }
  const postBody = splitEchoLocation(post.content);
  return <><article className="echo-post" ref={articleRef}>
    <a className="echo-post-avatar" href={`/echo/perfil?u=${encodeURIComponent(post.author.username)}`}><Avatar character={post.author}/></a>
    <div className="echo-post-main"><header><a href={`/echo/perfil?u=${encodeURIComponent(post.author.username)}`}><strong><VerifiedName character={post.author}>{post.author.displayName}</VerifiedName></strong> </a><span>@{post.author.username} · {relativeTime(post.createdAt)}</span>{(post.canDelete || post.author.id !== currentCharacter.id) && <div className="echo-post-menu-wrap"><button type="button" aria-label="Mais opções" aria-expanded={menuOpen} title="Mais opções" onClick={() => setMenuOpen((open) => !open)}><MaterialIcon name="more_horiz"/></button>{menuOpen && <div className="post-options-menu" role="menu">{post.canDelete && <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}><MaterialIcon name="delete"/>Excluir publicação</button>}{post.author.id !== currentCharacter.id && <button className="report-post-action" type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); setReportOpen(true); }}><MaterialIcon name="flag"/>Denunciar publicação</button>}</div>}</div>}</header>
      {postBody.text && <EchoCopy text={postBody.text}/>}{(post.imageUrls?.[0] || post.imageUrl) && <img className="echo-post-image" src={post.imageUrls?.[0] || post.imageUrl} alt="Imagem do Echo"/>}{postBody.location && <EchoLocationCard location={postBody.location}/>}
      {poll && <section className="echo-poll" aria-label={`Enquete: ${poll.question}`}><h3>{poll.question}</h3>{poll.options.map((option) => { const totalVotes = poll.options.reduce((total, item) => total + item.votesCount, 0); const percentage = totalVotes ? Math.round(option.votesCount / totalVotes * 100) : 0; const selected = poll.myVote === option.id; return <button key={option.id} type="button" className={`echo-poll-option${selected ? ' is-selected' : ''}`} onClick={() => void vote(option.id).catch(() => undefined)} disabled={Boolean(poll.myVote) || busy}><span className="echo-poll-option-fill" style={{ width: `${percentage}%` }}/><span className="echo-poll-option-label">{option.text}{selected && <b> · Seu voto</b>}</span><strong>{percentage}%</strong></button>; })}<small>{poll.options.reduce((total, option) => total + option.votesCount, 0)} votos{poll.myVote ? ' · Você já votou' : ' · Escolha uma opção'}</small></section>}
      <footer><button type="button" disabled={busy} className={post.commentsCount ? 'has-count' : ''} onClick={() => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: post }))} aria-label="Comentar"><MaterialIcon name="chat_bubble_outline"/>{post.commentsCount || ''}</button><button type="button" disabled={busy} className={post.reposted ? 'is-active' : ''} onClick={() => void action(`/api/posts/${post.id}/repost`, post.reposted ? 'DELETE' : 'PUT')} aria-label="Republicar"><MaterialIcon name="repeat"/>{post.repostCount || ''}</button><button type="button" disabled={busy} className={post.liked ? 'is-liked' : ''} onClick={() => void action(`/api/posts/${post.id}/like`, post.liked ? 'DELETE' : 'PUT')} aria-label="Curtir"><MaterialIcon name="favorite" filled={post.liked}/>{post.likesCount || ''}</button><span className="echo-post-views" aria-label={`${viewsCount.toLocaleString('pt-BR')} visualizações`} title="Pessoas que visualizaram este post"><MaterialIcon name="visibility"/>{new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(viewsCount)}</span></footer>
    </div>
  </article>{confirmDelete && <div className="composer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmDelete(false); }}><section className="delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby={`echo-delete-title-${post.id}`}><span className="delete-confirm-icon"><MaterialIcon name="delete"/></span><h2 id={`echo-delete-title-${post.id}`}>Excluir publicação?</h2><p>Esta publicação e as interações relacionadas serão removidas. Esta ação não pode ser desfeita.</p><div><button type="button" className="delete-cancel-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</button><button type="button" className="delete-confirm-button" disabled={busy} onClick={() => void deletePost()}>{busy ? 'Excluindo…' : 'Excluir publicação'}</button></div></section></div>}{reportOpen && <div className="composer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setReportOpen(false); }}><section className="post-report-modal" role="dialog" aria-modal="true" aria-labelledby={`echo-report-title-${post.id}`}><button className="modal-x" type="button" aria-label="Fechar" disabled={busy} onClick={() => setReportOpen(false)}><MaterialIcon name="close"/></button><span className="post-report-icon"><MaterialIcon name="flag"/></span><h2 id={`echo-report-title-${post.id}`}>Denunciar publicação</h2><p>Conte à administração da comunidade por que esta publicação pode violar as diretrizes.</p><form onSubmit={(event) => void reportPost(event)}><label htmlFor={`echo-report-reason-${post.id}`}>Motivo da denúncia</label><textarea id={`echo-report-reason-${post.id}`} value={reportReason} onChange={(event) => setReportReason(event.currentTarget.value)} minLength={3} maxLength={500} placeholder="Descreva o que há de inadequado nesta publicação..." required/><small>Até 500 caracteres. A denúncia será analisada pela administração.</small><div><button type="button" className="delete-cancel-button" disabled={busy} onClick={() => setReportOpen(false)}>Cancelar</button><button type="submit" className="post-report-submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar denúncia'}</button></div></form></section></div>}</>;
}

function EchoRightColumn({ community }: { community: string }) {
  const [trends, setTrends] = useState<{ tag: string; count: number }[]>([]);
  const [people, setPeople] = useState<SocialCharacter[]>([]);
  useEffect(() => { void apiRequest<typeof trends>('/api/echo/trends').then(setTrends).catch(() => setTrends([])); void apiRequest<{ people: SocialCharacter[]; posts: SocialPost[] }>('/api/echo/explore').then((data) => setPeople(data.people)).catch(() => setPeople([])); }, []);
  return <aside className="echo-right-column">
    <section className="echo-about-card"><span><MaterialIcon name="graphic_eq"/></span><div><h2>O que está acontecendo <b>✦</b></h2><p>Os assuntos começam a aparecer conforme a comunidade conversa.</p></div></section>
    <section className="echo-side-panel echo-trends-panel"><h2><MaterialIcon name="trending_up"/> Tópicos em alta</h2>{trends.map((item) => <a href={`/echo/explorar?q=${encodeURIComponent(`#${item.tag}`)}`} key={item.tag}><strong>#{item.tag}</strong><small>{item.count.toLocaleString('pt-BR')} conversas</small><MaterialIcon name="tag"/></a>)}{!trends.length && <p>As conversas mais populares aparecerão aqui.</p>}</section>
    <section className="echo-side-panel"><h2>Quem seguir</h2>{people.slice(0, 4).map((person) => <article className="echo-suggestion" key={person.id}><a href={`/echo/perfil?u=${encodeURIComponent(person.username)}`}><Avatar character={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></a><button type="button" onClick={() => void apiRequest(`/api/characters/${person.username}/follow`, { method: person.following ? 'DELETE' : 'POST' }).then(() => setPeople((items) => items.map((item) => item.id === person.id ? { ...item, following: !person.following } : item)))}>{person.following ? 'Seguindo' : 'Seguir'}</button></article>)}{!people.length && <p>Novas pessoas aparecerão aqui.</p>}</section>
    <section className="echo-community-card"><strong>Universo {community}</strong><p>Ideias e conversas da sua comunidade.</p></section>
  </aside>;
}

function EchoPage({ identity, tenant, initialTab = 'for-you' }: { identity: SocialCharacter; tenant: TenantInfo | null; initialTab?: 'for-you' | 'following' }) {
  const [tab, setTab] = useState<'for-you' | 'following'>(initialTab);
  const [posts, setPosts] = useState<SocialPost[]>([]); const [explorePeople, setExplorePeople] = useState<SocialCharacter[]>([]); const [content, setContent] = useState(''); const [image, setImage] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [query, setQuery] = useState(new URLSearchParams(window.location.search).get('q') ?? '');
  const [pollOpen, setPollOpen] = useState(false); const [pollQuestion, setPollQuestion] = useState(''); const [pollOptions, setPollOptions] = useState(['', '']); const [location, setLocation] = useState(''); const [locationPanelOpen, setLocationPanelOpen] = useState(false); const [locationCity, setLocationCity] = useState(''); const [locationState, setLocationState] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { captureSelection, insertEmoji } = useEmojiInsertion(contentRef, content, setContent);
  const exploring = window.location.pathname === '/echo/explorar';
  async function load() { try { const endpoint = exploring ? `/api/echo/explore${query ? `?q=${encodeURIComponent(query)}` : ''}` : `/api/pulso?tab=${tab}`; const data = await apiRequest<SocialPost[] | { posts: SocialPost[]; people?: SocialCharacter[] }>(endpoint); setPosts(Array.isArray(data) ? data : data.posts); setExplorePeople(!Array.isArray(data) ? data.people ?? [] : []); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar o Echo.'); } }
  useEffect(() => { void load(); }, [tab, query, exploring]);
  async function publish(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const options = pollOptions.map((option) => option.trim()).filter(Boolean); if (pollOpen && (!pollQuestion.trim() || options.length < 2)) { setError('Preencha a pergunta e pelo menos duas opções da enquete.'); return; } const postContent = [content.trim(), location].filter(Boolean).join('\n\n'); if (!postContent && !image && !pollOpen) return; if (postContent.length > 500) { setError('Texto e localização devem somar até 500 caracteres.'); return; } setBusy(true); setError(''); try { await apiRequest('/api/pulso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: postContent, images: image ? [image] : [], ...(pollOpen ? { poll: { question: pollQuestion.trim(), options } } : {}) }) }); setContent(''); setImage(''); setPollOpen(false); setPollQuestion(''); setPollOptions(['', '']); setLocation(''); setLocationPanelOpen(false); setLocationCity(''); setLocationState(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível publicar.'); } finally { setBusy(false); } }
  function confirmLocation() { const city = locationCity.trim(); const state = locationState.trim(); if (!city || !state) { setError('Informe a cidade e o estado.'); return; } setLocation(`📍 ${city}, ${state}`); setLocationPanelOpen(false); setError(''); }
  async function chooseImage(file?: File) { if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { setError('Escolha uma imagem PNG, JPEG ou WebP de até 3 MB.'); return; } try { setImage(await fileAsDataUrl(file)); setError(''); } catch { setError('Não foi possível abrir a imagem.'); } }
  return <div className="echo-layout"><main className="echo-main"><header className="echo-page-heading"><div><h1>VYBE <em>Echo</em> <span>✦</span></h1><p>Converse, discuta ideias e acompanhe o que está acontecendo na sua comunidade.</p></div><MaterialIcon name="graphic_eq"/></header>
    {!exploring && <form className="echo-composer" onSubmit={(event) => void publish(event)}><Avatar character={identity}/><div className="echo-compose-content"><TextFormattingEditor ref={contentRef} value={content} onChange={setContent} maxLength={500} placeholder={`O que está acontecendo, ${identity.displayName.split(/\s+/)[0]}?`}/>{image && <div className="echo-image-preview"><img src={image} alt="Prévia"/><button type="button" aria-label="Remover imagem" onClick={() => setImage('')}><MaterialIcon name="close"/></button></div>}{pollOpen && <div className="echo-poll-editor"><label>Pergunta da enquete<input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} maxLength={120} placeholder="Faça uma pergunta"/></label>{pollOptions.map((option, index) => <input aria-label={`Opção ${index + 1}`} key={index} value={option} onChange={(event) => setPollOptions((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} maxLength={80} placeholder={`Opção ${index + 1}`}/>)}{pollOptions.length < 4 && <button className="echo-poll-add" type="button" onClick={() => setPollOptions((items) => [...items, ''])}>+ Adicionar opção</button>}</div>}{locationPanelOpen && <div className="echo-location-editor"><label>Cidade<input value={locationCity} onChange={(event) => setLocationCity(event.currentTarget.value)} maxLength={80} placeholder="Ex.: São Paulo"/></label><label>Estado<input value={locationState} onChange={(event) => setLocationState(event.currentTarget.value)} maxLength={40} placeholder="Ex.: SP ou São Paulo"/></label><button type="button" onClick={confirmLocation}>Confirmar local</button></div>}{location && <button className="echo-location-chip" type="button" onClick={() => { setLocation(''); setLocationPanelOpen(true); }} title="Alterar localização">{location}<MaterialIcon name="close"/></button>}<div className="echo-compose-actions"><label title="Adicionar imagem" aria-label="Adicionar imagem"><MaterialIcon name="image"/><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void chooseImage(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}/></label><button className={pollOpen ? 'echo-compose-tool is-active' : 'echo-compose-tool'} type="button" aria-label="Criar enquete" title="Criar enquete" onClick={() => setPollOpen((open) => !open)}><MaterialIcon name="ballot"/></button><EmojiButton onBeforeOpen={captureSelection} onSelect={insertEmoji} label="Adicionar emoji"/><button className={locationPanelOpen ? "echo-compose-tool is-active" : "echo-compose-tool"} type="button" aria-label="Adicionar localização" title="Adicionar localização" onClick={() => setLocationPanelOpen((open) => !open)}><MaterialIcon name="place"/></button><span>{content.length > 450 ? `${content.length}/500` : ''}</span><button type="submit" disabled={busy || (!content.trim() && !image && !pollOpen)}>{busy ? 'Publicando…' : 'Publicar'}</button></div></div></form>}
    {exploring && <header className="echo-explore-heading"><span>EXPLORAR</span><h2>Encontre conversas e pessoas</h2><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar no Echo..." aria-label="Buscar no Echo"/></header>}
    {exploring && explorePeople.length > 0 && <section className="echo-explore-people"><h2>Pessoas</h2>{explorePeople.map((person) => <article key={person.id}><a href={`/echo/perfil?u=${encodeURIComponent(person.username)}`}><Avatar character={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></a><button type="button" onClick={() => void apiRequest(`/api/characters/${person.username}/follow`, { method: person.following ? 'DELETE' : 'POST' }).then(() => setExplorePeople((items) => items.map((item) => item.id === person.id ? { ...item, following: !person.following } : item)))}>{person.following ? 'Seguindo' : 'Seguir'}</button></article>)}</section>}
    {!exploring && <nav className="echo-tabs"><button className={tab === 'for-you' ? 'is-active' : ''} type="button" onClick={() => setTab('for-you')}>Para você</button><button className={tab === 'following' ? 'is-active' : ''} type="button" onClick={() => setTab('following')}>Seguindo</button></nav>}
    {image && !busy && error && <p className="echo-inline-error" role="alert">{error}</p>}{error && !image && <p className="echo-inline-error" role="alert">{error}</p>}
      {posts.map((post) => <EchoPost key={post.id} post={post} currentCharacter={identity} refresh={() => void load()}/>)}
    {!posts.length && !error && <div className="echo-empty"><MaterialIcon name="graphic_eq"/><strong>{exploring ? 'Nenhuma conversa encontrada.' : 'Ainda está tudo quieto por aqui.'}</strong><span>{exploring ? 'Tente buscar outro assunto.' : 'Compartilhe o primeiro pensamento.'}</span></div>}
  </main><EchoRightColumn community={tenant?.name ?? 'VYBE'}/></div>;
}

function EchoProfilePage({ current, tenant }: { current: SocialCharacter; tenant: TenantInfo | null }) {
  const username = new URLSearchParams(window.location.search).get('u') ?? current.username;
  const [data, setData] = useState<{ profile: SocialCharacter; posts: SocialPost[]; reposts: SocialPost[] } | null>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'reposts'>('posts');
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState('');
  const [removePhoto, setRemovePhoto] = useState(false);
  const [cover, setCover] = useState('');
  const [removeCover, setRemoveCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    try { setData(await apiRequest<{ profile: SocialCharacter; posts: SocialPost[]; reposts: SocialPost[] }>(`/api/echo/profile/${encodeURIComponent(username)}`)); }
    catch { setData(null); }
  }
  useEffect(() => { void load(); }, [username]);
  function edit() {
    if (!data) return;
    setDisplayName(data.profile.displayName); setBio(data.profile.bio); setPhoto(''); setRemovePhoto(false); setCover(''); setRemoveCover(false); setError(''); setEditing(true);
  }
  async function chooseCover(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { setError('Escolha uma capa PNG, JPEG ou WebP de até 3 MB.'); return; }
    try { setCover(await fileAsDataUrl(file)); setRemoveCover(false); setError(''); }
    catch { setError('Não foi possível carregar a imagem de capa.'); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const result = await apiRequest<{ profile: SocialCharacter }>('/api/echo/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName, bio, ...(photo ? { photo } : removePhoto ? { photo: null } : {}), ...(cover ? { cover } : removeCover ? { cover: null } : {}) }) });
      window.dispatchEvent(new CustomEvent('vybe:echo-profile-updated', { detail: result.profile })); await load(); setEditing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil.'); }
    finally { setSaving(false); }
  }
  if (!data) return <div className="echo-empty">Carregando perfil…</div>;
  const visiblePosts = activeTab === 'posts' ? data.posts : data.reposts;
  return <><div className="echo-layout"><main className="echo-main"><header className="echo-page-heading"><div><h1>VYBE ECHO</h1></div></header><section style={isHexNameColor(data.profile.profileCustomization?.profileTheme ?? '') ? { background: `color-mix(in srgb, ${data.profile.profileCustomization!.profileTheme} 14%, white)`, borderColor: data.profile.profileCustomization!.profileTheme } : undefined} className={`echo-profile-header vybe-theme-${(data.profile.profileCustomization?.profileTheme ?? 'DEFAULT').toLowerCase()}`}><div className="echo-profile-cover" style={data.profile.coverUrl ? { backgroundImage: `url(\"${data.profile.coverUrl}\")` } : undefined}/><div className="echo-profile-details"><Avatar character={data.profile} className="echo-profile-avatar"/>{data.profile.own ? <button className="echo-edit-profile" type="button" onClick={edit}>Editar perfil</button> : <button className="echo-edit-profile" type="button" onClick={async()=>{const reason=window.prompt('Por que deseja denunciar este perfil?');if(!reason?.trim())return;try{await apiRequest('/api/community-reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetType:'profile',targetId:data.profile.id,reason:reason.trim()})});notifySnack('Denúncia enviada à administração da comunidade.','success');}catch(error){notifySnack(error instanceof Error?error.message:'Não foi possível enviar a denúncia.');}}}>Denunciar perfil</button>}<h2><VerifiedName character={data.profile} showBadge={false}>{data.profile.displayName}</VerifiedName></h2><p className="echo-profile-handle">@{data.profile.username}{data.profile.verified && <span className="verification-badge" role="img" aria-label="Conta verificada" title="Conta verificada">✓</span>}</p>{data.profile.bio && <ProfileFontText as="p" className="echo-profile-bio" character={data.profile} role="secondary">{data.profile.bio}</ProfileFontText>}<ProfileFontText as="div" className="echo-profile-counts" character={data.profile} role="primary"><span><strong>{data.profile.followingCount}</strong> seguindo</span><span><strong>{data.profile.followerCount}</strong> seguidores</span></ProfileFontText></div></section><nav className="echo-profile-tabs" aria-label="Publicações do perfil"><button className={activeTab === 'posts' ? 'is-active' : ''} type="button" aria-pressed={activeTab === 'posts'} onClick={() => setActiveTab('posts')}>Postagens</button><button className={activeTab === 'reposts' ? 'is-active' : ''} type="button" aria-pressed={activeTab === 'reposts'} onClick={() => setActiveTab('reposts')}>Republicados</button></nav>{visiblePosts.map((post) => <EchoPost key={`${activeTab}-${post.id}`} post={post} currentCharacter={current} refresh={() => void load()}/>)}{!visiblePosts.length && <div className="echo-empty"><MaterialIcon name={activeTab === 'posts' ? 'edit_note' : 'repeat'}/><strong>{activeTab === 'posts' ? 'Nenhuma postagem ainda.' : 'Nenhuma republicação ainda.'}</strong></div>}</main><EchoRightColumn community={tenant?.name ?? 'Sua comunidade'}/></div>{editing && <div className="story-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditing(false); }}><form className="edit-profile-modal echo-profile-edit-modal" role="dialog" aria-modal="true" aria-labelledby="echo-profile-edit-title" onSubmit={(event) => void save(event)}><button className="modal-x" type="button" aria-label="Fechar" onClick={() => setEditing(false)}><MaterialIcon name="close"/></button><span>VYBE ECHO</span><h2 id="echo-profile-edit-title">Editar perfil</h2><ProfilePhotoEditor value={photo || (removePhoto ? '' : data.profile.avatarUrl)} onChange={(value) => { setPhoto(value); setRemovePhoto(false); setError(''); }} onError={setError} maxBytes={3 * 1024 * 1024}/>{data.profile.avatarUrl && <button type="button" className="echo-profile-photo-reset" onClick={() => { setPhoto(''); setRemovePhoto(true); }}>Usar foto do Social</button>}<label>Imagem de capa<input className="echo-cover-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const input = event.currentTarget; void chooseCover(input.files?.[0]); input.value = ''; }}/><span className={`echo-cover-preview ${cover || (!removeCover && data.profile.coverUrl) ? 'has-image' : ''}`} style={cover || (!removeCover && data.profile.coverUrl) ? { backgroundImage: `url(\"${cover || data.profile.coverUrl}\")` } : undefined}>{cover ? 'Nova capa selecionada' : removeCover ? 'Capa removida' : data.profile.coverUrl ? 'Capa atual' : 'Adicionar capa'}</span></label>{data.profile.coverUrl && <button type="button" className="echo-profile-photo-reset" onClick={() => { setCover(''); setRemoveCover(true); }}>Usar capa do Social</button>}<label>Nome<input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} maxLength={60} required/></label><label>Bio<textarea value={bio} onChange={(event) => setBio(event.currentTarget.value)} maxLength={300} placeholder="Conte um pouco sobre você no Echo."/></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></form></div>}</>;
}

function ConnectionsPage({ username, list }: { username: string; list: 'followers' | 'following' }) {
  const [people, setPeople] = useState<SocialCharacter[]>([]);
  useEffect(() => { void apiRequest<SocialCharacter[]>(`/api/characters/${encodeURIComponent(username)}/${list}`).then(setPeople).catch(() => setPeople([])); }, [username, list]);
  return <section className="social-page-card"><div className="social-page-title"><span>CONEXÕES</span><h1>{list === 'followers' ? 'Seguidores' : 'Seguindo'}</h1><p>Conexões dentro da comunidade.</p></div><div className="connections-list">{people.map((person) => <a key={person.id} href={`/@${person.username}`}><Avatar character={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span><b>›</b></a>)}</div>{!people.length && <p className="muted-copy">Nenhuma conexão para mostrar.</p>}</section>;
}

function ProfileEditModal({ profile, onClose, onSave }: { profile: SocialCharacter; onClose: () => void; onSave: (values: { displayName: string; username: string; communityFunction: string; bio: string; avatarUrl?: string; coverUrl?: string }) => Promise<void> }) {
  const [avatarUrl, setAvatarUrl] = useState<string>();
  const [coverUrl, setCoverUrl] = useState<string>();
  const [avatarCrop, setAvatarCrop] = useState({ x: 0.5, y: 0.5, zoom: 1 });
  const [avatarRatio, setAvatarRatio] = useState(1);
  const [avatarFileName, setAvatarFileName] = useState('');
  const [coverFileName, setCoverFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);
  const cropViewport = useRef<HTMLDivElement>(null);
  const cropImage = useRef<HTMLImageElement>(null);
  const dragPoint = useRef<{ x: number; y: number } | null>(null);
  const avatarSource = avatarUrl || profile.avatarUrl;
  async function readImage(event: ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Escolha uma imagem PNG, JPEG ou WebP de até 2 MB.');
      event.currentTarget.value = '';
      return;
    }
    try { const dataUrl = await fileAsDataUrl(file); if (type === 'avatar') { setAvatarUrl(dataUrl); setAvatarCrop({ x: 0.5, y: 0.5, zoom: 1 }); setAvatarRatio(1); setAvatarFileName(file.name); } else { setCoverUrl(dataUrl); setCoverFileName(file.name); } setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível ler a imagem.'); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const adjustedAvatar = avatarSource ? await cropAvatarImage(avatarSource, avatarCrop) : undefined;
      await onSave({ displayName: String(data.get('displayName') ?? ''), username: String(data.get('username') ?? ''), communityFunction: String(data.get('communityFunction') ?? ''), bio: String(data.get('bio') ?? ''), avatarUrl: adjustedAvatar, coverUrl });
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o perfil.'); }
    finally { setSaving(false); }
  }
  return <div className="story-overlay"><form className="edit-profile-modal" onSubmit={(event) => void submit(event)}><button type="button" className="modal-x" aria-label="Fechar" onClick={onClose}><MaterialIcon name="close"/></button><h2>Editar perfil</h2><div className="profile-image-edit-grid"><div className="profile-image-picker"><span>Foto de perfil</span><input ref={avatarInput} className="profile-file-input-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher foto de perfil" onChange={(event) => { void readImage(event, 'avatar'); event.currentTarget.value = ''; }}/><div className="profile-avatar-cropper" ref={cropViewport} onPointerDown={(event) => { dragPoint.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragPoint.current || !cropImage.current || !cropViewport.current) return; const rect = cropViewport.current.getBoundingClientRect(); const overflowX = Math.max(1, cropImage.current.naturalWidth * Math.max(rect.width / cropImage.current.naturalWidth, rect.height / cropImage.current.naturalHeight) * avatarCrop.zoom - rect.width); const overflowY = Math.max(1, cropImage.current.naturalHeight * Math.max(rect.width / cropImage.current.naturalWidth, rect.height / cropImage.current.naturalHeight) * avatarCrop.zoom - rect.height); const dx = event.clientX - dragPoint.current.x; const dy = event.clientY - dragPoint.current.y; dragPoint.current = { x: event.clientX, y: event.clientY }; setAvatarCrop((crop) => ({ ...crop, x: Math.max(0, Math.min(1, crop.x - dx / overflowX)), y: Math.max(0, Math.min(1, crop.y - dy / overflowY)) })); }} onPointerUp={() => { dragPoint.current = null; }} onPointerCancel={() => { dragPoint.current = null; }} aria-label="Arraste a foto para ajustar o recorte">{avatarSource ? <img ref={cropImage} src={avatarSource} alt="Prévia do recorte da foto" draggable={false} onLoad={(event) => setAvatarRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} style={{ position: 'absolute', width: `${Math.max(100, avatarRatio * 100) * avatarCrop.zoom}%`, height: `${Math.max(100, 100 / avatarRatio) * avatarCrop.zoom}%`, left: `${(100 - Math.max(100, avatarRatio * 100) * avatarCrop.zoom) * avatarCrop.x}%`, top: `${(100 - Math.max(100, 100 / avatarRatio) * avatarCrop.zoom) * avatarCrop.y}%` }}/> : <Avatar character={profile} className="profile-avatar-upload-preview"/>}<span className="profile-avatar-crop-hint">Arraste para ajustar</span></div><label className="profile-avatar-zoom">Zoom<input type="range" min="1" max="3" step="0.01" value={avatarCrop.zoom} onChange={(event) => setAvatarCrop((crop) => ({ ...crop, zoom: Number(event.currentTarget.value) }))}/></label><button className="profile-image-change" type="button" onClick={() => avatarInput.current?.click()}>Trocar foto</button>{avatarFileName && <small className="profile-selected-file">{avatarFileName}</small>}<small>Arraste a foto e ajuste o zoom antes de salvar.</small></div><div className="profile-image-picker"><span>Imagem de capa</span><label className="profile-cover-upload" title="Trocar imagem de capa">{(coverUrl || profile.coverUrl) ? <img src={coverUrl || profile.coverUrl} alt="Prévia da capa"/> : <span className="profile-cover-empty">Selecionar capa</span>}<span className="profile-cover-upload-action">Trocar capa</span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher imagem de capa" onChange={(event) => void readImage(event, 'cover')}/></label>{coverFileName && <small className="profile-selected-file">{coverFileName}</small>}<small>PNG, JPG ou WebP · até 2 MB</small></div></div><label>Nome de exibição<input name="displayName" defaultValue={profile.displayName} required minLength={2} maxLength={60}/></label><label>Nome de usuário<input name="username" defaultValue={profile.username} required minLength={3} maxLength={24} pattern="[A-Za-z0-9._]+"/><small>Seu endereço ficará /@seu-username. Use letras, números, ponto ou sublinhado.</small></label><label>Função na comunidade<input name="communityFunction" defaultValue={profile.communityFunction ?? ''} maxLength={80} placeholder="Ex.: Professor, mascote, diretor"/><small>Essa função pode aparecer nos detalhes de eventos.</small></label><label>Bio<textarea name="bio" defaultValue={profile.bio} maxLength={1000}/><small>Até 1.000 caracteres.</small></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></form></div>;
}

function ProfilePage({ username, currentCharacter, onUpdated }: { username: string; currentCharacter: SocialCharacter; onUpdated: (character: SocialCharacter) => void }) {
  const [profile, setProfile] = useState<SocialCharacter | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [error, setError] = useState('');
  async function load() { try { const result = await apiRequest<{ character: SocialCharacter; posts: SocialPost[] }>(`/api/characters/${encodeURIComponent(username)}`); setProfile(result.character); setPosts(result.posts); setSelectedPost((current) => current ? result.posts.find((post) => post.id === current.id) ?? null : null); setError(''); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Perfil indisponível.'); } }
  useEffect(() => { void load(); }, [username]);
  async function toggleFollow() { if (!profile) return; await apiRequest(`/api/characters/${profile.username}/follow`, { method: profile.following ? 'DELETE' : 'POST' }); void load(); }
  async function saveProfile(values: { displayName: string; username: string; communityFunction: string; bio: string; avatarUrl?: string; coverUrl?: string }) {
    const updated = await apiRequest<SocialCharacter>('/api/me/character', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const nextProfile = { ...updated, own: true, following: profile?.following };
    setProfile(nextProfile); onUpdated(nextProfile);
    if (updated.username !== username) window.history.replaceState(null, '', `/@${updated.username}`);
  }
  if (error && !profile) return <section className="social-page-card"><p className="inline-error">{error}</p></section>;
  if (!profile) return <div className="social-panel blank-state">Carregando perfil…</div>;
  const visiblePosts = posts.filter((post) => post.kind === 'post' && (post.imageUrls?.length || post.imageUrl));
  return <div className={`profile-page vybe-theme-${(profile.profileCustomization?.profileTheme ?? 'DEFAULT').toLowerCase()}`}><section style={isHexNameColor(profile.profileCustomization?.profileTheme ?? '') ? { background: `color-mix(in srgb, ${profile.profileCustomization!.profileTheme} 14%, white)`, borderColor: profile.profileCustomization!.profileTheme } : undefined} className="profile-header"><div className="profile-cover-art" style={profile.coverUrl ? { backgroundImage: `url("${profile.coverUrl}")` } : undefined}/><div className="profile-info"><Avatar character={profile} className="large-avatar"/><div className="profile-actions">{profile.own ? <button className="soft-button" type="button" onClick={() => setShowEdit(true)}>Editar perfil</button> : <button className="primary-button" type="button" onClick={() => void toggleFollow()}>{profile.following ? 'Seguindo' : 'Seguir'}</button>}</div><h1><VerifiedName character={profile} showBadge={false}>{profile.displayName}</VerifiedName></h1><span>@{profile.username}{profile.verified && <span className="verification-badge" role="img" aria-label="Conta verificada" title="Conta verificada">✓</span>}</span><ProfileFontText as="p" character={profile} role="secondary">{profile.bio}</ProfileFontText>{(profile.age || profile.photoplayerName) && <div className="profile-character-meta">{profile.age && <span>{profile.age} anos</span>}{profile.photoplayerName && <span>Photoplayer: {profile.photoplayerName}</span>}</div>}<ProfileFontText as="div" className="profile-stats" character={profile} role="primary"><strong>{(profile.photoPostCount ?? visiblePosts.length).toLocaleString('pt-BR')}<small>publicações</small></strong><a href={`/@${profile.username}/followers`}><strong>{profile.followerCount.toLocaleString('pt-BR')}<small>seguidores</small></strong></a><a href={`/@${profile.username}/following`}><strong>{profile.followingCount.toLocaleString('pt-BR')}<small>seguindo</small></strong></a></ProfileFontText></div></section><h2 className="profile-grid-heading">Publicações</h2><div className="profile-post-grid">{visiblePosts.map((post) => <button className="profile-post-tile" type="button" key={post.id} title="Abrir publicação" aria-label={`Abrir publicação de ${post.author.displayName}`} onClick={() => setSelectedPost(post)}><img src={post.imageUrls?.[0] || post.imageUrl} alt={post.content || `Publicação de ${post.author.displayName}`}/><small><MaterialIcon name="favorite" filled/>{post.likesCount} <MaterialIcon name="comment"/>{post.commentsCount}</small></button>)}</div>{visiblePosts.length === 0 && <div className="blank-state">Ainda não há publicações por aqui.</div>}{selectedPost && <div className="profile-post-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPost(null); }}><section className="profile-post-modal" role="dialog" aria-modal="true" aria-label={`Publicação de ${selectedPost.author.displayName}`}><button className="modal-x" type="button" aria-label="Fechar publicação" onClick={() => setSelectedPost(null)}><MaterialIcon name="close"/></button><PostCard post={selectedPost} currentCharacter={currentCharacter} onRefresh={() => void load()} onComments={(post) => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: post }))}/></section></div>}{showEdit && <ProfileEditModal profile={profile} onClose={() => setShowEdit(false)} onSave={saveProfile}/>}</div>;
}

type ChatChannel = { id: string; name: string; category: string; description: string; kind: 'text' | 'announcement' | 'roleplay' | 'restricted' | 'voice' | 'forum'; posting: 'members' | 'staff' | 'restricted'; private: boolean };
type ChatCategory = { id: string; name: string; private: boolean };
type ChatMember = Pick<SocialCharacter, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'verified'> & { online?: boolean };
type ChatMessage = { id: string; content: string; createdAt: string; deleted: boolean; own: boolean; author: ChatMember | null };

function CommunityChatPage({ tenant, character }: { tenant: TenantInfo | null; character: SocialCharacter }) {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [categories, setCategories] = useState<ChatCategory[]>([]);
  const [canManageChannels, setCanManageChannels] = useState(false);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [selected, setSelected] = useState<ChatChannel | null>(null);
  const selectedChannelRef = useRef(selected);
  selectedChannelRef.current = selected;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { captureSelection, insertEmoji } = useEmojiInsertion(contentRef, content, setContent);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelCategory, setNewChannelCategory] = useState('Comunidade');
  const [newChannelDescription, setNewChannelDescription] = useState('');
  const [newChannelKind, setNewChannelKind] = useState<ChatChannel['kind']>('text');
  const [newChannelPosting, setNewChannelPosting] = useState<ChatChannel['posting']>('members');
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [channelCreateError, setChannelCreateError] = useState('');
  const [channelCreateBusy, setChannelCreateBusy] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryPrivate, setNewCategoryPrivate] = useState(false);
  const [categoryCreateError, setCategoryCreateError] = useState('');
  const [categoryCreateBusy, setCategoryCreateBusy] = useState(false);
  const [activeServerId, setActiveServerId] = useState(() => { const params = new URLSearchParams(window.location.search); return params.has('invite') ? '' : params.get('serverId') ?? ''; });
  const [serverSettingsSection, setServerSettingsSection] = useState<MessageServerSettingsSection | ''>(() => new URLSearchParams(window.location.search).get('settings') as MessageServerSettingsSection | '' || '');
  const communityCollapsedKey = `vybe:messages:collapsed:${character.id}:community:${tenant?.id ?? 'current'}`;
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>(() => { try { const parsed = JSON.parse(localStorage.getItem(`vybe:messages:collapsed:${character.id}:community:${tenant?.id ?? 'current'}`) ?? '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } });
  function selectMessageServer(serverId: string) {
    setActiveServerId(serverId);
    setServerSettingsSection('');
    window.history.replaceState({}, '', serverId ? `/mensagens?serverId=${encodeURIComponent(serverId)}` : '/mensagens');
  }
  function openMessageServerSettings(section: MessageServerSettingsSection = 'overview') {
    setServerSettingsSection(section);
    window.history.replaceState({}, '', `/mensagens?serverId=${encodeURIComponent(activeServerId)}&settings=${section}`);
  }
  function toggleCommunityCategory(categoryId: string) {
    setCollapsedCategories((current) => {
      const next = current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId];
      try { localStorage.setItem(communityCollapsedKey, JSON.stringify(next)); } catch { /* Local storage can be disabled. */ }
      return next;
    });
  }
  function openCategoryCreator() { setNewCategoryName(''); setNewCategoryPrivate(false); setCategoryCreateError(''); setCreatingCategory(true); }
  function openChannelCreator(category = 'Comunidade', categoryPrivate = false) {
    setNewChannelName(''); setNewChannelCategory(category); setNewChannelDescription('');
    setNewChannelKind('text'); setNewChannelPosting('members'); setNewChannelPrivate(categoryPrivate);
    setChannelCreateError(''); setCreatingChannel(true);
  }
  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCategoryCreateBusy(true); setCategoryCreateError('');
    try {
      await apiRequest<ChatCategory>('/api/conversations/channel-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCategoryName.trim(), private: newCategoryPrivate }) });
      await loadChannels(); setCreatingCategory(false);
    } catch (reason) { setCategoryCreateError(reason instanceof Error ? reason.message : 'Não foi possível criar a categoria.'); }
    finally { setCategoryCreateBusy(false); }
  }
  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newChannelName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setChannelCreateBusy(true); setChannelCreateError('');
    try {
      const created = await apiRequest<ChatChannel>('/api/conversations/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, category: newChannelCategory, description: newChannelDescription, kind: newChannelKind, posting: newChannelPosting, private: newChannelPrivate }) });
      await loadChannels(); setSelected(created); setCreatingChannel(false);
    } catch (reason) { setChannelCreateError(reason instanceof Error ? reason.message : 'Não foi possível criar o canal.'); }
    finally { setChannelCreateBusy(false); }
  }
  async function loadChannels() {
    try {
      const [channelList, memberList, categoryList, permissions] = await Promise.all([
        apiRequest<ChatChannel[]>('/api/conversations/channels'),
        apiRequest<ChatMember[]>('/api/conversations/members'),
        apiRequest<ChatCategory[]>('/api/conversations/channel-categories'),
        apiRequest<{ canManageChannels: boolean }>('/api/conversations/permissions'),
      ]);
      setChannels(channelList);
      setMembers(memberList);
      setCategories(categoryList);
      setCanManageChannels(permissions.canManageChannels);
      setSelected((current) => current ? channelList.find((channel) => channel.id === current.id) ?? channelList[0] ?? null : channelList[0] ?? null);
      setError('');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os canais.'); }
    finally { setLoading(false); }
  }
  async function loadMessages(channelId: string) {
    try { setMessages(await apiRequest<ChatMessage[]>(`/api/conversations/channels/${channelId}/messages`)); setError(''); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as mensagens.'); }
  }
  useEffect(() => { void loadChannels(); }, []);
  useEffect(() => { if (selected?.id && selected.kind !== 'voice') void loadMessages(selected.id); else setMessages([]); }, [selected?.id, selected?.kind]);
  useEffect(() => connectConversationRealtime((event) => {
    const channel = selectedChannelRef.current;
    if (event.type === 'ready' && channel) void loadMessages(channel.id);
    if (channel && event.type === 'channel:message' && event.channelId === channel.id) void loadMessages(channel.id);
  }), []);
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || selected.kind === 'voice' || !content.trim()) return;
    const sent = await apiRequest<ChatMessage>(`/api/conversations/channels/${selected.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    setMessages((current) => [...current, sent]);
    setContent('');
  }
  const inviteParams = new URLSearchParams(window.location.search); const inviteToken = inviteParams.get('invite'); const inviteServerId = inviteParams.get('serverId'); const requestServerId = inviteParams.get('request')==='1'?inviteServerId:null;
  if (inviteToken && inviteServerId) return <MessageServerInviteGate serverId={inviteServerId} token={inviteToken} onSelectServer={selectMessageServer} onJoined={(serverId)=>{setActiveServerId(serverId);setServerSettingsSection('');window.history.replaceState({},'',`/mensagens?serverId=${encodeURIComponent(serverId)}`);}}/>;
  if (requestServerId) return <MessageServerRequestGate serverId={requestServerId} onSelectServer={selectMessageServer}/>;
  if (activeServerId && serverSettingsSection) return <MessageServerSettings key={`${activeServerId}-settings`} serverId={activeServerId} section={serverSettingsSection} onSelectServer={selectMessageServer} onBack={() => { setServerSettingsSection(''); window.history.replaceState({}, '', `/mensagens?serverId=${encodeURIComponent(activeServerId)}`); }}/>
  if (activeServerId) return <div className="community-chat-page is-message-server has-channel"><MessageServersRail activeServerId={activeServerId} communityActive={false} onSelectServer={selectMessageServer}/><MessageServerWorkspace key={activeServerId} serverId={activeServerId} characterId={character.id} onBack={() => selectMessageServer('')} onOpenSettings={(section='overview') => openMessageServerSettings(section as MessageServerSettingsSection)}/></div>;
  return <div className={`community-chat-page ${selected ? 'has-channel' : ''} ${membersOpen ? 'members-open' : ''}`}>
    <MessageServersRail activeServerId="" communityActive={false} onSelectServer={selectMessageServer}/>
    <aside className="channel-sidebar"><a className="chat-community-banner" href="/" style={tenant?.coverUrl ? { backgroundImage: `linear-gradient(0deg,rgba(5,49,49,.92),rgba(5,49,49,.03) 80%),url("${tenant.coverUrl}")` } : undefined}><span>{tenant?.logoUrl ? <img src={tenant.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span><strong>{tenant?.name ?? 'Sua comunidade'}</strong><small>{tenant?.description || 'Comunidade VYBE'}</small><MaterialIcon name="expand_more"/></a><div className="chat-sidebar-shortcuts"><a href="/mensagens/privadas"><MaterialIcon name="chat"/>Mensagens privadas</a><a href="/mensagens/privadas?tab=groups"><MaterialIcon name="groups"/>Grupos</a>{canManageChannels&&<a href="/configuracoes?tab=general"><MaterialIcon name="settings"/>Configurações da comunidade</a>}</div><header className="chat-channels-heading"><span>CANAIS DA COMUNIDADE</span>{canManageChannels&&<button type="button" onClick={openCategoryCreator} aria-label="Criar categoria" title="Criar categoria"><MaterialIcon name="add"/></button>}</header>{loading ? <p className="muted-copy">Carregando canais…</p> : categories.map((category) => <section className="channel-category" key={category.id || category.name}><h2><button type="button" className="chat-category-collapse" aria-label={`${collapsedCategories.includes(category.id || category.name)?'Expandir':'Recolher'} ${category.name}`} aria-expanded={!collapsedCategories.includes(category.id || category.name)} onClick={() => toggleCommunityCategory(category.id || category.name)}><MaterialIcon name={collapsedCategories.includes(category.id || category.name) ? 'chevron_right' : 'expand_more'}/></button><span>{category.name}</span>{canManageChannels&&<button type="button" onClick={() => openChannelCreator(category.name, category.private)} aria-label={`Criar canal em ${category.name}`} title={`Criar canal em ${category.name}`}><MaterialIcon name="add"/></button>}</h2>{!collapsedCategories.includes(category.id || category.name) && channels.filter((channel) => channel.category.toLowerCase() === category.name.toLowerCase()).map((channel) => <button key={channel.id} className={selected?.id === channel.id ? 'active' : ''} type="button" onClick={() => setSelected(channel)}><MaterialIcon name={channel.kind === 'announcement' ? 'campaign' : channel.kind === 'roleplay' ? 'auto_awesome' : channel.kind === 'voice' ? 'headphones' : channel.kind === 'forum' ? 'forum' : channel.private ? 'lock' : 'tag'}/><span>{channel.name.replaceAll('-', ' ')}</span></button>)}</section>)}{!loading && categories.length === 0 && <p className="chat-no-channels">Ainda não há categorias configuradas.</p>}<div className="chat-voice-entry"><MaterialIcon name="headphones"/><strong>Canais de voz</strong><span>Em breve</span></div></aside>
    <section className="community-chat-main"><header className="chat-channel-header"><button className="chat-back" type="button" onClick={() => setSelected(null)} aria-label="Voltar aos canais"><MaterialIcon name="arrow_back"/></button><MaterialIcon className="channel-heading-icon" name={selected?.kind === 'announcement' ? 'campaign' : selected?.kind === 'roleplay' ? 'auto_awesome' : selected?.kind === 'voice' ? 'headphones' : selected?.kind === 'forum' ? 'forum' : 'tag'}/><div><h2>{selected ? selected.name.replaceAll('-', ' ') : 'Escolha um canal'}</h2><p>{selected?.description ?? 'Selecione um espaço para conversar.'}</p></div><button className="chat-header-icon" type="button" aria-label="Notificações do canal" title="Notificações do canal"><MaterialIcon name="notifications"/></button><button className="chat-header-icon" type="button" aria-label="Fixar mensagem" title="Mensagens fixadas"><MaterialIcon name="push_pin"/></button><button className="members-toggle" type="button" onClick={() => setMembersOpen(true)}><MaterialIcon name="groups"/>{members.length}</button><button className="chat-header-icon" type="button" aria-label="Mais opções" title="Mais opções"><MaterialIcon name="more_vert"/></button></header>
      {selected?.kind === 'voice' ? <div className="chat-channel-welcome chat-voice-placeholder"><span><MaterialIcon name="headphones"/></span><div><strong>Canal de voz</strong><p>A conexão de voz estará disponível em uma atualização futura.</p></div></div> : selected && <div className="chat-channel-welcome"><span><MaterialIcon name={selected.kind === 'announcement' ? 'campaign' : 'push_pin'}/></span><div><strong>{selected.kind === 'announcement' ? 'Canal de avisos' : `Bem-vindo a #${selected.name.replaceAll('-', ' ')}`}</strong><p>{selected.description || 'Este é o começo deste espaço da comunidade.'}</p></div></div>}
      <div className="chat-message-list">{error && <p className="inline-error" role="alert">{error}</p>}{messages.map((message, index) => { const previous = messages[index - 1]; const grouped = previous?.author?.id === message.author?.id && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000; return <article className={`chat-message ${grouped ? 'is-grouped' : ''}`} key={message.id}>{grouped ? <span className="chat-message-time">{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> : <Avatar character={message.author}/>}<div className="chat-message-body">{!grouped && <header><strong>{message.author?.displayName ?? 'Novo membro'}</strong><span>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></header>}<FormattedText text={message.content}/><div className="chat-message-actions">{message.own && !message.deleted && <button type="button" aria-label="Excluir mensagem" onClick={async () => { await apiRequest(`/api/conversations/messages/${message.id}`, { method: 'DELETE' }); setMessages((items) => items.map((item) => item.id === message.id ? { ...item, deleted: true, content: 'Esta mensagem foi removida.' } : item)); }}><MaterialIcon name="delete"/></button>}{!message.own && !message.deleted && <button type="button" aria-label="Denunciar mensagem" onClick={() => void apiRequest(`/api/conversations/messages/${message.id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Conteúdo inadequado ou contrário às regras.' }) })}><MaterialIcon name="flag"/></button>}</div></div></article>; })}{!loading && messages.length === 0 && selected && selected.kind !== 'voice' && <div className="chat-empty"><MaterialIcon name="forum"/><p>Esta conversa começa com você.</p></div>}</div>
      <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}><button className="chat-composer-add" type="button" aria-label="Adicionar conteúdo" title="Adicionar conteúdo"><MaterialIcon name="add"/></button><div className="chat-composer-field"><TextFormattingEditor ref={contentRef} value={content} onChange={setContent} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={selected?.kind === 'voice' ? 'Este canal é de voz' : selected ? `Mensagem em #${selected.name}...` : 'Escolha um canal para começar'} maxLength={2000} disabled={!selected || selected.kind === 'voice'}/><div className="chat-composer-tools"><EmojiButton onBeforeOpen={captureSelection} onSelect={insertEmoji}/><button type="button" aria-label="GIF (em breve)" title="GIF em breve" disabled><MaterialIcon name="gif"/></button><button type="button" aria-label="Anexar imagem (em breve)" title="Anexos em breve" disabled><MaterialIcon name="image"/></button></div></div><button className="chat-composer-send" type="submit" disabled={!selected || selected.kind === 'voice' || !content.trim()} aria-label="Enviar mensagem"><MaterialIcon name="send"/></button></form>
    </section>
    {membersOpen && <button className="members-scrim" type="button" onClick={() => setMembersOpen(false)} aria-label="Fechar lista de membros"/>}<aside className={`chat-members ${membersOpen ? 'is-open' : ''}`}><header><h2>Membros <small>({members.length})</small></h2><button type="button" onClick={() => setMembersOpen(false)} aria-label="Fechar"><MaterialIcon name="close"/></button><button className="member-search-button" type="button" aria-label="Buscar membros"><MaterialIcon name="search"/></button></header><h3>Online <small>({members.filter((member) => member.online).length})</small></h3>{members.filter((member) => member.online).map((member) => <div key={member.id}><Avatar character={member}/><span>{member.displayName} <small>online nesta sessão</small></span><i className="online-dot"/></div>)}<h3>Offline</h3>{members.filter((member) => !member.online).map((member) => <div key={member.id}><Avatar character={member}/><span>{member.displayName} <small>@{member.username}</small></span></div>)}<section className="voice-sidebar-section"><h3><MaterialIcon name="headphones"/> Canais de voz <MaterialIcon name="add"/></h3><p>Canais de voz estarão disponíveis em uma atualização futura.</p></section></aside>
    {creatingCategory && <div className="chat-create-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !categoryCreateBusy) setCreatingCategory(false); }}><form className="chat-create-modal chat-create-category-modal" onSubmit={(event) => void createCategory(event)} role="dialog" aria-modal="true" aria-labelledby="chat-category-title"><button className="chat-create-close" type="button" aria-label="Fechar" onClick={() => setCreatingCategory(false)} disabled={categoryCreateBusy}><MaterialIcon name="close"/></button><span className="chat-create-eyebrow">CANAIS DA COMUNIDADE</span><h2 id="chat-category-title">Criar categoria</h2><label>Nome da categoria<input autoFocus value={newCategoryName} onChange={(event) => setNewCategoryName(event.currentTarget.value)} maxLength={60} placeholder="ex.: Conversas gerais" required/></label><label className="chat-create-category-private"><span><strong><MaterialIcon name="lock"/> Categoria privada</strong><small>Somente a equipe da comunidade poderá visualizar esta categoria e seus canais.</small></span><input type="checkbox" checked={newCategoryPrivate} onChange={(event) => setNewCategoryPrivate(event.currentTarget.checked)}/></label>{categoryCreateError && <p className="chat-create-error" role="alert">{categoryCreateError}</p>}<footer><button type="button" onClick={() => setCreatingCategory(false)} disabled={categoryCreateBusy}>Cancelar</button><button className="chat-create-submit" type="submit" disabled={categoryCreateBusy || newCategoryName.trim().length < 2}>{categoryCreateBusy ? "Criando…" : "Criar categoria"}</button></footer></form></div>}
    {creatingChannel && <div className="chat-create-modal-backdrop chat-create-channel-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !channelCreateBusy) setCreatingChannel(false); }}><form className="chat-create-modal chat-create-channel-modal" onSubmit={(event) => void createChannel(event)} role="dialog" aria-modal="true" aria-labelledby="chat-create-title"><button className="chat-create-close" type="button" aria-label="Fechar" onClick={() => setCreatingChannel(false)} disabled={channelCreateBusy}><MaterialIcon name="close"/></button><h2 id="chat-create-title">Criar canal</h2><p className="chat-create-channel-category">em {newChannelCategory}</p><fieldset className="chat-channel-kind-picker"><legend>Tipo de canal</legend><label className={newChannelKind === 'text' ? 'is-selected' : ''}><input type="radio" name="channel-kind" value="text" checked={newChannelKind === 'text'} onChange={() => setNewChannelKind('text')}/><span className="chat-channel-kind-radio"/><span className="chat-channel-kind-copy"><strong><MaterialIcon name="tag"/> Texto</strong><small>Envie mensagens, imagens, GIFs, emojis, opiniões e piadas</small></span></label><label className={newChannelKind === 'voice' ? 'is-selected' : ''}><input type="radio" name="channel-kind" value="voice" checked={newChannelKind === 'voice'} onChange={() => setNewChannelKind('voice')}/><span className="chat-channel-kind-radio"/><span className="chat-channel-kind-copy"><strong><MaterialIcon name="volume_up"/> Voz</strong><small>Passe tempo com a turma com voz, vídeo e compartilhamento de tela</small></span></label><label className={newChannelKind === 'forum' ? 'is-selected' : ''}><input type="radio" name="channel-kind" value="forum" checked={newChannelKind === 'forum'} onChange={() => setNewChannelKind('forum')}/><span className="chat-channel-kind-radio"/><span className="chat-channel-kind-copy"><strong><MaterialIcon name="forum"/> Fórum</strong><small>Crie um espaço para discussões organizadas</small></span></label></fieldset><label className="chat-create-channel-name">Nome do canal<div><MaterialIcon name="tag"/><input autoFocus value={newChannelName} onChange={(event) => setNewChannelName(event.currentTarget.value)} maxLength={40} placeholder="novo-canal" required/></div></label><label className="chat-create-channel-private"><span><strong><MaterialIcon name="lock"/> Canal privado</strong><small>Somente a equipe da comunidade poderá visualizar esse canal.</small></span><input type="checkbox" checked={newChannelPrivate} onChange={(event) => setNewChannelPrivate(event.currentTarget.checked)}/></label>{channelCreateError && <p className="chat-create-error" role="alert">{channelCreateError}</p>}<footer><button type="button" onClick={() => setCreatingChannel(false)} disabled={channelCreateBusy}>Cancelar</button><button className="chat-create-submit" type="submit" disabled={channelCreateBusy || !newChannelName.trim() || !newChannelCategory.trim()}>{channelCreateBusy ? "Criando…" : "Criar canal"}</button></footer></form></div>}
  </div>;
}

type DirectThread = { character: ChatMember; lastMessage: string; createdAt: string; unreadCount?: number };
type DirectMessageItem = { id: string; content: string; createdAt: string; own: boolean; readAt?: string | null };
function MessagesPage() {
  const [threads, setThreads] = useState<DirectThread[]>([]);
  const [selected, setSelected] = useState(new URLSearchParams(window.location.search).get('to') ?? '');
  const [recipient, setRecipient] = useState('');
  const [activeCharacter, setActiveCharacter] = useState<ChatMember | null>(null);
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [content, setContent] = useState(new URLSearchParams(window.location.search).get('draft') ?? '');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { captureSelection, insertEmoji } = useEmojiInsertion(contentRef, content, setContent);
  const [error, setError] = useState('');
  const [partnerTyping, setPartnerTyping] = useState(false);
  const activeCharacterRef = useRef(activeCharacter);
  activeCharacterRef.current = activeCharacter;
  const selectedUsernameRef = useRef(selected);
  selectedUsernameRef.current = selected;
  const messagesListRef = useRef<HTMLDivElement>(null);
  const typingActive = useRef(false);
  const typingTimeout = useRef<number | undefined>(undefined);
  function sendTypingState(typing: boolean) {
    if (!selected) return;
    void fetch('/api/messages/typing', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toUsername: selected, typing }) });
  }
  function updateDraft(value: string) {
    setContent(value);
    if (!value.trim()) {
      window.clearTimeout(typingTimeout.current);
      if (typingActive.current) { typingActive.current = false; sendTypingState(false); }
      return;
    }
    if (!typingActive.current) { typingActive.current = true; sendTypingState(true); }
    window.clearTimeout(typingTimeout.current);
    typingTimeout.current = window.setTimeout(() => { typingActive.current = false; sendTypingState(false); }, 1800);
  }
  async function loadThreads() { try { setThreads(await apiRequest<DirectThread[]>('/api/messages')); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as mensagens.'); } }
  async function openThread(username: string) {
    const normalized = username.trim().replace(/^@/, '').toLowerCase();
    if (!normalized) return;
    const result = await apiRequest<{ character: ChatMember; messages: DirectMessageItem[]; typing: boolean }>(`/api/messages/${encodeURIComponent(normalized)}`);
    setSelected(normalized); setActiveCharacter(result.character); setMessages(result.messages); setPartnerTyping(result.typing); setRecipient('');
    window.dispatchEvent(new Event('vybe:messages-read'));
    void loadThreads();
    window.history.replaceState({}, '', `/mensagens?to=${encodeURIComponent(normalized)}`);
  }
  useEffect(() => { void loadThreads(); }, []);
  useEffect(() => { if (selected) void openThread(selected); }, []);
  useEffect(() => connectConversationRealtime((event) => {
    if (event.type === 'ready') {
      void loadThreads();
      if (selectedUsernameRef.current) void openThread(selectedUsernameRef.current);
      return;
    }
    if (event.otherProfileId && event.otherProfileId === activeCharacterRef.current?.id) {
      if (event.type === 'direct:typing') setPartnerTyping(Boolean(event.typing));
      if (event.type === 'direct:message') void openThread(selectedUsernameRef.current).then(loadThreads).catch(() => undefined);
    }
  }), []);
  useEffect(() => {
    const list = messagesListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, partnerTyping]);
  useEffect(() => () => {
    window.clearTimeout(typingTimeout.current);
    if (typingActive.current) sendTypingState(false);
  }, [selected]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !content.trim()) return;
    window.clearTimeout(typingTimeout.current);
    typingActive.current = false;
    sendTypingState(false);
    const sent = await apiRequest<DirectMessageItem>('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toUsername: selected, content }) });
    setMessages((items) => [...items, sent]); setContent(''); void loadThreads();
  }
  return <div className={`direct-messages ${selected ? 'has-thread' : ''}`}><aside className="direct-sidebar"><header><span>PRIVADO</span><h1>Mensagens</h1><form onSubmit={(event) => { event.preventDefault(); void openThread(recipient); }}><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Iniciar com @usuário"/><button type="submit" aria-label="Abrir conversa"><MaterialIcon name="arrow_forward"/></button></form></header><div className="direct-thread-list">{threads.map((thread) => <button type="button" className={selected === thread.character.username ? 'active' : ''} key={thread.character.id} onClick={() => void openThread(thread.character.username)}><Avatar character={thread.character}/><span><strong>{thread.character.displayName} </strong><small>{thread.lastMessage}</small></span>{Boolean(thread.unreadCount) && <i className="direct-unread-dot" aria-label={`${thread.unreadCount} mensagens não lidas`}/>}</button>)}</div></aside><section className="direct-main"><header className="chat-channel-header"><button className="chat-back" type="button" onClick={() => { setSelected(''); setActiveCharacter(null); window.history.replaceState({}, '', '/mensagens'); }} aria-label="Voltar às mensagens"><MaterialIcon name="arrow_back"/></button>{activeCharacter ? <><Avatar character={activeCharacter}/><div><h2>{activeCharacter.displayName} </h2><p>@{activeCharacter.username}</p>{partnerTyping && <small className="direct-typing-indicator">Digitando…</small>}</div></> : <div><h2>Suas mensagens</h2><p>Converse em particular com personagens da comunidade.</p></div>}</header>{activeCharacter ? <><div className="chat-message-list direct-chat-message-list" ref={messagesListRef}>{error && <p className="inline-error" role="alert">{error}</p>}{messages.map((message) => <article className={`direct-message ${message.own ? 'own' : ''}`} key={message.id}><FormattedText text={message.content}/><small>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{message.own && <span className="direct-read-status">{message.readAt ? ' · Visualizado' : ' · Enviado'}</span>}</small></article>)}{messages.length === 0 && <div className="chat-empty"><MaterialIcon name="mail"/><p>Envie a primeira mensagem para {activeCharacter.displayName}.</p></div>}</div><form className="chat-composer" onSubmit={(event) => void send(event)}><TextFormattingEditor ref={contentRef} value={content} onChange={updateDraft} onBlur={() => { window.clearTimeout(typingTimeout.current); if (typingActive.current) { typingActive.current = false; sendTypingState(false); } }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={2000} placeholder={`Mensagem para ${activeCharacter.displayName}...`}/><div><EmojiButton onBeforeOpen={captureSelection} onSelect={insertEmoji}/><small>Enter envia · Shift + Enter quebra linha</small><button className="primary-button" type="submit" disabled={!content.trim()} aria-label="Enviar mensagem"><MaterialIcon name="send"/></button></div></form></> : <div className="chat-empty direct-empty"><MaterialIcon name="mail"/><p>Escolha uma conversa ou inicie uma nova pelo nome de usuário.</p></div>}</section></div>;
}

function CommunityPage({ tenant }: { tenant: TenantInfo | null }) { return <section className="social-page-card tenant-about"><div className="about-cover"/><span className="about-crest"><MaterialIcon name="auto_awesome"/></span><h1>{tenant?.name ?? 'VYBE Community'}</h1><p>{tenant?.description}</p><div className="about-stats"><strong>{tenant?.memberCount ?? 0}<small>membros</small></strong><strong>Pública<small>comunidade</small></strong><strong>Aberta<small>entrada</small></strong></div><h2>Regras da comunidade</h2><ol>{(tenant?.rules ?? ['Respeite os outros personagens e suas histórias.', 'Mantenha as interações dentro das regras da comunidade.', 'Use os canais adequados para dúvidas e sugestões.']).map((rule) => <li key={rule}>{rule}</li>)}</ol><h2>Administradores</h2>{tenant?.administrators?.length ? tenant.administrators.map((admin) => <a className="community-admin" href={`/@${admin.username}`} key={admin.id}><Avatar character={admin}/><span><strong>{admin.displayName}</strong><small>@{admin.username} · Administração</small></span></a>) : <p>A equipe da comunidade será exibida aqui quando configurada.</p>}</section>; }
function CompaniesPage({ community }: { community: string }) { return <section className="social-page-card tenant-about"><span className="about-crest"><MaterialIcon name="apartment"/></span><h1>Empresas</h1><p>Organizações e instituições de {community} aparecerão aqui quando forem cadastradas.</p><p className="settings-empty-state">Nenhuma empresa disponível no momento.</p></section>; }

function NotificationsPage({ echo = false }: { echo?: boolean }) {
  const [items, setItems] = useState<{ id: string; type: string; targetId: string; amountCents?: number | null; communityName?: string; message?: string; joinUpdate?: { status: string; communityName: string; message: string } | null; actor: SocialCharacter | null; createdAt: string; readAt?: string }[]>([]);
  useEffect(() => {
    void apiRequest<typeof items>('/api/notifications')
      .then((all) => all.filter((item) => echo
        ? ['echo_like', 'echo_mention', 'repost', 'echo_reply', 'follow'].includes(item.type)
        : ['like', 'comment', 'follow', 'mention', 'message', 'match_created', 'post_trending', 'bank_transfer_received', 'bank_admin_credit_received', 'community_join_update', 'community_creation_update', 'verification_requested', 'verification_payment_confirmed', 'verification_payment_issue', 'verification_approved', 'verification_rejected', 'verification_suspended', 'verification_removed', 'verification_gift_received', 'verification_gift_activated'].includes(item.type)))
      .then(setItems)
      .then(() => apiRequest(`/api/notifications/read${echo ? '?scope=echo' : ''}`, { method: 'PATCH' }))
      .catch(() => undefined);
  }, [echo]);
  const descriptions: Record<string, string> = {
    follow: 'começou a seguir você.', message: 'enviou uma mensagem para você.', match_created: 'Você deu Match! Agora podem conversar.', like: 'curtiu uma publicação sua.',
    comment: 'comentou em uma publicação sua.', post_trending: 'entrou em Trend. Entre para conferir.',
    echo_like: 'curtiu seu Echo.', echo_reply: 'respondeu ao seu Echo.', repost: 'repostou seu Echo.',
    mention: 'mencionou você em uma publicação.', echo_mention: 'mencionou você em um Echo.',
    verification_requested: 'recebeu sua solicitação de VYBE Verificado.',
    verification_payment_confirmed: 'confirmou o pagamento do seu VYBE Verificado.',
    verification_payment_issue: 'não conseguiu identificar seu pagamento do VYBE Verificado. Confira o comprovante ou fale com o VYBE Suporte.',
    verification_approved: 'ativou seu VYBE Verificado.', verification_rejected: 'atualizou sua solicitação de VYBE Verificado.',
    verification_suspended: 'suspendeu temporariamente seu VYBE Verificado.', verification_removed: 'revogou seu VYBE Verificado.'
  };
  function notificationText(item: (typeof items)[number]) {
    if (item.type === 'community_creation_update') return item.message || `A solicitação de criação da comunidade ${item.communityName || ''} foi atualizada.`;
    if (item.type === 'bank_transfer_received') return `enviou ${moneyForNotification(item.amountCents)} para você.`;
    if (item.type === 'bank_admin_credit_received') return `creditou ${moneyForNotification(item.amountCents)} na sua carteira.`;
    if (item.type === 'verification_gift_received') return `Você ganhou o VYBE Verificado ✦. Seu perfil em ${item.communityName || 'sua comunidade'} agora possui benefícios VYBE+.`;
    if (item.type === 'verification_gift_activated') return `O presente de VYBE Verificado para @${item.actor?.username ?? 'perfil'} foi ativado em ${item.communityName || 'sua comunidade'}.`;
    if (item.type === 'community_join_update') {
      const update = item.joinUpdate;
      if (!update) return 'atualizou sua solicitação de entrada em uma comunidade.';
      const statusText = update.status === 'APPROVED' ? 'aprovou sua entrada' : update.status === 'REJECTED' ? 'recusou sua solicitação' : 'solicitou ajustes na sua ficha';
      return `${statusText} em ${update.communityName}.${update.message ? ` ${update.message}` : ''}`;
    }
    return descriptions[item.type] ?? '';
  }
  return <section className="social-page-card"><div className="social-page-title"><span>{echo ? 'VYBE ECHO' : 'ATIVIDADE'}</span><h1>Notificações</h1></div>{items.map((item) => <article className="notification-row" key={item.id}><Avatar character={item.actor}/><p><strong>{item.type === 'community_join_update' ? 'Atualização da comunidade' : item.actor?.displayName ?? 'Alguém'}</strong> {notificationText(item)}<small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small></p></article>)}{!items.length && <div className="blank-state">Nenhuma novidade por enquanto.</div>}</section>;
}

function moneyForNotification(cents?: number | null) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100); }

type SettingsData = {
  role: 'owner';
  community: {
    id: string; name: string; slug: string; subdomain: string; description: string; category: string; logoUrl: string; coverUrl: string; wallpaperUrl: string;
    status: string; memberCount: number; entry: string; brand: { primary: string; dark: string; medium: string; soft: string; lilac: string; white: string; graphite: string };
    settings: {
      access: { visibility: 'public' | 'private' | 'controlled'; approvalRequired: boolean; invitesEnabled: boolean; welcomeMessage: string };
      characters: { usernameMinLength: number; usernameMaxLength: number; minimumAge: number; requireBio: boolean; customFields: Array<{ key: string; label: string; required: boolean }> };
      features: { feed: boolean; pulse: boolean; stories: boolean; conversations: boolean; messages: boolean; events: boolean; match?: boolean; bank?: boolean; academic?: boolean; career?: boolean; news?: boolean; companies?: boolean; eventCreation: 'any_pending' | 'staff' | 'admins' | 'owner' };
      privacy: { showInDirectory: boolean; showMembers: boolean; showAdmins: boolean; publicContent: boolean };
      moderation: { rules: string[]; requireReportReason: boolean; maxPostLength: number };
    };
  };
  team: Array<{ accountId: string; role: 'owner' | 'admin' | 'moderator'; email: string; character: string }>;
  pendingMembers: Array<{ accountId: string; email: string; createdAt: string; character: { displayName: string; username: string; bio: string; avatarUrl: string } | null }>;
  joinRequests: Array<{ id: string; status: 'PENDING' | 'NEEDS_INFORMATION'; createdAt: string; characterName: string; requestedUsername: string; characterAge: number; photoplayerName: string; photoplayerImageUrl: string; characterDescription: string; customAnswers: Array<{ key: string; label: string; value: string }>; requestedChanges: string[]; adminMessage: string; requester: { id: string; displayName: string; username: string; avatarUrl: string } | null }>;
  members: Array<{ accountId: string; joinedAt: string; displayName: string; username: string; bio: string; avatarUrl: string }>;
  pendingEvents: Array<{ id: string; title: string; description: string; startsAt: string; location: string; category: string; createdAt: string }>;
  sanctions: Array<{ id: string; accountId: string; action: 'suspend' | 'ban'; reason: string; createdAt: string; endsAt: string | null; displayName: string; username: string; avatarUrl: string }>;
  reports: Array<{ id: string; kind: 'post' | 'message' | 'content'; targetId: string; reason: string; createdAt: string; reporterName: string; reporterUsername: string; authorName: string; authorUsername: string; content: string; images: string[] }>;
  audit: Array<{ id: string; action: string; details: Record<string, unknown>; createdAt: string; actorEmail: string }>;
  metrics: { pendingMembers: number; teachers: number; newsWriters: number; pendingEvents: number; activeMembers: number; openReports: number | null };
};

function JoinRequestReviewCard({ request, onReview }: { request: SettingsData['joinRequests'][number]; onReview: (id: string, decision: 'approve' | 'request_changes' | 'reject', payload?: { fields?: string[]; message?: string }) => Promise<void> }) {
  const [fields, setFields] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(decision: 'approve' | 'request_changes' | 'reject', selectedFields?: string[]) {
    setBusy(true);
    try { await onReview(request.id, decision, { ...(selectedFields ? { fields: selectedFields } : {}), ...(message.trim() ? { message: message.trim() } : {}) }); }
    catch (error) { notifySnack(error instanceof Error ? error.message : 'Não foi possível revisar esta ficha.'); }
    finally { setBusy(false); }
  }
  function toggleField(field: string) { setFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]); }
  return <article className="settings-join-request"><header><Avatar character={{ displayName: request.requester?.displayName ?? 'Membro', avatarUrl: request.requester?.avatarUrl ?? '' }}/><div><strong>Solicitação de {request.requester?.displayName ?? 'membro'}</strong><small>{request.requester?.username ? `@${request.requester.username}` : ''}</small></div><span className={`join-request-status is-${request.status.toLowerCase()}`}>{request.status === 'PENDING' ? 'Aguardando análise' : 'Alterações solicitadas'}</span></header>
    {request.status === 'NEEDS_INFORMATION' && <p className="join-request-admin-message">{request.adminMessage}</p>}
    <div className="join-request-profile"><img src={request.photoplayerImageUrl} alt={`Photoplayer de ${request.characterName}`}/><div><span>PERSONAGEM</span><h3>{request.characterName}</h3><p>@{request.requestedUsername} · {request.characterAge} anos</p><p><b>Photoplayer:</b> {request.photoplayerName}</p><time>{new Date(request.createdAt).toLocaleString('pt-BR')}</time></div></div>
    <section><h4>Quem é você?</h4><p>{request.characterDescription}</p></section>
    {!!request.customAnswers.length && <section><h4>Perguntas adicionais</h4>{request.customAnswers.map((answer) => <p key={answer.key}><b>{answer.label}:</b> {answer.value}</p>)}</section>}
    <div className="join-request-review-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void submit('approve')}>Aprovar</button>
      <details><summary>Solicitar alteração</summary><form onSubmit={(event) => { event.preventDefault(); void submit('request_changes', fields); }}><div>{[['username', 'Username'], ['photoplayer', 'Photoplayer'], ['description', 'Descrição']].map(([key, label]) => <label key={key}><input type="checkbox" checked={fields.includes(key)} onChange={() => toggleField(key)}/>{label}</label>)}</div><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} placeholder="Explique o que precisa ser atualizado." required minLength={3}/><button type="submit" disabled={busy || !fields.length}>Enviar pedido</button></form></details>
      <details><summary>Recusar</summary><form onSubmit={(event) => { event.preventDefault(); void submit('reject'); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} placeholder="Informe o motivo da recusa." required minLength={3}/><button type="submit" disabled={busy}>Confirmar recusa</button></form></details>
    </div>
  </article>;
}

const settingsTabs = [
  ['overview', 'Visão geral', 'home'], ['members', 'Solicitações de entrada', 'person_add'], ['directory', 'Membros', 'groups'], ['team', 'Equipe e permissões', 'groups'], ['academic', 'Acadêmico', 'school'], ['news', 'Notícias (Jornal)', 'newspaper'], ['events', 'Eventos e calendário', 'calendar_month'], ['moderation', 'Moderação', 'shield'], ['general', 'Configurações gerais', 'tune'], ['access', 'Acesso e entrada', 'lock_open'], ['characters', 'Identidade', 'person'],
  ['features', 'Aplicativos', 'apps'], ['privacy', 'Privacidade', 'visibility'], ['advanced', 'Auditoria', 'settings'], ['risk', 'Zona de risco', 'warning'], ['support', 'Suporte e direção VYBE', 'support_agent'],
] as const;
const settingsTabGroups = [
  { label: 'COMUNIDADE', keys: ['overview', 'general', 'access', 'privacy'] },
  { label: 'PESSOAS', keys: ['members', 'directory', 'team', 'characters'] },
  { label: 'APLICATIVOS', keys: ['features', 'events'] },
  { label: 'SEGURANÇA', keys: ['moderation', 'advanced', 'risk'] },
  { label: 'ATENDIMENTO', keys: ['support'] },
] as const;

function SettingsIcon({ name }: { name: string }) {
  const names: Record<string, string> = { bolt: 'bolt', lock_open: 'lock_open', warning: 'warning' };
  return <MaterialIcon name={names[name] ?? name} className="settings-tab-icon"/>;
}

function SettingsOverview({ data, onSelect, onDecide, onResolveReport }: { data: SettingsData; onSelect: (tab: (typeof settingsTabs)[number][0]) => void; onDecide: (id: string, decision: 'approve' | 'reject') => void; onResolveReport: (reportId: string, kind: 'post' | 'message' | 'content') => void }) {
  const incomingRequests = data.pendingMembers.length + data.joinRequests.length;
  const stats = [
    ['Solicitações pendentes', incomingRequests, 'person_add', 'members'],
    ['Professores', data.metrics.teachers, 'school', 'academic'],
    ['Ocorrências abertas', data.metrics.openReports ?? 0, 'flag', 'moderation'],
  ] as const;
  const areas = [
    { key: 'community', title: 'Configurações da comunidade', text: 'Ajuste informações, acesso e recursos disponíveis.', icon: 'settings', links: [['Configurações gerais', 'general'], ['Acesso e entrada', 'access'], ['Aplicativos', 'features']] },
    { key: 'moderation', title: 'Moderação e segurança', text: 'Acompanhe regras e ações de segurança.', icon: 'shield', links: [['Regras da comunidade', 'moderation'], ['Ações recentes', 'advanced']] },
  ] as const;
  return <div className="settings-dashboard">
    <section className="settings-community-banner" style={data.community.coverUrl ? { backgroundImage: `linear-gradient(90deg,#064c39f2,#064c39ad 56%,#064c3930),url("${data.community.coverUrl}")` } : undefined}>
      <span className="settings-community-emblem">{data.community.logoUrl ? <img src={data.community.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span>
      <div><h2>{data.community.name}</h2><p>{data.community.description}</p></div><span className="settings-community-status">Comunidade {data.community.status === 'active' ? 'ativa' : data.community.status}</span>
    </section>
    <div className="settings-metrics">{stats.map(([label, value, icon, tab]) => <button type="button" key={label} onClick={() => onSelect(tab)}><span><SettingsIcon name={icon}/></span><strong>{value}</strong><small>{label}</small></button>)}</div>
    <div className="settings-dashboard-grid">
      <section className="settings-dashboard-panel settings-dashboard-requests"><header><h2><SettingsIcon name="person_add"/>Solicitações de entrada <span className="settings-request-count">{incomingRequests}</span></h2><button type="button" onClick={() => onSelect('members')}>Ver todas →</button></header>
        {data.joinRequests.slice(0, 3).map((joinRequest) => <article key={joinRequest.id}><span className="settings-pending-avatar">{joinRequest.photoplayerImageUrl ? <img src={joinRequest.photoplayerImageUrl} alt={`Foto enviada para ${joinRequest.characterName}`} loading="lazy"/> : joinRequest.characterName.slice(0, 1).toUpperCase()}</span><div><strong>{joinRequest.requester?.displayName ?? joinRequest.characterName}</strong><small>@{joinRequest.requestedUsername} · {joinRequest.status === 'PENDING' ? 'Aguardando análise' : 'Alterações solicitadas'}</small></div><time>{new Date(joinRequest.createdAt).toLocaleDateString('pt-BR')}</time><button type="button" className="settings-approve" onClick={() => onSelect('members')}>Revisar ficha</button></article>)}
        {data.pendingMembers.slice(0, Math.max(0, 3 - data.joinRequests.length)).map((member) => <article key={member.accountId}><span className="settings-pending-avatar">{member.character?.avatarUrl ? <img src={member.character.avatarUrl} alt=""/> : (member.character?.displayName ?? member.email).slice(0, 1).toUpperCase()}</span><div><strong>{member.character?.displayName ?? 'Novo membro'}</strong><small>{member.character?.username ? `@${member.character.username}` : member.email}</small></div><time>{new Date(member.createdAt).toLocaleDateString('pt-BR')}</time><button type="button" className="settings-approve" onClick={() => onDecide(member.accountId, 'approve')}>✓ Aprovar</button><button type="button" className="settings-reject" onClick={() => onDecide(member.accountId, 'reject')}>× Recusar</button></article>)}
        {!incomingRequests && <p className="settings-dashboard-empty">Nenhuma solicitação de entrada pendente.</p>}
      </section>
      {areas.map((area) => <section className={`settings-dashboard-panel settings-dashboard-area settings-dashboard-area--${area.key}`} key={area.title}><header><h2><SettingsIcon name={area.icon}/>{area.title}</h2></header><p>{area.text}</p>{area.links.map(([label, tab]) => <button type="button" key={label} onClick={() => onSelect(tab)}><span>{label}</span><b>›</b></button>)}</section>)}
      <section className="settings-dashboard-panel settings-dashboard-events"><header><h2><SettingsIcon name="calendar_month"/>Eventos e calendário</h2><button type="button" onClick={() => { window.location.href = '/eventos/admin'; }}>Ver solicitações →</button></header>{data.pendingEvents.slice(0, 3).map((event) => <article key={event.id}><span className="settings-event-icon"><SettingsIcon name="calendar_month"/></span><div><strong>{event.title}</strong><small>{event.location} · {new Date(event.startsAt).toLocaleString('pt-BR')}</small></div><span className="settings-event-pending">Pendente</span></article>)}{!data.pendingEvents.length && <p className="settings-dashboard-empty">Nenhum evento aguardando aprovação.</p>}</section>
      <section className="settings-dashboard-panel settings-dashboard-reports"><header><h2><SettingsIcon name="flag"/>Ocorrências abertas</h2><span>{data.metrics.openReports ?? data.reports.length}</span></header>{data.reports.length ? data.reports.map((report) => <article key={report.id}><div className="settings-report-meta"><b>{report.kind === 'post' ? 'Publicação ou foto' : report.kind === 'content' ? 'Mensagem, perfil ou conteúdo' : 'Mensagem'}</b><time>{new Date(report.createdAt).toLocaleString('pt-BR')}</time></div><p className="settings-report-content">{report.content}</p>{report.images.length > 0 && <div className="settings-report-images">{report.images.map((image) => <img key={image} src={image} alt="Imagem denunciada" loading="lazy"/>)}</div>}<p className="settings-report-reason"><strong>Motivo:</strong> {report.reason}</p><small>Denunciado por {report.reporterName}{report.reporterUsername ? ` (@${report.reporterUsername})` : ''} · conteúdo de {report.authorName}{report.authorUsername ? ` (@${report.authorUsername})` : ''}</small><button type="button" onClick={() => onResolveReport(report.id, report.kind)}>Marcar como resolvida</button></article>) : <p className="settings-dashboard-empty">Nenhuma ocorrência aberta.</p>}</section>
    </div>
  </div>;
}

function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<(typeof settingsTabs)[number][0]>(() => { const requested = new URLSearchParams(window.location.search).get('tab'); return settingsTabs.some(([key]) => key === requested) ? requested as (typeof settingsTabs)[number][0] : 'overview'; });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState('');
  const [cover, setCover] = useState('');
  const [selectedJoinRequest, setSelectedJoinRequest] = useState<SettingsData['joinRequests'][number] | null>(null);
  const [reviewingJoinRequestId, setReviewingJoinRequestId] = useState('');
  const [sanctionMember, setSanctionMember] = useState<SettingsData['members'][number] | null>(null);
  const [sanctionForm, setSanctionForm] = useState({ action: 'ban' as 'ban' | 'suspend', durationDays: '', reason: '' });
  const [sanctionConfirmed, setSanctionConfirmed] = useState(false);
  const [teamRole, setTeamRole] = useState<'owner' | 'admin' | 'moderator'>('admin');

  async function load() {
    setLoading(true);
    try { setData(await apiRequest<SettingsData>('/api/settings/community', { cache: 'no-store' })); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as configurações.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (tab !== 'overview') return;
    const refresh = () => { void fetch('/api/settings/community', { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.ok ? response.json() as Promise<SettingsData> : null).then((next) => { if (next) setData(next); }).catch(() => undefined); };
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  async function save(section: string, values: Record<string, unknown>) {
    setSaving(true); setNotice('');
    try {
      await apiRequest(`/api/settings/community/${section}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      setNotice('Configurações salvas.'); await load();
    } finally { setSaving(false); }
  }
  async function submitForm(section: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget);
    if (section === 'general') {
      const images: Record<string, unknown> = {};
      for (const [key, preview] of [['logo', logo], ['cover', cover]] as const) {
        if (preview) images[key] = preview;
        else { const file = fields.get(key); if (file instanceof File && file.size) images[key] = await fileAsDataUrl(file); }
      }
      const category = String(fields.get('category') ?? '').trim();
      await save(section, { name: fields.get('name'), description: fields.get('description'), ...(category ? { category } : {}), ...images });
      setLogo(''); setCover(''); return;
    }
    if (section === 'access') await save(section, { visibility: fields.get('visibility'), approvalRequired: fields.get('approvalRequired') === 'on', invitesEnabled: fields.get('invitesEnabled') === 'on', welcomeMessage: fields.get('welcomeMessage') });
    if (section === 'characters') {
      const customFields = String(fields.get('customFields') ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const [labelText, requiredText] = line.split('|').map((part) => part.trim()); const label = labelText.replace(/\*$/, '').trim(); const key = label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30); return { key, label, required: requiredText === 'obrigatorio' || labelText.endsWith('*') }; });
      await save(section, { usernameMinLength: Number(fields.get('usernameMinLength')), usernameMaxLength: Number(fields.get('usernameMaxLength')), requireBio: fields.get('requireBio') === 'on', customFields });
    }
    if (section === 'moderation') await save(section, { rules: String(fields.get('rules') ?? '').split('\n').map((line) => line.trim()).filter(Boolean), requireReportReason: fields.get('requireReportReason') === 'on', maxPostLength: Number(fields.get('maxPostLength')) });
    if (section === 'privacy') await save(section, { showInDirectory: fields.get('showInDirectory') === 'on', showMembers: fields.get('showMembers') === 'on', showAdmins: fields.get('showAdmins') === 'on', publicContent: fields.get('publicContent') === 'on' });
    if (section === 'appearance') {
      await save(section, { primary: fields.get('primary'), dark: fields.get('dark'), medium: fields.get('medium'), soft: fields.get('soft'), light: fields.get('light') });
    }
  }
  async function saveFeatures(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const fields = new FormData(event.currentTarget); await save('features', { ...Object.fromEntries(['feed', 'pulse', 'stories', 'conversations', 'messages', 'events', 'match', 'bank', 'academic', 'news', 'companies'].map((key) => [key, fields.get(key) === 'on'])), career: false, eventCreation: community.settings.features.eventCreation ?? 'any_pending' }); }
  async function teamOperation(operation: 'add' | 'remove', values: Record<string, unknown>) { await apiRequest('/api/settings/community/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, ...values }) }); setNotice('Equipe atualizada.'); await load(); }
  async function createSanction(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!sanctionMember || !sanctionConfirmed || sanctionForm.reason.trim().length < 3) return; await apiRequest(`/api/settings/community/members/${sanctionMember.accountId}/sanctions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: sanctionForm.action, durationDays: sanctionForm.durationDays ? Number(sanctionForm.durationDays) : null, reason: sanctionForm.reason.trim() }) }); setSanctionMember(null); setSanctionForm({ action: 'ban', durationDays: '', reason: '' }); setSanctionConfirmed(false); setNotice(sanctionForm.action === 'ban' ? 'Membro banido; o histórico foi preservado.' : 'Membro suspenso.'); await load(); }
  async function revokeSanction(id: string) { await apiRequest(`/api/settings/community/sanctions/${id}/revoke`, { method: 'POST' }); setNotice('Acesso do membro restaurado.'); await load(); }
  async function resolveCommunityReport(reportId: string, kind: 'post' | 'message' | 'content') { const [, id] = reportId.split(':'); await apiRequest(`/api/settings/community/reports/${kind}/${id}/resolve`, { method: 'POST' }); setNotice('Denúncia marcada como resolvida.'); await load(); }
  async function decideMember(accountId: string, decision: 'approve' | 'reject') { const rejectedReason = decision === 'reject' ? window.prompt('Informe o motivo da recusa:')?.trim() : undefined; if (decision === 'reject' && (!rejectedReason || rejectedReason.length < 3)) return; await apiRequest(`/api/settings/community/members/${accountId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, ...(rejectedReason ? { rejectedReason } : {}) }) }); setNotice(decision === 'approve' ? 'Novo membro aprovado.' : 'Pedido de entrada recusado.'); await load(); }
  async function reviewJoinRequest(id: string, decision: 'approve' | 'request_changes' | 'reject', payload: { fields?: string[]; message?: string } = {}) { setReviewingJoinRequestId(id); try { await apiRequest(`/api/settings/community/join-requests/${id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, ...payload }) }); setSelectedJoinRequest(null); setNotice(decision === 'approve' ? 'Ficha aprovada e perfil criado.' : decision === 'reject' ? 'Solicitação recusada.' : 'Solicitação de alteração enviada.'); await load(); } finally { setReviewingJoinRequestId(''); } }
  function openSettingsTab(key: (typeof settingsTabs)[number][0]) { if (key === 'academic') window.location.href = '/academico/admin'; else if (key === 'news') window.location.href = '/noticias/editorial'; else if (key === 'events') window.location.href = '/eventos/admin'; else { setTab(key); window.history.replaceState({}, '', `/configuracoes?tab=${key}`); void load(); } }
  async function riskAction(action: 'transfer' | 'suspend' | 'request-deletion', fields: FormData) {
    const route = action === 'transfer' ? 'transfer' : action === 'suspend' ? 'suspend' : 'request-deletion';
    const payload = action === 'transfer' ? { email: fields.get('email'), confirmation: fields.get('confirmation') } : { confirmation: fields.get('confirmation'), reason: fields.get('reason') };
    const result = await apiRequest<{ message?: string; status?: string }>(`/api/settings/community/risk/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setNotice(result.message ?? (result.status === 'suspended' ? 'Comunidade suspensa.' : 'Ação registrada.'));
    if (action === 'suspend') window.location.assign('/comunidades'); else await load();
  }

  if (loading) return <section className="community-settings-loading">Carregando configurações…</section>;
  if (error || !data) return <section className="community-settings-denied"><MaterialIcon name="lock"/><h1>Configurações da comunidade</h1><p>{error || 'Não foi possível abrir esta área.'}</p><a href="/">Voltar ao início</a></section>;
  const community = data.community;
  const check = (name: string, label: string, checked: boolean) => <label className="settings-check" key={name}><input type="checkbox" name={name} defaultChecked={checked}/><span><strong>{label}</strong></span></label>;
  const submitButton = <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>;
  return <section className="community-settings-page"><header className="settings-page-heading"><div><span>CONTROLE DO UNIVERSO</span><h1>Configurações da Comunidade</h1><p>Gerencie pessoas, permissões, conteúdo, eventos e todas as áreas da {community.name}.</p></div></header>{notice && <p className="settings-notice" role="status">{notice}</p>}<div className="settings-layout"><nav className="settings-tabs" aria-label="Seções de configuração">{settingsTabGroups.map((group) => <section className="settings-tab-group" key={group.label}><h2>{group.label}</h2>{group.keys.map((key) => { const item = settingsTabs.find(([tabKey]) => tabKey === key); if (!item || (item[0] === 'support' && data.role !== 'owner')) return null; const [tabKey, label, icon] = item; return <button key={tabKey} type="button" className={tab === tabKey ? 'is-active' : ''} onClick={() => openSettingsTab(tabKey)} aria-current={tab === tabKey ? 'page' : undefined}><SettingsIcon name={icon}/><span>{label}</span></button>; })}</section>)}<a className="settings-personal-audio-link" href="/configuracoes/sons"><SettingsIcon name="volume_up"/><span>Sons e notificações</span></a><UniverseBackLink className="settings-universe-back"/></nav><div className="settings-content">
    {tab === 'overview' && <SettingsOverview data={data} onSelect={openSettingsTab} onDecide={(id, decision) => void decideMember(id, decision)} onResolveReport={(id, kind) => void resolveCommunityReport(id, kind)}/>}
    {tab === 'directory' && <section className="settings-directory"><div className="settings-section-heading"><h2>Membros ativos</h2><p>{data.metrics.activeMembers} pessoas fazem parte desta comunidade.</p></div>{data.members.map((member)=><article key={member.accountId}><Avatar character={{displayName:member.displayName,avatarUrl:member.avatarUrl}}/><span><strong>{member.displayName}</strong><small>@{member.username} · desde {new Date(member.joinedAt).toLocaleDateString('pt-BR')}</small></span><button type="button" onClick={() => { setSanctionForm({ action: 'ban', durationDays: '', reason: '' }); setSanctionConfirmed(false); setSanctionMember(member); }}>Suspender ou banir</button></article>)}</section>}
    {tab === 'general' && <form onSubmit={(event) => void submitForm('general', event)}><div className="settings-section-heading"><h2>Geral</h2><p>Informações públicas e endereço do universo.</p></div><label>Nome da comunidade<input name="name" defaultValue={community.name} required minLength={2} maxLength={80}/></label><label>Descrição<textarea name="description" defaultValue={community.description} required minLength={10} maxLength={500}/></label><label>Categoria<input name="category" defaultValue={community.category} maxLength={60}/></label><div className="settings-image-fields"><label className="settings-image-upload"><span className="settings-upload-title">Logo</span><input name="logo" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher logo da comunidade" onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { input.value = ''; notifySnack('A logo deve ter no máximo 2 MB.'); return; } void fileAsDataUrl(file).then(setLogo).catch(() => notifySnack('Não foi possível carregar a logo.')); }}/><span className={`settings-image-preview is-logo ${logo || community.logoUrl ? 'has-image' : ''}`} style={logo || community.logoUrl ? { backgroundImage: `url("${logo || community.logoUrl}")` } : undefined}><span>{logo || community.logoUrl ? 'Prévia da logo' : 'Adicione a logo da comunidade'}</span></span><span className="settings-image-help"><strong>{logo ? 'Logo selecionada' : community.logoUrl ? 'Trocar logo' : 'Escolher imagem'}</strong><small>PNG, JPG ou WebP · até 2 MB</small></span></label><label className="settings-image-upload"><span className="settings-upload-title">Capa</span><input name="cover" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher capa da comunidade" onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { input.value = ''; notifySnack('A capa deve ter no máximo 2 MB.'); return; } void fileAsDataUrl(file).then(setCover).catch(() => notifySnack('Não foi possível carregar a capa.')); }}/><span className={`settings-image-preview is-cover ${cover || community.coverUrl ? 'has-image' : ''}`} style={cover || community.coverUrl ? { backgroundImage: `url("${cover || community.coverUrl}")` } : undefined}><span>{cover || community.coverUrl ? 'Prévia da capa' : 'Adicione uma imagem de capa'}</span></span><span className="settings-image-help"><strong>{cover ? 'Capa selecionada' : community.coverUrl ? 'Trocar capa' : 'Escolher imagem'}</strong><small>PNG, JPG ou WebP · até 2 MB</small></span></label></div><div className="settings-readonly-row"><span>Slug e subdomínio</span><strong>{community.slug}.vybe.com.br</strong><small>Protegidos para manter o endereço e os arquivos da comunidade consistentes.</small></div>{submitButton}</form>}
    {tab === 'access' && <form onSubmit={(event) => void submitForm('access', event)}><div className="settings-section-heading"><h2>Acesso e entrada</h2><p>Defina como novos membros encontram e entram neste universo.</p></div><label>Visibilidade<select name="visibility" defaultValue={community.settings.access.visibility}><option value="public">Pública</option><option value="controlled">Entrada controlada</option><option value="private">Privada</option></select></label>{check('approvalRequired', 'Aprovar novos membros manualmente', community.settings.access.approvalRequired)}{check('invitesEnabled', 'Permitir convites', community.settings.access.invitesEnabled)}<label>Mensagem de boas-vindas<textarea name="welcomeMessage" defaultValue={community.settings.access.welcomeMessage} maxLength={500}/></label><p className="settings-help">Quando a aprovação estiver ativa, a pessoa envia uma ficha de entrada e aguarda a análise da administração.</p>{submitButton}</form>}
    {tab === 'characters' && <form onSubmit={(event) => void submitForm('characters', event)}><div className="settings-section-heading"><h2>Personagens</h2><p>Regras para nomes, idade mínima e perguntas da ficha de entrada.</p></div><div className="settings-field-row"><label>Username mínimo<input type="number" name="usernameMinLength" min={3} max={24} defaultValue={community.settings.characters.usernameMinLength}/></label><label>Username máximo<input type="number" name="usernameMaxLength" min={3} max={24} defaultValue={community.settings.characters.usernameMaxLength}/></label></div><label>Idade mínima para entrar<input type="number" name="minimumAge" min={13} max={100} defaultValue={community.settings.characters.minimumAge}/></label>{check('requireBio', 'Exigir apresentação no perfil', community.settings.characters.requireBio)}<label>Perguntas adicionais da ficha<textarea name="customFields" defaultValue={community.settings.characters.customFields.map((item) => `${item.label}${item.required ? '*' : ''} | ${item.required ? 'obrigatorio' : 'opcional'}`).join('\n')} placeholder={'Profissão* | obrigatorio\nInstituição | opcional'}/><small>Uma pergunta por linha. Use * para torná-la obrigatória.</small></label>{submitButton}</form>}
    {tab === 'features' && <form onSubmit={(event) => void saveFeatures(event)}><div className="settings-section-heading"><h2>Recursos</h2><p>Escolha quais aplicativos aparecem no universo.</p></div><div className="settings-check-grid">{check('feed', 'Social', community.settings.features.feed)}{check('pulse', 'Echo', community.settings.features.pulse)}{check('match', 'Match', community.settings.features.match ?? true)}{check('messages', 'Mensagens', community.settings.features.messages)}{check('bank', 'Banco virtual', community.settings.features.bank ?? true)}{check('events', 'Eventos', community.settings.features.events)}{check('stories', 'Stories', community.settings.features.stories)}{check('conversations', 'Conversas e canais', community.settings.features.conversations)}{check('academic', 'Acadêmico', community.settings.features.academic ?? true)}{check('news', 'Notícias', community.settings.features.news ?? true)}{check('companies', 'Empresas', community.settings.features.companies ?? true)}</div><p className="settings-help-text">Todos os membros ativos podem sugerir eventos. A publicação no calendário depende da aprovação do Owner ou Admin.</p>{submitButton}<a className="settings-events-review-link" href="/eventos/admin">Revisar solicitações de eventos →</a></form>}
    {tab === 'members' && <div><div className="settings-section-heading"><h2>Solicitações de entrada</h2><p>Confira a ficha completa ou aprove a entrada diretamente.</p></div><div className="settings-join-requests">{data.joinRequests.map((joinRequest) => <article className="settings-join-request-preview" key={joinRequest.id}><span className="settings-join-preview-top"><Avatar character={{ displayName: joinRequest.requester?.displayName ?? 'Membro', avatarUrl: joinRequest.requester?.avatarUrl ?? '' }}/><span><strong>{joinRequest.requester?.displayName ?? 'Novo membro'}</strong><small>{joinRequest.requester?.username ? `@${joinRequest.requester.username}` : 'Solicitação de entrada'}</small></span></span><img src={joinRequest.photoplayerImageUrl} alt=""/><strong className="settings-join-preview-character">{joinRequest.characterName}</strong><small className={`join-request-status is-${joinRequest.status.toLowerCase()}`}>{joinRequest.status === 'PENDING' ? 'Aguardando análise' : 'Alterações solicitadas'}</small><div className="settings-join-preview-actions"><button type="button" onClick={() => setSelectedJoinRequest(joinRequest)}>Ver ficha</button><button type="button" className="primary-button" disabled={reviewingJoinRequestId === joinRequest.id} onClick={() => void reviewJoinRequest(joinRequest.id, 'approve').catch(() => undefined)}>{reviewingJoinRequestId === joinRequest.id ? 'Aprovando…' : 'Aprovar'}</button></div></article>)}</div><div className="settings-pending-list">{data.pendingMembers.map((member) => <article key={member.accountId}><div className="settings-pending-avatar">{(member.character?.displayName ?? member.email).slice(0, 1).toUpperCase()}</div><div className="settings-pending-info"><strong>{member.character?.displayName ?? 'Novo membro'} {member.character?.username && <small>@{member.character.username}</small>}</strong><span>{member.email}</span>{member.character?.bio && <p>{member.character.bio}</p>}<time>{new Date(member.createdAt).toLocaleString('pt-BR')}</time></div><div className="settings-pending-actions"><button type="button" onClick={() => void decideMember(member.accountId, 'reject')}>Recusar</button><button className="primary-button" type="button" onClick={() => void decideMember(member.accountId, 'approve')}>Aprovar</button></div></article>)}{!data.pendingMembers.length && !data.joinRequests.length && <p className="settings-empty-state">Nenhum pedido de entrada aguardando aprovação.</p>}</div></div>}
    {tab === 'team' && <div>
      <div className="settings-section-heading"><h2>Equipe e permissões</h2><p>Escolha membros ativos pelo nome e defina a função de cada pessoa.</p></div>
      <details className="settings-role-guide"><summary>O que cada função pode fazer?</summary><div><article><strong>Owner</strong><p>Controle total das configurações e da equipe; pode transferir a propriedade. Só existe um Owner por comunidade.</p></article><article><strong>Admin</strong><p>Pode aprovar entradas, revisar e gerenciar eventos e administrar canais da equipe. Não altera configurações gerais nem gerencia a equipe.</p></article><article><strong>Moderator</strong><p>Pode criar e administrar canais da equipe, acessar canais privados e sugerir eventos, sujeitos à regra de aprovação da comunidade.</p></article></div></details>
      <div className="settings-team-list">{data.team.map((person) => <article key={person.accountId}><span className="settings-team-avatar">{(person.character || person.email || '?').slice(0, 1).toUpperCase()}</span><div><strong>{person.character || person.email}</strong><small>{person.email}</small></div><b>{person.role === 'owner' ? 'Owner' : person.role === 'admin' ? 'Admin' : 'Moderator'}</b>{data.role === 'owner' && person.role !== 'owner' && <button type="button" onClick={() => { if (window.confirm(`Remover ${person.character || person.email} da equipe?`)) void teamOperation('remove', { accountId: person.accountId }); }}>Remover</button>}</article>)}</div>
      {data.role === 'owner' && <form className={`settings-team-add ${teamRole === 'owner' ? 'is-owner' : ''}`} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void teamOperation('add', { accountId: values.get('accountId'), staffRole: teamRole, ...(teamRole === 'owner' ? { confirmation: values.get('confirmation') } : {}) }); event.currentTarget.reset(); setTeamRole('admin'); }}>
        <label>Nome do membro<select name="accountId" required defaultValue=""><option value="" disabled>Selecione uma pessoa</option>{data.members.filter((member) => !data.team.some((person) => person.accountId === member.accountId && (teamRole !== 'owner' || person.role === 'owner'))).map((member) => <option key={member.accountId} value={member.accountId}>{member.displayName}{member.username ? ` · @${member.username}` : ''}</option>)}</select></label>
        <label>Função<select name="staffRole" value={teamRole} onChange={(event) => setTeamRole(event.target.value as typeof teamRole)}><option value="admin">Admin</option><option value="moderator">Moderator</option><option value="owner">Owner · transferir propriedade</option></select></label>
        {teamRole === 'owner' && <label className="settings-team-owner-confirm">Digite “{data.community.name}” para confirmar a transferência<input name="confirmation" required placeholder={data.community.name}/></label>}
        <button className="primary-button" type="submit" disabled={!data.members.some((member) => !data.team.some((person) => person.accountId === member.accountId && (teamRole !== 'owner' || person.role === 'owner')))}>{teamRole === 'owner' ? 'Transferir propriedade' : 'Adicionar à equipe'}</button>
      </form>}
    </div>}
    {tab === 'moderation' && <div className="settings-moderation"><form onSubmit={(event) => void submitForm('moderation', event)}><div className="settings-section-heading"><h2>Moderação e segurança</h2><p>Regras locais, limites e tratamento de denúncias.</p></div><label>Regras da comunidade<textarea name="rules" defaultValue={community.settings.moderation.rules.join('\n')} placeholder="Uma regra por linha"/></label><div className="settings-field-row"><label>Limite de caracteres por post<input type="number" name="maxPostLength" min={100} max={5000} defaultValue={community.settings.moderation.maxPostLength}/></label></div>{check('requireReportReason', 'Exigir justificativa nas denúncias', community.settings.moderation.requireReportReason)}{submitButton}</form><section className="settings-sanctions"><h2>Membros suspensos ou banidos</h2>{data.sanctions.map((sanction)=><article key={sanction.id}><Avatar character={{displayName:sanction.displayName,avatarUrl:sanction.avatarUrl}}/><span><strong>{sanction.displayName} {sanction.username && <small>@{sanction.username}</small>}</strong><small>{sanction.action === 'ban' ? 'Banimento' : 'Suspensão'} · {sanction.endsAt ? `até ${new Date(sanction.endsAt).toLocaleDateString('pt-BR')}` : 'permanente'}</small><small>Motivo: {sanction.reason}</small></span><button type="button" onClick={() => void revokeSanction(sanction.id)}>Revogar</button></article>)}{!data.sanctions.length && <p className="settings-dashboard-empty">Nenhum membro suspenso ou banido.</p>}</section></div>}
    {tab === 'privacy' && <form onSubmit={(event) => void submitForm('privacy', event)}><div className="settings-section-heading"><h2>Privacidade</h2><p>Controle as informações da comunidade exibidas publicamente.</p></div>{check('showInDirectory', 'Mostrar no portal de comunidades', community.settings.privacy.showInDirectory)}{check('showMembers', 'Exibir lista de membros', community.settings.privacy.showMembers)}{check('showAdmins', 'Exibir administradores', community.settings.privacy.showAdmins)}{check('publicContent', 'Permitir conteúdo público', community.settings.privacy.publicContent)}{submitButton}</form>}
    {tab === 'support' && data.role === 'owner' && <section className="settings-support-direction"><div className="settings-section-heading"><h2>Suporte e direção VYBE</h2><p>Um canal direto com quem constrói o VYBE. Converse sobre sua comunidade com a equipe da plataforma.</p></div><div className="settings-support-direction-cards"><article><span><MaterialIcon name="support_agent"/></span><h3>Suporte técnico</h3><p>Problemas de funcionamento ou dificuldades administrativas.</p><a href="/ajuda">Solicitar suporte <MaterialIcon name="arrow_forward"/></a></article><article><span><MaterialIcon name="campaign"/></span><h3>Falar com a direção do VYBE</h3><p>Gestão, parcerias, solicitações especiais e questões institucionais.</p><a href="/ajuda?category=PLATFORM_DIRECTION">Falar com a direção <MaterialIcon name="arrow_forward"/></a></article></div></section>}
    {tab === 'advanced' && <div><div className="settings-section-heading"><h2>Avançado</h2><p>Registro das alterações administrativas recentes.</p></div><div className="settings-audit-list">{data.audit.map((item) => <article key={item.id}><div><strong>{item.action.replaceAll('.', ' · ')}</strong><small>{item.actorEmail} · {new Date(item.createdAt).toLocaleString('pt-BR')}</small></div><details><summary>Detalhes</summary><pre>{JSON.stringify(item.details, null, 2)}</pre></details></article>)}{!data.audit.length && <p>Nenhuma ação registrada ainda.</p>}</div><div className="settings-readonly-row"><span>Exportação de dados</span><small>Exportações estarão disponíveis em uma etapa futura.</small></div></div>}
    {tab === 'risk' && <div className="settings-risk"><div className="settings-section-heading"><h2>Zona de risco</h2><p>Estas ações têm impacto amplo e exigem confirmação adicional.</p></div><form onSubmit={(event) => { event.preventDefault(); void riskAction('transfer', new FormData(event.currentTarget)); }}><h3>Transferir propriedade</h3><p>Transfere o papel de Owner para outra conta ativa desta comunidade.</p><label>E-mail do novo Owner<input type="email" name="email" required/></label><label>Digite “{community.name}” para confirmar<input name="confirmation" required/></label><button type="submit">Transferir propriedade</button></form><form onSubmit={(event) => { event.preventDefault(); void riskAction('suspend', new FormData(event.currentTarget)); }}><h3>Suspender comunidade</h3><p>Bloqueia imediatamente o acesso pelo subdomínio. A comunidade principal VYBE é protegida.</p><label>Digite “{community.name}” para confirmar<input name="confirmation" required/></label><button type="submit">Suspender comunidade</button></form><form onSubmit={(event) => { event.preventDefault(); void riskAction('request-deletion', new FormData(event.currentTarget)); }}><h3>Solicitar exclusão</h3><p>Registra uma solicitação para revisão da administração da plataforma; não apaga dados automaticamente.</p><label>Motivo<textarea name="reason" required minLength={10} maxLength={500}/></label><label>Digite “{community.name}” para confirmar<input name="confirmation" required/></label><button type="submit">Solicitar exclusão</button></form></div>}
  </div></div>{selectedJoinRequest && <div className="settings-join-request-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedJoinRequest(null); }}><section className="settings-join-request-dialog" role="dialog" aria-modal="true" aria-label={`Solicitação de ${selectedJoinRequest.requester?.displayName ?? 'entrada'}`}><button type="button" className="settings-join-request-close" onClick={() => setSelectedJoinRequest(null)} aria-label="Fechar solicitação"><MaterialIcon name="close"/></button><JoinRequestReviewCard request={selectedJoinRequest} onReview={reviewJoinRequest}/></section></div>}{sanctionMember && <div className="settings-sanction-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSanctionMember(null); setSanctionConfirmed(false); } }}><form className="settings-sanction-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-sanction-title" onSubmit={(event) => void createSanction(event)}><button type="button" className="settings-sanction-close" onClick={() => { setSanctionMember(null); setSanctionConfirmed(false); }} aria-label="Fechar">×</button><span>MODERAÇÃO</span><h2 id="settings-sanction-title">Suspender ou banir {sanctionMember.displayName}</h2><label>Ação<select value={sanctionForm.action} onChange={(event) => { setSanctionForm({ ...sanctionForm, action: event.target.value as 'ban' | 'suspend' }); setSanctionConfirmed(false); }}><option value="suspend">Suspender temporariamente</option><option value="ban">Banir</option></select></label><label>Duração<select value={sanctionForm.durationDays} onChange={(event) => setSanctionForm({ ...sanctionForm, durationDays: event.target.value })}><option value="">Permanente</option><option value="1">1 dia</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select></label><label>Motivo obrigatório<textarea value={sanctionForm.reason} onChange={(event) => { setSanctionForm({ ...sanctionForm, reason: event.target.value }); setSanctionConfirmed(false); }} minLength={3} maxLength={500} placeholder="Descreva por que esta pessoa está sendo suspensa ou banida." required/></label><label className="settings-sanction-confirm"><input type="checkbox" checked={sanctionConfirmed} onChange={(event) => setSanctionConfirmed(event.target.checked)} required/><span>Confirmo {sanctionForm.action === 'ban' ? 'o banimento' : 'a suspensão'} de {sanctionMember.displayName} e que o motivo informado está correto.</span></label><button className="primary-button" type="submit" disabled={!sanctionConfirmed || sanctionForm.reason.trim().length < 3}>Confirmar {sanctionForm.action === 'ban' ? 'banimento' : 'suspensão'}</button></form></div>}</section>;
}
type HelpTicket = { id: string; number: number; category: string; subject: string; description: string; appArea: string; communityName: string; communityId: string; status: string; createdAt: string; updatedAt: string; lastMessageAt: string; lastMessagePreview: string; unreadForAdmin?: boolean; unreadForUser?: boolean; unreadMessageCountForUser?: number };
type HelpAttachment = { name: string; mimeType: string; size: number; url: string };
type HelpMessage = { id: string; content: string; createdAt: string; isSupport: boolean; sender?: { displayName: string; username: string } | null; attachments?: HelpAttachment[]; attachment?: { url: string; name: string } };
const helpStatusIcon: Record<string,string> = { NEW: 'schedule', IN_PROGRESS: 'support_agent', RESPONDED: 'chat_bubble', WAITING_USER: 'chat_bubble', RESOLVED: 'check_circle', CLOSED: 'lock' };
function HelpStatusBadge({ status, label }: { status: string; label: string }) { return <span className={`support-status-badge status-${status === 'RESPONDED' ? 'waiting_user' : status.toLowerCase()}`}><MaterialIcon name={helpStatusIcon[status] ?? 'schedule'}/>{label}</span>; }
type HelpCommunity = { id: string; name: string; joinStatus: string; slug: string };
async function helpFilePayload(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}: cada anexo deve ter até 5 MB.`);
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type)) throw new Error('Anexe PNG, JPG, WebP ou PDF.');
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler o anexo.')); reader.readAsDataURL(file); });
  return { name: file.name, dataUrl };
}
function SupportFilePreviews({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => { const next = files.map((file) => file.type.startsWith('image/') ? URL.createObjectURL(file) : ''); setUrls(next); return () => next.forEach((url) => { if (url) URL.revokeObjectURL(url); }); }, [files]);
  if (!files.length) return null;
  return <div className="support-file-previews">{files.map((file, index) => <span className="support-file-preview" key={`${file.name}-${index}`}>{urls[index] && <img src={urls[index]} alt="Prévia do anexo"/>}<span>{file.name}</span><button type="button" aria-label={`Remover ${file.name}`} onClick={() => onRemove(index)}>×</button></span>)}</div>;
}
function HelpPage({ character, tenant }: { character: SocialCharacter; tenant: TenantInfo | null }) {
  const [tickets, setTickets] = useState<HelpTicket[]>([]); const [selected, setSelected] = useState<HelpTicket | null>(null); const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [newTicketOpen, setNewTicketOpen] = useState(false); const [success, setSuccess] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [draft, setDraft] = useState('');
  const [ticketFilter, setTicketFilter] = useState<'ALL'|'OPEN'|'IN_PROGRESS'|'WAITING_USER'|'RESOLVED'|'CLOSED'>('ALL'); const [supportMode, setSupportMode] = useState<'PLATFORM'|'COMMUNITY'>('PLATFORM');
  const [ticketFiles, setTicketFiles] = useState<File[]>([]); const [replyFiles, setReplyFiles] = useState<File[]>([]); const [communities, setCommunities] = useState<HelpCommunity[]>([]);
  const query = new URLSearchParams(window.location.search);
  const initialCategory = query.get('category') ?? '';
  const safeReturn = '/comunidades';
  const [form, setForm] = useState({ category: initialCategory, communityId: tenant?.id ?? '', subject: '', description: '', verificationRequestId: query.get('verificationRequestId') ?? '', communityCreationRequestId: query.get('communityCreationRequestId') ?? '' });
  const [isOwner, setIsOwner] = useState(false);
  const categories = [
    { id: 'TECHNICAL_PROBLEM', label: 'Problemas técnicos' }, { id: 'SYSTEM_ERROR', label: 'Erro no sistema' }, { id: 'ACCOUNT', label: 'Dúvidas sobre conta' },
    { id: 'COMMUNITY', label: 'Dúvidas sobre comunidades' }, { id: 'COMMUNITY_MANAGEMENT', label: 'Gestão de comunidade' }, { id: 'COMMUNITY_CREATION', label: 'Criação de comunidade' }, { id: 'PAYMENT', label: 'Pagamentos' },
    { id: 'VYBE_PLUS', label: 'VYBE+' }, { id: 'REPORT', label: 'Denúncias' }, { id: 'SUGGESTION', label: 'Sugestões' }, { id: 'OTHER', label: 'Outro assunto' },
    ...(isOwner ? [{ id: 'PLATFORM_DIRECTION', label: 'Contato com a direção' }] : []),
  ];
  const categoryLabel: Record<string, string> = Object.fromEntries(categories.map((item) => [item.id, item.label]));
  const statusName: Record<string,string> = { NEW: 'Aguardando atendimento', IN_PROGRESS: 'Em atendimento', RESPONDED: 'Aguardando sua resposta', WAITING_USER: 'Aguardando sua resposta', RESOLVED: 'Resolvido', CLOSED: 'Encerrado' };
  const loadTickets = async () => { try { setTickets(await apiRequest<HelpTicket[]>('/api/support/tickets/me')); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar seus atendimentos.'); } };
  useEffect(() => {
    void loadTickets();
    void apiRequest<{ communities: HelpCommunity[] }>('/api/communities').then((result) => { const joined = result.communities.filter((item) => item.joinStatus === 'MEMBER'); setCommunities(joined); if (!form.communityId && tenant?.id) setForm((current) => ({ ...current, communityId: tenant.id ?? '' })); }).catch(() => undefined);
    if (initialCategory && initialCategory !== 'PLATFORM_DIRECTION') setNewTicketOpen(true);
  }, []);
  useEffect(() => {
    if (!tenant?.id) return;
    void fetch('/api/settings/community', { credentials: 'same-origin' }).then(async (response) => response.ok ? await response.json() as { role?: string } : null).then((result) => { if (!result) return; const owner = result.role === 'owner'; setIsOwner(owner); if (initialCategory === 'PLATFORM_DIRECTION' && owner) setNewTicketOpen(true); }).catch(() => undefined);
  }, [tenant?.id, initialCategory]);
  useEffect(() => {
    const requestedTicketId = new URLSearchParams(window.location.search).get('ticket');
    const ticket = requestedTicketId ? tickets.find((item) => item.id === requestedTicketId) : undefined;
    if (ticket && selected?.id !== ticket.id) void openTicket(ticket);
  }, [tickets, selected?.id]);
  useEffect(() => { const timer = window.setInterval(() => { void loadTickets(); if (selected) void openTicket(selected); }, 15000); return () => window.clearInterval(timer); }, [selected?.id]);
  useEffect(() => { if (!selected) return; const ticketId = selected.id; const timer = window.setInterval(() => { void apiRequest<{ ticket: HelpTicket; messages: HelpMessage[] }>(`/api/support/tickets/${ticketId}`).then((result) => { setSelected(result.ticket); setMessages(result.messages); }).catch(() => undefined); }, 10000); return () => window.clearInterval(timer); }, [selected?.id]);
  async function openTicket(ticket: HelpTicket) { setSelected(ticket); setNewTicketOpen(false); setError(''); try { const data = await apiRequest<{ ticket: HelpTicket; messages: HelpMessage[] }>(`/api/support/tickets/${ticket.id}`); setSelected(data.ticket); setMessages(data.messages); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível abrir o atendimento.'); } }
  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form.category) return; setBusy(true); setError('');
    try {
      const attachments = await Promise.all(ticketFiles.map(helpFilePayload));
      const created = await apiRequest<HelpTicket>('/api/support/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, appArea: form.category, communityId: form.communityId || undefined, communityCreationRequestId: form.communityCreationRequestId || undefined, verificationRequestId: form.verificationRequestId || undefined, attachments }) });
      setTicketFiles([]); setForm({ category: '', communityId: tenant?.id ?? '', subject: '', description: '', verificationRequestId: '', communityCreationRequestId: '' }); setNewTicketOpen(false); setSelected(null); setSuccess(`Atendimento #${String(created.number).padStart(5,'0')} criado! Sua solicitação foi recebida e está aguardando atendimento.`); await loadTickets();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível iniciar o atendimento.'); } finally { setBusy(false); }
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || (!draft.trim() && !replyFiles.length)) return; setBusy(true); setError('');
    try { const attachments = await Promise.all(replyFiles.map(helpFilePayload)); await apiRequest(`/api/support/tickets/${selected.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: draft.trim(), attachments }) }); setDraft(''); setReplyFiles([]); await openTicket(selected); await loadTickets(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível enviar a mensagem.'); } finally { setBusy(false); }
  }
  const fileInput = (onChange: (files: File[]) => void) => <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => { const files = [...(event.currentTarget.files ?? [])]; if (files.length > 3) { setError('Anexe até 3 arquivos por envio.'); event.currentTarget.value = ''; return; } onChange(files); setError(''); }}/ >;
  const timeline = messages.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const visibleTickets = tickets.filter((ticket) => ticketFilter === 'ALL' || ticketFilter === 'OPEN' && ticket.status === 'NEW' || ticketFilter === 'IN_PROGRESS' && ['IN_PROGRESS','WAITING_USER'].includes(ticket.status) || ticket.status === ticketFilter);
  const renderAttachment = (attachment: HelpAttachment) => attachment.mimeType.startsWith('image/') ? <a className="support-attachment-image" key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.url} alt={attachment.name}/><small>Abrir imagem · {attachment.name}</small></a> : <a key={attachment.url} href={attachment.url}>{attachment.name}</a>;
  const quickCategories = supportMode === 'PLATFORM'
    ? [{id:'HELP',label:'Dúvidas gerais',icon:'help_outline'},{id:'TECHNICAL_PROBLEM',label:'Problema técnico',icon:'settings'},{id:'COMMUNITY_CREATION',label:'Criar comunidade',icon:'groups'},{id:'VYBE_PLUS',label:'Pagamento VYBE+',icon:'workspace_premium'},{id:'PAYMENT',label:'Pagamento de comunidade',icon:'payments'},{id:'ACCOUNT',label:'Conta e acesso',icon:'person'},...(isOwner?[{id:'PLATFORM_DIRECTION',label:'Suporte ao dono da comunidade',icon:'shield'}]:[])]
    : [{id:'COMMUNITY',label:'Dúvidas da comunidade',icon:'groups'},{id:'COMMUNITY_MANAGEMENT',label:'Gestão da comunidade',icon:'tune'},{id:'PAYMENT',label:'Pagamento de comunidade',icon:'payments'},{id:'TECHNICAL_PROBLEM',label:'Problema no aplicativo',icon:'settings'},...(isOwner?[{id:'PLATFORM_DIRECTION',label:'Falar com a direção',icon:'campaign'}]:[])];
  const ticketAttachments = selected ? messages.flatMap((message) => message.attachments ?? []).filter((item,index,all)=>all.findIndex((other)=>other.url===item.url)===index) : [];
  return <main className="help-center-page"><div className="help-center-frame">
    <a className="help-back-link" href={safeReturn} onClick={()=>sessionStorage.removeItem('vybe_help_return_to')}><MaterialIcon name="arrow_back"/>Voltar ao menu inicial</a>
    <header className="help-center-hero"><div><span>ATENDIMENTO OFICIAL</span><h1>Central de Ajuda VYBE</h1><p>Tire dúvidas, reporte problemas e acompanhe seus protocolos com o suporte oficial da plataforma.</p></div><aside><MaterialIcon name="lock"/><span><strong>Atendimento privado</strong><small>Cada atendimento é privado e visível apenas para você e para o suporte da VYBE.</small></span></aside></header>
    {error&&<p className="support-center-error" role="alert">{error}</p>}{success&&<p className="support-center-success" role="status">{success}</p>}
    <nav className="help-support-modes" aria-label="Tipo de suporte"><button type="button" className={supportMode==='PLATFORM'?'is-active':''} onClick={()=>setSupportMode('PLATFORM')}><MaterialIcon name="computer"/><span><strong>Suporte da plataforma</strong><small>Ajuda com o uso da VYBE, conta, VYBE+ e funcionalidades.</small></span></button><button type="button" className={supportMode==='COMMUNITY'?'is-active':''} onClick={()=>setSupportMode('COMMUNITY')}><MaterialIcon name="groups"/><span><strong>Suporte da comunidade</strong><small>Ajuda com sua comunidade, pagamentos, configurações e gestão.</small></span></button></nav>
    <section className="help-new-ticket-panel"><div className="help-new-ticket-intro"><span>NOVO ATENDIMENTO</span><h2>Precisa de ajuda?</h2><p>Escolha um assunto abaixo e abra um atendimento com o nosso suporte.</p></div><div className="help-quick-categories">{quickCategories.map((item)=><button type="button" key={item.id} onClick={()=>{setForm((current)=>({...current,category:item.id,communityId:supportMode==='COMMUNITY'?(tenant?.id??current.communityId):current.communityId}));setSelected(null);setNewTicketOpen(true);}}><MaterialIcon name={item.icon}/><span>{item.label}</span></button>)}</div><button type="button" className="help-new-ticket-button" onClick={()=>{setSelected(null);setNewTicketOpen((open)=>!open);setError('');}}><span>Novo atendimento</span><MaterialIcon name="add"/></button></section>
    <div className="help-ticket-workspace">
      <section className="support-my-tickets help-ticket-list"><header><div><span>MEUS ATENDIMENTOS</span></div><button type="button" onClick={()=>void loadTickets()}>Atualizar <MaterialIcon name="refresh"/></button></header><nav className="support-ticket-filters">{([['ALL','Todos'],['OPEN','Aguardando atendimento'],['IN_PROGRESS','Em atendimento'],['WAITING_USER','Aguardando sua resposta'],['RESOLVED','Resolvido'],['CLOSED','Encerrado']] as const).map(([id,label])=><button type="button" key={id} className={ticketFilter===id?'is-active':''} onClick={()=>setTicketFilter(id)}>{label}</button>)}</nav><div className="help-ticket-list-items">{visibleTickets.length?visibleTickets.map((ticket)=><button type="button" key={ticket.id} className={selected?.id===ticket.id?'is-selected':''} onClick={()=>void openTicket(ticket)}><strong>#{String(ticket.number).padStart(5,'0')} · {ticket.subject}</strong><small>{categoryLabel[ticket.category]??ticket.category} · {new Date(ticket.updatedAt).toLocaleString('pt-BR')}</small><span><HelpStatusBadge status={ticket.status} label={statusName[ticket.status]??ticket.status}/>{ticket.unreadForUser&&<b>{ticket.unreadMessageCountForUser||'Nova'}</b>}</span></button>):<p>{tickets.length?'Nenhum atendimento nesta categoria.':'Seus protocolos aparecerão aqui depois do primeiro atendimento.'}</p>}</div></section>
      <section className="help-ticket-conversation">
        {newTicketOpen?<form className="support-center-form" onSubmit={(event)=>void createTicket(event)}><div><span>NOVO PROTOCOLO</span><h2>Conte como podemos ajudar</h2></div><label>Assunto / categoria<select required value={form.category} onChange={(event)=>setForm({...form,category:event.target.value})}><option value="">Selecione um assunto</option>{categories.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Comunidade relacionada (opcional)<select value={form.communityId} onChange={(event)=>setForm({...form,communityId:event.target.value})}><option value="">Plataforma / nenhuma comunidade</option>{communities.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{form.category==='VYBE_PLUS'&&<label>Solicitação VYBE+ relacionada (opcional)<input value={form.verificationRequestId} onChange={(event)=>setForm({...form,verificationRequestId:event.target.value})} placeholder="ID da solicitação"/></label>}{form.category==='COMMUNITY_CREATION'&&<label>Solicitação de criação relacionada (opcional)<input value={form.communityCreationRequestId} onChange={(event)=>setForm({...form,communityCreationRequestId:event.target.value})} placeholder="ID da solicitação"/></label>}<label>Título do problema<input value={form.subject} onChange={(event)=>setForm({...form,subject:event.target.value})} required minLength={3} maxLength={120} placeholder="Resuma seu atendimento"/></label><label>Descrição detalhada<textarea value={form.description} onChange={(event)=>setForm({...form,description:event.target.value})} required minLength={5} maxLength={4000} rows={5} placeholder="Conte os detalhes para nossa equipe…"/></label><label>Anexos (opcional){fileInput(setTicketFiles)}<SupportFilePreviews files={ticketFiles} onRemove={(index)=>setTicketFiles((items)=>items.filter((_,i)=>i!==index))}/><small>PNG, JPG, WebP ou PDF · até 3 arquivos, 5 MB cada</small></label><footer><button type="button" onClick={()=>setNewTicketOpen(false)}>Cancelar</button><button className="is-primary" disabled={busy}>{busy?'Enviando…':'Enviar solicitação'}</button></footer></form>
        :selected?<><header className="help-conversation-header"><div><strong>#{String(selected.number).padStart(5,'0')} · {selected.subject}</strong><HelpStatusBadge status={selected.status} label={statusName[selected.status]??selected.status}/><small><MaterialIcon name="groups"/>{selected.communityName||'Atendimento da plataforma'}</small></div><button type="button" onClick={()=>{setSelected(null);setMessages([]);}}>Meus atendimentos</button></header>{['RESOLVED','CLOSED'].includes(selected.status)&&<p className={`support-ticket-resolved ${selected.status==='CLOSED'?'is-closed':''}`}><HelpStatusBadge status={selected.status} label={statusName[selected.status]??selected.status}/><span>{selected.status==='RESOLVED'?'Este atendimento foi resolvido e está somente para leitura.':'Este atendimento foi encerrado e está somente para leitura.'} Se precisar de mais ajuda, abra um novo atendimento.</span><button type="button" onClick={()=>{setSelected(null);setMessages([]);setNewTicketOpen(true);setForm({category:selected.category,communityId:selected.communityId||tenant?.id||'',subject:'',description:'',verificationRequestId:'',communityCreationRequestId:''});}}>Abrir novo atendimento</button></p>}<div className="support-ticket-messages">{timeline.map((message)=><article className={message.isSupport?'is-support':''} key={message.id}><strong>{message.isSupport?'VYBE Suporte':message.sender?.displayName??character.displayName}</strong>{message.content&&<FormattedText text={message.content}/>}{(message.attachments??[]).map(renderAttachment)}{message.attachment&&<a href={message.attachment.url}>{message.attachment.name}</a>}<small>{new Date(message.createdAt).toLocaleString('pt-BR')}</small></article>)}</div>{!['RESOLVED','CLOSED'].includes(selected.status)&&<form className="help-reply-form" onSubmit={(event)=>void sendMessage(event)}><label><MaterialIcon name="attach_file"/>{fileInput(setReplyFiles)}</label><textarea value={draft} onChange={(event)=>setDraft(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} placeholder="Digite sua mensagem…" maxLength={4000}/><button disabled={busy||(!draft.trim()&&!replyFiles.length)}><MaterialIcon name="send"/>Enviar</button><SupportFilePreviews files={replyFiles} onRemove={(index)=>setReplyFiles((items)=>items.filter((_,i)=>i!==index))}/><small>Você pode anexar imagens JPG, PNG ou WebP de até 5 MB.</small></form>}</>
        :<div className="help-empty-conversation"><MaterialIcon name="support_agent"/><strong>Selecione um atendimento</strong><span>Suas conversas com o VYBE Suporte aparecerão aqui.</span></div>}
      </section>
      <aside className="help-ticket-details"><span>DETALHES DO ATENDIMENTO</span>{selected?<><dl><dt>Protocolo</dt><dd>#{String(selected.number).padStart(5,'0')}</dd><dt>Assunto</dt><dd>{selected.subject}</dd><dt>Categoria</dt><dd>{categoryLabel[selected.category]??selected.category}</dd><dt>Origem</dt><dd>{selected.appArea||'Plataforma'}</dd><dt>Comunidade</dt><dd>{selected.communityName||'Nenhuma'}</dd><dt>Criado em</dt><dd>{new Date(selected.createdAt).toLocaleString('pt-BR')}</dd></dl><div className="help-detail-status"><small>Status atual</small><HelpStatusBadge status={selected.status} label={statusName[selected.status]??selected.status}/></div><section><h3>Anexos ({ticketAttachments.length})</h3>{ticketAttachments.length?ticketAttachments.map((attachment)=>attachment.mimeType.startsWith('image/')?<a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer"><MaterialIcon name="image"/>{attachment.name}</a>:<a key={attachment.url} href={attachment.url}><MaterialIcon name="attach_file"/>{attachment.name}</a>):<small>Nenhum anexo neste protocolo.</small>}</section></>:<div className="help-detail-empty"><MaterialIcon name="lock"/><p>Selecione um protocolo para consultar seus detalhes e anexos.</p></div>}</aside>
    </div>
  </div></main>;
}
function CommunitySwitchPage({ currentSlug }: { currentSlug: string }) {
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  function changeCommunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(normalized)) { setError('Use o subdomínio da comunidade, sem espaços ou pontuação.'); return; }
    if (isLocalVybeHost() && normalized !== currentSlug) { setError(`No ambiente local, a comunidade disponível é “${currentSlug}”.`); return; }
    activateLocalCommunity(normalized);
    window.location.assign(communityHomeHref(normalized));
  }
  return <section className="community-switch-page"><span>SEUS UNIVERSOS</span><h1>Trocar comunidade</h1><p>Cada comunidade VYBE tem seu próprio endereço e espaço isolado.</p><form onSubmit={changeCommunity}><label htmlFor="community-slug">Subdomínio da comunidade</label><div><input id="community-slug" value={slug} onChange={(event) => { setSlug(event.target.value); setError(''); }} placeholder="ex.: community" maxLength={40} required/><b>{isLocalVybeHost() ? window.location.host : '.vybe.com.br'}</b><button className="primary-button" type="submit">Acessar</button></div>{error && <small role="alert">{error}</small>}</form><a href="/">Voltar para esta comunidade</a></section>;
}

type HomeNotification = { id: string; type: string; targetId: string; serverId?:string; channelId?:string; supportTicketId?: string | null; status?: string; eventTitle?: string; communityName?: string; communitySlug?: string; message?: string; amountCents?: number | null; actor: SocialCharacter | null; createdAt: string; readAt?: string };
type AccountProfileData = { displayName: string; username: string; avatarUrl: string; birthDate: string };
function dateToDisplay(value: string) { return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : ''; }
function formatBirthDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
function displayDateToISO(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
function homeNotificationMessage(item: HomeNotification) {
  const actor = item.actor?.displayName ? `${item.actor.displayName} ` : '';
  if (item.type === 'support_ticket') return item.message || 'Há uma atualização no seu atendimento VYBE.';
  if (item.type === 'community_creation_update') return item.message || `A solicitação de criação de ${item.communityName || 'sua comunidade'} foi atualizada`;
  if (item.type === 'bank_transfer_received') return `${actor}enviou ${moneyForNotification(item.amountCents)} para você`;
  if (item.type === 'bank_admin_credit_received') return `${actor}creditou ${moneyForNotification(item.amountCents)} na sua carteira`;
  if (item.type === 'message') return `${actor}enviou uma mensagem`;
  if (item.type === 'server_message') return `${actor}enviou uma mensagem em um servidor`;
  if (item.type === 'match_created') return `${actor}Você deu Match! Agora podem conversar.`;
  if (item.type === 'verification_approved') return 'Seu VYBE Verificado foi ativado';
  if (item.type === 'verification_gift_received') return `Você ganhou o VYBE Verificado ✦. Seu perfil em ${item.communityName || 'sua comunidade'} agora possui benefícios VYBE+`;
  if (item.type === 'verification_gift_activated') return `O presente de VYBE Verificado para @${item.actor?.username ?? 'perfil'} foi ativado em ${item.communityName || 'sua comunidade'}`;
  if (item.type === 'verification_suspended') return 'Seu VYBE Verificado foi suspenso';
  if (item.type === 'verification_removed') return 'Seu VYBE Verificado foi revogado';
  if (item.type === 'verification_requested') return 'Sua solicitação de VYBE Verificado foi recebida';
  if (item.type === 'verification_payment_confirmed') return 'Pagamento de VYBE Verificado confirmado';
  if (item.type === 'verification_payment_issue') return 'Não conseguimos identificar seu pagamento. Confira o comprovante ou fale com o VYBE Suporte.';
  if (item.type === 'verification_rejected') return 'Sua solicitação de VYBE Verificado foi atualizada';
  if (item.type === 'news_published') return `${actor}publicou uma nova notícia`;
  if (item.type === 'news_reviewed') return `${actor}atualizou a revisão da sua matéria`;
  if (item.type === 'like') return `${actor}curtiu sua publicação`;
  if (item.type === 'comment') return `${actor}comentou em uma publicação sua`;
  if (item.type === 'post_trending') return `${actor}entrou em Trend. Entre para conferir.`;
  if (item.type === 'follow') return `${actor}começou a seguir você`;
  if (item.type.startsWith('event_')) return `${actor}${item.type === 'event_created' ? 'novo evento' : 'atualização do evento'}${item.eventTitle ? `: ${item.eventTitle}` : ''}`;
  return `${actor}enviou uma atualização`;
}
function homeNotificationHref(item: HomeNotification) {
  if (item.type === 'server_message' && item.serverId) return `/mensagens?serverId=${encodeURIComponent(item.serverId)}${item.channelId ? `&channel=${encodeURIComponent(item.channelId)}` : ''}`;
  if (item.type === 'support_ticket') return `/ajuda${item.supportTicketId ? `?ticket=${encodeURIComponent(item.supportTicketId)}` : ''}`;
  if (item.type === 'message') return `/mensagens?to=${encodeURIComponent(item.actor?.id ?? '')}`;
  if (item.type === 'match_created') return `/match/mensagens/${encodeURIComponent(item.targetId)}`;
  if (item.type.startsWith('verification_')) return '/vybe-plus';
  if (item.type.startsWith('event_')) return `/eventos/${item.targetId}`;
  if (item.type.startsWith('news_')) return `/noticias/${item.targetId}`;
  if (item.type === 'bank_transfer_received' || item.type === 'bank_admin_credit_received') return '/banco';
  if (item.type === 'follow' && item.actor?.username) return `/@${encodeURIComponent(item.actor.username)}`;
  if (['like', 'comment', 'mention', 'repost', 'echo_like', 'echo_mention', 'echo_reply', 'post_trending'].includes(item.type)) return `/feed?post=${encodeURIComponent(item.targetId)}`;
  if (item.type === 'academic_grade') return '/academico/notas';
  if (item.type === 'academic_submission') return '/academico/atividades';
  if (item.type.startsWith('academic_')) return '/academico/disciplinas';
  if (item.type.startsWith('career_')) return '/carreiras';
  if (item.type === 'community_join_update') return '/comunidades';
  if (item.type === 'community_creation_update' && item.status === 'APPROVED' && item.communitySlug) return communityHomeHref(item.communitySlug);
  if (item.type === 'community_creation_update') return '/comunidades';
  return '/notificacoes';
}
function homeNotificationIcon(item: HomeNotification) {
  return item.type === 'support_ticket' ? 'support_agent' : item.type === 'post_trending' ? 'trending_up' : item.type.startsWith('event_') ? 'calendar_month' : item.type.startsWith('news_') ? 'campaign' : item.type === 'message' || item.type === 'server_message' || item.type === 'match_created' ? 'chat' : 'notifications';
}

function HomeArrow() {
  return <MaterialIcon name="arrow_forward" className="home-arrow-icon"/>;
}

function CommunityAppIcon({ app }: { app: string }) {
  const names: Record<string, string> = {
    feed: 'photo_camera', pulse: 'graphic_eq', match: 'favorite', messages: 'chat_bubble', bank: 'credit_card',
    events: 'calendar_month', academic: 'school', career: 'work', news: 'newspaper', companies: 'apartment',
    settings: 'settings', apps: 'apps',
  };
  // Unknown app keys use the neutral app grid instead of a misleading icon.
  return <MaterialIcon name={names[app] ?? 'apps'} className="community-app-icon"/>;
}

function AccountProfilePage() {
  const [profile, setProfile] = useState<AccountProfileData>({ displayName: '', username: '', avatarUrl: '', birthDate: '' });
  const [birthDateInput, setBirthDateInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    void apiRequest<AccountProfileData>('/api/account/profile').then((data) => {
      setProfile(data);
      setBirthDateInput(dateToDisplay(data.birthDate));
    }).catch(() => setError('Não foi possível carregar os dados da conta. Entre novamente na sua conta VYBE.')).finally(() => setLoading(false));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess('');
    const birthDate = displayDateToISO(birthDateInput);
    if (birthDateInput && !birthDate) { setError('Digite uma data válida no formato DD/MM/AAAA.'); return; }
    setSaving(true);
    try {
      const updated = await apiRequest<AccountProfileData>('/api/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...profile, username: profile.username.replace(/^@/, ''), birthDate: birthDate ?? '' }) });
      setProfile(updated); setBirthDateInput(dateToDisplay(updated.birthDate));
      // Keep the account-level details (including greeting preference) in sync
      // with the community Home without requiring a full page reload.
      window.dispatchEvent(new CustomEvent('vybe:account-profile-updated', { detail: updated }));
      setSuccess('Perfil atualizado com segurança.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar seu perfil.'); }
    finally { setSaving(false); }
  }
  return <main className="account-profile-page"><header><a className="account-profile-back" href="/" aria-label="Voltar para a Home"><MaterialIcon name="arrow_back"/></a><div><span>CONTA VYBE</span><h1>Meu perfil</h1><p>Seus dados pessoais e a foto exibida na sua conta.</p></div></header>{loading ? <section className="account-profile-card"><p>Carregando perfil…</p></section> : <form className="account-profile-card" onSubmit={(event) => void save(event)}><ProfilePhotoEditor value={profile.avatarUrl} onChange={(avatarUrl) => setProfile((current) => ({ ...current, avatarUrl }))} onError={setError} maxBytes={2 * 1024 * 1024} label="Foto da conta" allowGif={false}/><div className="account-profile-fields"><label>Nome completo<input type="text" value={profile.displayName} maxLength={60} minLength={2} autoComplete="name" onChange={(event) => setProfile((current) => ({ ...current, displayName: event.currentTarget.value }))} required/></label><label>@username da conta<div className="account-username-input"><span>@</span><input type="text" value={profile.username} maxLength={24} autoComplete="username" onChange={(event) => setProfile((current) => ({ ...current, username: event.currentTarget.value.replace(/^@/, '').toLowerCase() }))} required/></div><small>Identificador global da sua conta VYBE.</small></label><label>Data de nascimento<input type="text" inputMode="numeric" autoComplete="bday" placeholder="DD/MM/AAAA" value={birthDateInput} onChange={(event) => setBirthDateInput(formatBirthDateInput(event.currentTarget.value))} maxLength={10}/></label></div>{error && <p className="account-profile-error" role="alert">{error}</p>}{success && <p className="account-profile-success" role="status">{success}</p>}<footer><p>Seus dados pessoais ficam privados na sua conta VYBE.</p><button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></footer></form>}</main>;
}

function CommunityHome({ character, tenant, onLogout }: { character: SocialCharacter; tenant: TenantInfo | null; onLogout: () => void }) {
  const [event, setEvent] = useState<SocialEvent | null>(null);
  const [accountProfile, setAccountProfile] = useState<AccountProfileData | null>(null);
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);
  const [threads, setThreads] = useState<DirectThread[]>([]);
  const [notifications, setNotifications] = useState<HomeNotification[]>([]);
  const [allNotifications, setAllNotifications] = useState<HomeNotification[]>([]);
  const [appsOpen, setAppsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [profileMenu, setProfileMenu] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [allNotificationsOpen, setAllNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [confirmDeleteNotifications, setConfirmDeleteNotifications] = useState(false);
  const [deletingNotifications, setDeletingNotifications] = useState(false);
  const notificationsRevision = useRef(0);
  const [canManageCommunity, setCanManageCommunity] = useState(false);
  const features = tenant?.settings?.features ?? {};
  const accountDisplayName = accountProfile?.displayName || character.displayName;
  const accountUsername = accountProfile?.username || character.username;
  const accountAvatarCharacter = { ...character, displayName: accountDisplayName, username: accountUsername, avatarUrl: accountProfile?.avatarUrl || character.avatarUrl };
  const firstName = accountDisplayName.trim().split(/\s+/)[0] || accountDisplayName;
  const welcomeLabel = 'QUE BOM TER VOCÊ DE VOLTA';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  useEffect(() => {
    void apiRequest<AccountProfileData>('/api/account/profile').then(setAccountProfile).catch(() => setAccountProfile(null));
    void apiRequest<{ canManage: boolean }>('/api/community/admin-access').then((result) => setCanManageCommunity(result.canManage)).catch(() => setCanManageCommunity(false));
    if (features.events !== false) void apiRequest<SocialEvent[]>('/api/events?limit=1').then((items) => setEvent(items[0] ?? null)).catch(() => setEvent(null));
    if (features.messages !== false) void apiRequest<DirectThread[]>('/api/messages-v2/summary').then(setThreads).catch(() => setThreads([]));
    if (features.bank === true) void apiRequest<{ wallet: { balanceCents: number } }>('/api/bank').then((result) => setWalletBalanceCents(result.wallet.balanceCents)).catch(() => setWalletBalanceCents(null));
    const revision = notificationsRevision.current;
    void apiRequest<HomeNotification[]>('/api/notifications?limit=4').then((items) => { if (notificationsRevision.current === revision) setNotifications(items); }).catch(() => { if (notificationsRevision.current === revision) setNotifications([]); });
  }, [tenant?.id, features.events, features.messages, features.bank]);
  useEffect(() => {
    const updateAccountProfile = (event: Event) => {
      const updated = (event as CustomEvent<AccountProfileData>).detail;
      if (updated) setAccountProfile(updated);
    };
    window.addEventListener('vybe:account-profile-updated', updateAccountProfile);
    return () => window.removeEventListener('vybe:account-profile-updated', updateAccountProfile);
  }, []);

  const availableApps = [
    { key: 'feed', title: 'Social', caption: 'Fotos, stories e momentos', icon: 'photo_camera', href: '/feed', color: 'social' },
    { key: 'pulse', title: 'Echo', caption: 'Pensamentos e acontecimentos', icon: 'graphic_eq', href: '/echo', color: 'pulse' },
    { key: 'match', title: 'Match', caption: 'Descubra novas conexões', icon: 'favorite', href: '/match', color: 'match' },
    { key: 'messages', title: 'Mensagens', caption: 'Conversas e grupos', icon: 'chat_bubble', href: '/mensagens', color: 'messages', badge: threads.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0) },
    { key: 'bank', title: 'Banco', caption: 'Saldo e transferências', icon: 'credit_card', href: '/banco', color: 'bank' },
    { key: 'events', title: 'Eventos', caption: 'Agenda da comunidade', icon: 'calendar_month', href: '/eventos', color: 'events' },
    { key: 'academic', title: 'Acadêmico', caption: 'Aulas, atividades e notas', icon: 'school', href: '/academico', color: 'academic' },
    { key: 'news', title: 'Notícias', caption: 'O jornal da comunidade', icon: 'newspaper', href: '/noticias', color: 'news' },
    { key: 'companies', title: 'Empresas', caption: 'Empresas e serviços', icon: 'apartment', href: '/empresas', color: 'companies' },
    ...(canManageCommunity ? [{ key: 'settings', title: 'Configurações', caption: 'Gerencie sua comunidade', icon: 'settings', href: '/configuracoes', color: 'settings' }] : []),
  ].filter((app) => {
    if (app.key === 'match') return features.match !== false;
    if (app.key === 'pulse') return features.pulse !== false;
    if (app.key === 'feed') return features.feed !== false;
    if (app.key === 'messages') return features.messages !== false;
    if (app.key === 'bank') return features.bank !== false;
    if (app.key === 'events') return features.events !== false;
    if (app.key === 'academic') return features.academic !== false;
    if (app.key === 'news') return features.news !== false;
    if (app.key === 'companies') return features.companies !== false;
    return true;
  });
  const openApp = (app: (typeof availableApps)[number]) => {
    const implemented = ['/feed', '/pulso', '/echo', '/mensagens', '/eventos', '/match', '/banco', '/academico', '/noticias', '/configuracoes'].includes(app.href);
    if (implemented) window.location.href = app.href;
    else { setMessage(app.key === 'companies' ? 'Este app ainda não está disponível.' : `${app.title} ainda não está disponível nesta comunidade.`); window.setTimeout(() => setMessage(''), 3200); }
  };
  const wallpaper = '/vybe-community-wallpaper-default.png';
  const unreadNotifications = notifications.filter((item) => !item.readAt).length;
  const showAllNotifications = async () => {
    const revision = notificationsRevision.current;
    setNotificationsOpen(false);
    setConfirmDeleteNotifications(false);
    setAllNotificationsOpen(true);
    setNotificationsLoading(true);
    try {
      const items = await apiRequest<HomeNotification[]>('/api/notifications');
      if (notificationsRevision.current !== revision) return;
      setAllNotifications(items);
      setNotifications(items.slice(0, 4));
      await apiRequest('/api/notifications/read', { method: 'PATCH' });
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      setAllNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
    } catch {
      setMessage('Não foi possível carregar as notificações.');
      window.setTimeout(() => setMessage(''), 3200);
    } finally {
      setNotificationsLoading(false);
    }
  };
  const deleteAllNotifications = async () => {
    notificationsRevision.current += 1;
    setNotifications([]);
    setAllNotifications([]);
    setDeletingNotifications(true);
    try {
      await apiRequest('/api/notifications', { method: 'DELETE' });
      setNotifications([]);
      setAllNotifications([]);
      setConfirmDeleteNotifications(false);
      setAllNotificationsOpen(false);
      setMessage('Notificações apagadas.');
      window.setTimeout(() => setMessage(''), 3200);
    } catch {
      setMessage('Não foi possível apagar as notificações.');
      window.setTimeout(() => setMessage(''), 3200);
    } finally {
      setDeletingNotifications(false);
    }
  };
  const upcomingEventCard = <article className="home-event-widget" style={{ backgroundImage: `linear-gradient(0deg,rgba(12,22,17,.78),rgba(12,22,17,.08)),url("${event?.imageUrl || tenant?.coverUrl || wallpaper}")` }}><span className="home-event-label"><MaterialIcon name="calendar_month"/> PRÓXIMO EVENTO</span>{event ? <><h2>{event.title}</h2><p>{event.category || 'Encontro da comunidade'}</p><small><MaterialIcon name="calendar_month"/> {new Date(event.startsAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} · {new Date(event.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} <MaterialIcon name="location_on"/> {event.location || 'Local a definir'}</small><a href={`/eventos/${event.id}`} aria-label="Ver detalhes do evento"><span>Ver detalhes</span><HomeArrow/></a><div className="home-event-indicators" aria-hidden="true"><i className="is-active"/><i/><i/></div></> : <p className="home-widget-empty">Nenhum evento próximo.</p>}</article>;
  return <main className="community-home" style={{ backgroundImage: `url("${wallpaper}")` }}>
    <header className="home-topbar"><div className="home-brand"><Logo/></div><span className="home-topbar-divider"/><details className="home-community-menu"><summary><strong>{tenant?.name ?? 'Sua comunidade'}</strong><MaterialIcon name="expand_more"/></summary><div><a href="/comunidades">Trocar de universo</a></div></details><div className="home-topbar-spacer"/><HelpHeaderLink/><div className="home-notification-menu"><button className="home-icon-button home-notifications-button" type="button" aria-label="Mostrar notificações recentes" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><MaterialIcon name="notifications"/>{unreadNotifications > 0 && <i>{unreadNotifications > 9 ? '9+' : unreadNotifications}</i>}</button>{notificationsOpen && <section className="home-notification-popover" aria-label="Quatro notificações mais recentes"><header><strong>Notificações</strong><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Fechar notificações"><MaterialIcon name="close"/></button></header>{notifications.slice(0, 4).map((item) => <a className="home-notification-popover-row" href={homeNotificationHref(item)} key={item.id} onClick={() => setNotificationsOpen(false)}><span className={`home-notification-icon ${item.type.startsWith('event_') ? 'is-event' : item.type.startsWith('news_') ? 'is-news' : 'is-community'}`}><MaterialIcon name={homeNotificationIcon(item)}/></span><span><strong>{homeNotificationMessage(item)}</strong><small>{item.type === 'community_creation_update' && item.status === 'APPROVED' ? 'Acessar minha comunidade →' : `há ${relativeTime(item.createdAt)}`}</small></span></a>)}{notifications.length === 0 && <p className="home-notification-popover-empty">Você está em dia com as notificações.</p>}<button className="home-notification-popover-all" type="button" onClick={showAllNotifications}>Ver todas as notificações</button></section>}</div><div className="home-profile-menu"><button className="home-profile-trigger" type="button" onClick={() => setProfileMenu((open) => !open)}><Avatar character={accountAvatarCharacter}/><span className="home-profile-copy"><strong>{accountDisplayName}</strong><small>@{accountUsername}</small></span><MaterialIcon name="expand_more"/></button>{profileMenu && <div className="home-profile-dropdown"><a href={`/@${encodeURIComponent(accountUsername)}`}>Perfil</a><a href="/configuracoes/sons">Sons e notificações</a><a href="/vybe-plus">VYBE+</a><a href="/comunidades">Trocar de universo</a><button type="button" onClick={onLogout}>Sair</button></div>}</div></header>
    <div className="home-content"><section className="home-left"><div className="home-welcome"><span>{welcomeLabel}</span><h1><span>{greeting},</span> <em>{firstName}.</em></h1><strong>{tenant?.name ?? 'Seu universo'}</strong><small>{date}</small></div>{upcomingEventCard}<div className="home-app-grid">{availableApps.map((app) => <button className={`home-app home-app--${app.color}`} type="button" key={app.key} onClick={() => openApp(app)} aria-label={`${app.title}: ${app.caption}`}><span className="home-app-icon"><CommunityAppIcon app={app.key}/>{Boolean(app.badge) && <i>{app.badge}</i>}</span><strong>{app.title}</strong><small>{app.caption}</small></button>)}{!availableApps.length && <p className="home-empty-apps">Os aplicativos desta comunidade aparecerão aqui.</p>}</div></section>
    <section className="home-widgets" aria-label="Resumo da comunidade"><div className="home-widget-pair">{features.bank === true && <article className="home-mini-widget home-bank-widget"><span>SEU SALDO</span><MaterialIcon name="credit_card"/><strong>{walletBalanceCents === null ? 'Saldo indisponível' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(walletBalanceCents / 100)}</strong><small>{walletBalanceCents === null ? 'Não foi possível carregar sua carteira.' : `Carteira virtual · ${tenant?.name ?? 'Comunidade'}`}</small><a className="home-bank-link" href="/banco">Ver extrato <HomeArrow/></a></article>}{features.messages !== false && <article className="home-mini-widget home-messages-widget"><span>MENSAGENS</span><a href="/mensagens" aria-label="Abrir mensagens"><HomeArrow/></a><div className="home-thread-avatars">{threads.slice(0, 3).map((thread) => <Avatar key={thread.character.id} character={thread.character}/>)}</div><strong>{threads.reduce((sum, thread) => sum + (thread.unreadCount ?? 0), 0)} novas mensagens</strong><small>{threads[0] ? `Última mensagem ${relativeTime(threads[0].createdAt)}` : 'Você ainda não tem novas mensagens.'}</small></article>}</div>
    <article className="home-notifications-widget"><header><span>NOTIFICAÇÕES RECENTES</span><button className="home-view-all" type="button" onClick={() => void showAllNotifications()}>Ver todas <HomeArrow/></button></header>{notifications.slice(0, 4).map((item) => <a className="home-notification-row" href={homeNotificationHref(item)} key={item.id}>{item.actor ? <Avatar character={item.actor}/> : <span className={`home-notification-icon ${item.type.startsWith('event_') ? 'is-event' : item.type.startsWith('news_') ? 'is-news' : 'is-community'}`}><MaterialIcon name={homeNotificationIcon(item)}/></span>}<span><strong>{homeNotificationMessage(item)}</strong><small>há {relativeTime(item.createdAt)}</small></span><MaterialIcon name="chevron_right"/></a>)}{notifications.length === 0 && <p className="home-notification-popover-empty">Você está em dia com as notificações.</p>}</article>
    <article className="home-promo-widget" aria-label="Explore tudo o que o VYBE oferece"><div className="home-promo-mascot" aria-hidden="true"><svg viewBox="0 0 130 145"><path d="M60 28c-4-14 2-22 12-27M68 17C79 3 94 4 100 7c-2 13-13 20-32 18" fill="#72c7b3" stroke="#176b69" strokeWidth="4" strokeLinecap="round"/><path d="M62 28v15" stroke="#176b69" strokeWidth="5" strokeLinecap="round"/><path d="M22 72c0-21 18-37 43-37s43 16 43 37v35c0 13-10 23-23 23H45c-13 0-23-10-23-23Z" fill="#fffdf5" stroke="#246b6e" strokeWidth="5"/><rect x="32" y="56" width="66" height="48" rx="21" fill="#17494b"/><path d="M49 80q5-8 10 0m10 0q5-8 10 0m-27 10q13 11 26 0" fill="none" stroke="#a8d8d2" strokeWidth="4" strokeLinecap="round"/><path d="M34 126v12m62-12v12m-57 0h14m29 0h14" stroke="#246b6e" strokeWidth="5" strokeLinecap="round"/></svg></div><div className="home-promo-copy"><span>✦</span><h2>Explore tudo<br/>o que o VYBE oferece!</h2><p>Conecte-se, participe de eventos,<br/>acompanhe sua vida acadêmica e muito mais.</p></div></article></section></div>
    <nav className="home-dock" aria-label="Navegação da comunidade"><a className="is-active" href="/"><MaterialIcon name="home"/><small>Início</small></a>{availableApps.filter((app) => ['feed','pulse','match','messages','bank','events'].includes(app.key)).map((app) => <button type="button" key={app.key} onClick={() => openApp(app)}><CommunityAppIcon app={app.key}/><small>{app.title}</small>{app.key === 'messages' && Boolean(app.badge) && <i/>}</button>)}<button type="button" onClick={() => setAppsOpen(true)}><CommunityAppIcon app="apps"/><small>Apps</small></button></nav>
    {appsOpen && <div className="home-apps-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAppsOpen(false); }}><section className="home-apps-panel" role="dialog" aria-modal="true" aria-label="Aplicativos da comunidade"><button type="button" className="home-apps-close" onClick={() => setAppsOpen(false)} aria-label="Fechar"><MaterialIcon name="close"/></button><span>SEU UNIVERSO</span><h2>Aplicativos</h2><div className="home-app-grid home-app-grid--launcher">{availableApps.map((app) => <button className={`home-app home-app--${app.color}`} type="button" key={app.key} onClick={() => openApp(app)} aria-label={`${app.title}: ${app.caption}`}><span className="home-app-icon"><CommunityAppIcon app={app.key}/></span><strong>{app.title}</strong></button>)}</div></section></div>}
    {allNotificationsOpen && <div className="home-all-notifications-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAllNotificationsOpen(false); }}><section className="home-all-notifications-panel" role="dialog" aria-modal="true" aria-label="Todas as notificações"><header><div><small>SUA COMUNIDADE</small><h2>Notificações</h2></div><button type="button" onClick={() => setAllNotificationsOpen(false)} aria-label="Fechar notificações"><MaterialIcon name="close"/></button></header><div className="home-all-notifications-list">{notificationsLoading ? <p className="home-notification-popover-empty">Carregando notificações…</p> : allNotifications.map((item) => <a className="home-notification-popover-row" href={homeNotificationHref(item)} key={item.id} onClick={() => { setAllNotificationsOpen(false); if (item.type === 'community_creation_update' && item.status === 'APPROVED' && item.communitySlug) activateLocalCommunity(item.communitySlug); }}><span className={`home-notification-icon ${item.type.startsWith('event_') ? 'is-event' : item.type.startsWith('news_') ? 'is-news' : 'is-community'}`}><MaterialIcon name={homeNotificationIcon(item)}/></span><span><strong>{homeNotificationMessage(item)}</strong><small>{item.type === 'community_creation_update' && item.status === 'APPROVED' ? 'Acessar minha comunidade →' : new Date(item.createdAt).toLocaleString('pt-BR')}</small></span></a>)}{!notificationsLoading && allNotifications.length === 0 && <div className="home-all-notifications-empty"><MaterialIcon name="notifications_off"/><p>Nenhuma notificação por enquanto.</p></div>}</div>{confirmDeleteNotifications ? <footer className="home-notification-delete-confirm"><span>Apagar todas as notificações?</span><button type="button" onClick={() => setConfirmDeleteNotifications(false)} disabled={deletingNotifications}>Cancelar</button><button type="button" onClick={() => void deleteAllNotifications()} disabled={deletingNotifications}>{deletingNotifications ? 'Apagando…' : 'Apagar'}</button></footer> : <footer><button className="home-delete-notifications-button" type="button" disabled={!allNotifications.length || notificationsLoading} onClick={() => setConfirmDeleteNotifications(true)}><MaterialIcon name="delete_outline"/> Apagar notificações</button></footer>}</section></div>}
    {message && <div className="home-toast" role="status">{message}</div>}</main>;
}

export function SocialApp({ character, onCharacterUpdated, onLogout }: { character: SocialCharacter; onCharacterUpdated: (character: SocialCharacter) => void; onLogout: () => void }) {
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [search, setSearch] = useState('');
  const [composerChoice, setComposerChoice] = useState<ComposerChoice | null>(null);
  const [commentPost, setCommentPost] = useState<SocialPost | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [replyToComment, setReplyToComment] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const { captureSelection: captureCommentSelection, insertEmoji: insertCommentEmoji } = useEmojiInsertion(commentInputRef, commentDraft, setCommentDraft);
  const path = window.location.pathname;
  const echoMode = path.startsWith('/echo') || path === '/pulso' || (path === '/personalizacao-vybe-verificado' && new URLSearchParams(window.location.search).get('app') === 'echo');
  const settingsMode = path === '/configuracoes';
  const soundSettingsMode = path === '/configuracoes/sons';
  const manageBenefitsMode = path === '/vybe-plus/gerenciar';
  const socialRedesignMode = ['/feed', '/stories', '/explorar', '/notificacoes'].includes(path) || path.startsWith('/@');
  const [echoIdentity,setEchoIdentity]=useState<SocialCharacter>(character);
  const isCommunityHome = path === '/';

  useEffect(() => { soundManager.installUnlock(); void soundManager.load(); }, []);
  useEffect(() => {
    if (!tenant?.id) return;
    let initialized = false;
    let knownIds = new Set<string>();
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/notifications?limit=50', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return;
        const rows = await response.json() as Array<{ id: string; type: string; targetId: string }>;
        if (stopped) return;
        if (!initialized) { knownIds = new Set(rows.map((row) => row.id)); initialized = true; return; }
        const fresh = rows.filter((row) => !knownIds.has(row.id));
        knownIds = new Set([...knownIds, ...rows.map((row) => row.id)].slice(-300));
        if (!fresh.length) return;
        const match = fresh.find((row) => row.type === 'match_created');
        const verified = fresh.find((row) => ['verification_approved', 'verification_gift_activated'].includes(row.type));
        if (match) soundManager.play('match', match.targetId);
        else if (verified) soundManager.play('vybePlus', verified.id);
        else {
          const ordinary = fresh.find((row) => row.type !== 'message');
          if (ordinary) soundManager.play('notification', ordinary.id);
        }
      } catch { /* Notification polling is best-effort and silent. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 12_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [tenant?.id]);

  const openCreate = (choice?: 'post' | 'story') => setComposerChoice(choice ?? 'choose');
  async function loadStories() { try { setStories(await apiRequest<StoryGroup[]>('/api/stories')); } catch { setStories([]); } }
  useEffect(() => {
    void apiRequest<TenantInfo>('/api/community').then(setTenant).catch(() => undefined);
    if(echoMode)void apiRequest<{profile:SocialCharacter}>('/api/echo/profile').then((result)=>setEchoIdentity(result.profile)).catch(()=>setEchoIdentity(character));
    if (['/feed', '/stories', '/pulso'].includes(path)) void loadStories();
    const refresh = () => void loadStories();
    window.addEventListener('vybe:refresh-stories', refresh);
    return () => window.removeEventListener('vybe:refresh-stories', refresh);
  }, [path,echoMode,character]);
  useEffect(()=>{const update=(event:Event)=>{const profile=(event as CustomEvent<SocialCharacter>).detail;if(profile)setEchoIdentity(profile);};window.addEventListener('vybe:echo-profile-updated',update);return()=>window.removeEventListener('vybe:echo-profile-updated',update);},[]);
  useEffect(() => {
    if (!tenant?.brand) return;
    const root = document.documentElement;
    const mappings: Array<[string, string]> = [
      ['--color-primary', tenant.brand.primary], ['--color-primary-dark', tenant.brand.dark],
      ['--color-primary-medium', tenant.brand.medium], ['--color-primary-light', tenant.brand.lilac],
      ['--color-primary-soft', tenant.brand.soft], ['--color-text', tenant.brand.graphite],
    ];
    for (const [property, value] of mappings) root.style.setProperty(property, value);
    return () => { for (const [property] of mappings) root.style.removeProperty(property); };
  }, [tenant?.brand]);
  useEffect(() => {
    const showComments = (event: Event) => { const post = (event as CustomEvent<SocialPost>).detail; setCommentDraft(''); setCommentPost(post); void apiRequest<CommentItem[]>(`/api/posts/${post.id}/comments`).then(setComments).catch(() => setComments([])); };
    window.addEventListener('vybe:comments', showComments);
    return () => window.removeEventListener('vybe:comments', showComments);
  }, []);

  let page: ReactNode;
  if (path === '/vybe-plus/gerenciar') page = <ManageVybePlusPage tenant={tenant}/>;
  else if (path === '/vybe-plus' || path === '/beneficios-vybe') page = <BenefitsPage tenant={tenant} character={character} onLogout={onLogout}/>;
  else if (path === '/personalizacao-vybe-verificado') page = <CustomizationPage character={character} tenant={tenant} app={new URLSearchParams(window.location.search).get('app') === 'echo' ? 'ECHO' : 'SOCIAL'}/>;
  else if (path === '/explorar') page = <ExplorePage current={character}/>;
  else if (path === '/stories' || path === '/pulso' || path === '/feed') page = <HomePage character={character} stories={stories} onCreate={openCreate} showInfoRail={socialRedesignMode}/>;
  else if (path === '/mensagens') page = <MessagesPage/>;
  else if (path === '/conversas') page = null;
  else if (path === '/comunidade') page = <CommunityPage tenant={tenant}/>;
  else if (path.startsWith('/empresas')) page = <CompaniesPage community={tenant?.name ?? 'sua comunidade'}/>;
  else if (path === '/eventos') page = <EventsPage section="home"/>;
  else if (path === '/eventos/calendario') page = <EventsPage section="calendar"/>;
  else if (path.startsWith('/eventos/')) page = <EventsPage eventId={path.slice('/eventos/'.length)}/>;
  else if (path === '/notificacoes') page = <NotificationsPage/>;
  else if (path === '/configuracoes') page = <SettingsPage/>;
  else if (path === '/configuracoes/sons') page = <SoundSettingsPage/>;
  else if (path === '/ajuda') page = <HelpPage character={character} tenant={tenant}/>;
  else if (path === '/comunidades') page = <CommunitySwitchPage currentSlug={tenant?.slug ?? ''}/>;
  else if (path.startsWith('/@')) {
    const [username, connectionList] = decodeURIComponent(path.slice(2)).split('/');
    page = connectionList === 'followers' || connectionList === 'following'
      ? <ConnectionsPage username={username} list={connectionList}/>
      : <ProfilePage username={username} currentCharacter={character} onUpdated={onCharacterUpdated}/>;
  }
  else page = <HomePage character={character} stories={stories} onCreate={openCreate} showInfoRail={socialRedesignMode}/>;

  if (path === '/echo' || path === '/pulso') page = <EchoPage identity={echoIdentity} tenant={tenant}/>;
  else if (path === '/echo/explorar') page = <EchoPage identity={echoIdentity} tenant={tenant} initialTab="for-you"/>;
  else if (path === '/echo/notificacoes') page = <NotificationsPage echo/>;
  else if (path === '/echo/perfil') page = <EchoProfilePage current={character} tenant={tenant}/>;
  if (path.startsWith('/match')) return <MatchApp community={tenant?.name ?? 'Sua comunidade'} communityId={tenant?.id ?? ''}/>;
  if (path.startsWith('/mensagens')) {
    const messageParams = new URLSearchParams(window.location.search);
    const privateMessages = path === '/mensagens/perfil' || path === '/mensagens/privadas' || ['conversation', 'to', 'new'].some((key) => messageParams.has(key)) || messageParams.get('tab') === 'groups';
    if (messageParams.get('home') === '1' || (path === '/mensagens' && !privateMessages && !messageParams.has('serverId'))) return <MessagesHomePage character={character} community={tenant?.name ?? 'Sua comunidade'}/>;
    return privateMessages ? <MessagesApp character={character} community={tenant?.name ?? 'Sua comunidade'}/> : <CommunityChatPage tenant={tenant} character={character}/>;
  }
  if (path === '/conversas') return <CommunityChatPage tenant={tenant} character={character}/>;
  if (path === '/ajuda') return <HelpPage character={character} tenant={tenant}/>;
  if (path.startsWith('/academico')) return <AcademicApp community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/noticias')) return <NewsApp community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/banco')) return <BankApp character={character}/>;
  if (path === '/eventos/admin') return <EventsAdminPage community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/eventos')) return <EventsPage community={tenant?.name ?? 'Sua comunidade'} section={path === '/eventos/calendario' ? 'calendar' : 'home'} eventId={path.startsWith('/eventos/') && path !== '/eventos/calendario' ? path.slice('/eventos/'.length) : undefined}/>;
  if (path === '/perfil') return <AccountProfilePage/>;
  return <>
    {isCommunityHome && <CommunityHome character={character} tenant={tenant} onLogout={onLogout}/>}
    {!isCommunityHome && <div className={`social-app ${socialRedesignMode ? 'social-redesign' : ''} ${echoMode ? 'echo-app' : ''} ${settingsMode || soundSettingsMode ? 'settings-app' : ''} ${manageBenefitsMode ? 'manage-vybe-plus' : ''}`}>
      {!settingsMode && !soundSettingsMode && !manageBenefitsMode && <AppSidebar character={character} tenant={tenant} hideCommunity={['/vybe-plus', '/beneficios-vybe'].includes(path)} onCreate={() => openCreate()} echo={echoMode}/>}
      <main className="social-workspace">
        {!settingsMode && path !== '/personalizacao-vybe-verificado' && <header className="social-topbar">
          {manageBenefitsMode ? <><Logo/><span className="home-topbar-divider"/><details className="home-community-menu vybe-plus-community-menu"><summary><span className="home-community-mark">{tenant?.logoUrl ? <img src={tenant.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span><strong>{tenant?.name ?? 'Sua comunidade'}</strong><MaterialIcon name="expand_more"/></summary><div><a href="/comunidades">Trocar de universo</a></div></details><div className="home-topbar-spacer"/><a className="vybe-plus-manage-header-link" href="/vybe-plus">VYBE+</a></> : <>
            {!echoMode && !['/vybe-plus', '/beneficios-vybe'].includes(path) && <a className="social-topbar-brand" href="/feed">VYBE <span>Social</span><b aria-hidden="true">✦</b></a>}
            {!echoMode && !socialRedesignMode && path !== '/personalizacao-vybe-verificado' && !['/vybe-plus', '/beneficios-vybe'].includes(path) && <label className="global-search"><MaterialIcon name="search" className="global-search-icon"/><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && search.trim()) window.location.href = `/explorar?q=${encodeURIComponent(search.trim())}`; }} placeholder="Pesquisar pessoas, lugares..."/></label>}
          </>}
          <HelpHeaderLink/><details className="topbar-profile-menu"><summary className="topbar-user"><Avatar character={echoMode ? echoIdentity : character}/><span><strong><VerifiedName character={echoMode ? echoIdentity : character}>{echoMode ? echoIdentity.displayName : character.displayName}</VerifiedName></strong><small>@{echoMode ? echoIdentity.username : character.username}</small></span><b><MaterialIcon name="expand_more"/></b></summary><div><a href={echoMode ? '/echo/perfil' : `/@${character.username}`}>Perfil</a><a href="/configuracoes/sons">Sons e notificações</a><a href="/vybe-plus">VYBE+</a><a href="/comunidades">Meus universos</a><button type="button" onClick={onLogout}>Sair</button></div></details>
        </header>}
        <div className="social-page-layout"><div className="social-route-column">{page}</div>{['/feed', '/stories'].includes(path) && !socialRedesignMode && <SocialInfoRail character={character}/>}</div>
      </main>
      {composerChoice && <ComposerModal character={character} choice={composerChoice} onChoose={setComposerChoice} onClose={() => setComposerChoice(null)} onPosted={() => { window.dispatchEvent(new Event('vybe:refresh-feed')); window.dispatchEvent(new Event('vybe:refresh-stories')); }}/ >}
      {commentPost && <div className="story-overlay"><section className="comments-modal" role="dialog" aria-modal="true"><button className="modal-x" type="button" onClick={() => setCommentPost(null)}><MaterialIcon name="close"/></button><h2>Respostas</h2><div className="comments-list">{comments.map((comment) => <article className={comment.replyToCommentId ? 'echo-comment-reply' : ''} key={comment.id}><Avatar character={comment.author}/><div><strong>{comment.author ? <VerifiedName character={comment.author}>{comment.author.displayName}</VerifiedName> : 'Alguém'} </strong><ProfileFontText as="div" character={comment.author} role="secondary"><FormattedText text={comment.content}/></ProfileFontText><button type="button" onClick={() => { setReplyToComment(comment.id); commentInputRef.current?.focus(); }}>Responder</button>{comment.own && <button type="button" onClick={async () => { await apiRequest(`/api/comments/${comment.id}`, { method: 'DELETE' }); setComments((items) => items.filter((item) => item.id !== comment.id)); }}>Excluir</button>}</div></article>)}</div><form className="comment-compose" onSubmit={async (event) => { event.preventDefault(); if (!commentDraft.trim()) return; const comment = await apiRequest<CommentItem>(`/api/posts/${commentPost.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: commentDraft, ...(replyToComment ? { replyToCommentId: replyToComment } : {}) }) }); setComments((items) => [...items, comment]); setCommentDraft(''); setReplyToComment(null); window.dispatchEvent(new Event('vybe:refresh-feed')); }}><TextFormattingEditor ref={commentInputRef} value={commentDraft} onChange={setCommentDraft} name="comment" placeholder={replyToComment ? 'Escreva uma resposta...' : 'Compartilhe uma resposta...'} maxLength={1000} required/><EmojiButton onBeforeOpen={captureCommentSelection} onSelect={insertCommentEmoji}/><button className="primary-button">Responder</button></form></section></div>}
    </div>}
  </>;
}
