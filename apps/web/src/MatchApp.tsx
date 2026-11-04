import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import type { SocialCharacter } from './SocialApp';
import { MaterialIcon } from './MaterialIcon';
import { isHexNameColor, ProfileNameColorPicker } from './ProfileNameColorPicker';
import { notifySnack } from './SnackMessage';
import { UniverseBackLink } from './UniverseBackLink';
import { HelpHeaderLink } from './HelpHeaderLink';
import { VybeLogo } from './VybeLogo';
import { connectConversationRealtime } from './conversationRealtime';
import { soundManager } from './soundManager';
import { getVybeFont } from '@vybe/shared';
import { loadVybeGoogleFont, ProfileFontPicker, ProfileFontText } from './ProfileFontPicker';
import './MatchApp.css';

type MatchProfileData = { enabled: boolean; age: number | null; bio: string; location: string; interests: string[]; photos: string[] };
type MatchIdentity = Pick<SocialCharacter, 'id' | 'username' | 'displayName' | 'bio' | 'avatarUrl' | 'verified' | 'profileCustomization'>;
type MatchCardData = MatchIdentity & { age: number; bio: string; location: string; interests: string[]; photos: string[] };
type MatchSummary = { id: string; profile: MatchCardData; latestMessage: { content: string; createdAt: string; own: boolean } | null; unreadCount: number; createdAt: string };

function MatchIdentityAvatar({ identity, src, className = '' }: { identity: MatchIdentity; src?: string; className?: string }) {
  const customization = identity.verified ? identity.profileCustomization : undefined;
  const frame = customization?.avatarFrame ?? 'NONE';
  const frameStyle = isHexNameColor(frame) ? { outline: `3px solid ${frame}`, outlineOffset: '2px' } : undefined;
  return <MatchAvatar src={src ?? identity.avatarUrl} label={identity.displayName} style={frameStyle} className={`${className} ${frame !== 'NONE' && !isHexNameColor(frame) ? `match-frame-${frame.toLowerCase()}` : ''}`.trim()}/>;
}

function MatchIdentityName({ identity, text }: { identity: MatchIdentity; text?: string }) {
  const customization = identity.verified ? identity.profileCustomization : undefined;
  const color = customization?.nameColor ?? 'DEFAULT';
  const font = getVybeFont(customization?.primaryFontId ?? customization?.nameFont ?? customization?.fontId);
  useEffect(() => { if (identity.verified && font) loadVybeGoogleFont(font.id); }, [identity.verified, font?.id]);
  return <strong style={{ ...(isHexNameColor(color) ? { color } : {}), ...(font ? { fontFamily: `"${font.family}", var(--vybe-profile-font, sans-serif)` } : {}) }} className={`match-name-color-${identity.verified && !isHexNameColor(color) ? color.toLowerCase() : 'default'}`}>{text ?? identity.displayName}{identity.verified && <span className="match-verified-badge" aria-label="Conta verificada" title="Conta verificada">✓</span>}</strong>;
}
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

function MatchAvatar({ src, label, className = '', style }: { src?: string; label: string; className?: string; style?: CSSProperties }) {
  return <span style={style} className={`match-avatar ${className}`}>{src ? <img src={src} alt={label}/> : <span>{label.slice(0, 1).toUpperCase()}</span>}</span>;
}

const matchAvatarFrames = [
  { id: 'NONE', label: 'Sem moldura', color: 'transparent' },
  { id: 'TEAL', label: 'Teal', color: '#4d9285' },
  { id: 'CORAL', label: 'Coral', color: '#d77a70' },
  { id: 'LILAC', label: 'Lilás', color: '#8d86c9' },
  { id: 'GOLD', label: 'Dourada', color: '#c5a46d' },
  { id: 'VYBE', label: 'Gradiente VYBE+', color: 'linear-gradient(135deg,#246b6e,#67b59a,#c5a46d)' },
];

function matchCardFrameStyle(frame: string): CSSProperties | undefined {
  const normalized = frame.toUpperCase();
  if (normalized === 'NONE') return undefined;
  const base: CSSProperties = { position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', borderRadius: 'inherit' };
  if (normalized === 'VYBE') return { ...base, border: '8px solid transparent', background: 'linear-gradient(transparent,transparent) padding-box,linear-gradient(135deg,#246b6e,#67b59a,#c5a46d) border-box' };
  const colors: Record<string, string> = { TEAL: '#4d9285', CORAL: '#d77a70', LILAC: '#8d86c9', GOLD: '#c5a46d' };
  const color = isHexNameColor(frame) ? frame : colors[normalized];
  return color ? { ...base, boxShadow: `inset 0 0 0 8px ${color}` } : undefined;
}

function MatchAvatarFramePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const customColor = isHexNameColor(value) ? value : '#c5a46d';
  const normalizedValue = value.toUpperCase();
  return <fieldset className="match-avatar-frame-picker"><legend>Moldura do avatar</legend><div className="match-avatar-frame-options" role="group" aria-label="Paleta de cores para a moldura">
    {matchAvatarFrames.map((frame) => <button key={frame.id} type="button" className={`match-frame-swatch${normalizedValue === frame.id ? ' is-selected' : ''}${frame.id === 'NONE' ? ' is-none' : ''}`} style={{ background: frame.color }} aria-label={frame.label} aria-pressed={normalizedValue === frame.id} title={frame.label} onClick={() => onChange(frame.id)}>{normalizedValue === frame.id && <MaterialIcon name="check"/>}</button>)}
    <label className={`match-frame-swatch match-frame-swatch-custom${isHexNameColor(value) ? ' is-selected' : ''}`} style={{ background: customColor }} title="Cor livre" aria-label="Escolher cor livre da moldura"><input type="color" aria-label="Escolher cor livre da moldura" value={customColor} onChange={(event) => onChange(event.currentTarget.value.toUpperCase())}/>{isHexNameColor(value) && <MaterialIcon name="check"/>}</label>
  </div></fieldset>;
}

