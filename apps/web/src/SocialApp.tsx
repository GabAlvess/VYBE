import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type SyntheticEvent } from 'react';
import './SocialApp.css';
import { notifySnack } from './SnackMessage';
import { MaterialIcon } from './MaterialIcon';
import { VybeLogo } from './VybeLogo';
import { EmojiButton, useEmojiInsertion } from './EmojiPicker';
import { EventsAdminPage, EventsPage } from './EventsPage';
import { VERIFICATION_PRICE_BRL } from '@vybe/shared';
import { VerificationAdminPage } from './VerificationAdminPage';
import { MatchApp } from './MatchApp';
import { MessagesApp } from './MessagesApp';
import { UniverseBackLink } from './UniverseBackLink';
import { BankApp } from './BankApp';
import { ProfilePhotoEditor } from './ProfilePhotoEditor';
import { AcademicApp } from './AcademicApp';
import { NewsApp } from './NewsApp';

export type SocialCharacter = {
  id: string;
  username: string;
  displayName: string;
  communityFunction?: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  own?: boolean;
  following?: boolean;
  verified?: boolean;
};
type SocialPost = { id: string; content: string; imageUrl: string; imageUrls?: string[]; kind: 'post' | 'pulse'; likesCount: number; commentsCount: number; repostCount?: number; reposted?: boolean; createdAt: string; liked: boolean; saved?: boolean; canDelete?: boolean; author: SocialCharacter };
type StoryItem = { id: string; imageUrl: string; createdAt: string };
type StoryGroup = { character: SocialCharacter; own: boolean; unseen: boolean; stories: StoryItem[] };
type SocialEvent = { id: string; title: string; description: string; startsAt: string; location: string; imageUrl: string; category?: string; participantLimit?: number | null; allowComments?: boolean; status?: string; statusLabel?: string; official?: boolean; rejectedReason?: string; cancellationReason?: string; confirmedCount?: number; going?: boolean; canManage?: boolean; canEdit?: boolean; creator?: { id: string; username: string; displayName: string; avatarUrl: string } | null };
type CommunityFeatures = { feed?: boolean; pulse?: boolean; stories?: boolean; conversations?: boolean; messages?: boolean; events?: boolean; match?: boolean; bank?: boolean; academic?: boolean; career?: boolean; news?: boolean; companies?: boolean };
type TenantInfo = { id?: string; name: string; slug?: string; description: string; memberCount: number; rules: string[]; coverUrl?: string; wallpaperUrl?: string; logoUrl?: string; settings?: { features?: CommunityFeatures }; administrators?: SocialCharacter[]; brand?: { primary: string; dark: string; medium: string; soft: string; lilac: string; white: string; graphite: string } };
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

function Avatar({ character, className = '' }: { character?: Pick<SocialCharacter, 'displayName' | 'avatarUrl'> | null; className?: string }) {
  const initial = character?.displayName?.slice(0, 1).toUpperCase() ?? '?';
  const name = character?.displayName ?? 'VYBE';
  return <span className={`social-avatar ${className} ${character?.avatarUrl ? '' : 'social-avatar--sample'}`} aria-label={name} role="img">{!character?.avatarUrl && <span className="avatar-fallback-initial">{initial}</span>}{character?.avatarUrl && <img className="social-avatar-image" src={character.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }}/>}</span>;
}

function VerificationBadge({ verified = false }: { verified?: boolean }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  async function requestVerification() {
    setSubmitting(true);
    try {
      const result = await apiRequest<{ adminUsername: string; suggestedMessage: string }>('/api/verification/requests', { method: 'POST' });
      const query = new URLSearchParams({ to: result.adminUsername, draft: result.suggestedMessage });
      window.location.href = `/mensagens?${query.toString()}`;
    } finally { setSubmitting(false); }
  }
  return <span className="verification-badge-wrap">
    <button type="button" className={`verification-badge ${verified ? 'is-verified' : 'is-available'}`} title={verified ? 'Perfil verificado pelo VYBE' : 'Verificação disponível'} aria-label={verified ? 'Perfil verificado pelo VYBE' : 'Verificação disponível'} onClick={() => setOpen(true)}>
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.3"/>{verified && <path d="m6.2 10.2 2.4 2.4 5.2-5.3"/>}</svg>
    </button>
    {open && verified && <span className="verification-popover" role="status"><strong>Perfil verificado pelo VYBE</strong><small>Este perfil possui uma verificação ativa.</small><button type="button" onClick={() => setOpen(false)}>Fechar</button></span>}
    {open && !verified && <div className="verification-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setOpen(false); }}><section className="verification-offer" role="dialog" aria-modal="true" aria-labelledby="verification-offer-title"><button className="modal-x" type="button" aria-label="Fechar" disabled={submitting} onClick={() => setOpen(false)}><MaterialIcon name="close"/></button><span className="verification-offer-mark"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.3"/><path d="m6.2 10.2 2.4 2.4 5.2-5.3"/></svg></span><h2 id="verification-offer-title">Torne-se verificado</h2><p>Destaque seu perfil e mostre que ele possui o selo oficial de verificação do VYBE.</p><ul><li>Selo de verificação no perfil</li><li>Selo nas publicações e comentários</li><li>Identificação visual em toda a comunidade</li><li>Pagamento único</li></ul><strong className="verification-price">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(VERIFICATION_PRICE_BRL)}</strong><small>Pagamento único. O selo permanece ativo enquanto sua conta estiver em conformidade com as regras do VYBE.</small><button className="primary-button" type="button" disabled={submitting} onClick={() => void requestVerification()}>{submitting ? 'Abrindo conversa…' : 'Quero me tornar verificado'}</button><button className="verification-dismiss" type="button" disabled={submitting} onClick={() => setOpen(false)}>Agora não</button></section></div>}
  </span>;
}

function relativeTime(date: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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

function NavIcon({ name }: { name: 'home' | 'explore' | 'community' | 'notifications' | 'messages' | 'conversations' | 'profile' | 'pulse' | 'create' | 'event' }) {
  const names = { home: 'home', explore: 'explore', community: 'groups', notifications: 'notifications', messages: 'mail', conversations: 'forum', profile: 'person', pulse: 'edit_note', create: 'add_box', event: 'calendar_month' } as const;
  return <MaterialIcon name={names[name]} className="nav-icon"/>;
}

function SidebarItem({ href, icon, label, active = false, unread = false, onClick, className = '' }: { href?: string; icon: ReactNode; label: string; active?: boolean; unread?: boolean; onClick?: () => void; className?: string }) {
  const content = <><span className="sidebar-item-icon">{icon}{unread && <i className="sidebar-unread-dot" aria-label="Mensagens não lidas"/>}</span><span className="sidebar-item-label">{label}</span></>;
  return href ? <a className={`sidebar-item ${active ? 'active' : ''} ${className}`} href={href} title={label}>{content}</a>
    : <button className={`sidebar-item ${className}`} type="button" onClick={onClick} title={label}>{content}</button>;
}

function AppSidebar({ character, tenant, onCreate, echo = false }: { character: SocialCharacter; tenant: TenantInfo | null; onCreate: () => void; echo?: boolean }) {
  const currentPath = window.location.pathname;
  const profilePath = `/@${character.username}`;
  if (echo) return <aside className="social-sidebar echo-sidebar">
    <div className="sidebar-brand-row"><Logo/></div><div className="echo-brand"><strong>VYBE Echo</strong><small>{tenant?.name ?? 'Sua comunidade'}</small></div>
    <nav aria-label="Navegação do Echo" className="social-nav">
      <SidebarItem href="/echo" icon={<NavIcon name="home"/>} label="Início" active={currentPath === '/echo'}/>
      <SidebarItem href="/echo/explorar" icon={<NavIcon name="explore"/>} label="Explorar" active={currentPath.startsWith('/echo/explorar')}/>
      <SidebarItem href="/echo/notificacoes" icon={<NavIcon name="notifications"/>} label="Notificações" active={currentPath === '/echo/notificacoes'}/>
      <SidebarItem href={`/echo/perfil`} icon={<NavIcon name="profile"/>} label="Perfil" active={currentPath === '/echo/perfil'}/>
    </nav>
    <UniverseBackLink className="social-universe-back"/>
  </aside>;
  return <aside className="social-sidebar">
    <div className="sidebar-brand-row"><Logo/></div>
    <div className="community-switcher"><span className="community-badge-mark"><MaterialIcon name="groups"/></span><span className="community-badge-copy"><strong>{tenant?.name ?? 'Sua comunidade'}</strong></span></div>
    <nav aria-label="Menu da comunidade" className="social-nav">
      <SidebarItem href="/feed" icon={<NavIcon name="home"/>} label="Início" active={currentPath === '/feed' || currentPath === '/'} />
      <SidebarItem href="/explorar" icon={<NavIcon name="explore"/>} label="Explorar" active={currentPath === '/explorar'} />
      <SidebarItem icon={<NavIcon name="create"/>} label="Criar" onClick={onCreate} className="sidebar-create"/>
      <SidebarItem href="/notificacoes" icon={<NavIcon name="notifications"/>} label="Notificações" active={currentPath === '/notificacoes'} />
      <SidebarItem href={profilePath} icon={<NavIcon name="profile"/>} label="Perfil" active={currentPath === profilePath} />
    </nav>
    <UniverseBackLink className="social-universe-back"/>
  </aside>;
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
  return <div className="story-overlay" role="presentation" onClick={close}><section className="story-viewer story-viewer-real" role="dialog" aria-modal="true" aria-label={`Story de ${activeGroup.character.displayName}`} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); if (event.key === 'Escape') close(); }} onClick={(event) => event.stopPropagation()}><div className="story-progress">{activeGroup.stories.map((item, itemIndex) => <i className={itemIndex <= index ? 'is-active' : ''} key={item.id}/>)}</div><header><Avatar character={activeGroup.character}/><span><strong>{activeGroup.character.displayName}</strong><small>{relativeTime(story.createdAt)}</small></span><button type="button" aria-label="Fechar story" onClick={close}><MaterialIcon name="close"/></button></header><img src={story.imageUrl} alt={`Story de ${activeGroup.character.displayName}`}/><button className="story-prev" type="button" aria-label="Story anterior" onClick={() => move(-1)}><MaterialIcon name="chevron_left"/></button><button className="story-next" type="button" aria-label="Próximo story" onClick={() => move(1)}><MaterialIcon name="chevron_right"/></button></section></div>;
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
    {kind === 'post' && <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={5000} placeholder="Escreva uma legenda..."/>}
    <input ref={imageInput} className="composer-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple={kind === 'post'} onChange={(event) => { void selectImages(event.currentTarget.files); event.currentTarget.value = ''; }}/>
    <button className="composer-upload" type="button" onClick={() => imageInput.current?.click()}><MaterialIcon name="add_a_photo"/><strong>{images.length ? 'Adicionar mais imagens' : 'Selecionar imagem'}</strong><small>{kind === 'story' ? 'Uma imagem · disponível por 24 horas' : '4:5 recomendado (1080 × 1350) · 3:4 (1080 × 1440) · quadrado (1080 × 1080)'}</small></button>
    {!!images.length && <div className={`composer-image-previews ${kind === 'story' ? 'composer-image-previews--story' : ''}`}>{images.map((image, index) => <figure key={`${index}-${image.slice(-12)}`}><img src={image} alt={`Prévia ${index + 1}`}/><button type="button" aria-label={`Remover imagem ${index + 1}`} onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}><MaterialIcon name="close"/></button></figure>)}</div>}
    {error && <p className="inline-error" role="alert">{error}</p>}<footer><span>{kind === 'story' ? 'Seu story desaparece após 24 horas.' : `${content.length}/5000`}</span><button className="primary-button" type="submit" disabled={posting || !images.length}>{posting ? 'Publicando…' : 'Publicar'}</button></footer>
  </form>;
}

type ComposerChoice = 'choose' | 'post' | 'story';
function ComposerModal({ character, choice, onChoose, onClose, onPosted }: { character: SocialCharacter; choice: ComposerChoice; onChoose: (choice: ComposerChoice) => void; onClose: () => void; onPosted: () => void }) {
  if (choice === 'choose') return <div className="composer-modal-backdrop" role="presentation" onClick={onClose}><section className="composer-modal-picker" role="dialog" aria-modal="true" aria-labelledby="create-title" onClick={(event) => event.stopPropagation()}>
    <header><div><span>CRIAR</span><h2 id="create-title">O que deseja compartilhar?</h2></div><button type="button" className="modal-x" aria-label="Fechar" onClick={onClose}><MaterialIcon name="close"/></button></header>
    <div className="create-choice-grid"><button type="button" onClick={() => onChoose('post')}><MaterialIcon name="image"/><strong>Publicação</strong><small>Uma ou mais imagens com legenda</small></button><button type="button" onClick={() => onChoose('story')}><MaterialIcon name="add_a_photo"/><strong>Story</strong><small>Um momento por 24 horas</small></button></div>
  </section></div>;
  return <div className="composer-modal-backdrop" role="presentation" onClick={onClose}><section className="composer-modal-editor" role="dialog" aria-modal="true" aria-labelledby="create-editor-title" onClick={(event) => event.stopPropagation()}><header><div><span>{choice === 'story' ? 'STORY' : 'FEED'}</span><h2 id="create-editor-title">{choice === 'story' ? 'Compartilhe um momento' : 'Nova publicação'}</h2></div><button type="button" className="modal-x" aria-label="Fechar" onClick={onClose}><MaterialIcon name="close"/></button></header><Composer character={character} kind={choice} onPosted={() => { onPosted(); onClose(); }}/></section></div>;
}

