import { useEffect, useState, type FormEvent } from 'react';
import { MaterialIcon } from './MaterialIcon';
import { notifySnack } from './SnackMessage';
import { UniverseBackLink } from './UniverseBackLink';
import { VybeLogo } from './VybeLogo';
import './EventsPage.css';

type Character = { id: string; username: string; displayName: string; communityFunction?: string; bio?: string; avatarUrl: string };
type CommunityEvent = {
  id: string; title: string; description: string; startsAt: string; endsAt?: string; location: string; imageUrl: string;
  category?: string; participantLimit?: number | null; allowComments?: boolean; status: string; statusLabel: string;
  official: boolean; rejectedReason: string; cancellationReason: string; confirmedCount: number; going: boolean; rsvpStatus?: 'going'|'maybe'|'not_going'|'cancelled'|null;
  canManage: boolean; canEdit: boolean; creator: Character | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    const message = body?.error ?? 'Não foi possível concluir a solicitação.';
    notifySnack(message);
    throw new Error(message);
  }
  return body as T;
}

function Avatar({ character, className = '' }: { character: Character; className?: string }) {
  const initial = character.displayName.slice(0, 1).toUpperCase();
  return <span className={`social-avatar ${className}`}><span className="events-avatar-fallback" style={{ display: character.avatarUrl ? 'none' : 'grid' }}>{initial}</span>{character.avatarUrl&&<img src={character.avatarUrl} alt="" onLoad={(event)=>{event.currentTarget.previousElementSibling instanceof HTMLElement&&(event.currentTarget.previousElementSibling.style.display='none');}} onError={(event)=>{event.currentTarget.style.display='none';event.currentTarget.previousElementSibling instanceof HTMLElement&&(event.currentTarget.previousElementSibling.style.display='grid');}}/>}</span>;
}

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Falha ao ler imagem.'));
    reader.onerror = () => reject(new Error('Falha ao ler imagem.'));
    reader.readAsDataURL(file);
  });
}

function weekStart(date: Date) { const value = new Date(date); value.setHours(0,0,0,0); value.setDate(value.getDate() - (value.getDay() + 6) % 7); return value; }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }

