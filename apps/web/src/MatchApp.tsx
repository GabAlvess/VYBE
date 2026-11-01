import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { SocialCharacter } from './SocialApp';
import { MaterialIcon } from './MaterialIcon';
import { notifySnack } from './SnackMessage';
import { UniverseBackLink } from './UniverseBackLink';
import { VybeLogo } from './VybeLogo';
import { connectConversationRealtime } from './conversationRealtime';
import './MatchApp.css';

type MatchProfileData = { enabled: boolean; age: number | null; bio: string; location: string; interests: string[]; photos: string[] };
type MatchIdentity = Pick<SocialCharacter, 'id' | 'username' | 'displayName' | 'bio' | 'avatarUrl' | 'verified'>;
type MatchCardData = MatchIdentity & { age: number; bio: string; location: string; interests: string[]; photos: string[] };
type MatchSummary = { id: string; profile: MatchCardData; latestMessage: { content: string; createdAt: string; own: boolean } | null; unreadCount: number; createdAt: string };
type MatchMessageData = { id: string; senderProfileId: string; recipientProfileId: string; content: string; createdAt: string; readAt: string | null; own: boolean };

async function matchRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? 'Não foi possível concluir esta ação.');
  return body as T;
}

function dataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a foto.')); reader.onerror = () => reject(new Error('Não foi possível ler a foto.')); reader.readAsDataURL(file); });
}

function MatchAvatar({ src, label, className = '' }: { src?: string; label: string; className?: string }) {
  return <span className={`match-avatar ${className}`}>{src ? <img src={src} alt={label}/> : <span>{label.slice(0, 1).toUpperCase()}</span>}</span>;
}

function MatchLogo() {
  return <a href="/match" className="match-brand" aria-label="VYBE Match"><VybeLogo variant="symbol"/><span>VYBE</span><small>Match</small></a>;
}

function MatchSidebar({ community }: { community: string }) {
  const path = window.location.pathname;
  return <aside className="match-sidebar"><div className="match-sidebar-brand"><MatchLogo/><span className="match-community"><MaterialIcon name="groups"/>{community}</span></div><nav aria-label="Navegação do Match"><a className={path === '/match' ? 'active' : ''} href="/match"><MaterialIcon name="favorite"/>Início</a><a className={path === '/match/perfil' ? 'active' : ''} href="/match/perfil"><MaterialIcon name="person"/>Perfil</a><a className={path.startsWith('/match/mensagens') ? 'active' : ''} href="/match/mensagens"><MaterialIcon name="chat_bubble"/>Mensagens</a></nav><UniverseBackLink className="match-universe-back"/></aside>;
}