function MatchLogo() {
  return <a href="/match" className="match-brand" aria-label="VYBE Match"><VybeLogo variant="symbol"/><span>VYBE</span><small>Match</small></a>;
}

function MatchSidebar({ community }: { community: string }) {
  const path = window.location.pathname;
  return <aside className="match-sidebar"><div className="match-sidebar-brand"><MatchLogo/><HelpHeaderLink/><span className="match-community"><MaterialIcon name="groups"/>{community}</span></div><div className="match-nav-app"><MaterialIcon name="favorite" filled/>Match</div><nav aria-label="Navegação do Match"><a className={path === '/match' ? 'active' : ''} href="/match"><MaterialIcon name="home"/>Início</a><a className={path === '/match/perfil' ? 'active' : ''} href="/match/perfil"><MaterialIcon name="person"/>Perfil</a><a className={path.startsWith('/match/mensagens') ? 'active' : ''} href="/match/mensagens"><MaterialIcon name="chat_bubble"/>Mensagens</a><a className={path === '/match/personalizacao-vybe' ? 'active' : ''} href="/match/personalizacao-vybe"><MaterialIcon name="auto_awesome"/>Personalização VYBE+</a></nav><UniverseBackLink className="match-universe-back"/></aside>;
}

function MatchProfilePage({ identity, profile, communityId, onSaved }: { identity: MatchIdentity; profile: MatchProfileData; communityId: string; onSaved: (identity: MatchIdentity, profile: MatchProfileData) => void }) {
  const [age, setAge] = useState(profile.age?.toString() ?? '');
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location);
  const [interests, setInterests] = useState(profile.interests);
  const [photos, setPhotos] = useState(profile.photos);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [customization, setCustomization] = useState({ nameColor: identity.profileCustomization?.nameColor ?? 'DEFAULT', primaryFontId: identity.profileCustomization?.primaryFontId ?? identity.profileCustomization?.nameFont ?? identity.profileCustomization?.fontId ?? 'DEFAULT', secondaryFontId: identity.profileCustomization?.secondaryFontId ?? 'DEFAULT', avatarFrame: identity.profileCustomization?.avatarFrame ?? 'NONE' });
  const selectedFont = getVybeFont(customization.primaryFontId);
  useEffect(() => {
    const saved = identity.profileCustomization;
    setCustomization({ nameColor: saved?.nameColor ?? 'DEFAULT', primaryFontId: saved?.primaryFontId ?? saved?.nameFont ?? saved?.fontId ?? 'DEFAULT', secondaryFontId: saved?.secondaryFontId ?? 'DEFAULT', avatarFrame: saved?.avatarFrame ?? 'NONE' });
  }, [communityId, identity.id, identity.profileCustomization?.nameColor, identity.profileCustomization?.primaryFontId, identity.profileCustomization?.secondaryFontId, identity.profileCustomization?.nameFont, identity.profileCustomization?.fontId, identity.profileCustomization?.avatarFrame]);
  useEffect(() => { if (identity.verified && selectedFont) loadVybeGoogleFont(selectedFont.id); }, [identity.verified, selectedFont?.id]);
  function clearMissing(field: string) { setMissingFields((fields) => fields.filter((item) => item !== field)); }
  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = '';
    if (!files.length) return;
    if (photos.length + files.length > 6) { setError('Escolha até 6 fotos.'); return; }
    if (files.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) { setError('Use fotos PNG, JPEG ou WebP de até 2 MB cada.'); return; }
    try { const images = await Promise.all(files.map(dataUrl)); setPhotos((current) => [...current, ...images]); clearMissing('Fotos'); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as fotos.'); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const missing: string[] = [];
    const ageValue = age.trim() ? Number(age) : null;
    if (ageValue === null || !Number.isInteger(ageValue) || ageValue < 18 || ageValue > 120) missing.push('Idade');
    if (!location.trim()) missing.push('Localização');
    if (!bio.trim()) missing.push('Sobre você');
    if (!photos.length && !identity.avatarUrl) missing.push('Fotos');
    setMissingFields(missing);
    if (missing.length) {
      setError(`Preencha os campos obrigatórios: ${missing.join(', ')}.`);
      return;
    }
    setSaving(true);
    try {
      const result = await matchRequest<{ identity: MatchIdentity; profile: MatchProfileData }>('/api/match/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ age: ageValue, bio, location, interests, photos, enabled }) });
      onSaved(result.identity, result.profile); notifySnack('Perfil do Match atualizado.', 'success');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil.'); }
    finally { setSaving(false); }
  }
  const interestDraft = useRef<HTMLInputElement>(null);
  function addInterest() { const value = interestDraft.current?.value.trim(); if (value && !interests.includes(value) && interests.length < 12) setInterests((items) => [...items, value.slice(0, 32)]); if (interestDraft.current) interestDraft.current.value = ''; }
  return <section className="match-profile-page"><header className="match-page-heading"><span>SEU PERFIL</span><h1>Seu perfil no Match</h1><p>Use a identidade da comunidade e escolha o que quer compartilhar aqui.</p></header><form className="match-profile-form" noValidate onSubmit={(event) => void submit(event)}>
    <div className="match-identity-row"><MatchAvatar src={photos[0] || identity.avatarUrl} label={identity.displayName} style={identity.verified && isHexNameColor(customization.avatarFrame) ? { outline: `3px solid ${customization.avatarFrame}`, outlineOffset: '2px' } : undefined} className={identity.verified && !isHexNameColor(customization.avatarFrame) ? `match-frame-${customization.avatarFrame.toLowerCase()}` : ''}/><div><strong style={{ ...(identity.verified && isHexNameColor(customization.nameColor) ? { color: customization.nameColor } : {}), ...(identity.verified && selectedFont ? { fontFamily: `\"${selectedFont.family}\", var(--vybe-profile-font, sans-serif)` } : {}) }} className={`match-name-color-${identity.verified && !isHexNameColor(customization.nameColor) ? customization.nameColor.toLowerCase() : 'default'}`}>{identity.displayName}{identity.verified && <span className="match-verified-badge" title="Conta verificada" aria-label="Conta verificada">✓</span>}</strong><small>@{identity.username}</small></div></div><a className="match-customization-link" href="/match/personalizacao-vybe"><MaterialIcon name="auto_awesome"/><span><strong>Personalização VYBE Verificado</strong><small>Personalize sua identidade neste Match.</small></span><MaterialIcon name="arrow_forward"/></a>
    <fieldset className="match-toggle"><div className="match-toggle-copy"><legend>Mostrar no Match</legend><small>Quando ativado, seu perfil aparece para as pessoas elegíveis da comunidade.</small></div><div className="match-toggle-options"><label><input type="radio" name="match-visibility" value="yes" checked={enabled} onChange={() => setEnabled(true)}/><span>Sim</span></label><label><input type="radio" name="match-visibility" value="no" checked={!enabled} onChange={() => setEnabled(false)}/><span>Não</span></label></div></fieldset>
    <div className="match-fields-two"><label className={missingFields.includes('Idade') ? 'has-error' : ''}>Idade<input type="number" inputMode="numeric" min="18" max="120" value={age} aria-required="true" aria-invalid={missingFields.includes('Idade')} onChange={(event) => { setAge(event.currentTarget.value); clearMissing('Idade'); setError(''); }} placeholder="18 ou mais"/>{missingFields.includes('Idade') && <small className="match-field-error">Informe uma idade válida entre 18 e 120 anos.</small>}</label><label className={missingFields.includes('Localização') ? 'has-error' : ''}>Localização da comunidade<input maxLength={100} value={location} aria-required="true" aria-invalid={missingFields.includes('Localização')} onChange={(event) => { setLocation(event.currentTarget.value); clearMissing('Localização'); setError(''); }} placeholder="Ex.: Ribeirão Preto"/>{missingFields.includes('Localização') && <small className="match-field-error">Informe sua localização.</small>}</label></div>
    <label className={missingFields.includes('Sobre você') ? 'has-error' : ''}>Sobre você<textarea maxLength={500} value={bio} aria-required="true" aria-invalid={missingFields.includes('Sobre você')} onChange={(event) => { setBio(event.currentTarget.value); clearMissing('Sobre você'); setError(''); }} placeholder="Uma breve apresentação..."/><small>{bio.length}/500</small>{missingFields.includes('Sobre você') && <small className="match-field-error">Escreva uma breve apresentação.</small>}</label>
    <div className="match-interests-editor"><label htmlFor="match-interest-entry">Interesses</label><div className="match-interest-chips">{interests.map((interest) => <button type="button" key={interest} onClick={() => setInterests((items) => items.filter((item) => item !== interest))}>{interest}<MaterialIcon name="close"/></button>)}</div><div className="match-interest-entry"><input ref={interestDraft} id="match-interest-entry" maxLength={32} placeholder="Adicionar interesse" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addInterest(); } }}/><button type="button" aria-label="Adicionar interesse" onClick={addInterest}><MaterialIcon name="add"/></button></div><small>Até 12 interesses.</small></div>
    <div className={`match-photo-editor${missingFields.includes('Fotos') ? ' has-error' : ''}`}><div><strong>Fotos</strong><small>Tenha pelo menos uma foto. A foto do perfil da conta é usada se nenhuma foto adicional for escolhida.</small></div><div className="match-photo-grid">{photos.map((photo, index) => <figure key={`${index}-${photo.slice(-12)}`}><img src={photo} alt={`Foto ${index + 1} do Match`}/><button type="button" aria-label={`Remover foto ${index + 1}`} onClick={() => { setPhotos((items) => items.filter((_, itemIndex) => itemIndex !== index)); clearMissing('Fotos'); setError(''); }}><MaterialIcon name="close"/></button></figure>)}<label className="match-photo-add"><MaterialIcon name="add_photo_alternate"/><span>Adicionar foto</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { void addPhotos(event); }}/></label></div>{missingFields.includes('Fotos') && <small className="match-field-error">Adicione uma foto ou mantenha a foto da sua conta.</small>}</div>
    {error && <p className="match-error" role="alert">{error}</p>}<button className="match-primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar perfil'}</button>
  </form></section>;
}

