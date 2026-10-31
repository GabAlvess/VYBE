import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { MaterialIcon } from './MaterialIcon';
import { VybeLogo } from './VybeLogo';
import { notifySnack } from './SnackMessage';
import { activateLocalCommunity, communityHomeHref } from './communityNavigation';
import './CommunityJoinPage.css';

type JoinAnswer = { key: string; label: string; value: string };
type JoinRequest = { id: string; characterName: string; requestedUsername: string; characterAge: number; photoplayerName: string; photoplayerImageUrl: string; characterDescription: string; customAnswers: JoinAnswer[]; status: 'PENDING' | 'NEEDS_INFORMATION' | 'APPROVED' | 'REJECTED'; requestedChanges: string[]; adminMessage: string; rejectionReason: string; createdAt: string };
type JoinInfo = { community: { id: string; name: string; slug: string; subdomain: string; logoUrl: string; coverUrl: string }; account: { displayName: string; username: string; avatarUrl: string }; minimumAge: number; usernameMinLength: number; usernameMaxLength: number; customQuestions: Array<{ key: string; label: string; required: boolean }>; requiresApproval: boolean; membershipStatus: 'MEMBER' | 'NONE'; request: JoinRequest | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? 'Não foi possível concluir a solicitação.');
  return body as T;
}

function fileData(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a foto.')); reader.onerror = () => reject(new Error('Não foi possível ler a foto.')); reader.readAsDataURL(file); });
}