function PostCard({ post, onRefresh, onComments, onOpen, currentCharacter }: { post: SocialPost; onRefresh: () => void; onComments: (post: SocialPost) => void; onOpen?: (post: SocialPost) => void; currentCharacter?: SocialCharacter }) {
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [commentDraft, setCommentDraft] = useState('');
  const images = post.imageUrls?.length ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];
  async function toggleLike() {
    setPending(true);
    try { await apiRequest(`/api/posts/${post.id}/like`, { method: post.liked ? 'DELETE' : 'PUT' }); onRefresh(); }
    finally { setPending(false); }
  }
  async function toggleSaved() {
    setPending(true);
    try { await apiRequest(`/api/posts/${post.id}/save`, { method: post.saved ? 'DELETE' : 'PUT' }); onRefresh(); }
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
  return <><article className="social-panel post-card post-card--visual"><header className="post-header"><a href={`/@${post.author.username}`}><Avatar character={post.author}/></a><div><span className="post-author-title"><a href={`/@${post.author.username}`} className="post-author-name">{post.author.displayName}</a><VerificationBadge verified={post.author.verified}/></span><span>@{post.author.username} · {relativeTime(post.createdAt)}</span></div>{post.canDelete && <div className="post-menu-wrap"><button className="post-more" type="button" aria-label="Mais opções" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MaterialIcon name="more_horiz"/></button>{menuOpen && <div className="post-options-menu" role="menu"><button type="button" role="menuitem" disabled={pending} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}><MaterialIcon name="delete"/>Excluir publicação</button></div>}</div>}</header>
    {images.length > 0 && <div className="post-carousel"><img className="post-image" src={images[imageIndex]} alt={`Imagem ${imageIndex + 1} da publicação`} onClick={() => onOpen?.(post)} onError={useFallbackImage}/>{images.length > 1 && <><span className="carousel-count">{imageIndex + 1}/{images.length}</span><button type="button" className="carousel-arrow carousel-prev" aria-label="Imagem anterior" onClick={() => setImageIndex((index) => (index - 1 + images.length) % images.length)}><MaterialIcon name="chevron_left"/></button><button type="button" className="carousel-arrow carousel-next" aria-label="Próxima imagem" onClick={() => setImageIndex((index) => (index + 1) % images.length)}><MaterialIcon name="chevron_right"/></button></>}</div>}
    {images.length > 1 && <div className="carousel-dots" aria-label={`${images.length} imagens`}>{images.map((image, index) => <button className={index === imageIndex ? 'is-active' : ''} type="button" key={`${index}-${image.slice(-12)}`} aria-label={`Mostrar imagem ${index + 1}`} onClick={() => setImageIndex(index)}/>)}</div>}
    <footer className="post-actions"><button className={post.liked ? 'liked' : ''} type="button" disabled={pending} aria-label="Curtir" onClick={() => void toggleLike()}><MaterialIcon name="favorite" filled={post.liked}/></button><button type="button" aria-label="Comentar" onClick={() => onComments(post)}><MaterialIcon name="comment"/></button><button type="button" aria-label="Compartilhar" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/posts/${post.id}`); notifySnack('Link copiado.'); }}><MaterialIcon name="send"/></button><button className={`bookmark-action ${post.saved ? 'is-saved' : ''}`} type="button" aria-label={post.saved ? 'Remover dos salvos' : 'Salvar'} disabled={pending} onClick={() => void toggleSaved()}><MaterialIcon name="bookmark" filled={post.saved}/></button></footer>
    <div className="post-content"><strong className="post-likes-count">{post.likesCount.toLocaleString('pt-BR')} curtidas</strong>{post.content && <p className="post-copy"><a href={`/@${post.author.username}`}>{post.author.username}</a> {post.content}</p>}{post.commentsCount > 0 && <button className="post-comments-link" type="button" onClick={() => onComments(post)}>Ver todos os {post.commentsCount} comentários</button>}</div>
    <form className="post-inline-comment" onSubmit={(event) => void submitComment(event)}>{currentCharacter && <Avatar character={currentCharacter}/>}<input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={1000} placeholder="Adicione um comentário..."/><button type="submit" disabled={!commentDraft.trim()}>Publicar</button></form>
  </article>{confirmDelete && <div className="composer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setConfirmDelete(false); }}><section className="delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby={`delete-post-title-${post.id}`} aria-describedby={`delete-post-description-${post.id}`}><span className="delete-confirm-icon"><MaterialIcon name="delete"/></span><h2 id={`delete-post-title-${post.id}`}>Excluir publicação?</h2><p id={`delete-post-description-${post.id}`}>Esta publicação e as interações relacionadas serão removidas. Esta ação não pode ser desfeita.</p><div><button type="button" className="delete-cancel-button" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancelar</button><button type="button" className="delete-confirm-button" disabled={pending} onClick={() => void deletePost()}>{pending ? 'Excluindo…' : 'Excluir publicação'}</button></div></section></div>}</>;
}

function CurrentProfile({ character }: { character: SocialCharacter }) { return <section className="right-profile-preview"><div className="right-profile-details"><Avatar character={character}/><h2>{character.displayName} <VerificationBadge verified={character.verified}/></h2><small>@{character.username}</small><div className="right-profile-stats"><span><strong>{character.postCount.toLocaleString('pt-BR')}</strong>Publicações</span><span><strong>{character.followerCount.toLocaleString('pt-BR')}</strong>Seguidores</span><span><strong>{character.followingCount.toLocaleString('pt-BR')}</strong>Seguindo</span></div><a className="right-profile-edit" href={`/@${character.username}`}>Ver perfil</a></div></section>; }

function HomePage({ character, stories, onCreate }: { character: SocialCharacter; stories: StoryGroup[]; onCreate: (choice?: 'post' | 'story') => void }) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [story, setStory] = useState<StoryGroup | null>(null);
  const [error, setError] = useState('');
  async function loadFeed() {
    try { setPosts(await apiRequest<SocialPost[]>('/api/feed?tab=for-you')); setError(''); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o feed.'); }
  }
  useEffect(() => {
    void loadFeed();
    const refresh = () => { void loadFeed(); };
    window.addEventListener('vybe:refresh-feed', refresh);
    return () => window.removeEventListener('vybe:refresh-feed', refresh);
  }, []);
  return <div className="social-content-grid"><div className="social-main-column">
    <Stories groups={stories} current={character} onOpen={setStory} onCreate={() => onCreate('story')}/>
    <>
      {error && <div className="inline-error">{error}</div>}
      {posts.map((post) => <PostCard key={post.id} post={post} currentCharacter={character} onRefresh={() => void loadFeed()} onComments={(selected) => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: selected }))}/>)}
      {posts.length === 0 && !error && <div className="social-panel blank-state">Ainda não há publicações por aqui.</div>}
    </>
  </div>{story && <StoryViewer group={story} groups={stories} onClose={() => setStory(null)}/>}</div>;
}

function ExplorePage({ current }: { current: SocialCharacter }) {
  const [query, setQuery] = useState(new URLSearchParams(window.location.search).get('q') ?? '');
  const [people, setPeople] = useState<SocialCharacter[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim());
      const result = await apiRequest<{ people: SocialCharacter[]; posts: SocialPost[] }>(`/api/explore${params.size ? `?${params}` : ''}`);
      setPeople(result.people); setPosts(result.posts);
    } finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 220); return () => window.clearTimeout(timer); }, [query]);
  async function toggleFollow(person: SocialCharacter) { await apiRequest(`/api/characters/${person.username}/follow`, { method: person.following ? 'DELETE' : 'POST' }); await load(); }
  return <section className="explore-page"><header className="explore-heading"><span>EXPLORAR</span><h1>Encontre publicações e pessoas</h1><label className="explore-search"><MaterialIcon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar pessoas, lugares ou publicações..."/></label></header>
    {query && people.length > 0 && <section className="explore-people"><h2>Pessoas</h2>{people.map((person) => <article key={person.id}><a href={`/@${person.username}`}><Avatar character={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></a><button type="button" className={person.following ? 'following' : ''} onClick={() => void toggleFollow(person)}>{person.following ? 'Seguindo' : 'Seguir'}</button></article>)}</section>}
    <h2 className="explore-grid-title">{query ? 'Publicações' : 'Descubra'}</h2><div className="explore-image-grid">{posts.map((post) => <button type="button" className="explore-image-tile" key={post.id} onClick={() => setSelectedPost(post)}><img src={post.imageUrls?.[0] || post.imageUrl} alt={post.content || `Publicação de ${post.author.displayName}`}/>{(post.imageUrls?.length ?? 0) > 1 && <span><MaterialIcon name="filter_none"/></span>}<i><MaterialIcon name="favorite" filled/>{post.likesCount}<MaterialIcon name="comment"/>{post.commentsCount}</i></button>)}</div>
    {loading && <p className="muted-copy">Carregando…</p>}{!loading && posts.length === 0 && people.length === 0 && <div className="blank-state">Não encontramos publicações ou pessoas nesta comunidade.</div>}
    {selectedPost && <div className="profile-post-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPost(null); }}><section className="profile-post-modal" role="dialog" aria-modal="true" aria-label={`Publicação de ${selectedPost.author.displayName}`}><button className="modal-x" type="button" aria-label="Fechar publicação" onClick={() => setSelectedPost(null)}><MaterialIcon name="close"/></button><PostCard post={selectedPost} currentCharacter={current} onRefresh={() => void load()} onComments={(post) => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: post }))}/></section></div>}
  </section>;
}

function EchoCopy({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]{2,40}|@[a-zA-Z0-9._]{3,24})/gu);
  return <p className="echo-copy">{parts.map((part, index) => part.startsWith('#') ? <a key={index} href={`/echo/explorar?q=${encodeURIComponent(part)}`}>{part}</a> : part.startsWith('@') ? <a key={index} href={`/echo/perfil?u=${encodeURIComponent(part.slice(1))}`}>{part}</a> : part)}</p>;
}

function EchoPost({ post, refresh }: { post: SocialPost; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  async function action(path: string, method: string) { setBusy(true); try { await apiRequest(path, { method }); refresh(); } finally { setBusy(false); } }
  return <article className="echo-post">
    <a className="echo-post-avatar" href={`/echo/perfil?u=${encodeURIComponent(post.author.username)}`}><Avatar character={post.author}/></a>
    <div className="echo-post-main"><header><a href={`/echo/perfil?u=${encodeURIComponent(post.author.username)}`}><strong>{post.author.displayName}</strong> <VerificationBadge verified={post.author.verified}/></a><span>@{post.author.username} · {relativeTime(post.createdAt)}</span>{post.canDelete && <button type="button" aria-label="Mais opções" title="Excluir Echo" onClick={() => void apiRequest(`/api/posts/${post.id}`, { method: 'DELETE' }).then(refresh)}><MaterialIcon name="more_horiz"/></button>}</header>
      <EchoCopy text={post.content}/>{(post.imageUrls?.[0] || post.imageUrl) && <img className="echo-post-image" src={post.imageUrls?.[0] || post.imageUrl} alt="Imagem do Echo"/>}
      <footer><button type="button" disabled={busy} className={post.commentsCount ? 'has-count' : ''} onClick={() => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: post }))} aria-label="Responder"><MaterialIcon name="chat_bubble_outline"/>{post.commentsCount || ''}</button><button type="button" disabled={busy} className={post.reposted ? 'is-active' : ''} onClick={() => void action(`/api/posts/${post.id}/repost`, post.reposted ? 'DELETE' : 'PUT')} aria-label="Repostar"><MaterialIcon name="repeat"/>{post.repostCount || ''}</button><button type="button" disabled={busy} className={post.liked ? 'is-liked' : ''} onClick={() => void action(`/api/posts/${post.id}/like`, post.liked ? 'DELETE' : 'PUT')} aria-label="Curtir"><MaterialIcon name="favorite" filled={post.liked}/>{post.likesCount || ''}</button><button type="button" disabled={busy} className={post.saved ? 'is-active' : ''} onClick={() => void action(`/api/posts/${post.id}/save`, post.saved ? 'DELETE' : 'PUT')} aria-label="Salvar"><MaterialIcon name="bookmark" filled={post.saved}/></button></footer>
    </div>
  </article>;
}

function EchoRightColumn({ community }: { community: string }) {
  const [trends, setTrends] = useState<{ tag: string; count: number }[]>([]);
  const [people, setPeople] = useState<SocialCharacter[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => { void apiRequest<typeof trends>('/api/echo/trends').then(setTrends).catch(() => setTrends([])); void apiRequest<{ people: SocialCharacter[]; posts: SocialPost[] }>('/api/echo/explore').then((data) => setPeople(data.people)).catch(() => setPeople([])); }, []);
  return <aside className="echo-right-column"><form className="echo-search" onSubmit={(e) => { e.preventDefault(); window.location.href = `/echo/explorar?q=${encodeURIComponent(search)}`; }}><MaterialIcon name="search"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no Echo..." aria-label="Buscar no Echo"/></form>
    <section className="echo-side-panel"><h2>O que está acontecendo</h2>{trends.map((item) => <a href={`/echo/explorar?q=${encodeURIComponent(`#${item.tag}`)}`} key={item.tag}><strong>#{item.tag}</strong><small>{item.count.toLocaleString('pt-BR')} {item.count === 1 ? 'Echo' : 'Echos'}</small><MaterialIcon name="more_horiz"/></a>)}{!trends.length && <p>Os assuntos começam a aparecer conforme a comunidade conversa.</p>}</section>
    <section className="echo-side-panel"><h2>Quem seguir</h2>{people.slice(0, 4).map((person) => <article className="echo-suggestion" key={person.id}><a href={`/echo/perfil?u=${encodeURIComponent(person.username)}`}><Avatar character={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></a><button type="button" onClick={() => void apiRequest(`/api/characters/${person.username}/follow`, { method: person.following ? 'DELETE' : 'POST' }).then(() => setPeople((items) => items.map((item) => item.id === person.id ? { ...item, following: !person.following } : item)))}>{person.following ? 'Seguindo' : 'Seguir'}</button></article>)}{!people.length && <p>Novas pessoas aparecerão aqui.</p>}</section>
    <section className="echo-community-card"><strong>Universo {community}</strong><p>Ideias e conversas da sua comunidade.</p></section>
  </aside>;
}

function EchoPage({ identity, tenant, initialTab = 'for-you' }: { identity: SocialCharacter; tenant: TenantInfo | null; initialTab?: 'for-you' | 'following' }) {
  const [tab, setTab] = useState<'for-you' | 'following'>(initialTab);
  const [posts, setPosts] = useState<SocialPost[]>([]); const [explorePeople, setExplorePeople] = useState<SocialCharacter[]>([]); const [content, setContent] = useState(''); const [image, setImage] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [query, setQuery] = useState(new URLSearchParams(window.location.search).get('q') ?? '');
  const exploring = window.location.pathname === '/echo/explorar';
  async function load() { try { const endpoint = exploring ? `/api/echo/explore${query ? `?q=${encodeURIComponent(query)}` : ''}` : `/api/pulso?tab=${tab}`; const data = await apiRequest<SocialPost[] | { posts: SocialPost[]; people?: SocialCharacter[] }>(endpoint); setPosts(Array.isArray(data) ? data : data.posts); setExplorePeople(!Array.isArray(data) ? data.people ?? [] : []); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar o Echo.'); } }
  useEffect(() => { void load(); }, [tab, query, exploring]);
  async function publish(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!content.trim() && !image) return; setBusy(true); setError(''); try { await apiRequest('/api/pulso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, images: image ? [image] : [] }) }); setContent(''); setImage(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível publicar.'); } finally { setBusy(false); } }
  async function chooseImage(file?: File) { if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { setError('Escolha uma imagem PNG, JPEG ou WebP de até 3 MB.'); return; } try { setImage(await fileAsDataUrl(file)); setError(''); } catch { setError('Não foi possível abrir a imagem.'); } }
  return <div className="echo-layout"><main className="echo-main"><header className="echo-page-heading"><div><h1>VYBE Echo</h1><p>{tenant?.name ?? 'Sua comunidade'}</p></div></header>
    {!exploring && <form className="echo-composer" onSubmit={(event) => void publish(event)}><Avatar character={identity}/><div className="echo-compose-content"><textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} placeholder={`O que está acontecendo, ${identity.displayName.split(/\s+/)[0]}?`}/>{image && <div className="echo-image-preview"><img src={image} alt="Prévia"/><button type="button" aria-label="Remover imagem" onClick={() => setImage('')}><MaterialIcon name="close"/></button></div>}<div className="echo-compose-actions"><label title="Adicionar imagem"><MaterialIcon name="image"/><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void chooseImage(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}/></label><span>{content.length > 450 ? `${content.length}/500` : ''}</span><button type="submit" disabled={busy || (!content.trim() && !image)}>{busy ? 'Publicando…' : 'Publicar'}</button></div></div></form>}
    {exploring && <header className="echo-explore-heading"><span>EXPLORAR</span><h2>Encontre conversas e pessoas</h2><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar no Echo..." aria-label="Buscar no Echo"/></header>}
    {exploring && explorePeople.length > 0 && <section className="echo-explore-people"><h2>Pessoas</h2>{explorePeople.map((person) => <article key={person.id}><a href={`/echo/perfil?u=${encodeURIComponent(person.username)}`}><Avatar character={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></a><button type="button" onClick={() => void apiRequest(`/api/characters/${person.username}/follow`, { method: person.following ? 'DELETE' : 'POST' }).then(() => setExplorePeople((items) => items.map((item) => item.id === person.id ? { ...item, following: !person.following } : item)))}>{person.following ? 'Seguindo' : 'Seguir'}</button></article>)}</section>}
    {!exploring && <nav className="echo-tabs"><button className={tab === 'for-you' ? 'is-active' : ''} type="button" onClick={() => setTab('for-you')}>Para você</button><button className={tab === 'following' ? 'is-active' : ''} type="button" onClick={() => setTab('following')}>Seguindo</button></nav>}
    {image && !busy && error && <p className="echo-inline-error" role="alert">{error}</p>}{error && !image && <p className="echo-inline-error" role="alert">{error}</p>}
      {posts.map((post) => <EchoPost key={post.id} post={post} refresh={() => void load()}/>)}
    {!posts.length && !error && <div className="echo-empty"><MaterialIcon name="graphic_eq"/><strong>{exploring ? 'Nenhuma conversa encontrada.' : 'Ainda está tudo quieto por aqui.'}</strong><span>{exploring ? 'Tente buscar outro assunto.' : 'Compartilhe o primeiro pensamento.'}</span></div>}
  </main><EchoRightColumn community={tenant?.name ?? 'VYBE'}/></div>;
}

function EchoProfilePage({ current, tenant }: { current: SocialCharacter; tenant: TenantInfo | null }) {
  const username = new URLSearchParams(window.location.search).get('u') ?? current.username;
  const [data, setData] = useState<{ profile: SocialCharacter; posts: SocialPost[] } | null>(null);
  const [editing,setEditing]=useState(false);const [displayName,setDisplayName]=useState('');const [bio,setBio]=useState('');const [photo,setPhoto]=useState('');const [removePhoto,setRemovePhoto]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  async function load(){try{setData(await apiRequest<{profile:SocialCharacter;posts:SocialPost[]}>(`/api/echo/profile/${encodeURIComponent(username)}`));}catch{setData(null);}}
  useEffect(() => { void load(); }, [username]);
  function edit(){if(!data)return;setDisplayName(data.profile.displayName);setBio(data.profile.bio);setPhoto('');setRemovePhoto(false);setError('');setEditing(true);}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);setError('');try{const result=await apiRequest<{profile:SocialCharacter}>('/api/echo/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,bio,...(photo?{photo}:removePhoto?{photo:null}:{})})});window.dispatchEvent(new CustomEvent('vybe:echo-profile-updated',{detail:result.profile}));await load();setEditing(false);}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível salvar o perfil.');}finally{setSaving(false);}}
  if (!data) return <div className="echo-empty">Carregando perfil…</div>;
  return <><div className="echo-layout"><main className="echo-main"><header className="echo-page-heading"><div><h1>VYBE Echo</h1><p>{tenant?.name ?? 'Sua comunidade'}</p></div></header><section className="echo-profile"><Avatar character={data.profile}/><h2>{data.profile.displayName}</h2><p>@{data.profile.username}</p><p>{data.profile.bio}</p><span>{data.profile.followerCount} seguidores · {data.profile.followingCount} seguindo</span>{data.profile.own&&<button className="echo-edit-profile" type="button" onClick={edit}><MaterialIcon name="edit"/>Editar perfil</button>}</section>{data.posts.map((post) => <EchoPost key={post.id} post={post} refresh={() => void load()}/>)}</main><EchoRightColumn community={tenant?.name ?? 'VYBE'}/></div>{editing&&<div className="story-overlay" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!saving)setEditing(false);}}><form className="edit-profile-modal echo-profile-edit-modal" role="dialog" aria-modal="true" aria-labelledby="echo-profile-edit-title" onSubmit={(event)=>void save(event)}><button className="modal-x" type="button" aria-label="Fechar" onClick={()=>setEditing(false)}><MaterialIcon name="close"/></button><span>VYBE ECHO</span><h2 id="echo-profile-edit-title">Editar perfil</h2><ProfilePhotoEditor value={photo||(removePhoto?'':data.profile.avatarUrl)} onChange={(value)=>{setPhoto(value);setRemovePhoto(false);setError('');}} onError={setError} maxBytes={3*1024*1024}/>{data.profile.avatarUrl&&<button type="button" className="echo-profile-photo-reset" onClick={()=>{setPhoto('');setRemovePhoto(true);}}>Usar foto do Social</button>}<label>Nome<input value={displayName} onChange={(event)=>setDisplayName(event.currentTarget.value)} maxLength={60} required/></label><label>Bio<textarea value={bio} onChange={(event)=>setBio(event.currentTarget.value)} maxLength={300} placeholder="Conte um pouco sobre você no Echo."/></label>{error&&<p className="inline-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={saving}>{saving?'Salvando…':'Salvar alterações'}</button></form></div>}</>;
}

function ConnectionsPage({ username, list }: { username: string; list: 'followers' | 'following' }) {
  const [people, setPeople] = useState<SocialCharacter[]>([]);
  useEffect(() => { void apiRequest<SocialCharacter[]>(`/api/characters/${encodeURIComponent(username)}/${list}`).then(setPeople).catch(() => setPeople([])); }, [username, list]);
  return <section className="social-page-card"><div className="social-page-title"><span>CONEXÕES</span><h1>{list === 'followers' ? 'Seguidores' : 'Seguindo'}</h1><p>Conexões dentro da comunidade.</p></div><div className="connections-list">{people.map((person) => <a key={person.id} href={`/@${person.username}`}><Avatar character={person}/><span><strong>{person.displayName} <VerificationBadge verified={person.verified}/></strong><small>@{person.username}</small></span><b>›</b></a>)}</div>{!people.length && <p className="muted-copy">Nenhuma conexão para mostrar.</p>}</section>;
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
  return <div className="story-overlay"><form className="edit-profile-modal" onSubmit={(event) => void submit(event)}><button type="button" className="modal-x" aria-label="Fechar" onClick={onClose}><MaterialIcon name="close"/></button><h2>Editar perfil</h2><div className="profile-image-edit-grid"><div className="profile-image-picker"><span>Foto de perfil</span><input ref={avatarInput} className="profile-file-input-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher foto de perfil" onChange={(event) => { void readImage(event, 'avatar'); event.currentTarget.value = ''; }}/><div className="profile-avatar-cropper" ref={cropViewport} onPointerDown={(event) => { dragPoint.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragPoint.current || !cropImage.current || !cropViewport.current) return; const rect = cropViewport.current.getBoundingClientRect(); const overflowX = Math.max(1, cropImage.current.naturalWidth * Math.max(rect.width / cropImage.current.naturalWidth, rect.height / cropImage.current.naturalHeight) * avatarCrop.zoom - rect.width); const overflowY = Math.max(1, cropImage.current.naturalHeight * Math.max(rect.width / cropImage.current.naturalWidth, rect.height / cropImage.current.naturalHeight) * avatarCrop.zoom - rect.height); const dx = event.clientX - dragPoint.current.x; const dy = event.clientY - dragPoint.current.y; dragPoint.current = { x: event.clientX, y: event.clientY }; setAvatarCrop((crop) => ({ ...crop, x: Math.max(0, Math.min(1, crop.x - dx / overflowX)), y: Math.max(0, Math.min(1, crop.y - dy / overflowY)) })); }} onPointerUp={() => { dragPoint.current = null; }} onPointerCancel={() => { dragPoint.current = null; }} aria-label="Arraste a foto para ajustar o recorte">{avatarSource ? <img ref={cropImage} src={avatarSource} alt="Prévia do recorte da foto" draggable={false} onLoad={(event) => setAvatarRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} style={{ position: 'absolute', width: `${Math.max(100, avatarRatio * 100) * avatarCrop.zoom}%`, height: `${Math.max(100, 100 / avatarRatio) * avatarCrop.zoom}%`, left: `${(100 - Math.max(100, avatarRatio * 100) * avatarCrop.zoom) * avatarCrop.x}%`, top: `${(100 - Math.max(100, 100 / avatarRatio) * avatarCrop.zoom) * avatarCrop.y}%` }}/> : <Avatar character={profile} className="profile-avatar-upload-preview"/>}<span className="profile-avatar-crop-hint">Arraste para ajustar</span></div><label className="profile-avatar-zoom">Zoom<input type="range" min="1" max="3" step="0.01" value={avatarCrop.zoom} onChange={(event) => setAvatarCrop((crop) => ({ ...crop, zoom: Number(event.currentTarget.value) }))}/></label><button className="profile-image-change" type="button" onClick={() => avatarInput.current?.click()}>Trocar foto</button>{avatarFileName && <small className="profile-selected-file">{avatarFileName}</small>}<small>Arraste a foto e ajuste o zoom antes de salvar.</small></div><div className="profile-image-picker"><span>Imagem de capa</span><label className="profile-cover-upload" title="Trocar imagem de capa">{(coverUrl || profile.coverUrl) ? <img src={coverUrl || profile.coverUrl} alt="Prévia da capa"/> : <span className="profile-cover-empty">Selecionar capa</span>}<span className="profile-cover-upload-action">Trocar capa</span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher imagem de capa" onChange={(event) => void readImage(event, 'cover')}/></label>{coverFileName && <small className="profile-selected-file">{coverFileName}</small>}<small>PNG, JPG ou WebP · até 2 MB</small></div></div><label>Nome de exibição<input name="displayName" defaultValue={profile.displayName} required minLength={2} maxLength={60}/></label><label>Nome de usuário<input name="username" defaultValue={profile.username} required minLength={3} maxLength={24} pattern="[A-Za-z0-9._]+"/><small>Seu endereço ficará /@seu-username. Use letras, números, ponto ou sublinhado.</small></label><label>Função na comunidade<input name="communityFunction" defaultValue={profile.communityFunction ?? ''} maxLength={80} placeholder="Ex.: Professor, mascote, diretor"/><small>Essa função pode aparecer nos detalhes de eventos.</small></label><label>Bio<textarea name="bio" defaultValue={profile.bio} maxLength={280}/><small>Até 280 caracteres.</small></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></form></div>;
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
  return <div className="profile-page"><section className="profile-header"><div className="profile-cover-art" style={profile.coverUrl ? { backgroundImage: `url("${profile.coverUrl}")` } : undefined}/><div className="profile-info"><Avatar character={profile} className="large-avatar"/><div className="profile-actions">{profile.own ? <button className="soft-button" type="button" onClick={() => setShowEdit(true)}>Editar perfil</button> : <button className="primary-button" type="button" onClick={() => void toggleFollow()}>{profile.following ? 'Seguindo' : 'Seguir'}</button>}</div><h1>{profile.displayName} <VerificationBadge verified={profile.verified}/></h1><span>@{profile.username}</span><p>{profile.bio}</p><div className="profile-stats"><strong>{profile.postCount.toLocaleString('pt-BR')}<small>publicações</small></strong><a href={`/@${profile.username}/followers`}><strong>{profile.followerCount.toLocaleString('pt-BR')}<small>seguidores</small></strong></a><a href={`/@${profile.username}/following`}><strong>{profile.followingCount.toLocaleString('pt-BR')}<small>seguindo</small></strong></a></div></div></section><h2 className="profile-grid-heading">Publicações</h2><div className="profile-post-grid">{visiblePosts.map((post) => <button className="profile-post-tile" type="button" key={post.id} title="Abrir publicação" aria-label={`Abrir publicação de ${post.author.displayName}`} onClick={() => setSelectedPost(post)}><img src={post.imageUrls?.[0] || post.imageUrl} alt={post.content || `Publicação de ${post.author.displayName}`}/><small><MaterialIcon name="favorite" filled/>{post.likesCount} <MaterialIcon name="comment"/>{post.commentsCount}</small></button>)}</div>{visiblePosts.length === 0 && <div className="blank-state">Ainda não há publicações por aqui.</div>}{selectedPost && <div className="profile-post-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPost(null); }}><section className="profile-post-modal" role="dialog" aria-modal="true" aria-label={`Publicação de ${selectedPost.author.displayName}`}><button className="modal-x" type="button" aria-label="Fechar publicação" onClick={() => setSelectedPost(null)}><MaterialIcon name="close"/></button><PostCard post={selectedPost} currentCharacter={currentCharacter} onRefresh={() => void load()} onComments={(post) => window.dispatchEvent(new CustomEvent('vybe:comments', { detail: post }))}/></section></div>}{showEdit && <ProfileEditModal profile={profile} onClose={() => setShowEdit(false)} onSave={saveProfile}/>}</div>;
}

type ChatChannel = { id: string; name: string; category: string; description: string; kind: 'text' | 'announcement' | 'roleplay' | 'restricted'; posting: 'members' | 'staff' | 'restricted'; private: boolean };
type ChatMember = Pick<SocialCharacter, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'verified'> & { online?: boolean };
type ChatMessage = { id: string; content: string; createdAt: string; deleted: boolean; own: boolean; author: ChatMember | null };

function CommunityChatPage() {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [selected, setSelected] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { captureSelection, insertEmoji } = useEmojiInsertion(contentRef, content, setContent);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  async function loadChannels() {
    try {
      const [channelList, memberList] = await Promise.all([
        apiRequest<ChatChannel[]>('/api/conversations/channels'),
        apiRequest<ChatMember[]>('/api/conversations/members'),
      ]);
      setChannels(channelList);
      setMembers(memberList);
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
  useEffect(() => {
    if (!selected) return;
    void loadMessages(selected.id);
    const timer = window.setInterval(() => { void loadMessages(selected.id); }, 8000);
    return () => window.clearInterval(timer);
  }, [selected?.id]);
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !content.trim()) return;
    const sent = await apiRequest<ChatMessage>(`/api/conversations/channels/${selected.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    setMessages((current) => [...current, sent]);
    setContent('');
  }
  const categories = [...new Set(channels.map((channel) => channel.category))];
  return <div className={`community-chat ${selected ? 'has-channel' : ''} ${membersOpen ? 'members-open' : ''}`}>
    <aside className="channel-sidebar"><header><span>COMUNIDADE</span><h1>Conversas</h1><p>Espaços para criar histórias juntos.</p></header>{loading ? <p className="muted-copy">Carregando canais…</p> : categories.map((category) => <section className="channel-category" key={category}><h2>{category}</h2>{channels.filter((channel) => channel.category === category).map((channel) => <button key={channel.id} className={selected?.id === channel.id ? 'active' : ''} type="button" onClick={() => setSelected(channel)}><MaterialIcon name={channel.kind === 'announcement' ? 'campaign' : channel.kind === 'roleplay' ? 'auto_awesome' : 'tag'}/><span>{channel.name.replaceAll('-', ' ')}</span></button>)}</section>)}</aside>
    <section className="community-chat-main"><header className="chat-channel-header"><button className="chat-back" type="button" onClick={() => setSelected(null)} aria-label="Voltar aos canais"><MaterialIcon name="arrow_back"/></button><div><h2>{selected ? `# ${selected.name.replaceAll('-', ' ')}` : 'Escolha um canal'}</h2><p>{selected?.description ?? 'Selecione um espaço para conversar.'}</p></div><span className="channel-kind">{selected?.kind === 'roleplay' ? 'Canal temático' : selected?.kind === 'announcement' ? 'Avisos' : 'Comunidade'}</span><button className="members-toggle" type="button" onClick={() => setMembersOpen(true)}><MaterialIcon name="groups"/>{members.length}</button></header>
      <div className="chat-message-list">{error && <p className="inline-error" role="alert">{error}</p>}{messages.map((message, index) => { const previous = messages[index - 1]; const grouped = previous?.author?.id === message.author?.id && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000; return <article className={`chat-message ${grouped ? 'is-grouped' : ''}`} key={message.id}>{grouped ? <span className="chat-message-time">{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> : <Avatar character={message.author}/>}<div className="chat-message-body">{!grouped && <header><strong>{message.author?.displayName ?? 'Novo membro'}</strong><span>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></header>}<p>{message.content}</p><div className="chat-message-actions">{message.own && !message.deleted && <button type="button" aria-label="Excluir mensagem" onClick={async () => { await apiRequest(`/api/conversations/messages/${message.id}`, { method: 'DELETE' }); setMessages((items) => items.map((item) => item.id === message.id ? { ...item, deleted: true, content: 'Esta mensagem foi removida.' } : item)); }}><MaterialIcon name="delete"/></button>}{!message.own && !message.deleted && <button type="button" aria-label="Denunciar mensagem" onClick={() => void apiRequest(`/api/conversations/messages/${message.id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Conteúdo inadequado ou contrário às regras.' }) })}><MaterialIcon name="flag"/></button>}</div></div></article>; })}{!loading && messages.length === 0 && selected && <div className="chat-empty"><MaterialIcon name="forum"/><p>Esta conversa começa com você.</p></div>}</div>
      <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}><textarea ref={contentRef} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={selected ? `Mensagem em #${selected.name}...` : 'Escolha um canal para começar'} maxLength={2000} disabled={!selected}/><div><EmojiButton onBeforeOpen={captureSelection} onSelect={insertEmoji}/><small>Enter envia · Shift + Enter quebra linha</small><button className="primary-button" type="submit" disabled={!selected || !content.trim()} aria-label="Enviar mensagem"><MaterialIcon name="send"/></button></div></form>
    </section>
    {membersOpen && <button className="members-scrim" type="button" onClick={() => setMembersOpen(false)} aria-label="Fechar lista de membros"/>}<aside className={`chat-members ${membersOpen ? 'is-open' : ''}`}><header><h2>Membros <small>{members.length}</small></h2><button type="button" onClick={() => setMembersOpen(false)} aria-label="Fechar"><MaterialIcon name="close"/></button></header><h3>Online</h3>{members.filter((member) => member.online).map((member) => <div key={member.id}><Avatar character={member}/><span>{member.displayName} <VerificationBadge verified={member.verified}/><small>online nesta sessão</small></span><i className="online-dot"/></div>)}<h3>Offline</h3>{members.filter((member) => !member.online).map((member) => <div key={member.id}><Avatar character={member}/><span>{member.displayName} <VerificationBadge verified={member.verified}/><small>@{member.username}</small></span></div>)}</aside>
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
  useEffect(() => {
    if (!selected) return;
    const interval = window.setInterval(() => { void openThread(selected).then(loadThreads).catch(() => undefined); }, 3500);
    return () => window.clearInterval(interval);
  }, [selected]);
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
  return <div className={`direct-messages ${selected ? 'has-thread' : ''}`}><aside className="direct-sidebar"><header><span>PRIVADO</span><h1>Mensagens</h1><form onSubmit={(event) => { event.preventDefault(); void openThread(recipient); }}><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Iniciar com @usuário"/><button type="submit" aria-label="Abrir conversa"><MaterialIcon name="arrow_forward"/></button></form></header><div className="direct-thread-list">{threads.map((thread) => <button type="button" className={selected === thread.character.username ? 'active' : ''} key={thread.character.id} onClick={() => void openThread(thread.character.username)}><Avatar character={thread.character}/><span><strong>{thread.character.displayName} <VerificationBadge verified={thread.character.verified}/></strong><small>{thread.lastMessage}</small></span>{Boolean(thread.unreadCount) && <i className="direct-unread-dot" aria-label={`${thread.unreadCount} mensagens não lidas`}/>}</button>)}</div></aside><section className="direct-main"><header className="chat-channel-header"><button className="chat-back" type="button" onClick={() => { setSelected(''); setActiveCharacter(null); window.history.replaceState({}, '', '/mensagens'); }} aria-label="Voltar às mensagens"><MaterialIcon name="arrow_back"/></button>{activeCharacter ? <><Avatar character={activeCharacter}/><div><h2>{activeCharacter.displayName} <VerificationBadge verified={activeCharacter.verified}/></h2><p>@{activeCharacter.username}</p>{partnerTyping && <small className="direct-typing-indicator">Digitando…</small>}</div></> : <div><h2>Suas mensagens</h2><p>Converse em particular com personagens da comunidade.</p></div>}</header>{activeCharacter ? <><div className="chat-message-list direct-chat-message-list" ref={messagesListRef}>{error && <p className="inline-error" role="alert">{error}</p>}{messages.map((message) => <article className={`direct-message ${message.own ? 'own' : ''}`} key={message.id}><p>{message.content}</p><small>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{message.own && <span className="direct-read-status">{message.readAt ? ' · Visualizado' : ' · Enviado'}</span>}</small></article>)}{messages.length === 0 && <div className="chat-empty"><MaterialIcon name="mail"/><p>Envie a primeira mensagem para {activeCharacter.displayName}.</p></div>}</div><form className="chat-composer" onSubmit={(event) => void send(event)}><textarea ref={contentRef} value={content} onChange={(event) => updateDraft(event.target.value)} onBlur={() => { window.clearTimeout(typingTimeout.current); if (typingActive.current) { typingActive.current = false; sendTypingState(false); } }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={2000} placeholder={`Mensagem para ${activeCharacter.displayName}...`}/><div><EmojiButton onBeforeOpen={captureSelection} onSelect={insertEmoji}/><small>Enter envia · Shift + Enter quebra linha</small><button className="primary-button" type="submit" disabled={!content.trim()} aria-label="Enviar mensagem"><MaterialIcon name="send"/></button></div></form></> : <div className="chat-empty direct-empty"><MaterialIcon name="mail"/><p>Escolha uma conversa ou inicie uma nova pelo nome de usuário.</p></div>}</section></div>;
}

function CommunityPage({ tenant }: { tenant: TenantInfo | null }) { return <section className="social-page-card tenant-about"><div className="about-cover"/><span className="about-crest"><MaterialIcon name="auto_awesome"/></span><h1>{tenant?.name ?? 'VYBE Community'}</h1><p>{tenant?.description}</p><div className="about-stats"><strong>{tenant?.memberCount ?? 0}<small>membros</small></strong><strong>Pública<small>comunidade</small></strong><strong>Aberta<small>entrada</small></strong></div><h2>Regras da comunidade</h2><ol>{(tenant?.rules ?? ['Respeite os outros personagens e suas histórias.', 'Mantenha as interações dentro das regras da comunidade.', 'Use os canais adequados para dúvidas e sugestões.']).map((rule) => <li key={rule}>{rule}</li>)}</ol><h2>Administradores</h2>{tenant?.administrators?.length ? tenant.administrators.map((admin) => <a className="community-admin" href={`/@${admin.username}`} key={admin.id}><Avatar character={admin}/><span><strong>{admin.displayName}</strong><small>@{admin.username} · Administração</small></span></a>) : <p>A equipe da comunidade será exibida aqui quando configurada.</p>}</section>; }
function CompaniesPage({ community }: { community: string }) { return <section className="social-page-card tenant-about"><span className="about-crest"><MaterialIcon name="apartment"/></span><h1>Empresas</h1><p>Organizações e instituições de {community} aparecerão aqui quando forem cadastradas.</p><p className="settings-empty-state">Nenhuma empresa disponível no momento.</p></section>; }

function NotificationsPage({ echo = false }: { echo?: boolean }) { const [items, setItems] = useState<{ id: string; type: string; targetId: string; amountCents?: number | null; actor: SocialCharacter | null; createdAt: string; readAt?: string }[]>([]); useEffect(() => { void apiRequest<typeof items>('/api/notifications').then((all) => all.filter((item) => echo ? ['echo_like', 'echo_mention', 'repost', 'echo_reply', 'follow'].includes(item.type) : ['like', 'comment', 'follow', 'mention', 'message', 'bank_transfer_received', 'bank_admin_credit_received'].includes(item.type))).then(setItems).then(() => apiRequest(`/api/notifications/read${echo ? '?scope=echo' : ''}`, { method: 'PATCH' })).catch(() => undefined); }, [echo]); const descriptions: Record<string, string> = { follow: 'começou a seguir você.', message: 'enviou uma mensagem para você.', like: 'curtiu uma publicação sua.', comment: 'comentou em uma publicação sua.', echo_like: 'curtiu seu Echo.', echo_reply: 'respondeu ao seu Echo.', repost: 'repostou seu Echo.', mention: 'mencionou você em uma publicação.', echo_mention: 'mencionou você em um Echo.' }; return <section className="social-page-card"><div className="social-page-title"><span>{echo ? 'VYBE ECHO' : 'ATIVIDADE'}</span><h1>Notificações</h1></div>{items.map((item) => <article className="notification-row" key={item.id}><Avatar character={item.actor}/><p><strong>{item.actor?.displayName ?? 'Alguém'}</strong> {item.type === 'bank_transfer_received' ? `enviou ${moneyForNotification(item.amountCents)} para você.` : item.type === 'bank_admin_credit_received' ? `creditou ${moneyForNotification(item.amountCents)} na sua carteira.` : descriptions[item.type]}<small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small></p></article>)}{!items.length && <div className="blank-state">Nenhuma novidade por enquanto.</div>}</section>; }

function moneyForNotification(cents?: number | null) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents ?? 0) / 100); }

type SettingsData = {
  role: 'owner';
  community: {
    id: string; name: string; slug: string; subdomain: string; description: string; category: string; logoUrl: string; coverUrl: string; wallpaperUrl: string;
    status: string; memberCount: number; entry: string; brand: { primary: string; dark: string; medium: string; soft: string; lilac: string; white: string; graphite: string };
    settings: {
      access: { visibility: 'public' | 'private' | 'controlled'; approvalRequired: boolean; invitesEnabled: boolean; welcomeMessage: string };
      characters: { usernameMinLength: number; usernameMaxLength: number; requireBio: boolean; customFields: Array<{ key: string; label: string; required: boolean }> };
      features: { feed: boolean; pulse: boolean; stories: boolean; conversations: boolean; messages: boolean; events: boolean; match?: boolean; bank?: boolean; academic?: boolean; career?: boolean; news?: boolean; companies?: boolean; eventCreation: 'any_pending' | 'staff' | 'admins' | 'owner' };
      privacy: { showInDirectory: boolean; showMembers: boolean; showAdmins: boolean; publicContent: boolean };
      moderation: { rules: string[]; requireReportReason: boolean; maxPostLength: number };
    };
  };
  team: Array<{ accountId: string; role: 'owner' | 'admin' | 'moderator'; email: string; character: string }>;
  pendingMembers: Array<{ accountId: string; email: string; createdAt: string; character: { displayName: string; username: string; bio: string; avatarUrl: string } | null }>;
  members: Array<{ accountId: string; joinedAt: string; displayName: string; username: string; bio: string; avatarUrl: string }>;
  pendingEvents: Array<{ id: string; title: string; description: string; startsAt: string; location: string; category: string; createdAt: string }>;
  sanctions: Array<{ id: string; accountId: string; action: 'suspend' | 'ban'; reason: string; createdAt: string; endsAt: string | null; displayName: string; username: string; avatarUrl: string }>;
  audit: Array<{ id: string; action: string; details: Record<string, unknown>; createdAt: string; actorEmail: string }>;
  metrics: { pendingMembers: number; teachers: number; newsWriters: number; pendingEvents: number; activeMembers: number; openReports: number | null };
};

const settingsTabs = [
  ['overview', 'Visão geral', 'home'], ['members', 'Solicitações de entrada', 'person_add'], ['directory', 'Membros', 'groups'], ['team', 'Equipe e permissões', 'groups'], ['academic', 'Acadêmico', 'school'], ['news', 'Notícias (Jornal)', 'newspaper'], ['events', 'Eventos e calendário', 'calendar_month'], ['moderation', 'Moderação', 'shield'], ['appearance', 'Personalização', 'palette'], ['general', 'Configurações gerais', 'tune'], ['access', 'Acesso e entrada', 'lock_open'], ['characters', 'Identidade', 'person'],
  ['features', 'Aplicativos', 'apps'], ['privacy', 'Privacidade', 'visibility'], ['advanced', 'Auditoria', 'settings'], ['risk', 'Zona de risco', 'warning'],
] as const;

function SettingsIcon({ name }: { name: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const artwork: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></>,
    person_add: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M19 8v6m-3-3h6"/></>,
    school: <><path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 3 9 3 12 0v-5M22 9v6"/></>,
    newspaper: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h5v5H7zm8 0h3m-3 4h3m-11 1v3h11"/></>,
    calendar_month: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 4h2m4 0h2m-8 3h2"/></>,
    bolt: <><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></>,
    tune: <><path d="M4 7h9M17 7h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
    lock_open: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/><path d="M12 14v3"/></>,
    person: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    apps: <><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>,
    forum: <><path d="M20 11.5a6.5 6.5 0 0 1-6.5 6.5H8l-4 3v-5.5A6.5 6.5 0 0 1 10.5 9H14"/><path d="M13 4h7v7h-7z"/></>,
    groups: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.5"/></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>,
    visibility: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></>,
    palette: <><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.3-3.5 1.7 1.7 0 0 1 1.1-3h1.1A4.3 4.3 0 0 0 21 10.2C20.2 6.1 16.4 3 12 3Z"/><circle cx="7.5" cy="11" r=".8"/><circle cx="10" cy="7.5" r=".8"/><circle cx="14.5" cy="7.5" r=".8"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.7-1.4-2.4 1.4-1.1a8 8 0 0 1 0-1.9l-1.4-1.2 1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.2a8 8 0 0 1 0 1.9Z" transform="translate(-1 -1) scale(1.08)"/></>,
    warning: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/></>,
  };
  return <svg className="settings-tab-icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>{artwork[name] ?? artwork.settings}</svg>;
}

function SettingsOverview({ data, onSelect, onDecide }: { data: SettingsData; onSelect: (tab: (typeof settingsTabs)[number][0]) => void; onDecide: (id: string, decision: 'approve' | 'reject') => void }) {
  const stats = [
    ['Solicitações pendentes', data.metrics.pendingMembers, 'person_add', 'members'],
    ['Professores', data.metrics.teachers, 'school', 'academic'],
    ['Redatores do jornal', data.metrics.newsWriters, 'newspaper', 'news'],
    ['Eventos para aprovação', data.metrics.pendingEvents, 'calendar_month', 'events'],
    ['Membros ativos', data.metrics.activeMembers.toLocaleString('pt-BR'), 'groups', 'directory'],
    ['Ocorrências abertas', data.metrics.openReports === null ? '—' : data.metrics.openReports, 'shield', 'moderation'],
  ] as const;
  const areas = [
    { title: 'Equipe e permissões', text: 'Gerencie responsáveis por cada área da comunidade.', icon: 'groups', links: [['Equipe da comunidade', 'team'], ['Configurar permissões', 'team']] },
    { title: 'Moderação e segurança', text: 'Acompanhe regras e ações de segurança.', icon: 'shield', links: [['Regras da comunidade', 'moderation'], ['Ações recentes', 'advanced']] },
    { key: 'academic', title: 'Gestão do Acadêmico', text: 'Organize a estrutura acadêmica da comunidade.', icon: 'school', links: [['Disciplinas e professores', 'academic']] },
    { key: 'news', title: 'Gestão do Jornal', text: 'Configure a equipe editorial e publicações.', icon: 'newspaper', links: [['Equipe e matérias', 'news']] },
    { key: 'community', title: 'Configurações da comunidade', text: 'Ajuste acesso, identidade e aparência.', icon: 'settings', links: [['Identidade e personalização', 'appearance'], ['Configurações gerais', 'general'], ['Aplicativos', 'features']] },
  ] as const;
  return <div className="settings-dashboard">
    <section className="settings-community-banner" style={data.community.coverUrl ? { backgroundImage: `linear-gradient(90deg,#064c39f2,#064c39ad 56%,#064c3930),url("${data.community.coverUrl}")` } : undefined}>
      <span className="settings-community-emblem">{data.community.logoUrl ? <img src={data.community.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span>
      <div><h2>{data.community.name}</h2><p>{data.community.description}</p></div><span className="settings-community-status">Comunidade {data.community.status === 'active' ? 'ativa' : data.community.status}</span>
    </section>
    <div className="settings-metrics">{stats.map(([label, value, icon, tab]) => <button type="button" key={label} onClick={() => onSelect(tab)}><span><SettingsIcon name={icon}/></span><strong>{value}</strong><small>{label}</small></button>)}</div>
    <div className="settings-dashboard-grid">
      <section className="settings-dashboard-panel settings-dashboard-requests"><header><h2><SettingsIcon name="person_add"/>Solicitações de entrada</h2><button type="button" onClick={() => onSelect('members')}>Ver todas →</button></header>
        {data.pendingMembers.slice(0, 3).map((member) => <article key={member.accountId}><span className="settings-pending-avatar">{member.character?.avatarUrl ? <img src={member.character.avatarUrl} alt=""/> : (member.character?.displayName ?? member.email).slice(0, 1).toUpperCase()}</span><div><strong>{member.character?.displayName ?? 'Novo membro'}</strong><small>{member.character?.username ? `@${member.character.username}` : member.email}</small></div><time>{new Date(member.createdAt).toLocaleDateString('pt-BR')}</time><button type="button" className="settings-approve" onClick={() => onDecide(member.accountId, 'approve')}>✓ Aprovar</button><button type="button" className="settings-reject" onClick={() => onDecide(member.accountId, 'reject')}>× Recusar</button></article>)}
        {!data.pendingMembers.length && <p className="settings-dashboard-empty">Nenhuma solicitação de entrada pendente.</p>}
      </section>
      <div className="settings-dashboard-stack">{areas.slice(0, 2).map((area) => <section className="settings-dashboard-panel settings-dashboard-area" key={area.title}><header><h2><SettingsIcon name={area.icon}/>{area.title}</h2></header><p>{area.text}</p>{area.links.map(([label, tab]) => <button type="button" key={label} onClick={() => onSelect(tab)}><span>{label}</span><b>›</b></button>)}</section>)}</div>
      <section className="settings-dashboard-panel settings-dashboard-quick"><header><h2><SettingsIcon name="bolt"/>Ações rápidas</h2></header><button onClick={() => onSelect('members')}>＋ Convidar ou aprovar membro</button><button onClick={() => { window.location.href = '/academico/admin'; }}>＋ Adicionar professor</button><button onClick={() => { window.location.href = '/noticias/editorial'; }}>＋ Gerenciar equipe do jornal</button><button onClick={() => { window.location.href = '/eventos/admin'; }}>＋ Revisar eventos</button><button onClick={() => onSelect('moderation')}>＋ Aplicar moderação</button></section>
      {areas.slice(2).map((area) => <section className={`settings-dashboard-panel settings-dashboard-area settings-dashboard-area--${"key" in area ? area.key : ""}`} key={area.title}><header><h2><SettingsIcon name={area.icon}/>{area.title}</h2></header><p>{area.text}</p>{area.links.map(([label, tab]) => <button type="button" key={label} onClick={() => onSelect(tab)}><span>{label}</span><b>›</b></button>)}</section>)}
      <section className="settings-dashboard-panel settings-dashboard-events"><header><h2><SettingsIcon name="calendar_month"/>Eventos e calendário</h2><button type="button" onClick={() => { window.location.href = '/eventos/admin'; }}>Ver solicitações →</button></header>{data.pendingEvents.slice(0, 3).map((event) => <article key={event.id}><span className="settings-event-icon"><SettingsIcon name="calendar_month"/></span><div><strong>{event.title}</strong><small>{event.location} · {new Date(event.startsAt).toLocaleString('pt-BR')}</small></div><span className="settings-event-pending">Pendente</span></article>)}{!data.pendingEvents.length && <p className="settings-dashboard-empty">Nenhum evento aguardando aprovação.</p>}</section>
    </div>
  </div>;
}

function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<(typeof settingsTabs)[number][0]>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState('');
  const [cover, setCover] = useState('');
  const [wallpaper, setWallpaper] = useState('');
  const [sanctionMember, setSanctionMember] = useState<SettingsData['members'][number] | null>(null);
  const [sanctionForm, setSanctionForm] = useState({ action: 'ban' as 'ban' | 'suspend', durationDays: '', reason: '' });

  async function load() {
    setLoading(true);
    try { setData(await apiRequest<SettingsData>('/api/settings/community')); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as configurações.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

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
      for (const [key, preview] of [['logo', logo], ['cover', cover], ['wallpaper', wallpaper]] as const) {
        if (preview) images[key] = preview;
        else { const file = fields.get(key); if (file instanceof File && file.size) images[key] = await fileAsDataUrl(file); }
      }
      await save(section, { name: fields.get('name'), description: fields.get('description'), category: fields.get('category'), ...images });
      setLogo(''); setCover(''); setWallpaper(''); return;
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
  async function saveFeatures(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const fields = new FormData(event.currentTarget); await save('features', { ...Object.fromEntries(['feed', 'pulse', 'stories', 'conversations', 'messages', 'events', 'match', 'bank', 'academic', 'career', 'news', 'companies'].map((key) => [key, fields.get(key) === 'on'])), eventCreation: community.settings.features.eventCreation ?? 'any_pending' }); }
  async function teamOperation(operation: 'add' | 'remove', values: Record<string, unknown>) { await apiRequest('/api/settings/community/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, ...values }) }); setNotice('Equipe atualizada.'); await load(); }
  async function createSanction(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!sanctionMember) return; await apiRequest(`/api/settings/community/members/${sanctionMember.accountId}/sanctions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: sanctionForm.action, durationDays: sanctionForm.durationDays ? Number(sanctionForm.durationDays) : null, reason: sanctionForm.reason.trim() }) }); setSanctionMember(null); setSanctionForm({ action: 'ban', durationDays: '', reason: '' }); setNotice(sanctionForm.action === 'ban' ? 'Membro banido; o histórico foi preservado.' : 'Membro suspenso.'); await load(); }
  async function revokeSanction(id: string) { await apiRequest(`/api/settings/community/sanctions/${id}/revoke`, { method: 'POST' }); setNotice('Acesso do membro restaurado.'); await load(); }
  async function decideMember(accountId: string, decision: 'approve' | 'reject') { const rejectedReason = decision === 'reject' ? window.prompt('Informe o motivo da recusa:')?.trim() : undefined; if (decision === 'reject' && (!rejectedReason || rejectedReason.length < 3)) return; await apiRequest(`/api/settings/community/members/${accountId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, ...(rejectedReason ? { rejectedReason } : {}) }) }); setNotice(decision === 'approve' ? 'Novo membro aprovado.' : 'Pedido de entrada recusado.'); await load(); }
  function openSettingsTab(key: (typeof settingsTabs)[number][0]) { if (key === 'academic') window.location.href = '/academico/admin'; else if (key === 'news') window.location.href = '/noticias/editorial'; else if (key === 'events') window.location.href = '/eventos/admin'; else setTab(key); }
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
  return <section className="community-settings-page"><header className="settings-page-heading"><div><span>CONTROLE DO UNIVERSO</span><h1>Configurações da Comunidade</h1><p>Gerencie pessoas, permissões, conteúdo, eventos e todas as áreas da {community.name}.</p></div><a href="/comunidade">Ver comunidade ↗</a></header>{notice && <p className="settings-notice" role="status">{notice}</p>}<div className="settings-layout"><nav className="settings-tabs" aria-label="Seções de configuração">{settingsTabs.map(([key, label, icon]) => <button key={key} type="button" className={tab === key ? 'is-active' : ''} onClick={() => openSettingsTab(key)}><SettingsIcon name={icon}/><span>{label}</span></button>)}<a href="/">Voltar para o universo</a></nav><div className="settings-content">
    {tab === 'overview' && <SettingsOverview data={data} onSelect={openSettingsTab} onDecide={(id, decision) => void decideMember(id, decision)}/>}
    {tab === 'directory' && <section className="settings-directory"><div className="settings-section-heading"><h2>Membros ativos</h2><p>{data.metrics.activeMembers} pessoas fazem parte desta comunidade.</p></div>{data.members.map((member)=><article key={member.accountId}><Avatar character={{displayName:member.displayName,avatarUrl:member.avatarUrl}}/><span><strong>{member.displayName}</strong><small>@{member.username} · desde {new Date(member.joinedAt).toLocaleDateString('pt-BR')}</small></span><a href={`/@${member.username}`}>Ver perfil</a><button type="button" onClick={() => setSanctionMember(member)}>Suspender ou banir</button></article>)}</section>}
    {tab === 'general' && <form onSubmit={(event) => void submitForm('general', event)}><div className="settings-section-heading"><h2>Geral</h2><p>Informações públicas e endereço do universo.</p></div><label>Nome da comunidade<input name="name" defaultValue={community.name} required minLength={2} maxLength={80}/></label><label>Descrição<textarea name="description" defaultValue={community.description} required minLength={10} maxLength={500}/></label><label>Categoria<input name="category" defaultValue={community.category} maxLength={60}/></label><div className="settings-image-fields"><label className="settings-image-upload"><span className="settings-upload-title">Logo</span><input name="logo" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher logo da comunidade" onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { input.value = ''; notifySnack('A logo deve ter no máximo 2 MB.'); return; } void fileAsDataUrl(file).then(setLogo).catch(() => notifySnack('Não foi possível carregar a logo.')); }}/><span className={`settings-image-preview is-logo ${logo || community.logoUrl ? 'has-image' : ''}`} style={logo || community.logoUrl ? { backgroundImage: `url("${logo || community.logoUrl}")` } : undefined}><span>{logo || community.logoUrl ? 'Prévia da logo' : 'Adicione a logo da comunidade'}</span></span><span className="settings-image-help"><strong>{logo ? 'Logo selecionada' : community.logoUrl ? 'Trocar logo' : 'Escolher imagem'}</strong><small>PNG, JPG ou WebP · até 2 MB</small></span></label><label className="settings-image-upload"><span className="settings-upload-title">Capa</span><input name="cover" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Escolher capa da comunidade" onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { input.value = ''; notifySnack('A capa deve ter no máximo 2 MB.'); return; } void fileAsDataUrl(file).then(setCover).catch(() => notifySnack('Não foi possível carregar a capa.')); }}/><span className={`settings-image-preview is-cover ${cover || community.coverUrl ? 'has-image' : ''}`} style={cover || community.coverUrl ? { backgroundImage: `url("${cover || community.coverUrl}")` } : undefined}><span>{cover || community.coverUrl ? 'Prévia da capa' : 'Adicione uma imagem de capa'}</span></span><span className="settings-image-help"><strong>{cover ? 'Capa selecionada' : community.coverUrl ? 'Trocar capa' : 'Escolher imagem'}</strong><small>PNG, JPG ou WebP · até 2 MB</small></span></label></div><label className="settings-wallpaper-upload">Wallpaper da Home<input name="wallpaper" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { input.value = ''; notifySnack('A imagem deve ter no máximo 2 MB.'); return; } void fileAsDataUrl(file).then(setWallpaper).catch(() => notifySnack('Não foi possível carregar o wallpaper.')); }}/><small>{wallpaper ? 'Wallpaper selecionado' : community.wallpaperUrl ? 'Trocar wallpaper' : 'Escolha uma imagem para o fundo da Home'} · PNG, JPG ou WebP · até 2 MB</small>{(wallpaper || community.wallpaperUrl) && <img src={wallpaper || community.wallpaperUrl} alt="Prévia do wallpaper"/></label><div className="settings-readonly-row"><span>Slug e subdomínio</span><strong>{community.slug}.vybe.com.br</strong><small>Protegidos para manter o endereço e os arquivos da comunidade consistentes.</small></div>{submitButton}</form>}
    {tab === 'access' && <form onSubmit={(event) => void submitForm('access', event)}><div className="settings-section-heading"><h2>Acesso e entrada</h2><p>Defina como novos membros encontram e entram neste universo.</p></div><label>Visibilidade<select name="visibility" defaultValue={community.settings.access.visibility}><option value="public">Pública</option><option value="controlled">Entrada controlada</option><option value="private">Privada</option></select></label>{check('approvalRequired', 'Aprovar novos membros manualmente', community.settings.access.approvalRequired)}{check('invitesEnabled', 'Permitir convites', community.settings.access.invitesEnabled)}<label>Mensagem de boas-vindas<textarea name="welcomeMessage" defaultValue={community.settings.access.welcomeMessage} maxLength={500}/></label><p className="settings-help">Quando a aprovação estiver ativa, novos cadastros ficam pendentes e aparecem na aba “Aprovar membros”.</p>{submitButton}</form>}
    {tab === 'characters' && <form onSubmit={(event) => void submitForm('characters', event)}><div className="settings-section-heading"><h2>Personagens</h2><p>Regras de nome e campos exibidos nos perfis.</p></div><div className="settings-field-row"><label>Username mínimo<input type="number" name="usernameMinLength" min={3} max={24} defaultValue={community.settings.characters.usernameMinLength}/></label><label>Username máximo<input type="number" name="usernameMaxLength" min={3} max={24} defaultValue={community.settings.characters.usernameMaxLength}/></label></div>{check('requireBio', 'Exigir uma bio no cadastro e no perfil', community.settings.characters.requireBio)}<label>Campos personalizados<textarea name="customFields" defaultValue={community.settings.characters.customFields.map((item) => `${item.label}${item.required ? '*' : ''} | ${item.required ? 'obrigatorio' : 'opcional'}`).join('\n')} placeholder={'Pronome* | obrigatorio\nClã | opcional'}/><small>Um campo por linha. Use * para marcar como obrigatório.</small></label>{submitButton}</form>}
    {tab === 'features' && <form onSubmit={(event) => void saveFeatures(event)}><div className="settings-section-heading"><h2>Recursos</h2><p>Escolha quais aplicativos aparecem no universo.</p></div><div className="settings-check-grid">{check('feed', 'Social', community.settings.features.feed)}{check('pulse', 'Echo', community.settings.features.pulse)}{check('match', 'Match', community.settings.features.match ?? true)}{check('messages', 'Mensagens', community.settings.features.messages)}{check('bank', 'Banco virtual', community.settings.features.bank ?? true)}{check('events', 'Eventos', community.settings.features.events)}{check('stories', 'Stories', community.settings.features.stories)}{check('conversations', 'Conversas e canais', community.settings.features.conversations)}{check('academic', 'Acadêmico', community.settings.features.academic ?? true)}{check('career', 'Carreira', community.settings.features.career ?? true)}{check('news', 'Notícias', community.settings.features.news ?? true)}{check('companies', 'Empresas', community.settings.features.companies ?? true)}</div><p className="settings-help-text">Todos os membros ativos podem sugerir eventos. A publicação no calendário depende da aprovação do Owner ou Admin.</p>{submitButton}<a className="settings-events-review-link" href="/eventos/admin">Revisar solicitações de eventos →</a></form>}
    {tab === 'members' && <div><div className="settings-section-heading"><h2>Aprovar membros</h2><p>Revise os pedidos de entrada desta comunidade. A aprovação libera o acesso à conta e às áreas protegidas.</p></div><div className="settings-pending-list">{data.pendingMembers.map((member) => <article key={member.accountId}><div className="settings-pending-avatar">{(member.character?.displayName ?? member.email).slice(0, 1).toUpperCase()}</div><div className="settings-pending-info"><strong>{member.character?.displayName ?? 'Novo membro'} {member.character?.username && <small>@{member.character.username}</small>}</strong><span>{member.email}</span>{member.character?.bio && <p>{member.character.bio}</p>}<time>{new Date(member.createdAt).toLocaleString('pt-BR')}</time></div><div className="settings-pending-actions"><button type="button" onClick={() => void decideMember(member.accountId, 'reject')}>Recusar</button><button className="primary-button" type="button" onClick={() => void decideMember(member.accountId, 'approve')}>Aprovar</button></div></article>)}{!data.pendingMembers.length && <p className="settings-empty-state">Nenhum pedido de entrada aguardando aprovação.</p>}</div></div>}
    {tab === 'team' && <div><div className="settings-section-heading"><h2>Equipe e permissões</h2><p>Owner controla a equipe. Admins podem editar as configurações da comunidade.</p></div><div className="settings-team-list">{data.team.map((person) => <article key={person.accountId}><span className="settings-team-avatar">{(person.character || person.email || '?').slice(0, 1).toUpperCase()}</span><div><strong>{person.character || person.email}</strong><small>{person.email}</small></div><b>{person.role === 'owner' ? 'Owner' : person.role === 'admin' ? 'Admin' : 'Moderator'}</b>{data.role === 'owner' && person.role !== 'owner' && <button type="button" onClick={() => { if (window.confirm(`Remover ${person.email} da equipe?`)) void teamOperation('remove', { accountId: person.accountId }); }}>Remover</button>}</article>)}</div>{data.role === 'owner' && <form className="settings-team-add" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void teamOperation('add', { email: values.get('email'), staffRole: values.get('staffRole') }); event.currentTarget.reset(); }}><label>E-mail de uma conta da comunidade<input type="email" name="email" required placeholder="pessoa@email.com"/></label><label>Função<select name="staffRole"><option value="admin">Admin</option><option value="moderator">Moderator</option></select></label><button className="primary-button" type="submit">Adicionar à equipe</button></form>}</div>}
    {tab === 'moderation' && <div className="settings-moderation"><form onSubmit={(event) => void submitForm('moderation', event)}><div className="settings-section-heading"><h2>Moderação e segurança</h2><p>Regras locais, limites e tratamento de denúncias.</p></div><label>Regras da comunidade<textarea name="rules" defaultValue={community.settings.moderation.rules.join('\n')} placeholder="Uma regra por linha"/></label><div className="settings-field-row"><label>Limite de caracteres por post<input type="number" name="maxPostLength" min={100} max={5000} defaultValue={community.settings.moderation.maxPostLength}/></label></div>{check('requireReportReason', 'Exigir justificativa nas denúncias', community.settings.moderation.requireReportReason)}{submitButton}</form><section className="settings-sanctions"><h2>Membros suspensos ou banidos</h2>{data.sanctions.map((sanction)=><article key={sanction.id}><Avatar character={{displayName:sanction.displayName,avatarUrl:sanction.avatarUrl}}/><span><strong>{sanction.displayName} {sanction.username && <small>@{sanction.username}</small>}</strong><small>{sanction.action === 'ban' ? 'Banimento' : 'Suspensão'} · {sanction.endsAt ? `até ${new Date(sanction.endsAt).toLocaleDateString('pt-BR')}` : 'permanente'}</small><small>Motivo: {sanction.reason}</small></span><button type="button" onClick={() => void revokeSanction(sanction.id)}>Revogar</button></article>)}{!data.sanctions.length && <p className="settings-dashboard-empty">Nenhum membro suspenso ou banido.</p>}</section></div>}
    {tab === 'privacy' && <form onSubmit={(event) => void submitForm('privacy', event)}><div className="settings-section-heading"><h2>Privacidade</h2><p>Controle as informações da comunidade exibidas publicamente.</p></div>{check('showInDirectory', 'Mostrar no portal de comunidades', community.settings.privacy.showInDirectory)}{check('showMembers', 'Exibir lista de membros', community.settings.privacy.showMembers)}{check('showAdmins', 'Exibir administradores', community.settings.privacy.showAdmins)}{check('publicContent', 'Permitir conteúdo público', community.settings.privacy.publicContent)}{submitButton}</form>}
    {tab === 'appearance' && <form onSubmit={(event) => void submitForm('appearance', event)}><div className="settings-section-heading"><h2>Aparência</h2><p>Personalize a identidade visual dentro dos limites da marca VYBE.</p></div><div className="settings-color-grid">{[['primary','Verde principal',community.brand.primary],['dark','Verde escuro',community.brand.dark],['medium','Verde médio',community.brand.medium],['soft','Fundo suave',community.brand.soft],['light','Verde claro',community.brand.lilac]].map(([key, label, value]) => <label key={key}>{label}<span><input type="color" name={key} defaultValue={value}/><code>{value}</code></span></label>)}</div>{submitButton}</form>}
    {tab === 'advanced' && <div><div className="settings-section-heading"><h2>Avançado</h2><p>Registro das alterações administrativas recentes.</p></div><div className="settings-audit-list">{data.audit.map((item) => <article key={item.id}><div><strong>{item.action.replaceAll('.', ' · ')}</strong><small>{item.actorEmail} · {new Date(item.createdAt).toLocaleString('pt-BR')}</small></div><details><summary>Detalhes</summary><pre>{JSON.stringify(item.details, null, 2)}</pre></details></article>)}{!data.audit.length && <p>Nenhuma ação registrada ainda.</p>}</div><div className="settings-readonly-row"><span>Exportação de dados</span><small>Exportações estarão disponíveis em uma etapa futura.</small></div></div>}
    {tab === 'risk' && <div className="settings-risk"><div className="settings-section-heading"><h2>Zona de risco</h2><p>Estas ações têm impacto amplo e exigem confirmação adicional.</p></div><form onSubmit={(event) => { event.preventDefault(); void riskAction('transfer', new FormData(event.currentTarget)); }}><h3>Transferir propriedade</h3><p>Transfere o papel de Owner para outra conta ativa desta comunidade.</p><label>E-mail do novo Owner<input type="email" name="email" required/></label><label>Digite “{community.name}” para confirmar<input name="confirmation" required/></label><button type="submit">Transferir propriedade</button></form><form onSubmit={(event) => { event.preventDefault(); void riskAction('suspend', new FormData(event.currentTarget)); }}><h3>Suspender comunidade</h3><p>Bloqueia imediatamente o acesso pelo subdomínio. A comunidade principal VYBE é protegida.</p><label>Digite “{community.name}” para confirmar<input name="confirmation" required/></label><button type="submit">Suspender comunidade</button></form><form onSubmit={(event) => { event.preventDefault(); void riskAction('request-deletion', new FormData(event.currentTarget)); }}><h3>Solicitar exclusão</h3><p>Registra uma solicitação para revisão da administração da plataforma; não apaga dados automaticamente.</p><label>Motivo<textarea name="reason" required minLength={10} maxLength={500}/></label><label>Digite “{community.name}” para confirmar<input name="confirmation" required/></label><button type="submit">Solicitar exclusão</button></form></div>}
  </div></div>{sanctionMember && <div className="settings-sanction-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSanctionMember(null); }}><form className="settings-sanction-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-sanction-title" onSubmit={(event) => void createSanction(event)}><button type="button" className="settings-sanction-close" onClick={() => setSanctionMember(null)} aria-label="Fechar">×</button><span>MODERAÇÃO</span><h2 id="settings-sanction-title">Suspender ou banir {sanctionMember.displayName}</h2><label>Ação<select value={sanctionForm.action} onChange={(event) => setSanctionForm({ ...sanctionForm, action: event.target.value as 'ban' | 'suspend' })}><option value="suspend">Suspender temporariamente</option><option value="ban">Banir</option></select></label><label>Duração<select value={sanctionForm.durationDays} onChange={(event) => setSanctionForm({ ...sanctionForm, durationDays: event.target.value })}><option value="">Permanente</option><option value="1">1 dia</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select></label><label>Motivo obrigatório<textarea value={sanctionForm.reason} onChange={(event) => setSanctionForm({ ...sanctionForm, reason: event.target.value })} minLength={3} maxLength={500} required/></label><button className="primary-button" type="submit">Confirmar {sanctionForm.action === 'ban' ? 'banimento' : 'suspensão'}</button></form></div>}</section>;
}
function HelpPage() { return <section className="social-page-card placeholder-page"><MaterialIcon name="help"/><h1>Ajuda</h1><p>Central de ajuda da comunidade em preparação.</p></section>; }
function CommunitySwitchPage() {
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  function changeCommunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(normalized)) { setError('Use o subdomínio da comunidade, sem espaços ou pontuação.'); return; }
    window.location.assign(`https://${normalized}.vybe.com.br`);
  }
  return <section className="community-switch-page"><span>SEUS UNIVERSOS</span><h1>Trocar comunidade</h1><p>Cada comunidade VYBE tem seu próprio endereço e espaço isolado.</p><form onSubmit={changeCommunity}><label htmlFor="community-slug">Subdomínio da comunidade</label><div><input id="community-slug" value={slug} onChange={(event) => { setSlug(event.target.value); setError(''); }} placeholder="ex.: community" maxLength={40} required/><b>.vybe.com.br</b><button className="primary-button" type="submit">Acessar</button></div>{error && <small role="alert">{error}</small>}</form><a href="/">Voltar para esta comunidade</a></section>;
}