function MatchProfilePage({ identity, profile, onSaved }: { identity: MatchIdentity; profile: MatchProfileData; onSaved: (identity: MatchIdentity, profile: MatchProfileData) => void }) {
  const [age, setAge] = useState(profile.age?.toString() ?? '');
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location);
  const [interests, setInterests] = useState(profile.interests);
  const [photos, setPhotos] = useState(profile.photos);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = '';
    if (!files.length) return;
    if (photos.length + files.length > 6) { setError('Escolha até 6 fotos.'); return; }
    if (files.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) { setError('Use fotos PNG, JPEG ou WebP de até 2 MB cada.'); return; }
    try { const images = await Promise.all(files.map(dataUrl)); setPhotos((current) => [...current, ...images]); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as fotos.'); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const result = await matchRequest<{ identity: MatchIdentity; profile: MatchProfileData }>('/api/match/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ age: age ? Number(age) : null, bio, location, interests, photos, enabled }) });
      onSaved(result.identity, result.profile); notifySnack('Perfil do Match atualizado.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil.'); }
    finally { setSaving(false); }
  }
  const interestDraft = useRef<HTMLInputElement>(null);
  function addInterest() { const value = interestDraft.current?.value.trim(); if (value && !interests.includes(value) && interests.length < 12) setInterests((items) => [...items, value.slice(0, 32)]); if (interestDraft.current) interestDraft.current.value = ''; }
  return <section className="match-profile-page"><header className="match-page-heading"><span>SEU PERFIL</span><h1>Seu perfil no Match</h1><p>Use a identidade da comunidade e escolha o que quer compartilhar aqui.</p></header><form className="match-profile-form" onSubmit={(event) => void submit(event)}>
    <div className="match-identity-row"><MatchAvatar src={identity.avatarUrl} label={identity.displayName}/><div><strong>{identity.displayName}</strong><small>@{identity.username}</small><a href={`/@${identity.username}`}>Editar identidade e foto</a></div></div>
    <label className="match-toggle"><span><strong>Mostrar no Match</strong><small>Quando desativado, seu perfil deixa de aparecer na descoberta.</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)}/></label>
    <div className="match-fields-two"><label>Idade<input type="number" inputMode="numeric" min="18" max="120" value={age} onChange={(event) => setAge(event.currentTarget.value)} placeholder="18 ou mais" required={enabled}/></label><label>Localização da comunidade<input maxLength={100} value={location} onChange={(event) => setLocation(event.currentTarget.value)} placeholder="Ex.: Ribeirão Preto"/></label></div>
    <label>Sobre você<textarea maxLength={500} value={bio} onChange={(event) => setBio(event.currentTarget.value)} placeholder="Uma breve apresentação..."/><small>{bio.length}/500</small></label>
    <div className="match-interests-editor"><label htmlFor="match-interest-entry">Interesses</label><div className="match-interest-chips">{interests.map((interest) => <button type="button" key={interest} onClick={() => setInterests((items) => items.filter((item) => item !== interest))}>{interest}<MaterialIcon name="close"/></button>)}</div><div className="match-interest-entry"><input ref={interestDraft} id="match-interest-entry" maxLength={32} placeholder="Adicionar interesse" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addInterest(); } }}/><button type="button" aria-label="Adicionar interesse" onClick={addInterest}><MaterialIcon name="add"/></button></div><small>Até 12 interesses.</small></div>
    <div className="match-photo-editor"><div><strong>Fotos</strong><small>Até 6 fotos. A foto do seu perfil é usada quando nenhuma foto adicional é escolhida.</small></div><div className="match-photo-grid">{photos.map((photo, index) => <figure key={`${index}-${photo.slice(-12)}`}><img src={photo} alt={`Foto ${index + 1} do Match`}/><button type="button" aria-label={`Remover foto ${index + 1}`} onClick={() => setPhotos((items) => items.filter((_, itemIndex) => itemIndex !== index))}><MaterialIcon name="close"/></button></figure>)}<label className="match-photo-add"><MaterialIcon name="add_photo_alternate"/><span>Adicionar foto</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void addPhotos(event)}/></label></div></div>
    {error && <p className="match-error" role="alert">{error}</p>}<button className="match-primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar perfil'}</button>
  </form></section>;
}