export function EventsPage({ eventId, community = 'Sua comunidade', section = 'home' }: { eventId?: string; community?: string; section?: 'home' | 'calendar' }) {
  const [view, setView] = useState('upcoming');
  const [calendarMode, setCalendarMode] = useState<'week'|'month'|'list'>(section === 'calendar' ? 'week' : 'list');
  const [anchor, setAnchor] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [selected, setSelected] = useState<CommunityEvent | null>(null);
  const [participants, setParticipants] = useState<Character[]>([]);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CommunityEvent | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CommunityEvent | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      if (eventId) {
        const event = await request<CommunityEvent>('/api/events/' + eventId);
        setSelected(event);
        setEvents([event]);
      } else {
        const start = calendarMode === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : weekStart(anchor);
        const end = calendarMode === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth()+1, 1) : new Date(start.getTime()+7*86400000);
        const params = new URLSearchParams({ view, ...(view === 'upcoming' && calendarMode !== 'list' ? { from: start.toISOString(), to: end.toISOString() } : {}) });
        const result = await request<CommunityEvent[]>('/api/events?' + params.toString());
        setEvents(result);
        setSelected((current) => current ? result.find((item) => item.id === current.id) ?? result[0] ?? null : result[0] ?? null);
      }
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os eventos.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [view, eventId, calendarMode, anchor]);

  async function togglePresence(event: CommunityEvent, status: 'going'|'maybe'|'not_going'|'cancelled' = event.going ? 'cancelled' : 'going') {
    try {
      const result = await request<{ going: boolean; status: CommunityEvent['rsvpStatus']; confirmedCount: number }>('/api/events/' + event.id + '/rsvp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const updated = { ...event, going: result.going, rsvpStatus: result.status, confirmedCount: result.confirmedCount };
      setEvents((items) => items.map((item) => item.id === event.id ? updated : item));
      setSelected((item) => item?.id === event.id ? updated : item);
    } catch { /* A notificação da API descreve o erro. */ }
  }

  async function openParticipants(event: CommunityEvent) {
    try { setParticipants(await request<Character[]>('/api/events/' + event.id + '/participants')); setSelected(event); setParticipantsOpen(true); }
    catch { setParticipants([]); }
  }

  async function deleteEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await request<CommunityEvent | { deleted: boolean }>('/api/events/' + cancelTarget.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: cancelReason.trim() }) });
      setEvents((items) => items.filter((item) => item.id !== cancelTarget.id));
      setSelected((item) => item?.id === cancelTarget.id ? null : item);
      setCancelTarget(null);
      setCancelReason('');
      if (eventId) window.location.assign('/eventos');
    } catch { /* A notificação da API descreve o erro. */ }
    finally { setCancelling(false); }
  }

  function card(event: CommunityEvent) {
    const date = new Date(event.startsAt);
    const publicStatus = event.status === 'approved' || event.status === 'upcoming';
    return <article className="event-social-card" key={event.id}>
      {event.imageUrl && <a className="event-social-cover" href={'/eventos/' + event.id} style={{ backgroundImage: 'url("' + event.imageUrl + '")' }} aria-label={'Ver evento ' + event.title}/>}
      <div className="event-social-card-body"><time className="event-date-badge"><strong>{date.getDate().toString().padStart(2, '0')}</strong><span>{date.toLocaleString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase()}</span></time><div className="event-social-main"><div className="event-social-title-row"><a href={'/eventos/' + event.id}><h2>{event.title}</h2></a>{event.official && <span className="event-official-badge">Evento oficial</span>}{!publicStatus && <span className={'event-status-pill is-' + event.status}>{event.statusLabel}</span>}</div><p>{event.description}</p><small>{event.location} · {date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small><button className="event-participants-link" type="button" onClick={() => void openParticipants(event)}><MaterialIcon name="groups"/>{event.confirmedCount} {event.confirmedCount === 1 ? 'confirmado' : 'confirmados'}</button>{event.status === 'rejected' && event.rejectedReason && <p className="event-review-reason">Motivo: {event.rejectedReason}</p>}</div><div className="event-card-actions">{publicStatus && <><button type="button" className={event.going ? 'is-going' : 'primary-button'} onClick={() => void togglePresence(event)}>{event.going ? '✓ Você confirmou presença' : 'Confirmar presença'}</button>{event.going && <button type="button" className="event-cancel-rsvp" onClick={() => void togglePresence(event)}>Cancelar presença</button>}</>}{event.canEdit && <><button type="button" className="event-cancel-rsvp" onClick={() => setEditing(event)}>Editar evento</button>{!(['cancelled','completed'].includes(event.status)) && <button type="button" className="event-cancel-rsvp" onClick={() => { setCancelTarget(event); setCancelReason(''); }}>Excluir evento</button>}</>}</div></div>
    </article>;
  }

  const startOfWeek = weekStart(anchor);
  const monthFirstWeek = weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const days = calendarMode === 'month'
    ? Array.from({length:42},(_,index)=>new Date(monthFirstWeek.getFullYear(),monthFirstWeek.getMonth(),monthFirstWeek.getDate()+index))
    : Array.from({length:7},(_,index)=>new Date(startOfWeek.getFullYear(),startOfWeek.getMonth(),startOfWeek.getDate()+index));
  const hours = Array.from({length:11},(_,index)=>index+8);
  const headingDate = calendarMode==='month' ? anchor.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}) : `${days[0].toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})} – ${days[6].toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}`;
  const selectedStatus = selected?.rsvpStatus;
  const upcomingEvents = events.filter((event)=>new Date(event.startsAt).getTime()>=Date.now()&&['approved','upcoming'].includes(event.status)).slice(0,4);
  return <div className="vybe-events-app">
    <aside className="events-sidebar"><a href="/eventos" className="events-brand"><VybeLogo variant="symbol"/><span><strong>VYBE</strong><small>Eventos</small></span></a><div className="events-community"><MaterialIcon name="groups"/><span><strong>{community}</strong><small>Comunidade atual</small></span></div><nav><a href="/eventos" className={section==='home'?'active':''}><MaterialIcon name="home"/>Início</a><a href="/eventos/calendario" className={section==='calendar'?'active':''}><MaterialIcon name="calendar_month"/>Calendário</a><button type="button" className={view==='mine'?'active':''} onClick={()=>{setView('mine');setCalendarMode('list')}}><MaterialIcon name="bookmark"/>Meus eventos</button><button type="button" onClick={()=>setCreateOpen(true)}><MaterialIcon name="add_box"/>Criar evento</button></nav><UniverseBackLink className="events-universe-back"/></aside>
    <main className="events-main"><header className="events-heading"><div><h1>Eventos</h1><p>Acompanhe os próximos eventos da comunidade e participe!</p></div><label><MaterialIcon name="search"/><input placeholder="Buscar eventos..." value={query} onChange={(event)=>setQuery(event.currentTarget.value)}/></label><select className="events-filter-button" aria-label="Filtrar eventos" value={view} onChange={(event)=>setView(event.currentTarget.value)}><option value="upcoming">Todos</option><option value="mine">Meus eventos</option><option value="going">Só vou participar</option><option value="past">Passados</option></select><button className="events-mobile-create" type="button" onClick={()=>setCreateOpen(true)}><MaterialIcon name="add"/></button></header>
      {section === 'calendar' && <div className="events-calendar-toolbar"><>{calendarMode!=='list'&&<><button type="button" aria-label="Anterior" onClick={()=>setAnchor(new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()-(calendarMode==='month'?30:7)))}><MaterialIcon name="chevron_left"/></button><button type="button" aria-label="Próximo" onClick={()=>setAnchor(new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()+(calendarMode==='month'?30:7)))}><MaterialIcon name="chevron_right"/></button><button className="events-today" type="button" onClick={()=>setAnchor(new Date())}>Hoje</button></> }<strong>{calendarMode==='list'?'Todos os próximos eventos':headingDate}</strong></><div className="events-view-switch">{(['week','month','list'] as const).map((mode)=><button type="button" className={calendarMode===mode?'active':''} key={mode} onClick={()=>setCalendarMode(mode)}>{mode==='week'?'Semana':mode==='month'?'Mês':'Lista'}</button>)}</div></div>}
      {error&&<p className="inline-error">{error}</p>}{loading?<div className="blank-state">Carregando calendário…</div>:calendarMode==='list'?<div className="events-list">{events.filter((item)=>item.title.toLowerCase().includes(query.toLowerCase())).map(card)}{!events.length&&<div className="blank-state">Ainda não há eventos neste período.</div>}</div>:calendarMode==='month'?<div className="events-month-grid"><div className="events-month-head">{['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(day=><b key={day}>{day}</b>)}</div>{days.map((day)=>{const items=events.filter((event)=>dateKey(new Date(event.startsAt))===dateKey(day)&&event.title.toLowerCase().includes(query.toLowerCase()));return <div className={'events-month-day '+(day.getMonth()!==anchor.getMonth()?'outside':'')} key={dateKey(day)}><span>{day.getDate()}</span>{items.map((event)=><button className={'category-'+(event.category??'outro')} key={event.id} type="button" onClick={()=>setSelected(event)}>{event.title}</button>)}</div>})}</div>:<div className="events-week-grid"><div className="events-week-header"><span/>{days.map((day)=><div key={dateKey(day)}><small>{day.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','')}</small><b className={dateKey(day)===dateKey(new Date())?'today':''}>{String(day.getDate()).padStart(2,'0')}</b></div>)}</div><div className="events-time-grid"><div className="events-time-labels">{hours.map((hour)=><span key={hour}>{String(hour).padStart(2,'0')}:00</span>)}</div><div className="events-day-columns">{days.map((day)=><div className="events-day-column" key={dateKey(day)}>{hours.map((hour)=><i key={hour}/>)}{events.filter((event)=>dateKey(new Date(event.startsAt))===dateKey(day)&&event.title.toLowerCase().includes(query.toLowerCase())).map((event)=>{const start=new Date(event.startsAt);const end=event.endsAt?new Date(event.endsAt):null;const top=((start.getHours()-8)*60+start.getMinutes())/660*100;const height=Math.max(6,end?(end.getTime()-start.getTime())/60000/660*100:7.5);return <button className={'events-time-card category-'+(event.category??'outro')} style={{top:`${top}%`,height:`${height}%`}} key={event.id} type="button" onClick={()=>setSelected(event)}><strong>{event.title}</strong><small>{start.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}{end&&` – ${end.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`}</small><small>{event.location}</small></button>})}</div>)}</div></div></div>}
      <section className="events-upcoming"><h2>Próximos eventos</h2><div>{upcomingEvents.map((event)=><button type="button" className="events-upcoming-card" key={event.id} onClick={()=>setSelected(event)}><time><b>{new Date(event.startsAt).getDate().toString().padStart(2,'0')}</b><small>{new Date(event.startsAt).toLocaleString('pt-BR',{month:'short'}).replace('.','').toUpperCase()}</small></time><span><strong>{event.title}</strong><small>{new Date(event.startsAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} · {event.location}</small><small>{event.going?'Confirmado':event.statusLabel}</small></span></button>)}{upcomingEvents.length===0&&<p>Ainda não há eventos neste período.</p>}</div></section>
      {createOpen&&<CreateEventModal onClose={()=>setCreateOpen(false)} onCreated={()=>{setCreateOpen(false);setView('mine');setCalendarMode('list');void load();}}/>}{editing&&<CreateEventModal event={editing} onClose={()=>setEditing(null)} onCreated={()=>{setEditing(null);void load();}}/>}
      {cancelTarget&&<div className="composer-modal-backdrop events-delete-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!cancelling)setCancelTarget(null);}}><form className="events-delete-modal" role="dialog" aria-modal="true" aria-labelledby="events-delete-title" onSubmit={(event)=>void deleteEvent(event)}><button className="events-delete-close" type="button" aria-label="Fechar" onClick={()=>setCancelTarget(null)}><MaterialIcon name="close"/></button><div className="events-delete-heading"><span><MaterialIcon name="delete_outline"/></span><div><small>GERENCIAR EVENTO</small><h2 id="events-delete-title">Excluir evento?</h2></div></div><p>Deseja excluir <strong>{cancelTarget.title}</strong>?{['approved','upcoming'].includes(cancelTarget.status)?' O evento sairá do calendário e as pessoas confirmadas serão notificadas.':' Ele também será removido da fila de aprovação.'}</p><label><span>Motivo <small>(opcional)</small></span><textarea value={cancelReason} onChange={(event)=>setCancelReason(event.target.value)} maxLength={500} placeholder="Se quiser, informe o motivo da exclusão."/></label><footer><button type="button" className="events-delete-keep" onClick={()=>setCancelTarget(null)}>Manter evento</button><button type="submit" className="events-delete-confirm" disabled={cancelling}><MaterialIcon name="delete_outline"/>{cancelling?'Excluindo…':'Excluir evento'}</button></footer></form></div>}
      {participantsOpen&&<div className="composer-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setParticipantsOpen(false);}}><section className="event-participants-modal"><button className="modal-x" type="button" onClick={()=>setParticipantsOpen(false)}><MaterialIcon name="close"/></button><h2>{selected?.confirmedCount??participants.length} participantes</h2>{participants.map((person)=><a href={'/@'+person.username} key={person.id}><Avatar character={person}/><span>{person.displayName}<small>@{person.username}</small></span></a>)}</section></div>}
      {organizerOpen&&selected?.creator&&<div className="composer-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setOrganizerOpen(false);}}><section className="event-organizer-modal" role="dialog" aria-modal="true" aria-labelledby="event-organizer-title"><button className="modal-x" type="button" aria-label="Fechar" onClick={()=>setOrganizerOpen(false)}><MaterialIcon name="close"/></button><Avatar className="event-organizer-avatar" character={selected.creator}/><span className="event-organizer-kicker">ORGANIZADOR DO EVENTO</span><h2 id="event-organizer-title">{selected.creator.displayName}</h2><p className="event-organizer-username">@{selected.creator.username}</p><div className="event-organizer-function"><MaterialIcon name="verified_user"/><span><small>Função na comunidade</small><strong>{selected.creator.communityFunction?.trim()||'Função não informada'}</strong></span></div>{selected.creator.bio&&<p className="event-organizer-bio">{selected.creator.bio}</p>}</section></div>}
    </main>
    {selected&&<aside className="events-details"><header><button type="button" onClick={()=>setSelected(null)}><MaterialIcon name="arrow_back"/></button><strong>Detalhes do evento</strong><span/></header>{selected.imageUrl?<img className="events-detail-cover" src={selected.imageUrl} alt=""/>:<div className="events-detail-cover events-detail-placeholder"><MaterialIcon name="event"/></div>}<h2>{selected.title}</h2><p className="events-detail-date">{new Date(selected.startsAt).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})} · {new Date(selected.startsAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}{selected.endsAt&&` – ${new Date(selected.endsAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`}</p><p>{selected.location}</p><span className="events-detail-status">{selected.going?'Você confirmou sua presença':selected.rsvpStatus==='maybe'?'Você está em dúvida':selected.rsvpStatus==='not_going'?'Você informou que não vai':'Evento da comunidade'}</span><p className="events-detail-description">{selected.description}</p><section><h3>Organizador</h3>{selected.creator&&<button className="events-organizer" type="button" onClick={()=>setOrganizerOpen(true)}><Avatar character={selected.creator}/><span>{selected.creator.displayName}<small>{selected.creator.communityFunction?.trim()||'Ver função e identificação'}</small></span><MaterialIcon name="chevron_right"/></button>}</section><section><h3>Participantes ({selected.confirmedCount}) <button type="button" onClick={()=>void openParticipants(selected)}>Ver todos</button></h3><button className="events-participant-count" type="button" onClick={()=>void openParticipants(selected)}><MaterialIcon name="groups"/> {selected.confirmedCount} participantes</button></section>{['approved','upcoming'].includes(selected.status)&&<section className="events-rsvp"><h3>Sua presença</h3><div>{(['going','maybe','not_going'] as const).map((status)=><button className={selectedStatus===status?'active':''} type="button" key={status} onClick={()=>void togglePresence(selected,status)}>{status==='going'?'Vou':status==='maybe'?'Em dúvida':'Não vou'}</button>)}</div></section>}{selected.canEdit&&<><button className="events-edit-button" type="button" onClick={()=>setEditing(selected)}>Editar evento</button>{!(['cancelled','completed'].includes(selected.status))&&<button className="event-cancel-rsvp events-detail-delete" type="button" onClick={()=>{setCancelTarget(selected);setCancelReason('')}}>Excluir evento</button>}</>}</aside>}
  </div>;
}

export function EventsAdminPage({ community = 'Sua comunidade' }: { community?: string }) {
  const [items,setItems]=useState<CommunityEvent[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  async function load(){setLoading(true);try{setItems(await request<CommunityEvent[]>('/api/events/manage'));setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível carregar as solicitações.');}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  async function decide(event:CommunityEvent,decision:'approve'|'reject'|'request_changes'){
    const reason=decision==='approve'?'':window.prompt(decision==='reject'?'Motivo da recusa':'Quais alterações são necessárias?');
    if(decision!=='approve'&&!reason?.trim())return;
    try{await request(`/api/events/${event.id}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,reason,official:decision==='approve'&&window.confirm('Marcar como evento oficial da comunidade?')})});await load();}catch{/* O aviso da API apresenta o motivo. */}
  }
  const pending=items.filter((event)=>['pending_approval','changes_requested'].includes(event.status));
  return <div className="events-admin-page"><header><a href="/configuracoes">← Configurações da comunidade</a><span>PAINEL DA COMUNIDADE</span><h1>Solicitações de eventos</h1><p>{community} · revise sugestões antes de publicá-las no calendário.</p></header>{error&&<p className="inline-error">{error}</p>}{loading?<p>Carregando solicitações…</p>:pending.length?pending.map((event)=><article key={event.id}><div><small>{event.statusLabel}</small><h2>{event.title}</h2><p>{event.description}</p><p>{new Date(event.startsAt).toLocaleString('pt-BR')} · {event.location}</p><span>Enviado por {event.creator?.displayName??'Membro da comunidade'}</span></div><footer><button type="button" onClick={()=>void decide(event,'request_changes')}>Solicitar ajustes</button><button type="button" onClick={()=>void decide(event,'reject')}>Recusar</button><button type="button" className="primary-button" onClick={()=>void decide(event,'approve')}>Aprovar e publicar</button></footer></article>):<div className="blank-state">Nenhuma solicitação pendente.</div>}</div>;
}

function CreateEventModal({ onClose, onCreated, event }: { onClose: () => void; onCreated: () => void; event?: CommunityEvent }) {
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setSaving(true); setError(''); const form = new FormData(formEvent.currentTarget);
    try {
      const date=String(form.get('date')); const startsAt=new Date(date+'T'+String(form.get('time'))); const endsAt=new Date(date+'T'+String(form.get('endTime')));
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) { setError('Confira a data e os horários. O término precisa ser depois do início.'); return; }
      const payload = { title: form.get('title'), description: form.get('description'), location: form.get('location'), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), category: form.get('category'), participantLimit: form.get('limit'), allowComments: form.get('allowComments') === 'on', official: form.get('official') === 'on', image }; await request(event ? '/api/events/' + event.id : '/api/events', { method: event ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      onCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o evento.'); }
    finally { setSaving(false); }
  }
  return <div className="composer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><form className="event-create-modal" onSubmit={(event) => void submit(event)}><button type="button" className="modal-x" onClick={onClose} aria-label="Fechar"><MaterialIcon name="close"/></button><span>AGENDA DA COMUNIDADE</span><h2>{event ? 'Editar evento' : 'Criar evento'}</h2>{!event && <p className="event-approval-note">Membros podem enviar eventos para avaliação. A equipe administrativa aprova antes da publicação no calendário.</p>}<label>Título *<input name="title" defaultValue={event?.title} required minLength={3} maxLength={120}/></label><label>Descrição *<textarea name="description" defaultValue={event?.description} required minLength={10} maxLength={3000}/></label><div className="event-form-row"><label>Data *<input type="date" name="date" defaultValue={event ? new Date(new Date(event.startsAt).getTime() - new Date(event.startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ""} required/></label><label>Início *<input type="time" name="time" defaultValue={event ? new Date(event.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""} required/></label></div><div className="event-form-row"><label>Término *<input type="time" name="endTime" defaultValue={event?.endsAt ? new Date(event.endsAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : ''} required/></label><label>Local *<input name="location" defaultValue={event?.location} required maxLength={160}/></label></div><div className="event-form-row"><label>Categoria<select name="category" defaultValue={event?.category ?? "reuniao"}><option value="reuniao">Reunião</option><option value="treinamento">Treinamento</option><option value="academico">Aula</option><option value="plantao">Plantão</option><option value="social">Social</option><option value="festa">Festa</option><option value="competicao">Competição</option><option value="outro">Outro</option></select></label><label>Limite de participantes<input type="number" name="limit" min={1} max={10000} defaultValue={event?.participantLimit ?? ""} placeholder="Sem limite"/></label></div><label>Imagem de capa<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; if (file.size > 3 * 1024 * 1024) { event.currentTarget.value = ''; setError('A capa deve ter no máximo 3 MB.'); return; } void readImage(file).then(setImage).catch(() => setError('Não foi possível carregar a imagem.')); }}/></label><label className="event-check-label"><input type="checkbox" name="allowComments" defaultChecked={event?.allowComments ?? true}/>Permitir comentários no evento</label>{error && <p className="inline-error">{error}</p>}<button className="primary-button" disabled={saving} type="submit">{saving ? 'Salvando…' : event ? 'Salvar alterações' : 'Enviar para aprovação'}</button></form></div>;
}