export function CommunityJoinPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [username, setUsername] = useState('');
  const [age, setAge] = useState('');
  const [photoplayerName, setPhotoplayerName] = useState('');
  const [photoplayerImage, setPhotoplayerImage] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [description, setDescription] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [photoplayerAvailable, setPhotoplayerAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [checkingPhotoplayer, setCheckingPhotoplayer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api<JoinInfo>(`/api/communities/${encodeURIComponent(slug)}/join-info`);
      setInfo(result);
      if (result.request) {
        const row = result.request;
        setCharacterName(row.characterName); setUsername(row.requestedUsername); setAge(String(row.characterAge));
        setPhotoplayerName(row.photoplayerName); setPhotoPreview(row.photoplayerImageUrl); setDescription(row.characterDescription);
        setCustomAnswers(Object.fromEntries(row.customAnswers.map((answer) => [answer.key, answer.value])));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a comunidade.'); }
    finally { setLoading(false); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const value = username.trim().replace(/^@/, '');
    if (!info || value.length < info.usernameMinLength) { setUsernameAvailable(null); setCheckingUsername(false); return; }
    setCheckingUsername(true);
    const timer = window.setTimeout(() => {
      void api<{ usernameAvailable: boolean | null }>(`/api/communities/${encodeURIComponent(slug)}/join-availability?username=${encodeURIComponent(value)}`)
        .then((result) => setUsernameAvailable(result.usernameAvailable)).catch(() => setUsernameAvailable(null)).finally(() => setCheckingUsername(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [username, slug, info]);

  useEffect(() => {
    const value = photoplayerName.trim();
    if (value.length < 2) { setPhotoplayerAvailable(null); setCheckingPhotoplayer(false); return; }
    setCheckingPhotoplayer(true);
    const timer = window.setTimeout(() => {
      void api<{ photoplayerAvailable: boolean | null }>(`/api/communities/${encodeURIComponent(slug)}/join-availability?photoplayer=${encodeURIComponent(value)}`)
        .then((result) => setPhotoplayerAvailable(result.photoplayerAvailable)).catch(() => setPhotoplayerAvailable(null)).finally(() => setCheckingPhotoplayer(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [photoplayerName, slug]);

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { event.currentTarget.value = ''; notifySnack('Escolha uma foto JPG, PNG ou WEBP de até 5 MB.'); return; }
    try { const value = await fileData(file); setPhotoplayerImage(value); setPhotoPreview(value); }
    catch { notifySnack('Não foi possível carregar a foto.'); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!info) return;
    if (Number(age) < info.minimumAge) { notifySnack(`Seu personagem não atende à idade mínima de ${info.minimumAge} anos desta comunidade.`); return; }
    if (usernameAvailable !== true) { notifySnack('Confirme se o nome de usuário está disponível.'); return; }
    if (photoplayerAvailable !== true) { notifySnack('Confirme se o photoplayer está disponível.'); return; }
    if (mustReplacePhotoplayerPhoto && !photoplayerImage) { notifySnack('Envie uma nova foto para o photoplayer atualizado.'); return; }
    if (!photoPreview) { notifySnack('Envie a foto do photoplayer.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { characterName, username, age: Number(age), photoplayerName, photoplayerImage, description, customAnswers, confirmed };
      await api<JoinRequest>(`/api/communities/${encodeURIComponent(slug)}/join-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      notifySnack('Sua ficha foi enviada para análise.'); await load();
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Não foi possível enviar sua ficha.'; setError(message); notifySnack(message); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="join-page-loading">Carregando o formulário da comunidade…</main>;
  if (!info) return <main className="join-page-loading"><p>{error || 'Comunidade não encontrada.'}</p><a href="/comunidades">Voltar para meus universos</a></main>;
  const existingRequest = info.request;
  const confirmedStatus = existingRequest?.status === 'PENDING' || existingRequest?.status === 'APPROVED';
  const mustReplacePhotoplayerPhoto = Boolean(existingRequest?.status === 'NEEDS_INFORMATION' && (existingRequest.requestedChanges.includes('photoplayer') || photoplayerName.trim().toLocaleLowerCase() !== existingRequest.photoplayerName.trim().toLocaleLowerCase()));
  if (info.membershipStatus === 'MEMBER' || existingRequest?.status === 'APPROVED') return <main className="join-status-page"><header><a href="/comunidades"><VybeLogo variant="full"/></a><a href={`/comunidades/${slug}/solicitar-entrada`}>Voltar</a></header><section><span className="join-status-icon"><MaterialIcon name="check_circle"/></span><p>ENTRADA APROVADA</p><h1>Você já pode entrar em {info.community.name}.</h1><a className="join-primary-button" href={communityHomeHref(info.community.subdomain)} onClick={() => activateLocalCommunity(info.community.subdomain)}>Entrar na comunidade</a></section></main>;
  if (confirmedStatus) return <main className="join-status-page"><header><a href="/comunidades"><VybeLogo variant="full"/></a><a href="/comunidades">Voltar para meus universos</a></header><section><span className="join-status-icon is-waiting"><MaterialIcon name="schedule"/></span><p>STATUS · AGUARDANDO ANÁLISE</p><h1>Sua ficha foi enviada para análise.</h1><p>A administração da comunidade irá analisar suas informações. Você será notificado quando houver uma atualização.</p><div className="join-status-actions"><button type="button" onClick={() => void load()}>Acompanhar solicitação</button><a href="/comunidades">Voltar para meus universos</a></div></section></main>;
  if (existingRequest?.status === 'REJECTED') return <main className="join-status-page"><header><a href="/comunidades"><VybeLogo variant="full"/></a><a href="/comunidades">Voltar para meus universos</a></header><section><span className="join-status-icon is-rejected"><MaterialIcon name="info"/></span><p>STATUS · SOLICITAÇÃO RECUSADA</p><h1>A administração analisou sua ficha.</h1><p>{existingRequest.rejectionReason || 'A solicitação não foi aprovada.'}</p><div className="join-status-actions"><a href="/comunidades">Voltar para meus universos</a></div></section></main>;
  if (!info.requiresApproval && !existingRequest) return <main className="join-status-page"><header><a href="/comunidades"><VybeLogo variant="full"/></a><a href="/comunidades">Voltar para meus universos</a></header><section><span className="join-status-icon"><MaterialIcon name="groups"/></span><p>COMUNIDADE ABERTA</p><h1>Entre em {info.community.name}.</h1><p>Sua conta VYBE já existe. Ao continuar, criaremos seu perfil inicial nesta comunidade. Os dados deste perfil ficam separados dos seus perfis em outros universos.</p>{error && <p className="join-form-error">{error}</p>}<button className="join-primary-button" type="button" disabled={joining} onClick={() => { setJoining(true); void api<{ subdomain: string }>(`/api/communities/${encodeURIComponent(slug)}/join`, { method: 'POST' }).then((result) => { activateLocalCommunity(result.subdomain); window.location.assign(communityHomeHref(result.subdomain)); }).catch((reason) => { const message = reason instanceof Error ? reason.message : 'Não foi possível entrar na comunidade.'; setError(message); notifySnack(message); }).finally(() => setJoining(false)); }}>{joining ? 'Entrando…' : 'Entrar na comunidade'}</button></section></main>;
  return <main className="community-join-page"><header className="join-topbar"><a href="/comunidades" className="join-brand"><VybeLogo variant="full"/></a><nav><a href="/">Início</a><a className="active" href={`/comunidades/${slug}/solicitar-entrada`}>Ficha</a></nav><div className="join-account"><img src={info.account.avatarUrl || undefined} alt=""/><span><strong>{info.account.displayName}</strong><small>@{info.account.username}</small></span></div></header>
    <div className="join-layout"><aside className="join-community-card">{info.community.coverUrl && <img className="join-community-cover" src={info.community.coverUrl} alt=""/>}<h2>{info.community.name}</h2><p>Comunidade VYBE</p><span className="join-age-note"><MaterialIcon name="18_up_rating"/> Idade mínima: {info.minimumAge} anos</span></aside>
      <section className="join-form-card"><header><span className="join-heading-icon"><MaterialIcon name="person_add"/></span><div><h1>Solicitar entrada</h1><p>Preencha sua ficha para solicitar entrada nesta comunidade.</p></div></header>
        <div className="join-account-identity"><img src={info.account.avatarUrl || undefined} alt=""/><div><small>Sua conta</small><strong>{info.account.displayName}</strong><span>@{info.account.username}</span></div><MaterialIcon name="lock"/></div>
        <form onSubmit={(event) => void submit(event)}>
          <label>Nome do personagem <b>*</b><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="Digite o nome completo do seu personagem" required minLength={2} maxLength={60}/></label>
          <label>Nome de usuário <b>*</b><div className="join-username-input"><span>@</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="marianacosta" required minLength={info.usernameMinLength} maxLength={info.usernameMaxLength}/></div>{checkingUsername && <small className="join-validation">Verificando disponibilidade…</small>}{!checkingUsername && usernameAvailable === true && <small className="join-validation is-valid">✓ @{username.replace(/^@/, '')} está disponível</small>}{!checkingUsername && usernameAvailable === false && <small className="join-validation is-invalid">Este nome de usuário já está sendo utilizado.</small>}</label>
          <label>Idade <b>*</b><input type="number" value={age} onChange={(event) => setAge(event.target.value)} min={info.minimumAge} max={100} required/><small>Esta comunidade aceita personagens a partir de {info.minimumAge} anos.</small>{age && Number(age) < info.minimumAge && <small className="join-validation is-invalid">Seu personagem não atende à idade mínima desta comunidade.</small>}</label>
          <label>Nome do photoplayer <b>*</b><input value={photoplayerName} onChange={(event) => setPhotoplayerName(event.target.value)} placeholder="Ex.: Madelyn Cline" required minLength={2} maxLength={100}/><small>Informe o nome da pessoa utilizada como referência visual do seu personagem.</small>{checkingPhotoplayer && <small className="join-validation">Verificando photoplayer…</small>}{!checkingPhotoplayer && photoplayerAvailable === true && <small className="join-validation is-valid">✓ Photoplayer disponível</small>}{!checkingPhotoplayer && photoplayerAvailable === false && <small className="join-validation is-invalid">Este photoplayer já está sendo utilizado nesta comunidade.</small>}</label>
          <label>Foto do photoplayer <b>*</b><span className="join-upload-help">Envie uma foto da referência visual utilizada pelo personagem.</span><div className="join-photo-upload">{photoPreview && <img src={photoPreview} alt="Prévia da foto do photoplayer"/>}<label className="join-photo-button"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectPhoto(event)}/><MaterialIcon name="add_photo_alternate"/><strong>{photoPreview ? 'Alterar foto' : '+ Adicionar foto'}</strong><small>JPG, PNG ou WEBP · até 5 MB</small></label></div></label>
          <label>Quem é você? <b>*</b><small>Conte um pouco sobre seu personagem.</small><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Fale sobre personalidade, história, rotina, profissão, interesses ou qualquer informação importante sobre seu personagem..." required minLength={10} maxLength={1000}/><small>{description.length}/1.000 caracteres</small></label>
          {!!info.customQuestions.length && <section className="join-custom-questions"><h2>Perguntas adicionais da comunidade</h2>{info.customQuestions.map((question) => <label key={question.key}>{question.label}{question.required && <b> *</b>}<textarea value={customAnswers[question.key] ?? ''} onChange={(event) => setCustomAnswers((current) => ({ ...current, [question.key]: event.target.value }))} required={question.required} maxLength={500}/></label>)}</section>}
          {existingRequest?.status === 'NEEDS_INFORMATION' && <div className="join-admin-feedback"><strong>A administração solicitou alterações</strong><p>{existingRequest.adminMessage}</p><small>Campos: {existingRequest.requestedChanges.join(', ') || 'revise sua ficha'}</small></div>}
          <label className="join-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required/><span>Confirmo que as informações desta ficha estão corretas e respeitam as regras da comunidade.</span></label>
          {error && <p className="join-form-error" role="alert">{error}</p>}
          {mustReplacePhotoplayerPhoto && !photoplayerImage && <p className="join-form-error">Envie uma nova foto para a referência visual atualizada.</p>}
          <button className="join-submit" type="submit" disabled={saving || checkingUsername || checkingPhotoplayer || usernameAvailable !== true || photoplayerAvailable !== true || !confirmed || !photoPreview || (mustReplacePhotoplayerPhoto && !photoplayerImage)}>{saving ? 'Enviando…' : existingRequest?.status === 'NEEDS_INFORMATION' ? 'Atualizar ficha e reenviar' : 'Enviar solicitação'}</button>
        </form>
      </section>
      <aside className="join-preview-column"><div className="join-preview-card"><header><span><MaterialIcon name="visibility"/></span><div><h2>Prévia do perfil</h2><p>Veja como sua ficha será exibida na comunidade.</p></div></header><article>{photoPreview ? <img className="join-preview-photo" src={photoPreview} alt="Foto do photoplayer"/> : <div className="join-preview-photo is-empty"><MaterialIcon name="person"/></div>}<h2>{characterName || 'Nome do personagem'}</h2><span>@{username.replace(/^@/, '') || 'username'}</span><p><MaterialIcon name="calendar_today"/> {age || '—'} anos</p><p><MaterialIcon name="person"/> Photoplayer: {photoplayerName || '—'}</p><div className="join-preview-description">{description || 'A apresentação do seu personagem aparecerá aqui.'}</div><div className="join-preview-badges"><span>{info.community.name}</span><span className="is-pending">Aguardando análise</span></div></article></div><div className="join-review-note"><MaterialIcon name="info"/><div><strong>Após o envio, sua ficha será analisada pela administração da comunidade.</strong><p>Você receberá uma notificação quando houver uma resposta sobre sua solicitação.</p></div></div></aside>
    </div>
  </main>;
}