type HomeNotification = { id: string; type: string; targetId: string; eventTitle?: string; amountCents?: number | null; actor: SocialCharacter | null; createdAt: string; readAt?: string };

function CommunityAppIcon({ app }: { app: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const drawings: Record<string, ReactNode> = {
    feed: <><rect x="3" y="6" width="18" height="14" rx="3"/><path d="m7 6 1-3h8l1 3"/><circle cx="12" cy="13" r="4"/></>,
    pulse: <><circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2m14.2-14.2a10 10 0 0 1 0 14.2"/></>,
    match: <path d="M20.8 8.7c0 5-8.8 11-8.8 11s-8.8-6-8.8-11a4.8 4.8 0 0 1 8.8-2.5 4.8 4.8 0 0 1 8.8 2.5Z"/>,
    messages: <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.7-.8L3 20l1.6-4.2A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z"/>,
    bank: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/></>,
    events: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m3 0h2m-7 3h2"/></>,
    academic: <><path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11v5c3.5 3 8.5 3 12 0v-5m4-2v7"/></>,
    career: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3m-13 5h18m-11 0v2h4v-2"/></>,
    news: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8m-8 4h8m-8 4h4m4 0h1"/></>,
    companies: <><path d="M4 21V5l8-3v19m0-12h8v12M2 21h20M7 8h1m-1 4h1m-1 4h1m8-2h1m-1 3h1"/></>,
    apps: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  };
  return <svg className="community-app-svg" viewBox="0 0 24 24" aria-hidden="true" {...common}>{drawings[app] ?? drawings.feed}</svg>;
}

function CommunityHome({ character, tenant }: { character: SocialCharacter; tenant: TenantInfo | null }) {
  const [event, setEvent] = useState<SocialEvent | null>(null);
  const [threads, setThreads] = useState<DirectThread[]>([]);
  const [notifications, setNotifications] = useState<HomeNotification[]>([]);
  const [appsOpen, setAppsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [profileMenu, setProfileMenu] = useState(false);
  const [canManageCommunity, setCanManageCommunity] = useState(false);
  const features = tenant?.settings?.features ?? {};
  const firstName = character.displayName.trim().split(/\s+/)[0] || character.displayName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  useEffect(() => {
    void apiRequest<{ canManage: boolean }>('/api/community/admin-access').then((result) => setCanManageCommunity(result.canManage)).catch(() => setCanManageCommunity(false));
    if (features.events !== false) void apiRequest<SocialEvent[]>('/api/events?limit=1').then((items) => setEvent(items[0] ?? null)).catch(() => setEvent(null));
    if (features.messages !== false) void apiRequest<DirectThread[]>('/api/messages-v2/summary').then(setThreads).catch(() => setThreads([]));
    void apiRequest<HomeNotification[]>('/api/notifications?limit=4').then(setNotifications).catch(() => setNotifications([]));
  }, [tenant?.id, features.events, features.messages]);

  const availableApps = [
    { key: 'feed', title: 'Social', caption: 'Compartilhe seu dia', icon: 'photo_camera', href: '/feed', color: 'social' },
    { key: 'pulse', title: 'Echo', caption: 'Compartilhe o que está acontecendo', icon: 'graphic_eq', href: '/echo', color: 'pulse' },
    { key: 'match', title: 'Match', caption: 'Novas conexões', icon: 'favorite', href: '/match', color: 'match' },
    { key: 'messages', title: 'Mensagens', caption: 'Suas conversas', icon: 'chat_bubble', href: '/mensagens', color: 'messages', badge: threads.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0) },
    { key: 'bank', title: 'Banco', caption: 'Seu saldo e transferências', icon: 'credit_card', href: '/banco', color: 'bank' },
    { key: 'events', title: 'Eventos', caption: 'Veja o que vem aí', icon: 'calendar_month', href: '/eventos', color: 'events' },
    { key: 'academic', title: 'Acadêmico', caption: 'Aulas e atividades', icon: 'school', href: '/academico', color: 'academic', optional: true },
    { key: 'career', title: 'Carreira', caption: 'Oportunidades', icon: 'work', href: '/carreira', color: 'career', optional: true },
    { key: 'news', title: 'Notícias', caption: 'Fique por dentro', icon: 'newspaper', href: '/noticias', color: 'news', optional: true },
    { key: 'companies', title: 'Empresas', caption: 'Conheça e explore', icon: 'apartment', href: '/empresas', color: 'companies', optional: true },
  ].filter((app) => {
    if (app.key === 'match') return features.match !== false;
    if (app.key === 'pulse') return features.pulse !== false;
    if (app.key === 'feed') return features.feed !== false;
    if (app.key === 'messages') return features.messages !== false;
    if (app.key === 'bank') return features.bank !== false;
    if (app.key === 'events') return features.events !== false;
    // Keep newly shipped applications visible even when older tenants have no
    // feature flag yet or the flag was saved before the app existed.
    if (app.optional) return true;
    return true;
  });
  const openApp = (app: (typeof availableApps)[number]) => {
    const implemented = ['/feed', '/pulso', '/echo', '/mensagens', '/eventos', '/match', '/banco', '/academico', '/carreira', '/noticias', '/empresas'].includes(app.href);
    if (implemented) window.location.href = app.href;
    else { setMessage(`${app.title} ainda não está disponível nesta comunidade.`); window.setTimeout(() => setMessage(''), 3200); }
  };
  const wallpaper = '/vybe-community-wallpaper-default.png';
  return <main className="community-home" style={{ backgroundImage: `url("${wallpaper}")` }}>
    <header className="home-topbar"><a className="home-brand" href="/" aria-label="VYBE"><Logo/></a><span className="home-topbar-divider"/><details className="home-community-menu"><summary><span className="home-community-mark">{tenant?.logoUrl ? <img src={tenant.logoUrl} alt=""/> : <MaterialIcon name="groups"/>}</span><strong>{tenant?.name ?? 'Comunidade'}</strong><MaterialIcon name="expand_more"/></summary><div><a href="/comunidades">Trocar universo</a><a href="/comunidade">Sobre a comunidade</a></div></details><div className="home-topbar-spacer"/><form className="home-search" onSubmit={(e) => { e.preventDefault(); if (search.trim()) window.location.href = `/explorar?q=${encodeURIComponent(search.trim())}`; }}><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" aria-label="Buscar na comunidade"/><button aria-label="Buscar"><MaterialIcon name="search"/></button></form><a className="home-icon-button" href="/notificacoes" aria-label="Notificações"><MaterialIcon name="notifications"/>{notifications.some((item) => !item.readAt) && <i/>}</a><div className="home-profile-menu"><button className="home-profile-trigger" type="button" onClick={() => setProfileMenu((open) => !open)}><Avatar character={character}/><span className="home-profile-copy"><strong>{character.displayName}</strong><small>@{character.username}</small></span><MaterialIcon name="expand_more"/></button>{profileMenu && <div className="home-profile-dropdown"><a href={`/@${character.username}`}>Meu perfil</a>{canManageCommunity && <a href="/configuracoes">Configurações da Comunidade</a>}<a href="/comunidades">Trocar universo</a><a href="/comunidades">Sair do universo</a></div>}</div></header>
    <div className="home-content"><section className="home-left"><div className="home-welcome"><span>BEM-VINDA DE VOLTA</span><h1>{greeting}, {firstName}.</h1><strong>{tenant?.name ?? 'Seu universo'}</strong><small>{date}</small></div><div className="home-app-grid">{availableApps.map((app) => <button className={`home-app home-app--${app.color}`} type="button" key={app.key} onClick={() => openApp(app)}><span className="home-app-icon"><CommunityAppIcon app={app.key}/>{Boolean(app.badge) && <i>{app.badge}</i>}</span><strong>{app.title}</strong><small>{app.caption}</small></button>)}{!availableApps.length && <p className="home-empty-apps">Os aplicativos desta comunidade aparecerão aqui.</p>}</div><a className="home-community-chip" href="/comunidade">{tenant?.logoUrl ? <img src={tenant.logoUrl} alt=""/> : <span><MaterialIcon name="groups"/></span>}<strong>{tenant?.name ?? 'Comunidade'}</strong><MaterialIcon name="chevron_right"/></a></section>
    <section className="home-widgets" aria-label="Resumo da comunidade"><article className="home-event-widget" style={event?.imageUrl ? { backgroundImage: `linear-gradient(0deg,rgba(12,22,17,.78),rgba(12,22,17,.08)),url("${event.imageUrl}")` } : undefined}><span>PRÓXIMO EVENTO</span>{event ? <><h2>{event.title}</h2><p>{event.category || 'Encontro da comunidade'}</p><small><MaterialIcon name="calendar_month"/> {new Date(event.startsAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} · {new Date(event.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} <MaterialIcon name="location_on"/> {event.location || 'Local a definir'}</small><a href={`/eventos/${event.id}`} aria-label="Ver evento"><MaterialIcon name="arrow_forward"/></a></> : <p className="home-widget-empty">Nenhum evento próximo.</p>}</article>
    <div className="home-widget-pair">{features.bank === true && <article className="home-mini-widget home-bank-widget"><span>SEU SALDO</span><MaterialIcon name="credit_card"/><strong>Saldo indisponível</strong><small>O Banco virtual ainda não está configurado.</small><button type="button" onClick={() => { setMessage('O Banco virtual ainda não está disponível nesta comunidade.'); window.setTimeout(() => setMessage(''), 3200); }}>Ver extrato <MaterialIcon name="arrow_forward"/></button></article>}{features.messages !== false && <article className="home-mini-widget home-messages-widget"><span>MENSAGENS</span><a href="/mensagens" aria-label="Abrir mensagens"><MaterialIcon name="arrow_forward"/></a><div className="home-thread-avatars">{threads.slice(0, 3).map((thread) => <Avatar key={thread.character.id} character={thread.character}/>)}</div><strong>{threads.reduce((sum, thread) => sum + (thread.unreadCount ?? 0), 0)} novas mensagens</strong><small>{threads[0] ? `Última mensagem ${relativeTime(threads[0].createdAt)}` : 'Você ainda não tem novas mensagens.'}</small></article>}</div>
    <article className="home-notifications-widget"><header><span>NOTIFICAÇÕES RECENTES</span><a href="/notificacoes" aria-label="Ver notificações"><MaterialIcon name="arrow_forward"/></a></header>{notifications.map((item) => <a className="home-notification-row" href={item.type === 'message' ? '/mensagens' : item.type.startsWith('event_') ? `/eventos/${item.targetId}` : '/notificacoes'} key={item.id}>{item.actor ? <Avatar character={item.actor}/> : <span className="home-notification-icon"><MaterialIcon name={item.type.startsWith('event_') ? 'calendar_month' : 'notifications'}/></span>}<span><strong>{item.actor?.displayName ?? 'VYBE'} {item.type === 'bank_transfer_received' ? `enviou ${moneyForNotification(item.amountCents)} para você` : item.type === 'bank_admin_credit_received' ? `creditou ${moneyForNotification(item.amountCents)} na sua carteira` : item.type === 'message' ? 'enviou uma mensagem' : item.type === 'news_published' ? 'publicou uma nova notícia' : item.type === 'news_reviewed' ? 'atualizou a revisão da sua matéria' : item.type === 'like' ? 'curtiu sua publicação' : item.type === 'comment' ? 'comentou em uma publicação sua' : item.type === 'follow' ? 'começou a seguir você' : item.type.startsWith('event_') ? `${item.type === 'event_created' ? 'novo evento' : 'atualização do evento'}${item.eventTitle ? `: ${item.eventTitle}` : ''}` : 'enviou uma atualização'}</strong><small>há {relativeTime(item.createdAt)}</small></span><MaterialIcon name="chevron_right"/></a>)}{notifications.length === 0 && <p className="home-widget-empty">Você está em dia com as notificações.</p>}</article></section></div>
    <nav className="home-dock" aria-label="Navegação da comunidade"><a className="is-active" href="/"><MaterialIcon name="home"/><small>Início</small></a>{availableApps.filter((app) => ['feed','pulse','match','messages','bank','events'].includes(app.key)).map((app) => <button type="button" key={app.key} onClick={() => openApp(app)}><CommunityAppIcon app={app.key}/><small>{app.title}</small>{app.key === 'messages' && Boolean(app.badge) && <i/>}</button>)}<button type="button" onClick={() => setAppsOpen(true)}><CommunityAppIcon app="apps"/><small>Apps</small></button></nav>
    {appsOpen && <div className="home-apps-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAppsOpen(false); }}><section className="home-apps-panel" role="dialog" aria-modal="true" aria-label="Aplicativos da comunidade"><button type="button" className="home-apps-close" onClick={() => setAppsOpen(false)} aria-label="Fechar"><MaterialIcon name="close"/></button><span>SEU UNIVERSO</span><h2>Aplicativos</h2><div className="home-app-grid home-app-grid--launcher">{availableApps.map((app) => <button className={`home-app home-app--${app.color}`} type="button" key={app.key} onClick={() => openApp(app)}><span className="home-app-icon"><CommunityAppIcon app={app.key}/></span><strong>{app.title}</strong></button>)}</div></section></div>}{message && <div className="home-toast" role="status">{message}</div>}</main>;
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
  const echoMode = path.startsWith('/echo') || path === '/pulso';
  const [echoIdentity,setEchoIdentity]=useState<SocialCharacter>(character);
  const isCommunityHome = path === '/';

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
  if (path === '/explorar') page = <ExplorePage current={character}/>;
  else if (path === '/stories' || path === '/pulso' || path === '/feed') page = <HomePage character={character} stories={stories} onCreate={openCreate}/>;
  else if (path === '/mensagens') page = <MessagesPage/>;
  else if (path === '/conversas') page = <CommunityChatPage/>;
  else if (path === '/comunidade') page = <CommunityPage tenant={tenant}/>;
  else if (path.startsWith('/empresas')) page = <CompaniesPage community={tenant?.name ?? 'sua comunidade'}/>;
  else if (path === '/eventos') page = <EventsPage/>;
  else if (path.startsWith('/eventos/')) page = <EventsPage eventId={path.slice('/eventos/'.length)}/>;
  else if (path === '/notificacoes') page = <NotificationsPage/>;
  else if (path === '/verificacoes') page = <VerificationAdminPage/>;
  else if (path === '/configuracoes') page = <SettingsPage/>;
  else if (path === '/ajuda') page = <HelpPage/>;
  else if (path === '/comunidades') page = <CommunitySwitchPage/>;
  else if (path.startsWith('/@')) {
    const [username, connectionList] = decodeURIComponent(path.slice(2)).split('/');
    page = connectionList === 'followers' || connectionList === 'following'
      ? <ConnectionsPage username={username} list={connectionList}/>
      : <ProfilePage username={username} currentCharacter={character} onUpdated={onCharacterUpdated}/>;
  }
  else page = <HomePage character={character} stories={stories} onCreate={openCreate}/>;

  if (path === '/echo' || path === '/pulso') page = <EchoPage identity={echoIdentity} tenant={tenant}/>;
  else if (path === '/echo/explorar') page = <EchoPage identity={echoIdentity} tenant={tenant} initialTab="for-you"/>;
  else if (path === '/echo/notificacoes') page = <NotificationsPage echo/>;
  else if (path === '/echo/perfil') page = <EchoProfilePage current={character} tenant={tenant}/>;
  if (path.startsWith('/match')) return <MatchApp community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/mensagens')) return <MessagesApp character={character} community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/academico')) return <AcademicApp community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/noticias')) return <NewsApp community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/banco')) return <BankApp character={character}/>;
  if (path === '/eventos/admin') return <EventsAdminPage community={tenant?.name ?? 'Sua comunidade'}/>;
  if (path.startsWith('/eventos')) return <EventsPage community={tenant?.name ?? 'Sua comunidade'} eventId={path.startsWith('/eventos/') ? path.slice('/eventos/'.length) : undefined}/>;
  return <>{isCommunityHome && <CommunityHome character={character} tenant={tenant}/ >}{!isCommunityHome && <div className={`social-app ${echoMode ? 'echo-app' : ''}`}><AppSidebar character={character} tenant={tenant} onCreate={() => openCreate()} echo={echoMode}/><main className="social-workspace"><header className="social-topbar"><label className="global-search"><MaterialIcon name="search" className="global-search-icon"/><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && search.trim()) window.location.href = `${echoMode ? '/echo/explorar' : '/explorar'}?q=${encodeURIComponent(search.trim())}`; }} placeholder={echoMode ? 'Buscar no Echo...' : 'Pesquisar pessoas, lugares...'}/></label>{echoMode && <a className="topbar-icon echo-topbar-notifications" href="/echo/notificacoes" aria-label="Notificações"><MaterialIcon name="notifications"/></a>}<details className="topbar-profile-menu"><summary className="topbar-user"><Avatar character={echoMode?echoIdentity:character}/><span><strong>{echoMode?echoIdentity.displayName:character.displayName}</strong><small>@{character.username}</small></span><b><MaterialIcon name="expand_more"/></b></summary><div><a href={echoMode ? '/echo/perfil' : `/@${character.username}`}>Ver perfil</a><button type="button" onClick={onLogout}>Sair</button></div></details></header><div className="social-page-layout"><div className="social-route-column">{page}</div>{['/feed', '/stories'].includes(path) && <aside className="social-right-column"><CurrentProfile character={character}/></aside>}</div></main>{composerChoice && <ComposerModal character={character} choice={composerChoice} onChoose={setComposerChoice} onClose={() => setComposerChoice(null)} onPosted={() => { window.dispatchEvent(new Event('vybe:refresh-feed')); window.dispatchEvent(new Event('vybe:refresh-stories')); }}/ >}{commentPost && <div className="story-overlay"><section className="comments-modal" role="dialog" aria-modal="true"><button className="modal-x" type="button" onClick={() => setCommentPost(null)}><MaterialIcon name="close"/></button><h2>Respostas</h2><div className="comments-list">{comments.map((comment) => <article className={comment.replyToCommentId ? 'echo-comment-reply' : ''} key={comment.id}><Avatar character={comment.author}/><div><strong>{comment.author?.displayName ?? 'Alguém'} <VerificationBadge verified={comment.author?.verified}/></strong><p>{comment.content}</p><button type="button" onClick={() => { setReplyToComment(comment.id); commentInputRef.current?.focus(); }}>Responder</button>{comment.own && <button type="button" onClick={async () => { await apiRequest(`/api/comments/${comment.id}`, { method: 'DELETE' }); setComments((items) => items.filter((item) => item.id !== comment.id)); }}>Excluir</button>}</div></article>)}</div><form className="comment-compose" onSubmit={async (event) => { event.preventDefault(); if (!commentDraft.trim()) return; const comment = await apiRequest<CommentItem>(`/api/posts/${commentPost.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: commentDraft, ...(replyToComment ? { replyToCommentId: replyToComment } : {}) }) }); setComments((items) => [...items, comment]); setCommentDraft(''); setReplyToComment(null); window.dispatchEvent(new Event('vybe:refresh-feed')); }}><textarea ref={commentInputRef} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} name="comment" placeholder={replyToComment ? 'Escreva uma resposta...' : 'Compartilhe uma resposta...'} maxLength={1000} required/><EmojiButton onBeforeOpen={captureCommentSelection} onSelect={insertCommentEmoji}/><button className="primary-button">Responder</button></form></section></div>}</div>}</>;
}