function MatchHome({ identity, profile, onNavigateMessages }: { identity: MatchIdentity; profile: MatchProfileData; onNavigateMessages: () => void }) {
  const [cards, setCards] = useState<MatchCardData[]>([]);
  const [index, setIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newMatch, setNewMatch] = useState<MatchSummary | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [blockMenu, setBlockMenu] = useState(false);
  const [firstMessage, setFirstMessage] = useState('');
  const card = cards[index];
  async function load() { setLoading(true); try { const result = await matchRequest<{ enabled: boolean; profiles: MatchCardData[] }>('/api/match/discovery'); setCards(result.profiles); setIndex(0); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o Match.'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  const images = card?.photos?.length ? card.photos : card?.avatarUrl ? [card.avatarUrl] : [];
  useEffect(() => { setPhotoIndex(0); }, [card?.id]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft') setPhotoIndex((value) => (value - 1 + Math.max(images.length, 1)) % Math.max(images.length, 1)); if (event.key === 'ArrowRight') setPhotoIndex((value) => (value + 1) % Math.max(images.length, 1)); };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [images.length]);
  async function react(type: 'pass' | 'star' | 'like') {
    if (!card) return;
    try {
      const result = await matchRequest<{ match: MatchSummary | null }>('/api/match/reactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toProfileId: card.id, type }) });
      if (result.match) setNewMatch(result.match); else { if (index + 1 >= cards.length) await load(); else setIndex((value) => value + 1); }
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Não foi possível registrar seu interesse.'; setError(message); notifySnack(message); }
  }
  async function openConversation() {
    if (!newMatch) return; setOpeningChat(true);
    try { if (firstMessage.trim()) await matchRequest(`/api/match/matches/${newMatch.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: firstMessage.trim() }) }); window.location.href = `/match/mensagens/${newMatch.id}`; }
    catch (reason) { const message = reason instanceof Error ? reason.message : 'Não foi possível iniciar a conversa.'; notifySnack(message); setOpeningChat(false); }
  }
  async function blockProfile() {
    if (!card || !window.confirm(`Bloquear ${card.displayName}? Este perfil deixará de aparecer para você.`)) return;
    try {
      await matchRequest(`/api/match/profiles/${card.id}/block`, { method: 'POST' });
      setBlockMenu(false);
      if (index + 1 >= cards.length) await load(); else setIndex((value) => value + 1);
      notifySnack('Perfil bloqueado.');
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Não foi possível bloquear este perfil.'; setError(message); notifySnack(message); }
  }
  if (!profile.enabled || !profile.age) return <section className="match-empty match-profile-needed"><MaterialIcon name="favorite"/><h1>Prepare seu perfil do Match</h1><p>Complete sua idade e ative “Mostrar no Match” para conhecer pessoas da comunidade.</p><a className="match-primary-button" href="/match/perfil">Configurar perfil</a></section>;
  if (loading) return <div className="match-empty">Encontrando pessoas da comunidade…</div>;
  if (!card) return <section className="match-empty"><MaterialIcon name="favorite"/><h1>Você já viu todo mundo por aqui.</h1><p>Novas pessoas vão aparecer por aqui em breve.</p><a href="/match/perfil">Revisar meu perfil</a><button type="button" onClick={onNavigateMessages}>Ver mensagens</button></section>;
  return <section className="match-home"><div className="match-card-wrap">{error && <p className="match-error" role="status">{error}</p>}<article className="match-person-card" aria-label={`Perfil de ${card.displayName}`}>
    {images.length > 0 ? <img className="match-card-photo" src={images[photoIndex]} alt={`Foto ${photoIndex + 1} de ${card.displayName}`}/> : <div className="match-card-photo match-no-photo"><MatchAvatar src={card.avatarUrl} label={card.displayName}/></div>}
    {images.length > 1 && <><div className="match-photo-indicators">{images.map((_, photo) => <i className={photo === photoIndex ? 'active' : ''} key={photo}/>)}</div><button type="button" className="match-photo-hit match-photo-hit-left" aria-label="Foto anterior" onClick={() => setPhotoIndex((value) => (value - 1 + images.length) % images.length)}/><button type="button" className="match-photo-hit match-photo-hit-right" aria-label="Próxima foto" onClick={() => setPhotoIndex((value) => (value + 1) % images.length)}/></>}
    <button type="button" className="match-card-menu" aria-label="Opções do perfil" title="Opções do perfil" onClick={() => setBlockMenu((value) => !value)}><MaterialIcon name="more_horiz"/></button>{blockMenu && <div className="match-card-menu-popover"><button type="button" onClick={() => void blockProfile()}>Bloquear perfil</button></div>}
    <div className="match-card-shade"/><div className="match-card-info"><h1>{card.displayName}, {card.age}{card.verified && <MaterialIcon name="verified" filled/>}</h1><span className="match-card-username">@{card.username}</span>{card.bio && <p>{card.bio}</p>}{card.location && <small className="match-location"><MaterialIcon name="location_on"/>{card.location}</small>}{card.interests.length > 0 && <div className="match-interest-tags">{card.interests.slice(0, 5).map((item) => <span key={item}>{item}</span>)}{card.interests.length > 5 && <span>+{card.interests.length - 5}</span>}</div>}</div>
  </article><div className="match-actions"><button className="match-action-pass" type="button" aria-label="Passar" title="Passar" onClick={() => void react('pass')}><MaterialIcon name="close"/></button><button className="match-action-star" type="button" aria-label="Enviar estrela" title="Interesse especial" onClick={() => void react('star')}><MaterialIcon name="star" filled/></button><button className="match-action-like" type="button" aria-label="Curtir" title="Curtir" onClick={() => void react('like')}><MaterialIcon name="favorite" filled/></button></div></div>
    {newMatch && <div className="match-modal-backdrop"><section className="match-success-modal" role="dialog" aria-modal="true" aria-labelledby="match-success-title"><button className="match-modal-close" type="button" aria-label="Fechar" onClick={() => setNewMatch(null)}><MaterialIcon name="close"/></button><div className="match-couple"><MatchAvatar src={identity.avatarUrl} label={identity.displayName}/><MatchAvatar src={newMatch.profile.photos[0] || newMatch.profile.avatarUrl} label={newMatch.profile.displayName}/><span><MaterialIcon name="favorite" filled/></span></div><h2 id="match-success-title">É um match! 💚</h2><p>Vocês se curtiram. Que tal iniciar a conversa?</p><textarea maxLength={1000} value={firstMessage} onChange={(event) => setFirstMessage(event.currentTarget.value)} placeholder="Envie uma mensagem..."/><button className="match-primary-button" type="button" disabled={openingChat} onClick={() => void openConversation()}><MaterialIcon name="send"/>{openingChat ? 'Abrindo conversa…' : 'Enviar mensagem'}</button><button className="match-modal-later" type="button" onClick={() => { setNewMatch(null); setFirstMessage(''); if (index + 1 >= cards.length) void load(); else setIndex((value) => value + 1); }}>Agora não</button></section></div>}
  </section>;
}

function MatchMessages({ selectedId }: { selectedId?: string }) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [messages, setMessages] = useState<MatchMessageData[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const selected = matches.find((item) => item.id === selectedId);
  async function loadMatches() { setMatches(await matchRequest<MatchSummary[]>('/api/match/matches')); }
  async function loadMessages(id: string) { const result = await matchRequest<MatchMessageData[]>(`/api/match/matches/${id}/messages`); setMessages(result); }
  useEffect(() => { void loadMatches().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as conversas.')); }, []);
  useEffect(() => {
    if (selectedId) void loadMessages(selectedId).catch((reason) => setError(reason instanceof Error ? reason.message : 'Esta conversa não está disponível.'));
    else setMessages([]);
  }, [selectedId]);
  useEffect(() => connectConversationRealtime((event) => {
    if (event.type === 'ready') {
      void loadMatches().catch(() => undefined);
      if (selectedIdRef.current) void loadMessages(selectedIdRef.current).catch(() => undefined);
      return;
    }
    if (event.type === 'match:message') {
      void loadMatches().catch(() => undefined);
      if (event.matchId && event.matchId === selectedIdRef.current) void loadMessages(event.matchId).catch(() => undefined);
    }
  }), []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedId || !draft.trim()) return;
    const message = await matchRequest<MatchMessageData>(`/api/match/matches/${selectedId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: draft.trim() }) });
    setMessages((items) => [...items, message]); setDraft(''); void loadMatches();
  }
  async function block() {
    if (!selectedId) return;
    if (!window.confirm(`Bloquear ${selected?.profile.displayName ?? 'esta pessoa'}? A conversa será encerrada.`)) return;
    await matchRequest(`/api/match/matches/${selectedId}/block`, { method: 'POST' }); window.location.href = '/match/mensagens';
  }
  if (!selectedId) return <div className="match-messages-layout"><aside className="match-thread-list"><header><h1>Mensagens</h1><span>{matches.length}</span></header>{matches.map((item) => <a href={`/match/mensagens/${item.id}`} className="match-thread" key={item.id}><MatchAvatar src={item.profile.photos[0] || item.profile.avatarUrl} label={item.profile.displayName}/><span><strong>{item.profile.displayName}</strong><small>{item.latestMessage?.content ?? 'Vocês deram Match!'}</small></span>{item.unreadCount > 0 && <i>{item.unreadCount}</i>}</a>)}{matches.length === 0 && <p className="match-thread-empty">Quando você der Match, poderá começar uma conversa por aqui.</p>}</aside><section className="match-chat-placeholder"><MaterialIcon name="chat_bubble"/><h2>Suas conversas</h2><p>Escolha um Match para conversar.</p></section></div>;
  return <div className="match-messages-layout"><aside className="match-thread-list"><header><h1>Mensagens</h1><span>{matches.length}</span></header>{matches.map((item) => <a href={`/match/mensagens/${item.id}`} className={`match-thread ${item.id === selectedId ? 'active' : ''}`} key={item.id}><MatchAvatar src={item.profile.photos[0] || item.profile.avatarUrl} label={item.profile.displayName}/><span><strong>{item.profile.displayName}</strong><small>{item.latestMessage?.content ?? 'Vocês deram Match!'}</small></span>{item.unreadCount > 0 && <i>{item.unreadCount}</i>}</a>)}</aside><section className="match-chat"><header className="match-chat-header"><a className="match-chat-back" href="/match/mensagens" aria-label="Voltar às mensagens"><MaterialIcon name="arrow_back"/></a><MatchAvatar src={selected?.profile.photos[0] || selected?.profile.avatarUrl} label={selected?.profile.displayName ?? 'Match'}/><div><strong>{selected?.profile.displayName ?? 'Conversa'}</strong><small>Conexão do Match</small></div><button type="button" aria-label="Opções da conversa" onClick={() => setMenu((value) => !value)}><MaterialIcon name="more_horiz"/></button>{menu && <div className="match-chat-menu"><button type="button" onClick={() => void block()}>Bloquear perfil</button></div>}</header><div className="match-chat-messages" ref={listRef}>{error && <p className="match-error">{error}</p>}{messages.map((message) => <article className={`match-message ${message.own ? 'own' : ''}`} key={message.id}><p>{message.content}</p><small>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{message.own && message.readAt && ' · Visualizada'}</small></article>)}{messages.length === 0 && <p className="match-chat-first">Vocês deram Match! Envie uma mensagem para começar.</p>}</div><form className="match-chat-compose" onSubmit={(event) => void send(event)}><button type="button" aria-label="Adicionar emoji" onClick={() => setDraft((value) => `${value} 💚`)}><MaterialIcon name="sentiment_satisfied"/></button><input value={draft} onChange={(event) => setDraft(event.currentTarget.value)} maxLength={1000} placeholder="Digite uma mensagem..."/><button type="submit" aria-label="Enviar" disabled={!draft.trim()}><MaterialIcon name="send"/></button></form></section></div>;
}

export function MatchApp({ community }: { community: string }) {
  const path = window.location.pathname;
  const [identity, setIdentity] = useState<MatchIdentity | null>(null);
  const [profile, setProfile] = useState<MatchProfileData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void matchRequest<{ identity: MatchIdentity; profile: MatchProfileData }>('/api/match/profile').then((result) => { setIdentity(result.identity); setProfile(result.profile); }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Match indisponível nesta comunidade.')); }, []);
  const selectedId = path.match(/^\/match\/mensagens\/([a-f\d]{24})$/i)?.[1];
  return <div className="match-app"><MatchSidebar community={community}/><main className="match-workspace">{error ? <section className="match-empty"><MaterialIcon name="lock"/><h1>Match indisponível</h1><p>{error}</p><UniverseBackLink/></section> : !identity || !profile ? <div className="match-empty">Carregando o Match…</div> : path === '/match/perfil' ? <MatchProfilePage identity={identity} profile={profile} onSaved={(nextIdentity, nextProfile) => { setIdentity(nextIdentity); setProfile(nextProfile); }}/>
    : path === '/match/mensagens' || selectedId ? <MatchMessages selectedId={selectedId}/>
    : <MatchHome identity={identity} profile={profile} onNavigateMessages={() => { window.location.href = '/match/mensagens'; }}/>}</main></div>;
}
