import { useEffect, useState, type FormEvent } from 'react';
import { MaterialIcon } from './MaterialIcon';

type PixConfig = { pixKey: string; pixKeyType: 'EMAIL' | 'PHONE' | 'CPF_CNPJ' | 'RANDOM_KEY' | 'PIX_COPY_PASTE'; recipientName: string; qrCodeDataUrl: string };
const empty: PixConfig = { pixKey: '', pixKeyType: 'RANDOM_KEY', recipientName: '', qrCodeDataUrl: '' };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Não foi possível salvar a configuração PIX.');
  return body;
}

function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler o QR Code.'));
    reader.onerror = () => reject(new Error('Não foi possível ler o QR Code.'));
    reader.readAsDataURL(file);
  });
}

export function VybePlusPixSettings() {
  const [config, setConfig] = useState<PixConfig>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void request<PixConfig>('/api/platform/vybe-plus/pix').then(setConfig).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o PIX.')).finally(() => setLoading(false));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSaved(false);
    try { setConfig(await request<PixConfig>('/api/platform/vybe-plus/pix', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a configuração PIX.'); }
    finally { setSaving(false); }
  }
  return <section className="admin-subpage vybe-plus-pix-admin"><div className="admin-page-title"><span>VYBE+</span><h1>Configurar pagamento PIX</h1><p>Estas informações aparecem para usuários com uma solicitação de VYBE Verificado aguardando pagamento.</p></div>
    {error && <p className="admin-page-error" role="alert">{error}</p>}{saved && <p className="vybe-plus-pix-saved" role="status"><MaterialIcon name="check_circle"/>Configuração PIX salva.</p>}
    {loading ? <div className="admin-empty">Carregando configuração…</div> : <form onSubmit={(event) => void submit(event)}>
      <div className="vybe-plus-pix-admin-callout"><MaterialIcon name="info"/><p><strong>Pagamento VYBE+ somente</strong><br/>Esta chave recebe pagamentos reais do VYBE Verificado. Ela não tem relação com saldo, transferências ou o VYBE Banco.</p></div>
      <label>Chave PIX<input value={config.pixKey} onChange={(event) => setConfig({ ...config, pixKey: event.currentTarget.value })} required maxLength={200} placeholder="Informe a chave PIX"/></label>
      <div className="vybe-plus-pix-admin-grid"><label>Tipo da chave<select value={config.pixKeyType} onChange={(event) => setConfig({ ...config, pixKeyType: event.currentTarget.value as PixConfig['pixKeyType'] })}><option value="EMAIL">E-mail</option><option value="PHONE">Telefone</option><option value="CPF_CNPJ">CPF/CNPJ</option><option value="RANDOM_KEY">Chave aleatória</option><option value="PIX_COPY_PASTE">PIX Copia e Cola</option></select></label><label>Nome do recebedor<input value={config.recipientName} onChange={(event) => setConfig({ ...config, recipientName: event.currentTarget.value })} required minLength={2} maxLength={100} placeholder="Nome exibido ao usuário"/></label></div>
      <label className="vybe-plus-pix-qr-upload">QR Code PIX (opcional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return; if (file.size > 1024 * 1024) { setError('A imagem do QR Code deve ter até 1 MB.'); return; } void fileDataUrl(file).then((qrCodeDataUrl) => setConfig((current) => ({ ...current, qrCodeDataUrl }))).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível ler o QR Code.')); }}/><small>PNG, JPG ou WebP até 1 MB. Use um QR Code real da chave cadastrada.</small>{config.qrCodeDataUrl && <div><img src={config.qrCodeDataUrl} alt="Prévia do QR Code PIX"/><button type="button" onClick={() => setConfig({ ...config, qrCodeDataUrl: '' })}>Remover QR Code</button></div>}</label>
      <button className="admin-primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar configuração'}</button>
    </form>}
  </section>;
}