function MatchCustomizationPage({ identity, profile, communityId, onSaved }: { identity: MatchIdentity; profile: MatchProfileData; communityId: string; onSaved: (identity: MatchIdentity, profile: MatchProfileData) => void }) {
  const [customization, setCustomization] = useState({ nameColor: identity.profileCustomization?.nameColor ?? 'DEFAULT', primaryFontId: identity.profileCustomization?.primaryFontId ?? identity.profileCustomization?.nameFont ?? identity.profileCustomization?.fontId ?? 'DEFAULT', secondaryFontId: identity.profileCustomization?.secondaryFontId ?? 'DEFAULT', avatarFrame: identity.profileCustomization?.avatarFrame ?? 'NONE' });
  const [saving, setSaving] = useState(false);
  const [colorValid, setColorValid] = useState(true);
  const [primaryFontOpen, setPrimaryFontOpen] = useState(false);
  const [secondaryFontOpen, setSecondaryFontOpen] = useState(false);
  const selectedFont = getVybeFont(customization.primaryFontId);
  const beneficiary = profile.photos[0] || identity.avatarUrl;
  useEffect(() => {
    const saved = identity.profileCustomization;
    setCustomization({ nameColor: saved?.nameColor ?? 'DEFAULT', primaryFontId: saved?.primaryFontId ?? saved?.nameFont ?? saved?.fontId ?? 'DEFAULT', secondaryFontId: saved?.secondaryFontId ?? 'DEFAULT', avatarFrame: saved?.avatarFrame ?? 'NONE' });
  }, [communityId, identity.id, identity.profileCustomization?.nameColor, identity.profileCustomization?.primaryFontId, identity.profileCustomization?.secondaryFontId, identity.profileCustomization?.nameFont, identity.profileCustomization?.fontId, identity.profileCustomization?.avatarFrame]);
  useEffect(() => { if (identity.verified && selectedFont) loadVybeGoogleFont(selectedFont.id); }, [identity.verified, selectedFont?.id]);
  async function saveCustomization() {
    if (!colorValid) return;
    setSaving(true);
    try {
      const result = await matchRequest<{ customization: typeof customization }>('/api/social/profile-customization', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'MATCH', customization }) });
      const nextIdentity = { ...identity, profileCustomization: result.customization };
      setCustomization(result.customization);
      onSaved(nextIdentity, profile);
      notifySnack('Personalização do Match salva nesta comunidade.', 'success');
    } catch (reason) { notifySnack(reason instanceof Error ? reason.message : 'Não foi possível salvar a personalização.'); }
    finally { setSaving(false); }
  }
  return <section className="match-customization-page">
    <header className="match-page-heading"><span>VYBE+ · MATCH</span><h1>Personalização VYBE Verificado</h1><p>Personalize sua identidade no Match desta comunidade.</p></header>
    {!identity.verified ? <section className="match-customization-locked"><span><MaterialIcon name="verified"/></span><div><h2>Personalização VYBE Verificado</h2><p>Desbloqueie novas formas de personalizar seu perfil no Match.</p><ul><li>Cor personalizada para seu nome</li><li>Fontes principal e secundária</li><li>Molduras e destaque premium</li></ul><a className="match-primary-button" href={`/vybe-plus?community=${encodeURIComponent(communityId)}`}>Tornar-se verificado <MaterialIcon name="arrow_forward"/></a></div></section> : <div className="match-customization-layout">
      <section className="match-customization-editor"><header><span>PERSONALIZAÇÃO DO MATCH</span><h2>Seu perfil de descoberta</h2><p>As escolhas ficam isoladas no Match e nesta comunidade.</p></header>
        <ProfileNameColorPicker label="Cor do nome" value={customization.nameColor} onChange={(nameColor) => setCustomization((current) => ({ ...current, nameColor }))} onValidityChange={setColorValid}/>
        <details className="verified-font-settings" open={primaryFontOpen} onToggle={(event) => setPrimaryFontOpen(event.currentTarget.open)}><summary><span><strong>Fonte principal</strong><small>Nome no card e no perfil Match.</small></span><b>Escolher fonte</b></summary><ProfileFontPicker app="MATCH" profileId={identity.id} communityId={communityId} currentFont={customization.primaryFontId} profileName={identity.displayName} title="Fonte principal" description="Aplicada ao seu nome no Match." resetLabel="Restaurar fonte principal" onChange={(primaryFontId) => setCustomization((current) => ({ ...current, primaryFontId }))}/></details>
        <details className="verified-font-settings" open={secondaryFontOpen} onToggle={(event) => setSecondaryFontOpen(event.currentTarget.open)}><summary><span><strong>Fonte secundária</strong><small>Bio e apresentação pessoal.</small></span><b>Escolher fonte</b></summary><ProfileFontPicker app="MATCH" profileId={identity.id} communityId={communityId} currentFont={customization.secondaryFontId} profileName="Sua apresentação no Match" title="Fonte secundária" description="Aplicada à sua bio no Match." resetLabel="Restaurar fonte secundária" onChange={(secondaryFontId) => setCustomization((current) => ({ ...current, secondaryFontId }))}/></details>
        <MatchAvatarFramePicker value={customization.avatarFrame} onChange={(avatarFrame) => setCustomization((current) => ({ ...current, avatarFrame }))}/>
        <button className="match-primary-button" type="button" disabled={saving || !colorValid} onClick={() => void saveCustomization()}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
      </section>
      <section className="match-customization-preview-panel"><span>PRÉVIA DO MATCH</span><article className="match-person-card match-customization-discovery-preview">
        {beneficiary ? <img className="match-card-photo" src={beneficiary} alt={`Prévia de ${identity.displayName}`}/> : <div className="match-card-photo match-no-photo"><MatchAvatar src={identity.avatarUrl} label={identity.displayName}/></div>}
        <div className="match-card-shade"/>{matchCardFrameStyle(customization.avatarFrame) && <div className="match-card-frame" style={matchCardFrameStyle(customization.avatarFrame)}/>}<div className="match-card-info"><h1 style={{ ...(isHexNameColor(customization.nameColor) ? { color: customization.nameColor } : {}), ...(selectedFont ? { fontFamily: `"${selectedFont.family}", var(--vybe-profile-font, sans-serif)` } : {}) }} className={!isHexNameColor(customization.nameColor) ? `match-name-color-${customization.nameColor.toLowerCase()}` : ''}>{identity.displayName}{profile.age ? `, ${profile.age}` : ''}<span className="match-verified-badge" aria-label="Conta verificada">✓</span></h1><span className="match-card-username">@{identity.username}</span><ProfileFontText as="p" role="secondary" character={{ ...identity, profileCustomization: customization }}>{profile.bio || identity.bio || 'Sua apresentação aparece aqui.'}</ProfileFontText></div>
      </article><small>Esta visualização representa seu card para outras pessoas desta comunidade.</small></section>
    </div>}
  </section>;
}

