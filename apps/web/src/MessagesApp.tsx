import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SocialCharacter } from './SocialApp.js';
import { MaterialIcon } from './MaterialIcon.js';
import { FormattedText, TextFormattingEditor } from './TextFormatting';
import { EmojiButton, useEmojiInsertion } from './EmojiPicker.js';
import { UniverseBackLink } from './UniverseBackLink';
import { HelpHeaderLink } from './HelpHeaderLink';
import { MessageServersRail } from './MessageServers';
import { ProfilePhotoEditor } from './ProfilePhotoEditor';
import { VybeLogo } from './VybeLogo';
import { connectConversationRealtime, sendConversationRealtime } from './conversationRealtime';
import { soundManager } from './soundManager';
import './MessagesApp.css';

type Person = Pick<SocialCharacter, 'id' | 'displayName' | 'username' | 'avatarUrl' | 'bio'> & { role?: 'admin' | 'member'; online?: boolean };
type Thread = { id: string; kind: 'direct' | 'group'; name: string; description: string; photoUrl: string; participants: Person[]; lastMessage: string; lastMessageAt: string; unreadCount: number; muted: boolean; favorite: boolean; archived?: boolean; closed?: boolean; typing?: boolean; peerLastReadAt?: string | null; blockedByMe?: boolean; blockedByThem?: boolean; currentRole: 'admin'|'member'; matchId: string | null; createdBy: string };
type ChatMessage = { id: string; senderProfileId: string; own?: boolean; content: string; messageType: 'text' | 'image' | 'file' | 'audio' | 'server_invite'; serverInvite?: {serverId:string;name:string;description:string;imageUrl:string;inviteUrl:string}|null; attachment?: { url: string; name: string; mimeType?: string; size?: number } | null; replyToMessageId: string | null; reply?: ChatMessage | null; favorite: boolean; favoriteCount: number; deleted: boolean; readAt?: string | null; createdAt: string };
type MessagesIdentity = Person & { statusMessage: string };
async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(path, { credentials: 'same-origin', ...init }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error ?? 'Não foi possível concluir a solicitação.'); return data as T; }
function Avatar({ src, name, large = false }: { src?: string; name: string; large?: boolean }) { return <span className={`messages-avatar ${large ? 'large' : ''}`}>{src ? <img src={src} alt=""/> : name.trim().split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase()}</span>; }
function when(date: string) { const value = new Date(date); const today = new Date(); if (value.toDateString() === today.toDateString()) return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); return value.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
function attachmentKind(mimeType?: string) { return mimeType?.split('/').pop()?.toUpperCase() || 'ARQUIVO'; }
function legacyServerInviteUrl(message: ChatMessage) {
  if (message.serverInvite || !message.content.startsWith('Você foi convidado para o servidor')) return null;
  const rawUrl = message.content.match(/https?:\/\/[^\s]+/)?.[0];
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl.replace(/[),.]+$/, ''));
    const serverId = url.searchParams.get('serverId'); const token = url.searchParams.get('invite');
    return serverId && token ? { serverId, token } : null;
  } catch { return null; }
}

function MessagesSidebar({ active = 'conversations', onGroups, onNew }: { community: string; active?: 'conversations'|'groups'|'profile'; onGroups: () => void; onNew: () => void }) {
  return <aside className="messages-nav"><a className="messages-brand" href="/" aria-label="VYBE"><VybeLogo variant="full" className="messages-brand-mark"/></a><div className="messages-app-identity"><span><MaterialIcon name="forum"/></span><div><strong>VYBE</strong><small>Mensagens</small></div></div><nav><a className={active==='conversations'?'active':''} href="/mensagens/privadas"><MaterialIcon name="forum"/>Conversas</a><button className={active==='groups'?'active':''} type="button" onClick={onGroups}><MaterialIcon name="groups"/>Grupos</button><button type="button" onClick={onNew}><MaterialIcon name="add_box"/>Nova conversa</button><a className={active==='profile'?'active':''} href="/mensagens/perfil"><MaterialIcon name="person"/>Perfil</a></nav><UniverseBackLink className="messages-universe-back"/></aside>;
}

