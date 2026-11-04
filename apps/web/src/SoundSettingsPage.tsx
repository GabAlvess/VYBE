import { useEffect, useState } from 'react';
import { MaterialIcon } from './MaterialIcon';
import { defaultSoundPreferences, soundManager, type SoundPreferences, type SoundType } from './soundManager';
import './SoundSettingsPage.css';

const controls: Array<{ key: keyof SoundPreferences; label: string; type: SoundType; preview?: boolean }> = [
  { key: 'enabled', label: 'Sons do VYBE', type: 'success' },
  { key: 'messageSoundEnabled', label: 'Som de mensagens', type: 'message', preview: true },
  { key: 'notificationSoundEnabled', label: 'Som de notificações', type: 'notification', preview: true },
  { key: 'matchSoundEnabled', label: 'Som de Match', type: 'match', preview: true },
  { key: 'actionSoundEnabled', label: 'Sons de ações', type: 'success', preview: true },
  { key: 'vybePlusSoundEnabled', label: 'Sons do VYBE+', type: 'vybePlus', preview: true },
];

export function SoundSettingsPage() {
  const [preferences, setPreferences] = useState<SoundPreferences>({ ...defaultSoundPreferences });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/account/audio-preferences', { credentials: 'same-origin', cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível carregar as preferências de áudio.');
      const next = await response.json() as SoundPreferences;
      setPreferences(next); soundManager.setPreferences(next);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as preferências.')).finally(() => setLoading(false));
  }, []);
  async function update(patch: Partial<SoundPreferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next); soundManager.setPreferences(next); setSaving(true); setError('');
    try {
      const response = await fetch('/api/account/audio-preferences', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const body = await response.json().catch(() => ({})) as SoundPreferences & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível salvar as preferências.');
      setPreferences(body); soundManager.setPreferences(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as preferências.'); }
    finally { setSaving(false); }
  }
  return <main className="sound-settings-page">
    <a className="sound-settings-back" href="/configuracoes"><MaterialIcon name="arrow_back"/> Configurações</a>
    <header><span>CONTA VYBE</span><h1>Sons e notificações</h1><p>Escolha quais sons você quer ouvir no VYBE. Essas preferências valem em todas as comunidades.</p></header>
    {error && <p className="sound-settings-error" role="alert">{error}</p>}
    <section className="sound-settings-card"><div className="sound-settings-master"><span className="sound-settings-icon"><MaterialIcon name="volume_up"/></span><span><strong>Sons do VYBE</strong><small>Controle todos os sons de uma vez.</small></span><label className="sound-toggle"><input type="checkbox" checked={preferences.enabled} disabled={loading || saving} onChange={(event) => void update({ enabled: event.currentTarget.checked })}/><span/><b>{preferences.enabled ? 'Ativado' : 'Desativado'}</b></label></div>
      <div className={`sound-settings-volume ${!preferences.enabled ? 'is-muted' : ''}`}><label htmlFor="vybe-sound-volume">Volume dos sons <strong>{Math.round(preferences.volume * 100)}%</strong></label><input id="vybe-sound-volume" type="range" min="0" max="100" step="1" value={Math.round(preferences.volume * 100)} disabled={loading || saving || !preferences.enabled} onChange={(event) => { const volume = Number(event.currentTarget.value) / 100; setPreferences((current) => ({ ...current, volume })); soundManager.setPreferences({ ...preferences, volume }); }} onPointerUp={(event) => void update({ volume: Number(event.currentTarget.value) / 100 })} onKeyUp={(event) => void update({ volume: Number(event.currentTarget.value) / 100 })}/><div><small>Silencioso</small><small>Máximo</small></div></div>
      <div className="sound-settings-list">{controls.slice(1).map((item) => <div className="sound-settings-row" key={item.key}><span className="sound-settings-row-icon"><MaterialIcon name={item.type === 'message' ? 'chat_bubble' : item.type === 'notification' ? 'notifications' : item.type === 'match' ? 'favorite' : item.type === 'vybePlus' ? 'verified' : 'check_circle'}/></span><strong>{item.label}</strong>{item.preview && <button className="sound-preview-button" type="button" disabled={loading || saving || !preferences.enabled || preferences.volume === 0} onClick={() => soundManager.play(item.type, `preview-${item.type}-${Date.now()}`)}><MaterialIcon name="play_arrow"/> Ouvir</button>}<label className="sound-toggle"><input type="checkbox" checked={Boolean(preferences[item.key])} disabled={loading || saving || !preferences.enabled} onChange={(event) => void update({ [item.key]: event.currentTarget.checked })}/><span/><b>{preferences[item.key] ? 'Ativado' : 'Desativado'}</b></label></div>)}</div>
    </section>
    <p className="sound-settings-note"><MaterialIcon name="info"/> A reprodução começa depois que você interagir com o VYBE. Sons não substituem avisos visuais.</p>
  </main>;
}