function MatchHome({ identity, profile, onNavigateMessages }: { identity: MatchIdentity; profile: MatchProfileData; onNavigateMessages: () => void }) {
  const [cards, setCards] = useState<MatchCardData[]>([]);
  const [index, setIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newMatch, setNewMatch] = useState<MatchSummary | null>(null);
  const [newMatchReaction, setNewMatchReaction] = useState<'like' | 'star'>('like');
  const [matchAdvancePending, setMatchAdvancePending] = useState(false);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(null);
  const [reacting, setReacting] = useState(false);
  const reactingRef = useRef(false);
  const [blockMenu, setBlockMenu] = useState(false);
  const blockMenuRef = useRef<HTMLDivElement>(null);
  const card = cards[index];
  const cardFont = getVybeFont(card?.verified ? card.profileCustomization?.primaryFontId ?? card.profileCustomization?.nameFont : undefined);
  const cardFrame = card?.verified ? card.profileCustomization?.avatarFrame ?? 'NONE' : 'NONE';
  useEffect(() => { if (cardFont) loadVybeGoogleFont(cardFont.id); }, [cardFont?.id]);
  async function load() { setLoading(true); try { const result = await matchRequest<{ enabled: boolean; profiles: MatchCardData[] }>('/api/match/discovery'); setCards(result.profiles); setIndex(0); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o Match.'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  const images = card?.photos?.length ? card.photos : card?.avatarUrl ? [card.avatarUrl] : [];
  useEffect(() => { setPhotoIndex(0); }, [card?.id]);
  useEffect(() => {
    if (!blockMenu) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !blockMenuRef.current?.contains(event.target)) setBlockMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setBlockMenu(false); };
    document.addEventListener('pointerdown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOnOutside); window.removeEventListener('keydown', closeOnEscape); };
  }, [blockMenu]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft') setPhotoIndex((value) => (value - 1 + Math.max(images.length, 1)) % Math.max(images.length, 1)); if (event.key === 'ArrowRight') setPhotoIndex((value) => (value + 1) % Math.max(images.length, 1)); };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [images.length]);
  async function react(type: 'pass' | 'star' | 'like') {
    if (!card || reactingRef.current) return;
    const selectedCard = card;
    const wasLastCard = index + 1 >= cards.length;
    reactingRef.current = true;
    setReacting(true);
    setError('');
    setBlockMenu(false);
    setExitDirection(type === 'pass' ? 'left' : 'right');
    const response = matchRequest<{ reaction: 'like' | 'star' | 'pass'; match: MatchSummary | null }>('/api/match/reactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toProfileId: selectedCard.id, type }) }).then(
      (result) => ({ ok: true as const, result }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      if (!wasLastCard) setIndex((value) => value + 1);
    } finally {
      setExitDirection(null);
      reactingRef.current = false;
      setReacting(false);
    }
    void response.then((outcome) => {
      if (!outcome.ok) {
        const message = outcome.reason instanceof Error ? outcome.reason.message : 'Não foi possível registrar seu interesse.';
        soundManager.play('error', `match-error:${selectedCard.id}:${Date.now()}`);
        setError(message);
        notifySnack(message);
        void load();
        return;
      }
      const { result } = outcome;
      if (result.match) {
        soundManager.play('match', result.match.id);
        setNewMatchReaction(result.reaction === 'star' ? 'star' : 'like');
        setMatchAdvancePending(wasLastCard);
        setNewMatch(result.match);
      } else if (wasLastCard) void load();
    });
  }
  function continueAfterMatch() { setNewMatch(null); if (matchAdvancePending) { setMatchAdvancePending(false); if (index + 1 >= cards.length) void load(); else setIndex((value) => value + 1); } else if (index >= cards.length) void load(); }
  async function reportProfile() { if (!card) return; const reason = window.prompt('Por que deseja denunciar este perfil?'); if (!reason?.trim()) return; try { await matchRequest('/api/community-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'match_profile', targetId: card.id, reason: reason.trim() }) }); notifySnack('Denúncia enviada à administração da comunidade.'); setBlockMenu(false); } catch (cause) { notifySnack((cause as Error).message); } }
  async function blockProfile() {
    if (!card || !window.confirm(`Bloquear ${card.displayName}? Este perfil deixará de aparecer para você.`)) return;
    try {
      await matchRequest(`/api/match/profiles/${card.id}/block`, { method: 'POST' });
      setBlockMenu(false);
      if (index + 1 >= cards.length) await load(); else setIndex((value) => value + 1);
      notifySnack('Perfil bloqueado.');
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Não foi possível bloquear este perfil.'; setError(message); notifySnack(message); }
  }
  if (!profile.enabled || !profile.age) return <section className="match-home match-home--onboarding"><header className="match-home-heading"><span>CONEXÕES DA SUA COMUNIDADE</span><h1>VYBE <em>Match</em> <MaterialIcon name="favorite"/></h1><p>Conecte-se, conheça novas pessoas e crie boas histórias na sua comunidade.</p></header><div className="match-onboarding-layout"><aside className="match-onboarding-side match-onboarding-side--left" aria-hidden="true"><div className="match-decor-photo"><MatchAvatar src={identity.avatarUrl} label={identity.displayName}/><span><MaterialIcon name="favorite" filled/></span></div><div className="match-decor-note is-lilac"><MaterialIcon name="groups"/><span>Encontre novas conexões.</span></div><div className="match-decor-spark">♡</div></aside><section className="match-onboarding-card"><div className="match-orbit-visual"><span className="match-orbit match-orbit--one"><MaterialIcon name="person"/></span><span className="match-orbit match-orbit--two"><MaterialIcon name="favorite"/></span><MatchAvatar src={identity.avatarUrl} label={identity.displayName}/><span className="match-orbit-heart"><MaterialIcon name="favorite" filled/></span></div><h2>Prepare seu perfil do Match</h2><p>Complete seu perfil e ative “Mostrar no Match” para conhecer pessoas da comunidade.</p><div className="match-onboarding-checklist"><div className={profile.age && profile.age >= 18 ? 'is-complete' : ''}><span><MaterialIcon name="person"/></span><strong>Confirme sua idade</strong><span className={profile.age && profile.age >= 18 ? 'match-check-indicator is-complete' : 'match-check-indicator'}>{profile.age && profile.age >= 18 && <MaterialIcon name='check'/>}</span></div><div className={profile.photos.length || identity.avatarUrl ? 'is-complete' : ''}><span><MaterialIcon name="image"/></span><strong>Adicione fotos ao seu perfil</strong><span className={profile.photos.length || identity.avatarUrl ? 'match-check-indicator is-complete' : 'match-check-indicator'}>{(profile.photos.length || identity.avatarUrl) && <MaterialIcon name='check'/>}</span></div><div className={profile.enabled ? 'is-complete' : ''}><span><MaterialIcon name="favorite"/></span><strong>Ative o Match</strong><span className={profile.enabled ? 'match-check-indicator is-complete' : 'match-check-indicator'}>{profile.enabled && <MaterialIcon name='check'/>}</span></div></div><a className="match-primary-button" href="/match/perfil">Configurar perfil <MaterialIcon name="arrow_forward"/></a></section><aside className="match-onboarding-side match-onboarding-side--right" aria-hidden="true"><div className="match-decor-note is-coral"><MaterialIcon name="favorite"/><span>Converse com quem combina com você.</span></div><div className="match-decor-photo match-decor-photo--second"><MatchAvatar src={identity.avatarUrl} label={identity.displayName}/><span><MaterialIcon name="favorite" filled/></span></div><div className="match-decor-note is-lilac"><MaterialIcon name="auto_awesome"/><span>Descubra pessoas com os mesmos interesses.</span></div></aside></div></section>;
  if (loading) return <section className="match-home match-home--discovery"><header className="match-home-heading"><span>SUA PRÓXIMA CONEXÃO</span><h1>VYBE <em>Match</em> <MaterialIcon name="favorite"/></h1><p>Conheça pessoas e descubra interesses em comum.</p></header><div className="match-empty match-empty--loading">Encontrando pessoas da comunidade…</div></section>;
  if (!card) return <section className="match-home match-home--discovery"><header className="match-home-heading"><span>SUA PRÓXIMA CONEXÃO</span><h1>VYBE <em>Match</em> <MaterialIcon name="favorite"/></h1><p>Conheça pessoas e descubra interesses em comum.</p></header><div className="match-empty match-empty--no-cards"><MaterialIcon name="auto_awesome"/><h1>Você já viu todo mundo por aqui.</h1><p>Novas pessoas vão aparecer por aqui em breve.</p><a href="/match/perfil">Revisar meu perfil</a><button type="button" onClick={onNavigateMessages}>Ver mensagens</button></div></section>;
  return <section className="match-home match-home--discovery"><header className="match-home-heading"><span>SUA PRÓXIMA CONEXÃO</span><h1>VYBE <em>Match</em> <MaterialIcon name="favorite"/></h1><p>Conheça pessoas e descubra interesses em comum.</p></header><div className="match-card-wrap">{error && <p className="match-error" role="status">{error}</p>}<article key={card.id} className={`match-person-card${exitDirection ? ` is-exiting is-exiting-${exitDirection}` : ''}`} aria-label={`Perfil de ${card.displayName}`} aria-busy={reacting}>
    {images.length > 0 ? <img className="match-card-photo" src={images[photoIndex]} alt={`Foto ${photoIndex + 1} de ${card.displayName}`}/> : <div className="match-card-photo match-no-photo"><MatchAvatar src={card.avatarUrl} label={card.displayName}/></div>}
    {images.length > 1 && <><div className="match-photo-indicators">{images.map((_, photo) => <i className={photo === photoIndex ? 'active' : ''} key={photo}/>)}</div><button type="button" className="match-photo-hit match-photo-hit-left" aria-label="Foto anterior" onClick={() => setPhotoIndex((value) => (value - 1 + images.length) % images.length)}/><button type="button" className="match-photo-hit match-photo-hit-right" aria-label="Próxima foto" onClick={() => setPhotoIndex((value) => (value + 1) % images.length)}/></>}
    <div className="match-card-menu-wrap" ref={blockMenuRef}><button type="button" className="match-card-menu" aria-label="Opções do perfil" title="Opções do perfil" aria-expanded={blockMenu} onClick={() => setBlockMenu((value) => !value)}><MaterialIcon name="more_horiz"/></button>{blockMenu && <div className="match-card-menu-popover"><button type="button" onClick={() => void reportProfile()}>Denunciar perfil</button><button type="button" onClick={() => void blockProfile()}>Bloquear perfil</button></div>}</div>
    <div className="match-card-shade"/>{card.verified && matchCardFrameStyle(cardFrame) && <div className="match-card-frame" style={matchCardFrameStyle(cardFrame)}/>}<div className="match-card-info"><h1 style={{ ...(card.verified && isHexNameColor(card.profileCustomization?.nameColor ?? '') ? { color: card.profileCustomization!.nameColor } : {}), ...(cardFont ? { fontFamily: `"${cardFont.family}", var(--vybe-profile-font, sans-serif)` } : {}) }} className={`match-name-color-${card.verified && !isHexNameColor(card.profileCustomization?.nameColor ?? '') ? card.profileCustomization?.nameColor?.toLowerCase() ?? 'default' : 'default'}`}>{card.displayName}, {card.age}{card.verified && <span className="match-verified-badge" title="Conta verificada" aria-label="Conta verificada">✓</span>}</h1><span className="match-card-username">@{card.username}</span>{card.bio && <ProfileFontText as="p" character={card} role="secondary">{card.bio}</ProfileFontText>}{card.location && <small className="match-location"><MaterialIcon name="location_on"/>{card.location}</small>}{card.interests.length > 0 && <div className="match-interest-tags">{card.interests.slice(0, 5).map((item) => <span key={item}>{item}</span>)}{card.interests.length > 5 && <span>+{card.interests.length - 5}</span>}</div>}</div>
  </article><div className="match-actions"><button className="match-action-pass" type="button" aria-label="Passar" title="Passar" disabled={reacting} onClick={() => void react('pass')}><MaterialIcon name="close"/></button><button className="match-action-star" type="button" aria-label="Enviar estrela" title="Interesse especial" disabled={reacting} onClick={() => void react('star')}><MaterialIcon name="star" filled/></button><button className="match-action-like" type="button" aria-label="Curtir" title="Curtir" disabled={reacting} onClick={() => void react('like')}><MaterialIcon name="favorite" filled/></button></div></div>
    {newMatch && <div className="match-modal-backdrop"><section className={`match-success-modal${newMatchReaction === 'star' ? ' is-super-like' : ''}`} role="dialog" aria-modal="true" aria-labelledby="match-success-title"><button className="match-modal-close" type="button" aria-label="Fechar" onClick={continueAfterMatch}><MaterialIcon name="close"/></button><div className="match-couple"><MatchIdentityAvatar identity={identity}/><MatchIdentityAvatar identity={newMatch.profile} src={newMatch.profile.photos[0] || newMatch.profile.avatarUrl}/><span><MaterialIcon name={newMatchReaction === 'star' ? 'star' : 'favorite'} filled/></span></div><h2 id="match-success-title">{newMatchReaction === 'star' ? 'Vocês se deram super like!' : 'Vocês deram match!'}</h2><p>Agora vocês podem conversar.</p><button className="match-primary-button match-go-chat" type="button" onClick={() => { window.location.href = `/match/mensagens/${newMatch.id}`; }}><MaterialIcon name="chat_bubble"/>Vá conversar</button><button className="match-modal-later" type="button" onClick={continueAfterMatch}>Continuar vendo perfis</button></section></div>}
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
      if (event.messageId) {
        const currentConversationIsOpen = event.matchId === selectedIdRef.current && document.visibilityState === 'visible' && document.hasFocus();
        if (!currentConversationIsOpen) soundManager.play('message', event.messageId);
      }
      void loadMatches().catch(() => undefined);
      if (event.matchId && event.matchId === selectedIdRef.current) void loadMessages(event.matchId).catch(() => undefined);
    }
  }), []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);
  async function reportMessage(message: MatchMessageData) { const reason = window.prompt('Por que deseja denunciar esta mensagem?'); if (!reason?.trim()) return; try { await matchRequest('/api/community-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'match_message', targetId: message.id, reason: reason.trim() }) }); notifySnack('Denúncia enviada à administração da comunidade.'); } catch (cause) { notifySnack((cause as Error).message); } }
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
  if (!selectedId) return <div className="match-messages-layout"><aside className="match-thread-list"><header><h1>Mensagens</h1><span>{matches.length}</span></header>{matches.map((item) => <a href={`/match/mensagens/${item.id}`} className="match-thread" key={item.id}><MatchIdentityAvatar identity={item.profile} src={item.profile.photos[0] || item.profile.avatarUrl}/><span><MatchIdentityName identity={item.profile}/><small>{item.latestMessage?.content ?? 'Vocês deram Match!'}</small></span>{item.unreadCount > 0 && <i>{item.unreadCount}</i>}</a>)}{matches.length === 0 && <p className="match-thread-empty">Quando você der Match, poderá começar uma conversa por aqui.</p>}</aside><section className="match-chat-placeholder"><MaterialIcon name="chat_bubble"/><h2>Suas conversas</h2><p>Escolha um Match para conversar.</p></section></div>;
  return <div className="match-messages-layout"><aside className="match-thread-list"><header><h1>Mensagens</h1><span>{matches.length}</span></header>{matches.map((item) => <a href={`/match/mensagens/${item.id}`} className={`match-thread ${item.id === selectedId ? 'active' : ''}`} key={item.id}><MatchIdentityAvatar identity={item.profile} src={item.profile.photos[0] || item.profile.avatarUrl}/><span><MatchIdentityName identity={item.profile}/><small>{item.latestMessage?.content ?? 'Vocês deram Match!'}</small></span>{item.unreadCount > 0 && <i>{item.unreadCount}</i>}</a>)}</aside><section className="match-chat"><header className="match-chat-header"><a className="match-chat-back" href="/match/mensagens" aria-label="Voltar às mensagens"><MaterialIcon name="arrow_back"/></a><MatchIdentityAvatar identity={selected?.profile ?? { id: '', username: '', displayName: 'Match', bio: '', avatarUrl: '', verified: false }} src={selected?.profile.photos[0] || selected?.profile.avatarUrl}/><div>{selected && <MatchIdentityName identity={selected.profile}/>}<small>Conexão do Match</small></div><button type="button" aria-label="Opções da conversa" onClick={() => setMenu((value) => !value)}><MaterialIcon name="more_horiz"/></button>{menu && <div className="match-chat-menu"><button type="button" onClick={() => { const latest = [...messages].reverse().find((item) => !item.own); if (latest) void reportMessage(latest); setMenu(false); }}>Denunciar mensagem recente</button><button type="button" onClick={() => void block()}>Bloquear perfil</button></div>}</header><div className="match-chat-messages" ref={listRef}>{error && <p className="match-error">{error}</p>}{messages.map((message) => <article className={`match-message ${message.own ? 'own' : ''}`} key={message.id}><p>{message.content}</p><small>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{message.own && message.readAt && ' · Visualizada'}{!message.own && <button type="button" aria-label="Denunciar mensagem" onClick={() => void reportMessage(message)}><MaterialIcon name="flag"/></button>}</small></article>)}{messages.length === 0 && <p className="match-chat-first">Vocês deram Match! Envie uma mensagem para começar.</p>}</div><form className="match-chat-compose" onSubmit={(event) => void send(event)}><button type="button" aria-label="Adicionar emoji" onClick={() => setDraft((value) => `${value} 💜`)}><MaterialIcon name="sentiment_satisfied"/></button><input value={draft} onChange={(event) => setDraft(event.currentTarget.value)} maxLength={1000} placeholder="Digite uma mensagem..."/><button type="submit" aria-label="Enviar" disabled={!draft.trim()}><MaterialIcon name="send"/></button></form></section></div>;
}

export function MatchApp({ community, communityId }: { community: string; communityId: string }) {
  const path = window.location.pathname;
  const [identity, setIdentity] = useState<MatchIdentity | null>(null);
  const [profile, setProfile] = useState<MatchProfileData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void matchRequest<{ identity: MatchIdentity; profile: MatchProfileData }>('/api/match/profile').then((result) => { setIdentity(result.identity); setProfile(result.profile); }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Match indisponível nesta comunidade.')); }, []);
  const selectedId = path.match(/^\/match\/mensagens\/([a-f\d]{24})$/i)?.[1];
  return <div className="match-app"><MatchSidebar community={community}/><main className="match-workspace">{error ? <section className="match-empty"><MaterialIcon name="lock"/><h1>Match indisponível</h1><p>{error}</p><UniverseBackLink/></section> : !identity || !profile ? <div className="match-empty">Carregando o Match…</div> : path === '/match/personalizacao-vybe' ? <MatchCustomizationPage identity={identity} profile={profile} communityId={communityId} onSaved={(nextIdentity, nextProfile) => { setIdentity(nextIdentity); setProfile(nextProfile); }}/>
    : path === '/match/perfil' ? <MatchProfilePage identity={identity} profile={profile} communityId={communityId} onSaved={(nextIdentity, nextProfile) => { setIdentity(nextIdentity); setProfile(nextProfile); }}/>
    : path === '/match/mensagens' || selectedId ? <MatchMessages selectedId={selectedId}/>
    : <MatchHome identity={identity} profile={profile} onNavigateMessages={() => { window.location.href = '/match/mensagens'; }}/>}</main></div>;
}