function MessagesProfilePage({ character, community }: { character: SocialCharacter; community: string }) {
  const [identity, setIdentity] = useState<MessagesIdentity>({ ...character, statusMessage: '' });
  const [name, setName] = useState(character.displayName);
  const [bio, setBio] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [photo, setPhoto] = useState<{dataUrl:string;name:string}|null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(()=>{void request<{identity:MessagesIdentity}>('/api/messages-v2/profile').then(({identity:result})=>{setIdentity(result);setName(result.displayName);setBio(result.bio);setStatusMessage(result.statusMessage);}).catch((reason)=>setError(reason.message)).finally(()=>setLoading(false));},[]);
  async function save(event:FormEvent){
    event.preventDefault(); setSaving(true); setError(''); setSaved(false);
    const payload: Record<string,unknown> = { displayName:name, bio, statusMessage };
    if(photo) payload.photo=photo; else if(removePhoto) payload.photo=null;
    try {
      const result=await request<{identity:MessagesIdentity}>('/api/messages-v2/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      setIdentity(result.identity); setName(result.identity.displayName); setBio(result.identity.bio); setStatusMessage(result.identity.statusMessage); setPhoto(null); setRemovePhoto(false); setSaved(true);
    } catch(reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  const preview=photo?.dataUrl??(removePhoto?'':identity.avatarUrl);
  return <div className="vybe-messages-app"><MessageServersRail activeServerId="" communityActive={false} privateActive onSelectServer={(serverId)=>window.location.assign(`/mensagens?serverId=${encodeURIComponent(serverId)}`)}/><MessagesSidebar community={community} active="profile" onGroups={()=>{window.location.href='/mensagens/privadas?tab=groups';}} onNew={()=>{window.location.href='/mensagens/privadas?new=1';}}/><main className="messages-profile-layout"><a className="messages-profile-back" href="/mensagens/privadas">‹ <span>Voltar para conversas</span></a><header className="messages-profile-heading"><HelpHeaderLink/><span>VYBE MENSAGENS</span><h1>Seu perfil no Mensagens</h1><p>Personalize como você aparece nas conversas. Essas alterações não modificam seu perfil Social.</p></header><form className="messages-profile-form" onSubmit={(event)=>void save(event)}><div className="messages-profile-preview"><Avatar src={preview} name={name||identity.displayName} large/><div><strong>{name||identity.displayName}</strong><small>@{identity.username} · identidade da comunidade</small>{statusMessage&&<span>{statusMessage}</span>}</div></div><ProfilePhotoEditor value={preview} onChange={(dataUrl)=>{setPhoto({dataUrl,name:'Foto ajustada'});setRemovePhoto(false);setSaved(false);setError('');}} onError={setError}/>{identity.avatarUrl&&<button type="button" className="messages-profile-reset-photo" onClick={()=>{setPhoto(null);setRemovePhoto(true);setSaved(false);}}>Usar foto padrão</button>}<label>Nome no Mensagens<input value={name} onChange={(event)=>{setName(event.currentTarget.value);setSaved(false);}} maxLength={60} required/><small>Seu nome nos outros apps não será alterado.</small></label><label>Apresentação<textarea value={bio} onChange={(event)=>{setBio(event.currentTarget.value);setSaved(false);}} maxLength={300} placeholder="Uma breve apresentação para suas conversas."/><small>{bio.length}/300</small></label><label>Recado<input value={statusMessage} onChange={(event)=>{setStatusMessage(event.currentTarget.value);setSaved(false);}} maxLength={80} placeholder="Ex.: Disponível para conversar"/><small>{statusMessage.length}/80</small></label>{loading&&<p className="messages-profile-loading">Carregando seu perfil…</p>}{error&&<p className="messages-profile-error" role="alert">{error}</p>}{saved&&<p className="messages-profile-saved" role="status">Perfil do Mensagens salvo.</p>}<button className="messages-primary-button" type="submit" disabled={loading||saving}>{saving?'Salvando…':'Salvar alterações'}</button></form></main></div>;
}

export function MessagesHomePage({ character, community }: { character: SocialCharacter; community: string }) {
  const [friends, setFriends] = useState<Person[]>([]);
  const [directMessages, setDirectMessages] = useState<Thread[]>([]);
  const [activeDirectId, setActiveDirectId] = useState('');
  const [deleteConversationTarget, setDeleteConversationTarget] = useState<Thread|null>(null);
  const [deleteConversationSaving, setDeleteConversationSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [sidebarPeople, setSidebarPeople] = useState<Person[]>([]);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [sidebarSearchLoading, setSidebarSearchLoading] = useState(false);
  const [directMessagesLoading, setDirectMessagesLoading] = useState(true);
  const [directMessagesError, setDirectMessagesError] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [friendsTab, setFriendsTab] = useState<'online' | 'offline'>('online');
  const filteredFriends = friends.filter((person) => `${person.displayName} ${person.username}`.toLowerCase().includes(query.trim().toLowerCase()));
  const onlineFriendsCount = friends.filter((person) => person.online).length;
  const offlineFriendsCount = friends.length - onlineFriendsCount;
  const visibleFriends = filteredFriends.filter((person) => Boolean(person.online) === (friendsTab === 'online'));
  const filteredPeople = people.filter((person) => !friends.some((friend) => friend.id === person.id) && `${person.displayName} ${person.username}`.toLowerCase().includes(search.trim().toLowerCase()));
  const filteredDirectMessages = directMessages.filter((thread) => {
    const peer = thread.participants.find((participant) => participant.id !== character.id);
    return `${peer?.displayName ?? thread.name} ${peer?.username ?? ''} ${thread.lastMessage}`.toLowerCase().includes(sidebarQuery.trim().toLowerCase());
  });
  useEffect(() => {
    let active = true;
    request<Person[]>('/api/messages-v2/people?all=true').then((members) => {
      if (active) setFriends(members);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os membros da comunidade.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [character.username]);
  useEffect(() => connectConversationRealtime((event) => {
    if (event.type === 'presence:snapshot' && Array.isArray(event.profileIds)) {
      const onlineIds = new Set(event.profileIds);
      setFriends((current) => current.map((person) => ({ ...person, online: onlineIds.has(person.id) })));
    }
    if (event.type === 'presence:update' && event.profileId) {
      setFriends((current) => current.map((person) => person.id === event.profileId ? { ...person, online: Boolean(event.online) } : person));
    }
  }), []);
  useEffect(() => {
    let active = true;
    request<Thread[]>('/api/messages-v2/conversations').then((threads) => {
      if (active) { setDirectMessages(threads.filter((thread) => thread.kind === 'direct')); setDirectMessagesError(false); }
    }).catch(() => { if (active) { setDirectMessages([]); setDirectMessagesError(true); } })
      .finally(() => { if (active) setDirectMessagesLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const term = sidebarQuery.trim();
    if (!term) { setSidebarPeople([]); setSidebarSearchLoading(false); return; }
    let active = true;
    setSidebarSearchLoading(true);
    const timer = window.setTimeout(() => {
      void request<Person[]>(`/api/messages-v2/people?q=${encodeURIComponent(term)}`)
        .then((result) => { if (active) setSidebarPeople(result); })
        .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível buscar pessoas.'); })
        .finally(() => { if (active) setSidebarSearchLoading(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [sidebarQuery]);
  useEffect(() => {
    if (!discoverOpen) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void request<Person[]>(`/api/messages-v2/people${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`)
        .then((result) => { if (active) setPeople(result); })
        .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível buscar pessoas.'); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [discoverOpen, search]);
  async function openDirect(person: Person) {
    const existing=directMessages.find((thread)=>thread.kind==='direct'&&thread.participants.some((participant)=>participant.id===person.id));
    if(existing){setActiveDirectId(existing.id);return;}
    setBusyId(person.id); setError('');
    try {
      const opened = await request<{id:string}>('/api/messages-v2/direct?open=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: person.id }) });
      const thread: Thread = { id:opened.id, kind:'direct', name:person.displayName, description:'', photoUrl:person.avatarUrl, participants:[{...person,role:'member'}], lastMessage:'', lastMessageAt:new Date().toISOString(), unreadCount:0, muted:false, favorite:false, currentRole:'member', matchId:null, createdBy:character.id };
      setDirectMessages((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
      setActiveDirectId(thread.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar a conversa.'); }
    finally { setBusyId(''); }
  }
  async function confirmDeleteConversation() {
    if (!deleteConversationTarget) return;
    setDeleteConversationSaving(true);
    try {
      await request(`/api/messages-v2/conversations/${deleteConversationTarget.id}/preferences`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) });
      setDirectMessages((items) => items.filter((item) => item.id !== deleteConversationTarget.id));
      if (activeDirectId === deleteConversationTarget.id) setActiveDirectId('');
      setDeleteConversationTarget(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível remover a conversa.'); }
    finally { setDeleteConversationSaving(false); }
  }
  function renderDirectMessage(thread: Thread) {
    const person = thread.participants.find((participant) => participant.id !== character.id);
    return <div className={`messages-home-dm-row${activeDirectId===thread.id?' is-active':''}`} key={thread.id}><button type="button" className="messages-home-dm" onClick={() => setActiveDirectId(thread.id)}><Avatar src={person?.avatarUrl} name={person?.displayName??thread.name}/><span><strong>{person?.displayName??thread.name}</strong><small>{thread.lastMessage||'Comece uma conversa'}</small></span>{thread.muted&&<MaterialIcon className="messages-home-dm-muted" name="notifications_off"/>}{thread.unreadCount>0&&<i>{thread.unreadCount}</i>}</button><button type="button" className="messages-home-dm-delete" aria-label={`Apagar conversa com ${person?.displayName??thread.name}`} title="Apagar conversa" onClick={() => setDeleteConversationTarget(thread)}><MaterialIcon name="delete_outline"/></button></div>;
  }
  return <div className="vybe-messages-app messages-home-app">
    <MessageServersRail activeServerId="" communityActive onSelectServer={(serverId) => window.location.assign(`/mensagens?serverId=${encodeURIComponent(serverId)}`)}/>
    <aside className="messages-home-dms" aria-label="Navegação de mensagens">
      <label className="messages-home-sidebar-search"><MaterialIcon name="search"/><input value={sidebarQuery} onChange={(event) => setSidebarQuery(event.currentTarget.value)} placeholder="Encontre ou comece uma conversa" aria-label="Encontre ou comece uma conversa"/><button type="button" aria-label="Limpar busca" onClick={() => setSidebarQuery('')} hidden={!sidebarQuery}><MaterialIcon name="close"/></button></label>
      <nav className="messages-home-shortcuts" aria-label="Atalhos">
        <button className={`messages-home-friends-shortcut${!activeDirectId&&!discoverOpen?' is-active':''}`} type="button" onClick={() => { setActiveDirectId(''); setDiscoverOpen(false); setNewConversationOpen(false); setQuery(''); window.history.replaceState({}, '', '/mensagens?home=1'); }}><MaterialIcon name="group"/><span>Amigos</span></button>
        <button className={`messages-home-find-shortcut${discoverOpen&&!newConversationOpen?' is-active':''}`} type="button" onClick={() => { setActiveDirectId(''); setDiscoverOpen(true); setNewConversationOpen(false); setSearch(sidebarQuery); setError(''); }}><MaterialIcon name="person_search"/><span>Encontrar pessoas</span></button>
      </nav>
      {sidebarQuery.trim() && <section className="messages-home-sidebar-results" aria-label="Resultados da busca">
        <strong>Conversas</strong>
        {filteredDirectMessages.map(renderDirectMessage)}
        <strong>Pessoas</strong>
        {sidebarSearchLoading ? <p>Buscando pessoas…</p> : sidebarPeople.length ? sidebarPeople.map((person) => <article className="messages-home-sidebar-person" key={person.id}><Avatar src={person.avatarUrl} name={person.displayName}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span><a href={`/@${encodeURIComponent(person.username)}`} aria-label={`Ver perfil de ${person.displayName}`} title="Ver perfil"><MaterialIcon name="open_in_new"/></a><button type="button" aria-label={`Enviar mensagem para ${person.displayName}`} title="Enviar mensagem" disabled={busyId===person.id} onClick={()=>void openDirect(person)}><MaterialIcon name="chat_bubble_outline"/></button></article>) : <p>Nenhuma pessoa encontrada.</p>}
      </section>}
      <div className="messages-home-dm-heading"><h2>Mensagens diretas</h2><button type="button" aria-label="Nova conversa" title="Nova conversa" onClick={() => { setActiveDirectId(''); setDiscoverOpen(true); setNewConversationOpen(true); setSearch(''); setSidebarQuery(''); setError(''); }}><MaterialIcon name="add"/></button></div>
      <nav className="messages-home-dm-list" aria-label="Conversas individuais">
        {filteredDirectMessages.map(renderDirectMessage)}
        {directMessagesLoading&&<p className="messages-home-dm-empty-note">Carregando conversas…</p>}
        {directMessagesError&&<div className="messages-home-dm-empty"><p>Não foi possível carregar suas conversas.</p><button type="button" onClick={() => { setDirectMessagesLoading(true); request<Thread[]>('/api/messages-v2/conversations').then((threads)=>{setDirectMessages(threads.filter((thread)=>thread.kind==='direct'));setDirectMessagesError(false);}).catch(()=>setDirectMessagesError(true)).finally(()=>setDirectMessagesLoading(false)); }}>Tentar novamente</button></div>}
        {!directMessagesLoading&&!directMessagesError&&!directMessages.length&&<div className="messages-home-dm-empty"><p>Você ainda não possui conversas. Encontre alguém para começar!</p><button type="button" onClick={() => { setDiscoverOpen(true); setSearch(''); }}>Encontrar pessoas</button></div>}
        {directMessages.length>0&&sidebarQuery.trim()&&!filteredDirectMessages.length&&<p className="messages-home-dm-empty-note">Nenhuma conversa corresponde à busca.</p>}
      </nav>
    </aside>
    <main className={`messages-home-main ${activeDirectId?'has-inline-conversation':''}`}>
      {activeDirectId ? <MessagesApp key={activeDirectId} character={character} community={community} embedded initialConversationId={activeDirectId} onExitEmbedded={()=>setActiveDirectId('')}/> : <>
      <header className="messages-home-topbar"><div><span className="messages-home-mark"><MaterialIcon name="forum"/></span><span><small>VYBE MENSAGENS · {community}</small><strong>Conexões</strong></span></div></header>
      <section className="messages-home-content">
        <div className="messages-home-heading"><div><span>{newConversationOpen?'MENSAGENS DIRETAS':'SEU CÍRCULO'}</span><h1>{newConversationOpen?'Nova conversa':'Amigos'}</h1><p>{newConversationOpen?'Busque uma pessoa da comunidade para iniciar uma conversa privada.':'Encontre seus amigos da comunidade e comece uma conversa.'}</p></div><button type="button" className="messages-home-add" onClick={() => { setDiscoverOpen((value) => !value); setNewConversationOpen(false); setError(''); }}><MaterialIcon name={discoverOpen ? 'close' : 'person_add'}/>{discoverOpen ? 'Fechar busca' : 'Encontrar pessoas'}</button></div>
        {error && <p className="messages-home-error" role="alert">{error}</p>}
        {discoverOpen && <section className="messages-home-discover"><div><strong>{newConversationOpen?'Nova conversa':'Encontrar pessoas'}</strong><small>Encontre alguém da comunidade e inicie uma conversa privada.</small></div><label><MaterialIcon name="search"/><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Buscar pelo nome ou @usuário"/></label>{filteredPeople.length ? <div className="messages-home-people">{filteredPeople.map((person) => <article key={person.id}><Avatar src={person.avatarUrl} name={person.displayName}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span><a href={`/@${encodeURIComponent(person.username)}`} aria-label={`Ver perfil de ${person.displayName}`} title="Ver perfil"><MaterialIcon name="open_in_new"/></a><button type="button" title={`Iniciar conversa com ${person.displayName}`} aria-label={`Iniciar conversa com ${person.displayName}`} disabled={busyId===person.id} onClick={()=>void openDirect(person)}><MaterialIcon name="chat_bubble_outline"/></button></article>)}</div> : <p className="messages-home-empty-note">{search ? 'Nenhuma pessoa encontrada nesta comunidade.' : 'Busque pelo nome ou @usuário para encontrar pessoas.'}</p>}</section>}
        <div className="messages-home-toolbar"><div><button type="button" className={!query ? 'active' : ''} onClick={() => setQuery('')}>Todos <span>{friends.length}</span></button><label><MaterialIcon name="search"/><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Buscar membros"/></label></div><span>Membros de {community}</span></div>
        <nav className="messages-home-presence-tabs" aria-label="Filtrar amigos por presença"><button type="button" className={friendsTab === 'online' ? 'is-active' : ''} onClick={() => setFriendsTab('online')}>Online <span>{onlineFriendsCount}</span></button><button type="button" className={friendsTab === 'offline' ? 'is-active' : ''} onClick={() => setFriendsTab('offline')}>Offline <span>{offlineFriendsCount}</span></button></nav>
        {loading ? <div className="messages-home-loading">Carregando membros da comunidade…</div> : visibleFriends.length ? <section className="messages-home-friend-list" aria-label={`Membros ${friendsTab === 'online' ? 'online' : 'offline'} da comunidade`}>{visibleFriends.map((person) => <button type="button" className="messages-home-friend" key={person.id} aria-label={`Conversar com ${person.displayName}`} disabled={busyId===person.id} onClick={()=>void openDirect(person)}><Avatar src={person.avatarUrl} name={person.displayName}/><span className={`messages-home-presence-dot ${person.online ? 'is-online' : ''}`} aria-label={person.online ? 'Online' : 'Offline'} title={person.online ? 'Online' : 'Offline'}/><span className="messages-home-friend-copy"><strong>{person.displayName}</strong><small>@{person.username}</small></span><span className="messages-home-chat"><MaterialIcon name="chat_bubble_outline"/>{busyId===person.id?'Abrindo…':'Conversar'}</span></button>)}</section> : <section className="messages-home-empty"><span><MaterialIcon name={query ? 'search_off' : 'group'}/></span><h2>{query ? `Nenhum membro ${friendsTab === 'online' ? 'online' : 'offline'} encontrado` : friendsTab === 'online' ? 'Ninguém online agora' : 'Nenhum membro offline'}</h2><p>{query ? 'Tente buscar usando outro nome ou usuário.' : 'A lista é atualizada conforme os membros entram ou saem da plataforma.'}</p></section>}
      </section>
      </>}
    </main>
    {deleteConversationTarget&&<div className="messages-dialog-backdrop messages-confirm-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!deleteConversationSaving)setDeleteConversationTarget(null);}}><section className="messages-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="messages-delete-conversation-title"><span className="messages-confirm-icon"><MaterialIcon name="delete_outline"/></span><small>MENSAGENS DIRETAS</small><h2 id="messages-delete-conversation-title">Você realmente deseja fazer isto?</h2><p>A conversa com {deleteConversationTarget.participants.find((person)=>person.id!==character.id)?.displayName??deleteConversationTarget.name} será removida da sua lista. O histórico da outra pessoa será preservado.</p><footer><button type="button" className="messages-confirm-cancel" disabled={deleteConversationSaving} onClick={()=>setDeleteConversationTarget(null)}>Cancelar</button><button type="button" className="messages-confirm-delete" disabled={deleteConversationSaving} onClick={()=>void confirmDeleteConversation()}>{deleteConversationSaving?'Removendo…':'Apagar conversa'}</button></footer></section></div>}
  </div>;
}

export function MessagesApp({ character, community, embedded = false, initialConversationId, onExitEmbedded }: { character: SocialCharacter; community: string; embedded?: boolean; initialConversationId?: string; onExitEmbedded?: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [friends, setFriends] = useState<Person[]>([]);
  const [friendsQuery, setFriendsQuery] = useState('');
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesForId, setMessagesForId] = useState('');
  const [selectedId, setSelectedId] = useState(initialConversationId ?? params.get('conversation') ?? '');
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [selected, setSelected] = useState<Thread | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all'|'unread'|'groups'|'favorites'|'archived'|'closed'>(params.get('tab')==='groups'?'groups':'all');
  const [threadContextMenu, setThreadContextMenu] = useState<{thread:Thread;x:number;y:number}|null>(null);
  const [threadActionBusy, setThreadActionBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [attachment, setAttachment] = useState<{ dataUrl: string; name: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialog, setDialog] = useState<'new'|'group'|'members'|null>(null);
  const [editGroupOpen, setEditGroupOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage|null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ kind: 'message' | 'profile'; id: string; label: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportSaving, setReportSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupPhoto, setGroupPhoto] = useState<{dataUrl:string;name:string}|null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDescription, setEditGroupDescription] = useState('');
  const [editGroupPhoto, setEditGroupPhoto] = useState<{dataUrl:string;name:string}|null>(null);
  const [removeGroupPhoto, setRemoveGroupPhoto] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobileList, setMobileList] = useState(() => embedded ? false : !params.get('conversation'));
  const [messageIdentity, setMessageIdentity] = useState<MessagesIdentity>({ ...character, statusMessage: '' });
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const pendingMessagesRef = useRef(new Map<string, string>());
  const typingTimerRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const typingConversationRef = useRef('');
  const lastTypingSentRef = useRef(0);
  const { captureSelection, insertEmoji } = useEmojiInsertion(draftRef, draft, setDraft);
  const ownId = character.id;
  async function loadThreads(scope: 'active'|'archived'|'closed' = filter === 'archived' ? 'archived' : filter === 'closed' ? 'closed' : 'active') { const result = await request<unknown>(`/api/messages-v2/conversations${scope==='archived'?'?archived=1':scope==='closed'?'?closed=1':''}`); if (!Array.isArray(result)) throw new Error('Não foi possível carregar a lista de conversas.'); const conversations = result as Thread[]; setThreads(conversations); const current = conversations.find((item) => item.id === selectedId); if (current) setSelected(current); }
  async function loadChat(id: string) { const result = await request<{conversation?: Thread; messages?: ChatMessage[]}>(`/api/messages-v2/conversations/${id}`); if (!result?.conversation || !Array.isArray(result.messages)) throw new Error('Não foi possível abrir esta conversa.'); const messages=await Promise.all(result.messages.map(async(message)=>{const invite=legacyServerInviteUrl(message);if(!invite)return message;try{const preview=await request<{server:{id:string;name:string;description:string;iconUrl:string;bannerUrl?:string}}>(`/api/messages-v2/servers/${encodeURIComponent(invite.serverId)}/invite-preview/${encodeURIComponent(invite.token)}`);return {...message,messageType:'server_invite' as const,content:`Convite para ${preview.server.name}`,serverInvite:{serverId:invite.serverId,name:preview.server.name,description:preview.server.description||'Um espaço para conversar e compartilhar.',imageUrl:preview.server.bannerUrl||preview.server.iconUrl,inviteUrl:`/mensagens?serverId=${encodeURIComponent(invite.serverId)}&invite=${encodeURIComponent(invite.token)}`}};}catch{return message;}})); if (selectedIdRef.current !== id) return; setSelected(result.conversation); setMessagesForId(id); setMessages((current)=>[...messages,...current.filter((message)=>pendingMessagesRef.current.get(message.id)===id)]); }
  function publishTyping(typing: boolean) { if(!selectedId&&!typingConversationRef.current)return;if(!typing&&!typingActiveRef.current)return;const targetId=typing?selectedId:typingConversationRef.current||selectedId;typingActiveRef.current=typing;if(typing){lastTypingSentRef.current=Date.now();typingConversationRef.current=targetId;}else typingConversationRef.current='';void request(`/api/messages-v2/conversations/${targetId}/typing`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({typing})}).catch(()=>undefined); }
  useEffect(() => { void request<{identity:MessagesIdentity}>('/api/messages-v2/profile').then((result)=>setMessageIdentity(result.identity)).catch(()=>undefined); if(params.get('new')==='1'){setDialog('new');void loadPeople();} }, []);
  useEffect(() => { void loadThreads(filter==='archived'?'archived':filter==='closed'?'closed':'active').catch((reason)=>setError(reason.message)); }, [filter]);
  useEffect(()=>{if(!threadContextMenu)return;const dismiss=(event:PointerEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('.messages-thread-context-menu'))setThreadContextMenu(null);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setThreadContextMenu(null);};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};},[threadContextMenu]);
  useEffect(() => {
    let active = true;
    Promise.all([
      request<Person[]>(`/api/characters/${encodeURIComponent(character.username)}/following`),
      request<Person[]>(`/api/characters/${encodeURIComponent(character.username)}/followers`),
    ]).then(([following, followers]) => {
      if (!active) return;
      const followerIds = new Set(followers.map((person) => person.id));
      setFriends(following.filter((person) => followerIds.has(person.id)));
    }).catch(() => { if (active) setFriends([]); });
    return () => { active = false; };
  }, [character.username]);
  useEffect(() => {
    setMessages([]);
    setMessagesForId('');
    setReply(null);
    if (!selectedId) { setSelected(null); return; }
    void loadChat(selectedId).catch((reason) => {
      if (selectedIdRef.current === selectedId) setError(reason.message);
    });
  }, [selectedId]);
  const directPerson = selected?.kind==='direct' ? selected.participants.find((person)=>person.id!==ownId) : undefined;
  useEffect(() => connectConversationRealtime((event) => {
    if (event.type === 'call:offer' && event.conversationId && event.profileId && event.callId) {
      sendConversationRealtime({ type: 'call:unavailable', conversationId: event.conversationId, targetProfileId: event.profileId, callId: event.callId });
      return;
    }
    if (event.type === 'ready') {
      void loadThreads().catch(() => undefined);
      if (selectedIdRef.current) void loadChat(selectedIdRef.current).catch(() => undefined);
      return;
    }
    if (event.conversationId) {
      if (event.type === 'message:new' && event.messageId) {
        const currentConversationIsOpen = event.conversationId === selectedIdRef.current && document.visibilityState === 'visible' && document.hasFocus();
        if (!currentConversationIsOpen) soundManager.play('message', event.messageId);
      }
      void loadThreads().catch(() => undefined);
      if (event.conversationId === selectedIdRef.current) void loadChat(event.conversationId).catch(() => undefined);
    }
  }), []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);
  useEffect(() => { if(!selectedId)return;if(typingTimerRef.current!==null)window.clearTimeout(typingTimerRef.current);if(!draft.trim()){publishTyping(false);return;}if(!typingActiveRef.current||Date.now()-lastTypingSentRef.current>1800)publishTyping(true);typingTimerRef.current=window.setTimeout(()=>publishTyping(false),2600);return()=>{if(typingTimerRef.current!==null)window.clearTimeout(typingTimerRef.current);}; }, [draft,selectedId]);
  async function loadPeople(q = '') { try { const result=await request<unknown>(`/api/messages-v2/people${q ? `?q=${encodeURIComponent(q)}` : ''}`); if (!Array.isArray(result)) throw new Error('Não foi possível carregar as pessoas da comunidade.'); setPeople(result as Person[]); return result as Person[]; } catch (reason) { setPeople([]); setError((reason as Error).message); return []; } }
  const filtered = useMemo(() => threads.filter((item) => {
    if (filter === 'archived') { if (!item.archived) return false; }
    else if (filter === 'closed') { if (!item.closed) return false; }
    else if (item.archived || item.closed) return false;
    if (filter === 'groups') { if (item.kind !== 'group') return false; }
    else if (!['archived','closed'].includes(filter) && item.kind !== 'direct') return false;
    if (filter === 'unread' && !item.unreadCount) return false;
    if (filter === 'favorites' && !item.favorite) return false;
    return `${item.name} ${item.participants.map((person) => person.displayName).join(' ')} ${item.lastMessage}`.toLowerCase().includes(query.toLowerCase());
  }).sort((left,right)=>Number(right.favorite)-Number(left.favorite)||new Date(right.lastMessageAt).getTime()-new Date(left.lastMessageAt).getTime()), [threads, filter, query]);
  const groupParticipantIds = new Set(selected?.kind === 'group' ? selected.participants.map((person) => person.id) : []);
  const visibleFriends = friends.filter((person) => (!selected || selected.kind !== 'group' || groupParticipantIds.has(person.id)) && `${person.displayName} ${person.username}`.toLowerCase().includes(friendsQuery.trim().toLowerCase()));
  function selectThread(thread: Thread) { setSelectedId(thread.id); setSelected(thread); setMobileList(false); if (!embedded) window.history.replaceState({}, '', `/mensagens/privadas?conversation=${thread.id}`); }
  async function startDirect(person: Person) { setBusy(true); try { const thread = await request<Thread>('/api/messages-v2/direct', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({profileId:person.id}) }); await loadThreads(); selectThread(thread); setDialog(null); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  useEffect(() => { const username=params.get('to')?.replace(/^@/,'').toLowerCase(); if (!username) return; void loadPeople(username).then((results)=>{const person=results.find((item)=>item.username.toLowerCase()===username); if(person) void startDirect(person); else setError('Pessoa não encontrada nesta comunidade.');}).catch((reason)=>setError((reason as Error).message)); }, []);
  async function createGroup(event: FormEvent) { event.preventDefault(); setBusy(true); try { const thread = await request<Thread>('/api/messages-v2/groups', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:groupName, description:groupDescription, memberIds:selectedPeople, photo:groupPhoto}) }); await loadThreads(); selectThread(thread); setDialog(null); setGroupName(''); setGroupDescription(''); setGroupPhoto(null); setSelectedPeople([]); } catch(reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  async function readGroupPhoto(file?: File) { if (!file) return; if (file.size>5*1024*1024) {setError('A foto deve ter até 5 MB.');return;} const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));reader.readAsDataURL(file);}); setGroupPhoto({dataUrl,name:file.name}); }
  function stopRecording() {
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Este navegador não permite gravar áudio.'); return; }
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const preferredType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onerror = () => { setError('Não foi possível gravar o áudio.'); setRecording(false); stream.getTracks().forEach((track) => track.stop()); };
      recorder.onstop = () => {
        const mimeType = (recorder.mimeType || 'audio/webm').split(';')[0].toLowerCase();
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        recordingChunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (!blob.size) { setError('A gravação ficou vazia. Tente novamente.'); return; }
        if (blob.size > 5 * 1024 * 1024) { setError('O áudio deve ter até 5 MB. Grave uma mensagem mais curta.'); return; }
        const extension = mimeType === 'audio/ogg' ? 'ogg' : mimeType === 'audio/mp4' ? 'm4a' : 'webm';
        const reader = new FileReader();
        reader.onload = () => setAttachment({ dataUrl: String(reader.result), name: `mensagem-de-audio.${extension}` });
        reader.onerror = () => setError('Não foi possível preparar o áudio para envio.');
        reader.readAsDataURL(blob);
      };
      recorder.start();
      setAttachment(null);
      setRecording(true);
      recordingTimeoutRef.current = window.setTimeout(stopRecording, 120_000);
    } catch (reason) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setError(reason instanceof Error && reason.name === 'NotAllowedError' ? 'Permita o acesso ao microfone para gravar.' : 'Não foi possível acessar o microfone.');
    }
  }
  useEffect(() => () => {
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  async function send(event: FormEvent) { event.preventDefault(); if (!selectedId || (!draft.trim() && !attachment) || recording) return; const targetId=selectedId;const originalDraft=draft;const originalAttachment=attachment;const originalReply=reply;const uniqueId=typeof crypto.randomUUID==='function'?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;const pendingId=`pending:${uniqueId}`;pendingMessagesRef.current.set(pendingId,targetId);const content=originalDraft.trim();const mimeType=originalAttachment?.dataUrl.match(/^data:([^;]+);base64,/)?.[1]??'application/octet-stream';const size=originalAttachment?Math.floor((originalAttachment.dataUrl.split(',')[1]?.length??0)*3/4):0;const optimistic:ChatMessage={id:pendingId,senderProfileId:ownId,own:true,content,messageType:originalAttachment?(mimeType.startsWith('audio/')?'audio':mimeType.startsWith('image/')?'image':'file'):'text',attachment:originalAttachment?{url:originalAttachment.dataUrl,name:originalAttachment.name,mimeType,size}:null,replyToMessageId:originalReply?.id??null,reply:originalReply,favorite:false,favoriteCount:0,deleted:false,createdAt:new Date().toISOString()};setMessagesForId(targetId);setMessages((items)=>[...items,optimistic]);setDraft('');setAttachment(null);setReply(null);setBusy(true);try{const saved=await request<ChatMessage>(`/api/messages-v2/conversations/${targetId}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:originalDraft,attachment:originalAttachment,replyToMessageId:originalReply?.id})});pendingMessagesRef.current.delete(pendingId);if(selectedIdRef.current===targetId)setMessages((items)=>items.map((item)=>item.id===pendingId?saved:item));void loadThreads().catch((reason)=>setError((reason as Error).message));}catch(reason){pendingMessagesRef.current.delete(pendingId);if(selectedIdRef.current===targetId){setMessages((items)=>items.filter((item)=>item.id!==pendingId));setDraft(originalDraft);setAttachment(originalAttachment);setReply(originalReply);setError((reason as Error).message);}}finally{setBusy(false);} }
  async function chooseFile(file?: File) { if (!file) return; if (file.size > 5*1024*1024) { setError('O arquivo deve ter até 5 MB.'); return; } const dataUrl = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); reader.readAsDataURL(file); }); setAttachment({dataUrl,name:file.name}); }
  async function toggleFavorite(message: ChatMessage) { try { await request(`/api/messages-v2/conversations/${selectedId}/messages/${message.id}/favorite`, {method:'POST'}); await loadChat(selectedId); } catch(reason) { setError((reason as Error).message); } }
  function deleteMessage(message:ChatMessage){if(message.senderProfileId===ownId)setDeleteTarget(message);}
  async function confirmDeleteMessage(){if(!selected||!deleteTarget)return;setDeleteSaving(true);try{const updated=await request<ChatMessage>(`/api/messages-v2/conversations/${selected.id}/messages/${deleteTarget.id}`,{method:'DELETE'});setMessages((items)=>items.map((item)=>item.id===deleteTarget.id?updated:item));setDeleteTarget(null);void loadThreads();}catch(reason){setError((reason as Error).message);setDeleteTarget(null);}finally{setDeleteSaving(false);}}
  async function toggleMute() { if (!selected) return; try { await request(`/api/messages-v2/conversations/${selected.id}/preferences`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({muted:!selected.muted})}); await loadThreads(); } catch(reason) { setError((reason as Error).message); } }
  async function toggleThreadFavorite() { if (!selected) return; try { await request(`/api/messages-v2/conversations/${selected.id}/preferences`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:!selected.favorite})}); await loadThreads(); } catch(reason) { setError((reason as Error).message); } }
  async function closeThread(thread:Thread){setThreadContextMenu(null);setThreadActionBusy(true);try{await request(`/api/messages-v2/conversations/${thread.id}/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({closed:!thread.closed})});if(!thread.closed&&selectedId===thread.id){setSelectedId('');setSelected(null);setMessages([]);setReply(null);if(!embedded){setMobileList(true);window.history.replaceState({},'','/mensagens/privadas');}}await loadThreads(filter==='archived'?'archived':filter==='closed'?'closed':'active');}catch(reason){setError((reason as Error).message);}finally{setThreadActionBusy(false);}}
  async function archiveThread(thread:Thread){setThreadActionBusy(true);try{await request(`/api/messages-v2/conversations/${thread.id}/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:!thread.archived})});setThreadContextMenu(null);if(selectedId===thread.id){setSelectedId('');setSelected(null);setMessages([]);if(!embedded)setMobileList(true);}await loadThreads(filter==='archived'?'archived':filter==='closed'?'closed':'active');}catch(reason){setError((reason as Error).message);}finally{setThreadActionBusy(false);}}
  async function pinThread(thread:Thread){setThreadActionBusy(true);try{await request(`/api/messages-v2/conversations/${thread.id}/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:!thread.favorite})});setThreadContextMenu(null);await loadThreads(filter==='archived'?'archived':filter==='closed'?'closed':'active');}catch(reason){setError((reason as Error).message);}finally{setThreadActionBusy(false);}}
  async function addGroupMembers() { if (!selected||!selectedPeople.length) return; try { await request(`/api/messages-v2/conversations/${selected.id}/participants`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileIds:selectedPeople})}); await loadChat(selected.id); await loadThreads(); setSelectedPeople([]); setDialog(null); } catch(reason) { setError((reason as Error).message); } }
  async function manageGroupMember(person:Person,action:'admin'|'member'|'remove') { if(!selected)return; try { await request(`/api/messages-v2/groups/${selected.id}/participants/${person.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}); await loadChat(selected.id); await loadThreads(); } catch(reason) { setError((reason as Error).message); } }
  function editGroup() { if(!selected||selected.kind!=='group')return;setError('');setEditGroupName(selected.name);setEditGroupDescription(selected.description);setEditGroupPhoto(null);setRemoveGroupPhoto(false);setEditGroupOpen(true); }
  async function saveGroup(event:FormEvent<HTMLFormElement>) { event.preventDefault();if(!selected||selected.kind!=='group')return;setBusy(true);try{await request(`/api/messages-v2/groups/${selected.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:editGroupName,description:editGroupDescription,...(editGroupPhoto?{photo:editGroupPhoto}:removeGroupPhoto?{photo:null}:{})})});await loadChat(selected.id);await loadThreads();setEditGroupOpen(false);}catch(reason){setError((reason as Error).message);}finally{setBusy(false);} }
  async function blockOrLeave() { if (!selected) return; setBusy(true); try { await request(`/api/messages-v2/conversations/${selected.id}/${selected.kind==='group'?'leave':selected.blockedByMe?'unblock':'block'}`,{method:'POST'}); setConfirmAction(false); if(selected.kind==='direct'){await loadChat(selected.id);await loadThreads();}else{setSelectedId('');setSelected(null);setMessages([]);setMobileList(true);window.history.replaceState({},'','/mensagens/privadas');await loadThreads();} } catch(reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  function openReport(kind: 'message' | 'profile', id: string, label: string) { setReportReason(''); setReportTarget({ kind, id, label }); }
  async function submitReport(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!reportTarget || reportReason.trim().length < 3) return; setReportSaving(true); try { await request('/api/community-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: reportTarget.kind === 'message' ? 'direct_message' : 'profile', targetId: reportTarget.id, reason: reportReason.trim() }) }); setReportTarget(null); setReportReason(''); setError('Denúncia enviada à administração da comunidade.'); } catch (cause) { setError((cause as Error).message); } finally { setReportSaving(false); } }
  const activeMessages = messagesForId === selectedId ? messages : [];
  const shared = activeMessages.filter((message)=>Boolean(message.attachment?.url));
  if (window.location.pathname === '/mensagens/perfil') return <MessagesProfilePage character={character} community={community}/>;
  return <div className={`vybe-messages-app ${embedded?'messages-app-embedded':''}`}>
    {!embedded&&<MessageServersRail activeServerId="" communityActive={false} privateActive onSelectServer={(serverId)=>window.location.assign(`/mensagens?serverId=${encodeURIComponent(serverId)}`)}/>}
    {!embedded&&<MessagesSidebar community={community} active={filter==='groups'?'groups':'conversations'} onGroups={()=>setFilter('groups')} onNew={()=>{setDialog('new');void loadPeople();}}/>}
    {!embedded&&    <aside className={`messages-list-pane ${mobileList?'mobile-visible':''}`}><header className="messages-list-heading"><div><h1>{filter==='groups'?'Grupos':filter==='archived'?'Arquivadas':filter==='closed'?'Fechadas':'Mensagens diretas'}</h1><HelpHeaderLink/><button type="button" aria-label="Nova conversa" onClick={()=>{setDialog('new');void loadPeople();}}><MaterialIcon name="edit_square"/></button></div><label className="messages-search"><MaterialIcon name="search"/><input value={query} onChange={(event)=>setQuery(event.currentTarget.value)} placeholder="Pesquisar mensagens diretas..."/></label><div className="messages-filters">{([['all','Diretas'],['unread','Não lidas'],['groups','Grupos'],['favorites','Fixadas'],['archived','Arquivadas'],['closed','Fechadas']] as const).map(([key,label])=><button type="button" className={filter===key?'active':''} key={key} onClick={()=>setFilter(key)}>{label}{key==='unread'&&threads.some((x)=>x.kind==='direct'&&x.unreadCount>0)&&<i>{threads.filter((x)=>x.kind==='direct').reduce((n,x)=>n+x.unreadCount,0)}</i>}</button>)}</div><button type="button" className={`messages-friends-shortcut ${friendsOpen?'active':''}`} onClick={()=>{setFriendsOpen((open)=>!open);setPanelOpen(false);}}><MaterialIcon name="group"/>Amigos</button></header><div className="messages-thread-list">{filtered.map((thread)=>{const person=thread.kind==='direct'?thread.participants.find((p)=>p.id!==ownId):null;return <button type="button" key={thread.id} className={`messages-thread ${selectedId===thread.id?'selected':''}`} onClick={()=>selectThread(thread)} onContextMenu={(event)=>{event.preventDefault();setThreadContextMenu({thread,x:Math.max(8,Math.min(event.clientX,window.innerWidth-220)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-150))});}}><Avatar src={thread.kind==='group'?thread.photoUrl:person?.avatarUrl} name={thread.name}/><span className="messages-thread-copy"><strong>{thread.name}</strong><small>{thread.lastMessage||'Comece uma conversa'}</small></span><span className="messages-thread-meta"><small>{when(thread.lastMessageAt)}</small>{thread.unreadCount>0&&<i>{thread.unreadCount}</i>}{thread.favorite&&<MaterialIcon name="push_pin" title="Conversa fixada"/>}{thread.muted&&<MaterialIcon name="notifications_off"/>}</span></button>;})}{threadContextMenu&&<div className="messages-thread-context-menu" role="menu" style={{left:threadContextMenu.x,top:threadContextMenu.y}}><button type="button" role="menuitem" onClick={()=>closeThread(threadContextMenu.thread)}><MaterialIcon name={threadContextMenu.thread.closed?'open_in_new':'close'}/>{threadContextMenu.thread.closed?'Reabrir conversa':'Fechar conversa'}</button><button type="button" role="menuitem" disabled={threadActionBusy} onClick={()=>void archiveThread(threadContextMenu.thread)}><MaterialIcon name={threadContextMenu.thread.archived?'unarchive':'archive'}/>{threadContextMenu.thread.archived?'Desarquivar':'Arquivar'}</button><button type="button" role="menuitem" disabled={threadActionBusy} onClick={()=>void pinThread(threadContextMenu.thread)}><MaterialIcon name={threadContextMenu.thread.favorite?'keep_off':'push_pin'}/>{threadContextMenu.thread.favorite?'Desafixar':'Fixar'}</button></div>}{filtered.length===0&&<div className="messages-empty-list">{filter==='groups'?'Você ainda não participa de nenhum grupo.':filter==='archived'?'Você não tem conversas arquivadas.':filter==='closed'?'Você não tem conversas fechadas.':'Suas conversas aparecerão aqui.'}<button type="button" onClick={()=>{setDialog(filter==='groups'?'group':'new');void loadPeople();}}>{filter==='groups'?'Criar grupo':'Nova conversa'}</button></div>}</div><button className="messages-create-group" type="button" onClick={()=>{setDialog('group');void loadPeople();}}><MaterialIcon name="group_add"/>Criar grupo</button></aside>}
    <section className={`messages-chat-pane ${!mobileList&&selected?'mobile-visible':''}`}>{selected?<><header className="messages-chat-header">{embedded&&<button className="messages-embedded-back" type="button" onClick={onExitEmbedded} aria-label="Voltar aos amigos"><MaterialIcon name="arrow_back"/></button>}{!embedded&&<button className="messages-back-mobile" type="button" onClick={()=>setMobileList(true)} aria-label="Voltar"><MaterialIcon name="arrow_back"/></button>}<Avatar src={selected.photoUrl} name={selected.name}/><div><strong>{selected.name}</strong><small className={selected.typing?'messages-typing-indicator':''}>{selected.typing?'digitando…':selected.kind==='group'?`${selected.participants.length+1} participantes`:'Conversa da comunidade'}</small></div></header><div className="messages-chat-body" ref={listRef}>{activeMessages.map((message)=>{const sender=message.own ?? (message.senderProfileId.trim().toLowerCase()===ownId.trim().toLowerCase());const person=selected.participants.find((item)=>item.id===message.senderProfileId);return <article className={`messages-bubble-row ${sender?'own':''}`} key={message.id}>{!sender&&selected.kind==='group'&&<Avatar src={person?.avatarUrl} name={person?.displayName??'Membro'}/>}<div className={`messages-bubble ${sender?'sent':''}`}>{!sender&&selected.kind==='group'&&<strong>{person?.displayName}</strong>}{message.reply&&<button className="messages-reply-reference" type="button" onClick={()=>document.getElementById(`message-${message.replyToMessageId}`)?.scrollIntoView({behavior:'smooth',block:'center'})}><b>Resposta a {message.reply.senderProfileId===ownId?'você':selected.participants.find((p)=>p.id===message.reply?.senderProfileId)?.displayName}</b><span>{message.reply.content||message.reply.attachment?.name}</span></button>}{message.serverInvite&&<div className="messages-server-invite-card"><div className="messages-server-invite-image" style={message.serverInvite.imageUrl?{backgroundImage:`linear-gradient(0deg,#153c3455,#153c3408),url(\"${message.serverInvite.imageUrl}\")`}:undefined}>{!message.serverInvite.imageUrl&&<MaterialIcon name="forum"/>}</div><div className="messages-server-invite-copy"><small>CONVITE PARA SERVIDOR</small><strong>{message.serverInvite.name}</strong><p>{message.serverInvite.description||'Um espaço para conversar e compartilhar.'}</p><a href={message.serverInvite.inviteUrl}>Entrar no servidor <MaterialIcon name="arrow_forward"/></a></div></div>}{message.attachment?.url&&(message.messageType==='audio'?<div className="messages-audio-attachment"><audio controls preload="metadata" src={message.attachment.url}/><small>{message.attachment.name}</small></div>:message.messageType==='image'?<a href={message.attachment.url} target="_blank" rel="noreferrer" className="messages-image-attachment"><img src={message.attachment.url} alt={message.attachment.name}/></a>:<a href={message.attachment.url} download={message.attachment.name} className="messages-file-attachment"><MaterialIcon name="description"/><span><b>{message.attachment.name}</b><small>{((message.attachment.size ?? 0)/1024).toFixed(0)} KB · {attachmentKind(message.attachment.mimeType)}</small></span><MaterialIcon name="download"/></a>)}{!message.serverInvite&&typeof message.content==="string"&&message.content&&<FormattedText text={message.content}/>}<footer><small>{new Date(message.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small>{sender&&selected.kind==='direct'&&<small className={`messages-read-status ${message.readAt?'is-read':''}`} title={message.readAt?'Mensagem lida':'Mensagem enviada'}>{message.readAt?'✓✓':'✓'}</small>}<button type="button" aria-label="Responder" title="Responder" onClick={()=>setReply(message)}><MaterialIcon name="reply"/></button><button type="button" aria-label="Favoritar mensagem" title="Favoritar" className={message.favorite?'is-favorite':''} onClick={()=>void toggleFavorite(message)}><MaterialIcon name="star" filled={message.favorite}/></button>{sender&&!message.deleted&&!message.id.startsWith('pending:')&&Date.now()-new Date(message.createdAt).getTime()<=300000&&<button type="button" aria-label="Apagar mensagem para todos" title="Apagar para todos (até 5 minutos)" onClick={()=>void deleteMessage(message)}><MaterialIcon name="delete_outline"/></button>}{!sender&&!message.deleted&&!message.id.startsWith('pending:')&&<button type="button" aria-label="Denunciar mensagem" title="Denunciar mensagem" onClick={()=>openReport('message',message.id,'esta mensagem')}><MaterialIcon name="flag"/></button>}</footer></div></article>;})}{messages.length===0&&<div className="messages-empty-chat"><MaterialIcon name="waving_hand"/><p>Comece uma conversa com {selected.name}.</p></div>}</div>{selected.blockedByMe ? <div className="messages-blocked-notice"><MaterialIcon name="block"/><div><strong>Você bloqueou {selected.name}</strong><p>Este contato não pode enviar mensagens para você.</p></div></div> : selected.blockedByThem ? <div className="messages-blocked-notice is-received"><MaterialIcon name="block"/><div><strong>Contato bloqueou você</strong><p>Não é possível enviar mensagens nesta conversa.</p></div></div> : <form className="messages-composer" onSubmit={(event)=>void send(event)}>{reply&&<div className="messages-reply-draft"><span><b>Respondendo</b><small>{reply.content||reply.attachment?.name}</small></span><button type="button" onClick={()=>setReply(null)} aria-label="Cancelar resposta"><MaterialIcon name="close"/></button></div>}{attachment&&<div className="messages-attachment-preview"><MaterialIcon name={attachment.dataUrl.startsWith('data:image/')?'image':attachment.dataUrl.startsWith('data:audio/')?'mic':'description'}/>{attachment.name}{attachment.dataUrl.startsWith('data:audio/')&&<audio controls preload="metadata" src={attachment.dataUrl}/>}<button type="button" onClick={()=>setAttachment(null)} aria-label="Remover anexo"><MaterialIcon name="close"/></button></div>}{recording&&<div className="messages-recording-state"><span className="messages-recording-pulse"/>Gravando áudio…<button type="button" onClick={stopRecording}>Parar gravação</button></div>}<div className="messages-composer-row">{selected.kind==='direct'&&<button type="button" className={recording?'is-recording':''} aria-label={recording?'Parar gravação de áudio':'Gravar mensagem de áudio'} title={recording?'Parar gravação':'Gravar áudio'} disabled={busy} onClick={recording?stopRecording:()=>void startRecording()}><MaterialIcon name={recording?'stop':'mic'}/></button>}<button type="button" aria-label="Anexar imagem, áudio ou arquivo" onClick={()=>fileRef.current?.click()}><MaterialIcon name="attach_file"/></button><input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,.m4a,.mp3,.ogg,.wav,.webm,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" onChange={(event)=>void chooseFile(event.currentTarget.files?.[0])}/><TextFormattingEditor ref={draftRef} value={draft} onChange={setDraft} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} maxLength={4000} placeholder="Escreva uma mensagem..."/><EmojiButton label="Inserir emoji" onBeforeOpen={captureSelection} onSelect={insertEmoji}/><button type="submit" aria-label="Enviar mensagem" disabled={busy||recording||(!draft.trim()&&!attachment)}><MaterialIcon name="send"/></button></div></form>}</>:<div className="messages-start-empty"><MaterialIcon name="forum"/><h2>Suas conversas</h2><p>Escolha uma conversa ou comece uma nova com alguém da comunidade.</p><button type="button" onClick={()=>{setDialog('new');void loadPeople();}}>Nova conversa</button></div>}</section>
    {friendsOpen&&<aside className="messages-details messages-friends-panel is-open"><button className="messages-details-close" type="button" aria-label="Fechar amigos" onClick={()=>setFriendsOpen(false)}><MaterialIcon name="close"/></button><header className="messages-friends-heading"><span><MaterialIcon name="group"/></span><div><h2>{selected?.kind==='group'?'Amigos do grupo':'Amigos'}</h2><small>{visibleFriends.length} {visibleFriends.length===1?'amigo':'amigos'}</small></div></header><label className="messages-search"><MaterialIcon name="search"/><input value={friendsQuery} onChange={(event)=>setFriendsQuery(event.currentTarget.value)} placeholder="Buscar amigos"/></label><div className="messages-friends-list">{visibleFriends.map((person)=><button type="button" key={person.id} onClick={()=>{setFriendsOpen(false);void startDirect(person);}}><Avatar src={person.avatarUrl} name={person.displayName}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span><MaterialIcon name="chat_bubble"/></button>)}{visibleFriends.length===0&&<div className="messages-friends-empty"><MaterialIcon name="group_off"/><strong>{selected?.kind==='group'?'Nenhum amigo neste grupo':'Nenhum amigo encontrado'}</strong><small>{friends.length===0?'Amigos são pessoas que também seguem você.':'Tente buscar outro nome.'}</small></div>}</div></aside>}
    {selected&&panelOpen&&<aside className={`messages-details ${panelOpen ? "is-open" : ""}`}><button className="messages-details-close" type="button" aria-label="Fechar detalhes" onClick={()=>setPanelOpen(false)}><MaterialIcon name="close"/></button><div className="messages-details-cover"/><Avatar src={selected.photoUrl} name={selected.name} large/><h2>{selected.name}</h2>{directPerson?<><small>@{directPerson.username}</small><p>{directPerson.bio}</p><button type="button" className="messages-block-action" onClick={()=>openReport('profile',directPerson.id,`o perfil de ${directPerson.displayName}`)}><MaterialIcon name="flag"/>Denunciar perfil</button></>:<p>{selected.description||'Grupo da comunidade.'}</p>}<div className="messages-details-actions"><button type="button" onClick={()=>void toggleThreadFavorite()}><MaterialIcon name="star" filled={selected.favorite}/> {selected.favorite?'Remover dos favoritos':'Favoritar conversa'}</button><button type="button" onClick={()=>void toggleMute()}><MaterialIcon name={selected.muted?'notifications_active':'notifications_off'}/>{selected.muted?'Ativar notificações':'Silenciar conversa'}</button>{selected.kind==='group'&&selected.currentRole==='admin'&&<><button type="button" onClick={()=>{setDialog('members');void loadPeople();}}><MaterialIcon name="group_add"/>Adicionar participantes</button><button type="button" onClick={()=>void editGroup()}><MaterialIcon name="edit"/>Editar grupo</button></>}</div><section><header><b>Mídia compartilhada</b><span>{shared.filter((x)=>x.messageType==='image').length}</span></header><div className="messages-media-grid">{shared.filter((x)=>x.messageType==='image').slice(-4).map((item)=><a href={item.attachment!.url} key={item.id} target="_blank" rel="noreferrer"><img src={item.attachment!.url} alt={item.attachment!.name}/></a>)}{shared.filter((x)=>x.messageType==='image').length===0&&<small>Nenhuma mídia compartilhada.</small>}</div></section><section className="messages-detail-links"><button type="button" onClick={()=>document.querySelector('.messages-chat-body')?.scrollTo({top:0,behavior:'smooth'})}><MaterialIcon name="description"/>Arquivos <span>{shared.filter((x)=>x.messageType==='file').length}</span></button><button type="button" onClick={()=>document.querySelector('.messages-chat-body')?.scrollTo({top:0,behavior:'smooth'})}><MaterialIcon name="link"/>Links <span>{messages.filter((x)=>/https?:\/\//.test(x.content)).length}</span></button><button type="button" onClick={()=>document.querySelector('.messages-chat-body')?.scrollTo({top:0,behavior:'smooth'})}><MaterialIcon name="star"/>Mensagens favoritas <span>{messages.filter((x)=>x.favorite).length}</span></button></section>{selected.kind==='group'&&<section className="messages-group-members"><header><b>Participantes</b><span>{selected.participants.length+1}</span></header><div><Avatar src={messageIdentity.avatarUrl} name={messageIdentity.displayName}/><span>{messageIdentity.displayName}<small>Você · {selected.currentRole==='admin'?'Administrador':'Membro'}</small></span></div>{selected.participants.map((person)=><div key={person.id}><Avatar src={person.avatarUrl} name={person.displayName}/><span>{person.displayName}<small>@{person.username} · {person.role==='admin'?'Admin':'Membro'}</small></span>{selected.currentRole==='admin'&&<span className="messages-member-actions">{person.role!=='admin'&&<button type="button" onClick={()=>void manageGroupMember(person,'admin')}>Promover</button>}{person.role==='admin'&&person.id!==selected.createdBy&&<button type="button" onClick={()=>void manageGroupMember(person,'member')}>Retirar admin</button>}<button type="button" onClick={()=>void manageGroupMember(person,'remove')}>Remover</button></span>}</div>)}</section>}<button className={`messages-block-action ${selected.blockedByMe ? 'is-unblock' : ''}`} type="button" onClick={()=>setConfirmAction(true)}><MaterialIcon name={selected.kind==='group'?'logout':'block'}/>{selected.kind==='group'?'Sair do grupo':selected.blockedByMe?'Desbloquear contato':'Bloquear contato'}</button></aside>}
    {dialog&&<div className="messages-dialog-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDialog(null);}}><section className="messages-dialog"><button className="messages-dialog-close" type="button" onClick={()=>setDialog(null)} aria-label="Fechar"><MaterialIcon name="close"/></button><span>{dialog==='group'?'NOVO GRUPO':dialog==='members'?'PARTICIPANTES':'NOVA CONVERSA'}</span><h2>{dialog==='group'?'Criar grupo':dialog==='members'?'Adicionar participantes':'Pessoas da comunidade'}</h2><label className="messages-search"><MaterialIcon name="search"/><input value={peopleQuery} onChange={(event)=>{setPeopleQuery(event.currentTarget.value);void loadPeople(event.currentTarget.value);}} placeholder="Buscar por nome ou @usuário"/></label>{dialog==='group'&&<form id="messages-create-group-form" onSubmit={(event)=>void createGroup(event)}><input className="messages-dialog-field" value={groupName} onChange={(event)=>setGroupName(event.currentTarget.value)} placeholder="Nome do grupo" required minLength={2} maxLength={80}/><textarea className="messages-dialog-field" value={groupDescription} onChange={(event)=>setGroupDescription(event.currentTarget.value)} placeholder="Descrição (opcional)" maxLength={500}/><label className="messages-group-photo">{groupPhoto?<img src={groupPhoto.dataUrl} alt="Prévia da foto do grupo"/>:<MaterialIcon name="add_photo_alternate"/>}<span>{groupPhoto?.name??'Adicionar foto do grupo'}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event)=>void readGroupPhoto(event.currentTarget.files?.[0])}/></label><p>Selecione pelo menos uma pessoa além de você.</p></form>}<div className="messages-people-results">{people.map((person)=><button type="button" key={person.id} onClick={()=>dialog==='new'?void startDirect(person):setSelectedPeople((ids)=>ids.includes(person.id)?ids.filter((id)=>id!==person.id):[...ids,person.id])}><Avatar src={person.avatarUrl} name={person.displayName}/><span><b>{person.displayName}</b><small>@{person.username}</small></span>{dialog!=='new'&&<i className={selectedPeople.includes(person.id)?'checked':''}>{selectedPeople.includes(person.id)?'✓':''}</i>}</button>)}</div>{dialog==='group'&&<button className="messages-primary-button" type="submit" form="messages-create-group-form" disabled={busy||!groupName.trim()||selectedPeople.length===0}>{busy?'Criando…':'Criar grupo'}</button>}{dialog==='members'&&<button className="messages-primary-button" type="button" disabled={busy||selectedPeople.length===0} onClick={()=>void addGroupMembers()}>{busy?'Adicionando…':'Adicionar selecionados'}</button>}</section></div>}
    {editGroupOpen&&selected?.kind==='group'&&<div className="messages-dialog-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!busy)setEditGroupOpen(false);}}><form className="messages-dialog messages-edit-group-dialog" onSubmit={(event)=>void saveGroup(event)}><button className="messages-dialog-close" type="button" onClick={()=>setEditGroupOpen(false)} aria-label="Fechar"><MaterialIcon name="close"/></button><span>CONFIGURAÇÕES DO GRUPO</span><h2>Editar grupo</h2><ProfilePhotoEditor value={editGroupPhoto?.dataUrl||(removeGroupPhoto?'':selected.photoUrl)} onChange={(dataUrl)=>{setEditGroupPhoto({dataUrl,name:'Foto do grupo'});setRemoveGroupPhoto(false);}} onError={setError}/>{selected.photoUrl&&<button className="messages-group-remove-photo" type="button" onClick={()=>{setEditGroupPhoto(null);setRemoveGroupPhoto(true);}}>Remover foto do grupo</button>}<label className="messages-edit-group-field">Nome do grupo<input className="messages-dialog-field" value={editGroupName} onChange={(event)=>setEditGroupName(event.currentTarget.value)} required minLength={2} maxLength={80}/></label><label className="messages-edit-group-field">Descrição<textarea className="messages-dialog-field" value={editGroupDescription} onChange={(event)=>setEditGroupDescription(event.currentTarget.value)} maxLength={500}/></label>{error&&<p className="messages-dialog-error" role="alert">{error}</p>}<button className="messages-primary-button" type="submit" disabled={busy||!editGroupName.trim()}>{busy?'Salvando…':'Salvar alterações'}</button></form></div>}
    {confirmAction&&selected&&<div className="messages-dialog-backdrop messages-confirm-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!busy)setConfirmAction(false);}}><section className="messages-confirm-dialog messages-block-confirm" role="alertdialog" aria-modal="true" aria-labelledby="messages-block-title"><span className="messages-confirm-icon"><MaterialIcon name={selected.kind==='group'?'logout':'block'}/></span><small>{selected.kind==='group'?'GRUPO':'PRIVACIDADE'}</small><h2 id="messages-block-title">{selected.kind==='group'?'Sair deste grupo?':selected.blockedByMe?`Desbloquear ${selected.name}?`:`Bloquear ${selected.name}?`}</h2><p>{selected.kind==='group'?'Você deixará de receber mensagens deste grupo.':selected.blockedByMe?'O contato poderá voltar a enviar e receber mensagens nesta conversa.':'Esta pessoa não poderá enviar mensagens para você. A conversa ficará marcada como bloqueada.'}</p><footer><button type="button" className="messages-confirm-cancel" disabled={busy} onClick={()=>setConfirmAction(false)}>Cancelar</button><button type="button" className={selected.kind==='direct'&&selected.blockedByMe?'messages-confirm-unblock':'messages-confirm-delete'} disabled={busy} onClick={()=>void blockOrLeave()}>{busy?(selected.kind==='group'?'Saindo…':selected.blockedByMe?'Desbloqueando…':'Bloqueando…'):selected.kind==='group'?'Sair do grupo':selected.blockedByMe?'Desbloquear contato':'Bloquear contato'}</button></footer></section></div>}
    {reportTarget&&<div className="messages-dialog-backdrop messages-report-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!reportSaving)setReportTarget(null);}}><form className="messages-report-dialog" role="dialog" aria-modal="true" aria-labelledby="messages-report-title" onSubmit={(event)=>void submitReport(event)}><button className="messages-dialog-close" type="button" aria-label="Fechar" disabled={reportSaving} onClick={()=>setReportTarget(null)}><MaterialIcon name="close"/></button><span className="messages-report-mark"><MaterialIcon name="flag"/></span><small>SEGURANÇA DA COMUNIDADE</small><h2 id="messages-report-title">Denunciar {reportTarget.kind==='message'?'mensagem':'perfil'}</h2><p>Conte à administração por que {reportTarget.label} pode estar violando as regras da comunidade.</p><label htmlFor="messages-report-reason">Motivo da denúncia</label><textarea id="messages-report-reason" value={reportReason} onChange={(event)=>setReportReason(event.currentTarget.value)} minLength={3} maxLength={500} placeholder="Descreva o que aconteceu..." required autoFocus/><small className="messages-report-hint">De 3 a 500 caracteres. A denúncia será analisada pela administração.</small><footer><button type="button" className="messages-confirm-cancel" disabled={reportSaving} onClick={()=>setReportTarget(null)}>Cancelar</button><button type="submit" className="messages-report-submit" disabled={reportSaving||reportReason.trim().length<3}>{reportSaving?'Enviando…':'Enviar denúncia'}</button></footer></form></div>}
    {deleteTarget&&<div className="messages-dialog-backdrop messages-confirm-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!deleteSaving)setDeleteTarget(null);}}><section className="messages-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="messages-delete-title" aria-describedby="messages-delete-copy"><span className="messages-confirm-icon"><MaterialIcon name="delete_outline"/></span><small>APAGAR MENSAGEM</small><h2 id="messages-delete-title">Apagar para todos?</h2><p id="messages-delete-copy">A mensagem será removida da conversa para todos os participantes. Essa ação só está disponível nos primeiros 5 minutos.</p><footer><button type="button" className="messages-confirm-cancel" disabled={deleteSaving} onClick={()=>setDeleteTarget(null)}>Cancelar</button><button type="button" className="messages-confirm-delete" disabled={deleteSaving} onClick={()=>void confirmDeleteMessage()}>{deleteSaving?'Apagando…':'Apagar mensagem'}</button></footer></section></div>}
    {error&&<div className="messages-toast" role="alert"><span>{error}</span><button type="button" onClick={()=>setError('')}><MaterialIcon name="close"/></button></div>}
  </div>;
}
