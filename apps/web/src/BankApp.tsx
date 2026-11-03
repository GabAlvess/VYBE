import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import './BankApp.css';
import { VybeLogo } from './VybeLogo';
import { MaterialIcon } from './MaterialIcon';
import { UniverseBackLink } from './UniverseBackLink';
import { soundManager } from './soundManager';

type Person = { id: string; displayName: string; username: string; avatarUrl: string };
type Transaction = { id: string; reference: string; type: string; direction: 'in' | 'out'; amountCents: number; description: string; status: string; createdAt: string; other: Person | null };
type BankData = { community: { id: string; name: string; logoUrl: string; coverUrl: string }; profile: Person; wallet: { id: string; balanceCents: number; limitCents: number | null; monthlyUsedCents: number; monthlyAvailableCents: number | null; cardLast4: string }; recent: Transaction[]; canManage: boolean };
type AdminPerson = Person & { wallet: { id: string; balanceCents: number; limitCents: number | null } | null };
type AuditItem = { id: string; action: string; details: Record<string, unknown>; createdAt: string };
type AdminSummary = { memberCount: number; maxBulkMembers: number; withdrawMemberCount: number; withdrawTotalCents: number };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error ?? 'Não foi possível concluir a solicitação.');
  return data as T;
}

const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(cents / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const transactionTime = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const dateKey = (item: Date) => `${item.getFullYear()}-${item.getMonth()}-${item.getDate()}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day = dateKey(date) === dateKey(today) ? 'Hoje' : dateKey(date) === dateKey(yesterday) ? 'Ontem' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  return `${day}, ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
};
function Icon({ name }: { name: string }) {
  const names: Record<string, string> = {
    home: 'home', wallet: 'account_balance_wallet', transfer: 'swap_horiz', history: 'history',
    arrow: 'arrow_forward', down: 'arrow_downward', up: 'arrow_upward', eye: 'visibility', eyeOff: 'visibility_off', add: 'add',
    bank: 'account_balance', search: 'search', close: 'close', back: 'arrow_back', receipt: 'receipt_long',
    shield: 'verified_user', bell: 'notifications', chevron: 'chevron_right', card: 'credit_card', info: 'info',
  };
  return <MaterialIcon name={names[name] ?? 'info'} className="bank-icon"/>;
}
function QuickActionIcon({ kind }: { kind: 'transfer' | 'history' | 'wallet' | 'receive' }) {
  if (kind === 'transfer') return <svg className="bank-quick-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 14.1 28 4 18.7 28l-4.5-9.5L4 14.1Z"/><path d="m14.2 18.5 13.8-14.4"/></svg>;
  if (kind === 'history') return <svg className="bank-quick-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M5.2 11.8A12 12 0 1 1 7 23.5"/><path d="M4 4.8v7.4h7.3M16 9v7l5 3"/></svg>;
  if (kind === 'wallet') return <svg className="bank-quick-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 8.5h21a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h18"/><path d="M3.5 10h21a2.5 2.5 0 0 1 2.5 2.5V16H19a4 4 0 0 0 0 8h8M21 20h.1"/></svg>;
  return <svg className="bank-quick-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4v24M4 16h24"/></svg>;
}
function PersonAvatar({ person, size = '' }: { person?: Person | null; size?: string }) { return <span className={`bank-avatar ${size} ${person?.avatarUrl ? '' : 'is-empty'}`}>{person?.avatarUrl ? <img src={person.avatarUrl} alt=""/> : person?.displayName?.slice(0, 1).toUpperCase() ?? 'V'}</span>; }

export function BankApp(_props: { character: Person }) {
  const [data, setData] = useState<BankData | null>(null);
  const [page, setPage] = useState<'home' | 'wallet' | 'transfer' | 'history' | 'admin'>(window.location.pathname === '/banco/transferir' ? 'transfer' : window.location.pathname === '/banco/historico' ? 'history' : window.location.pathname === '/banco/carteira' ? 'wallet' : window.location.pathname === '/banco/admin' ? 'admin' : 'home');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showBalance, setShowBalance] = useState(true);
  const [query, setQuery] = useState('');
  const [recipients, setRecipients] = useState<Person[]>([]);
  const [recipient, setRecipient] = useState<Person | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [review, setReview] = useState(false);
  const [sending, setSending] = useState(false);
  const pendingTransferKey = useRef<string | null>(null);
  const [adminPeople, setAdminPeople] = useState<AdminPerson[]>([]);
  const [adminAudit, setAdminAudit] = useState<AuditItem[]>([]);
  const [adminSummary, setAdminSummary] = useState<AdminSummary>({ memberCount: 0, maxBulkMembers: 500, withdrawMemberCount: 0, withdrawTotalCents: 0 });
  const [adminSearch, setAdminSearch] = useState('');
  const [activeAdminPerson, setActiveAdminPerson] = useState<AdminPerson | null>(null);
  const [adjustment, setAdjustment] = useState({ direction: 'credit', amount: '', reason: '' });
  const [bulkCredit, setBulkCredit] = useState({ amount: '', reason: '' });
  const [bulkReview, setBulkReview] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const bulkCreditKey = useRef<string | null>(null);
  const [bulkWithdrawReason, setBulkWithdrawReason] = useState('');
  const [bulkWithdrawMode, setBulkWithdrawMode] = useState<'all' | 'fixed'>('all');
  const [bulkWithdrawAmount, setBulkWithdrawAmount] = useState('');
  const [bulkWithdrawReview, setBulkWithdrawReview] = useState(false);
  const [bulkWithdrawSubmitting, setBulkWithdrawSubmitting] = useState(false);
  const [bulkWithdrawMessage, setBulkWithdrawMessage] = useState('');
  const bulkWithdrawKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await request<BankData>('/api/bank')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o Banco.'); }
    finally { setLoading(false); }
  }, []);
  const loadTransactions = useCallback(async () => {
    try { const list = await request<Transaction[]>(`/api/bank/transactions?filter=${filter}`); setTransactions(list); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o histórico.'); }
  }, [filter]);
  const changePage = (next: typeof page) => { setPage(next); setSelected(null); setError(''); const paths = { home: '/banco', wallet: '/banco/carteira', transfer: '/banco/transferir', history: '/banco/historico', admin: '/banco/admin' }; window.history.pushState({}, '', paths[next]); };
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (page === 'history' || page === 'wallet') void loadTransactions(); }, [page, loadTransactions]);
  useEffect(() => {
    const pop = () => { const path = window.location.pathname; setPage(path === '/banco/transferir' ? 'transfer' : path === '/banco/historico' ? 'history' : path === '/banco/carteira' ? 'wallet' : path === '/banco/admin' ? 'admin' : 'home'); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (query.trim().length < 2 || recipient) { setRecipients([]); return; }
    const timer = window.setTimeout(() => { void request<Person[]>(`/api/bank/recipients?q=${encodeURIComponent(query)}`).then(setRecipients).catch(() => setRecipients([])); }, 180);
    return () => window.clearTimeout(timer);
  }, [query, recipient]);
  useEffect(() => {
    if (page !== 'admin' || !data?.canManage) return;
    void request<AdminPerson[]>(`/api/bank/admin/wallets?q=${encodeURIComponent(adminSearch)}`).then(setAdminPeople).catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar carteiras.'));
    void request<AdminSummary>('/api/bank/admin/summary').then(setAdminSummary).catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar quantidade de membros.'));
    void request<AuditItem[]>('/api/bank/admin/audit').then(setAdminAudit).catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar a auditoria.'));
  }, [page, data?.canManage, adminSearch]);

  const formattedAmount = useMemo(() => {
    const normalized = amount.trim().replace(',', '.');
    const value = Number(normalized);
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }, [amount]);
  const bulkAmountCents = useMemo(() => {
    const value = Number(bulkCredit.amount.trim().replace(',', '.'));
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }, [bulkCredit.amount]);
  const pickTransaction = async (transaction: Transaction) => {
    try { setSelected(await request<Transaction>(`/api/bank/transactions/${transaction.id}`)); }
    catch { setSelected(transaction); }
  };
  async function sendTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipient || formattedAmount <= 0) return;
    if (!review) { pendingTransferKey.current = crypto.randomUUID(); setReview(true); return; }
    setSending(true); setError('');
    const key = pendingTransferKey.current ?? crypto.randomUUID();
    try {
      await request('/api/bank/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ recipientCharacterId: recipient.id, amountCents: formattedAmount, description: description.trim() }) });
      soundManager.play('success', `transfer:${key}`);
      pendingTransferKey.current = null; setRecipient(null); setQuery(''); setAmount(''); setDescription(''); setReview(false); await load(); await loadTransactions(); changePage('home');
    } catch (reason) { soundManager.play('error', `transfer-error:${key}`); setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a transferência.'); }
    finally { setSending(false); }
  }
  async function updateLimit(person: AdminPerson, limitCents: number) {
    try { await request(`/api/bank/admin/wallets/${person.id}/limit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limitCents }) }); setAdminPeople((items) => items.map((item) => item.id === person.id ? { ...item, wallet: { id: item.wallet?.id ?? '', balanceCents: item.wallet?.balanceCents ?? 0, limitCents } } : item)); setActiveAdminPerson(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o limite.'); }
  }
  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeAdminPerson) return;
    try { await request(`/api/bank/admin/wallets/${activeAdminPerson.id}/adjustment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction: adjustment.direction, amountCents: Math.round(Number(adjustment.amount.replace(',', '.')) * 100), reason: adjustment.reason }) }); if (adjustment.direction === 'withdraw_all') setAdminPeople((items) => items.map((item) => item.id === activeAdminPerson.id && item.wallet ? { ...item, wallet: { ...item.wallet, balanceCents: 0 } } : item)); setActiveAdminPerson(null); setAdjustment({ direction: 'credit', amount: '', reason: '' }); void request<AuditItem[]>('/api/bank/admin/audit').then(setAdminAudit).catch(() => undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível ajustar o saldo.'); }
  }
  async function submitBulkCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bulkReview) { bulkCreditKey.current = crypto.randomUUID(); setBulkReview(true); return; }
    if (!bulkCreditKey.current || !bulkAmountCents || !bulkCredit.reason.trim()) return;
    setBulkSubmitting(true); setError(''); setBulkMessage('');
    try {
      const result = await request<{ recipientCount: number; amountPerWalletCents: number; totalCents: number }>('/api/bank/admin/credits/all', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': bulkCreditKey.current }, body: JSON.stringify({ amountCents: bulkAmountCents, reason: bulkCredit.reason.trim() }) });
      setBulkMessage(`Crédito de ${money(result.amountPerWalletCents)} aplicado às ${result.recipientCount} carteiras.`);
      bulkCreditKey.current = null; setBulkReview(false); setBulkCredit({ amount: '', reason: '' });
      const [people, audit] = await Promise.all([request<AdminPerson[]>(`/api/bank/admin/wallets?q=${encodeURIComponent(adminSearch)}`), request<AuditItem[]>('/api/bank/admin/audit')]);
      setAdminPeople(people); setAdminAudit(audit);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível creditar as carteiras.'); }
    finally { setBulkSubmitting(false); }
  }
  async function submitBulkWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = Math.round(Number(bulkWithdrawAmount.replace(',', '.')) * 100);
    if (bulkWithdrawMode === 'fixed' && (!Number.isSafeInteger(amountCents) || amountCents <= 0)) return;
    if (!bulkWithdrawReview) {
      bulkWithdrawKey.current = crypto.randomUUID();
      try {
        const query = bulkWithdrawMode === 'fixed' ? `?withdrawAmountCents=${amountCents}` : '';
        setAdminSummary(await request<AdminSummary>(`/api/bank/admin/summary${query}`));
        setBulkWithdrawReview(true);
      } catch (reason) { bulkWithdrawKey.current = null; setError(reason instanceof Error ? reason.message : 'Não foi possível preparar a revisão.'); }
      return;
    }
    if (!bulkWithdrawKey.current || bulkWithdrawReason.trim().length < 3) return;
    setBulkWithdrawSubmitting(true); setError(''); setBulkWithdrawMessage('');
    try {
      const result = await request<{ recipientCount: number; totalCents: number }>('/api/bank/admin/debits/all', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': bulkWithdrawKey.current }, body: JSON.stringify({ mode: bulkWithdrawMode, ...(bulkWithdrawMode === 'fixed' ? { amountCents } : {}), reason: bulkWithdrawReason.trim() }) });
      setBulkWithdrawMessage(`Saldo retirado de ${result.recipientCount} carteiras. Total ajustado: ${money(result.totalCents)}.`);
      bulkWithdrawKey.current = null; setBulkWithdrawReview(false); setBulkWithdrawReason('');
      const [people, audit, summary] = await Promise.all([request<AdminPerson[]>(`/api/bank/admin/wallets?q=${encodeURIComponent(adminSearch)}`), request<AuditItem[]>('/api/bank/admin/audit'), request<AdminSummary>('/api/bank/admin/summary')]);
      setAdminPeople(people); setAdminAudit(audit); setAdminSummary(summary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível retirar os saldos das carteiras.'); }
    finally { setBulkWithdrawSubmitting(false); }
  }

  return <div className={`bank-shell ${selected && ['home', 'history', 'wallet'].includes(page) ? 'has-detail' : ''}`}>
    <aside className="bank-sidebar"><a className="bank-brand" href="/banco"><VybeLogo variant="symbol" className="bank-brand-symbol"/><span><strong>VYBE</strong><small>Banco</small></span></a><div className="bank-community"><span className="bank-community-icon"><Icon name="bank"/></span><span><strong>{data?.community.name ?? 'Comunidade'}</strong><small>Carteira da comunidade</small></span><Icon name="chevron"/></div><nav aria-label="Navegação do Banco"><button className={page === 'home' ? 'active' : ''} onClick={() => changePage('home')}><Icon name="home"/>Início</button><button className={page === 'wallet' ? 'active' : ''} onClick={() => changePage('wallet')}><Icon name="wallet"/>Carteira</button><button className={page === 'transfer' ? 'active' : ''} onClick={() => changePage('transfer')}><Icon name="transfer"/>Transferir</button><button className={page === 'history' ? 'active' : ''} onClick={() => changePage('history')}><Icon name="history"/>Histórico</button></nav>{data?.canManage && <button className="bank-admin-shortcut" onClick={() => changePage('admin')}><Icon name="shield"/>Banco / Carteiras</button>}<span className="bank-sidebar-sparkle" aria-hidden="true">✧</span><UniverseBackLink className="bank-universe-back"/></aside>
    <main className="bank-main"><header className="bank-topbar"><div className="bank-mobile-brand"><VybeLogo variant="symbol" className="bank-brand-symbol"/><strong>VYBE Banco</strong></div></header>
      {error && <div className="bank-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar"><Icon name="close"/></button></div>}
      {loading && !data ? <div className="bank-loading">Carregando sua carteira…</div> : data && <>
        {page === 'home' && <div className="bank-layout"><section className="bank-primary-column"><div className="bank-greeting"><div><h1>Olá, {data.profile.displayName.split(/\s+/)[0]}! <span>💚</span></h1><p>Sua carteira no VYBE — {data.community.name}</p></div></div><div className="bank-home-grid"><section className="bank-balance-card"><div className="bank-balance-top"><span>{data.wallet.balanceCents < 0 ? 'Saldo devedor' : 'Saldo disponível'} <button type="button" aria-pressed={!showBalance} aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'} title={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'} onClick={() => setShowBalance(!showBalance)}><Icon name={showBalance ? 'eye' : 'eyeOff'}/></button></span><CommunityCard community={data.community.name} holder={data.profile.displayName} last4={data.wallet.cardLast4}/></div><strong className="bank-balance-value">{showBalance ? money(data.wallet.balanceCents) : '••••••••'}</strong>{data.wallet.balanceCents < 0 && <small className="bank-debt-note">Saldo devedor: próximos créditos serão usados para compensar a dívida.</small>}<div className="bank-community-balance"><span className="bank-community-icon"><Icon name="bank"/></span>{data.community.name}</div><div className="bank-limit-strip"><div><strong>Limite da comunidade</strong><small>{data.wallet.limitCents === null ? 'Ainda não definido' : `Usado: ${money(data.wallet.monthlyUsedCents)} (${Math.min(100, Math.round(data.wallet.monthlyUsedCents / Math.max(data.wallet.limitCents, 1) * 100))}%)`}</small></div><strong>{data.wallet.limitCents === null ? '—' : money(data.wallet.limitCents)}</strong><div className="bank-progress"><i style={{ width: `${data.wallet.limitCents === null ? 0 : Math.min(100, data.wallet.monthlyUsedCents / Math.max(data.wallet.limitCents, 1) * 100)}%` }}/></div></div></section><section className="bank-quick-actions"><h2>Ações rápidas<span className="bank-action-sparkles" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M6 16 2 12M18 11l2-8M26 18l7-4M24 27l8-2"/></svg></span></h2><div><button onClick={() => changePage('transfer')}><QuickActionIcon kind="transfer"/><span>Transferir</span></button><button onClick={() => changePage('history')}><QuickActionIcon kind="history"/><span>Histórico</span></button><button onClick={() => changePage('wallet')}><QuickActionIcon kind="wallet"/><span>Carteira</span></button><button onClick={() => { setError('Compartilhe seu @username para receber transferências nesta comunidade.'); }}><QuickActionIcon kind="receive"/><span>Receber</span></button></div></section></div>
          <section className="bank-transactions-card"><div className="bank-section-title"><h2>Transações recentes</h2><button onClick={() => changePage('history')}>Ver histórico completo <Icon name="chevron"/></button></div><TransactionRows items={data.recent} selectedId={selected?.id} onSelect={pickTransaction}/></section>
          <CommunityBanner name={data.community.name} logo={data.community.logoUrl} cover={data.community.coverUrl}/>
          </section><aside className="bank-side-column"><section className="bank-community-card"><div><h2>Comunidade e cartão</h2><p>Você está na comunidade:</p></div><div className="bank-community-select"><span className="bank-community-icon"><Icon name="bank"/></span><strong>{data.community.name}</strong><Icon name="chevron"/></div><CommunityCard community={data.community.name} holder={data.profile.displayName} last4={data.wallet.cardLast4} compact/><button className="bank-card-details" onClick={() => changePage('wallet')}><Icon name="card"/> Ver dados do cartão</button></section><section className="bank-limit-card"><h2>Seu limite na comunidade</h2><p>Definido pelo administrador da comunidade</p>{data.wallet.limitCents === null ? <div className="bank-limit-empty">Limite ainda não definido pela comunidade.</div> : <><div><span>Limite mensal</span><strong>{money(data.wallet.limitCents)}</strong></div><div><span>Utilizado</span><strong>{money(data.wallet.monthlyUsedCents)}</strong></div><div><span>Disponível</span><strong>{money(data.wallet.monthlyAvailableCents ?? 0)}</strong></div><div className="bank-progress"><i style={{ width: `${Math.min(100, data.wallet.monthlyUsedCents / Math.max(data.wallet.limitCents, 1) * 100)}%` }}/></div></>}</section></aside></div>}
        {page === 'wallet' && <section className="bank-page"><PageTitle eyebrow={data.community.name} title="Carteira" subtitle="Seu saldo e seu cartão virtual neste universo."/><div className="bank-wallet-page-card"><CommunityCard community={data.community.name} holder={data.profile.displayName} last4={data.wallet.cardLast4}/><div className="bank-wallet-balance"><small>{data.wallet.balanceCents < 0 ? 'Saldo devedor' : 'Saldo disponível'}</small><strong>{showBalance ? money(data.wallet.balanceCents) : '••••••••'}</strong><button type="button" className="bank-balance-toggle" aria-pressed={!showBalance} onClick={() => setShowBalance(!showBalance)}><Icon name={showBalance ? 'eye' : 'eyeOff'}/>{showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}</button>{data.wallet.balanceCents < 0 && <p className="bank-debt-note">Os próximos créditos serão usados para compensar este saldo devedor.</p>}{data.wallet.limitCents === null ? <p>Limite ainda não definido pela comunidade.</p> : <p>Limite mensal: {money(data.wallet.limitCents)} · usado {showBalance ? money(data.wallet.monthlyUsedCents) : '••••'}</p>}</div></div><section className="bank-transactions-card"><div className="bank-section-title"><h2>Últimas movimentações</h2><button onClick={() => changePage('history')}>Histórico completo <Icon name="chevron"/></button></div><TransactionRows items={transactions.slice(0, 6)} onSelect={pickTransaction}/></section></section>}
        {page === 'history' && <section className="bank-page"><PageTitle eyebrow={data.community.name} title="Histórico" subtitle="Movimentações da carteira nesta comunidade."/><div className="bank-filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button><button className={filter === 'in' ? 'active' : ''} onClick={() => setFilter('in')}>Entradas</button><button className={filter === 'out' ? 'active' : ''} onClick={() => setFilter('out')}>Saídas</button></div><section className="bank-transactions-card bank-history-list"><TransactionRows items={transactions} onSelect={pickTransaction}/></section></section>}
        {page === 'transfer' && <section className="bank-page bank-transfer-page"><PageTitle eyebrow={data.community.name} title="Transferir" subtitle="Envie saldo virtual para alguém desta comunidade."/><form className="bank-transfer-form" onSubmit={(event) => void sendTransfer(event)}><label>Para quem?<div className="bank-recipient-field"><Icon name="search"/><input value={recipient ? `@${recipient.username}` : query} onChange={(event) => { pendingTransferKey.current = null; setReview(false); setRecipient(null); setQuery(event.target.value); }} placeholder="Buscar por nome ou @username" required/></div>{recipients.length > 0 && !recipient && <div className="bank-recipient-results">{recipients.map((person) => <button type="button" key={person.id} onClick={() => { pendingTransferKey.current = null; setReview(false); setRecipient(person); setQuery(`@${person.username}`); setRecipients([]); }}><PersonAvatar person={person}/><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></button>)}</div>}</label>{recipient && <div className="bank-selected-recipient"><PersonAvatar person={recipient}/><span><strong>{recipient.displayName}</strong><small>@{recipient.username}</small></span><button type="button" onClick={() => { pendingTransferKey.current = null; setReview(false); setRecipient(null); setQuery(''); }} aria-label="Trocar destinatário"><Icon name="close"/></button></div>}<label>Valor<div className="bank-amount-input"><span>US$</span><input inputMode="decimal" value={amount} onChange={(event) => { pendingTransferKey.current = null; setAmount(event.target.value.replace(/[^\d,.]/g, '')); setReview(false); }} placeholder="0,00" required/></div></label><label>Descrição <small>(opcional)</small><input className="bank-standard-input" value={description} onChange={(event) => { pendingTransferKey.current = null; setDescription(event.target.value); setReview(false); }} maxLength={160} placeholder="Ex.: almoço"/></label><div className="bank-transfer-available"><span>Saldo disponível</span><strong>{money(data.wallet.balanceCents)}</strong></div>{review && recipient && <div className="bank-transfer-review"><span>Revise a transferência</span><p>{money(formattedAmount)} para <strong>{recipient.displayName}</strong>{description.trim() && <> · {description.trim()}</>}</p><small>Esta movimentação é virtual e fica nesta comunidade.</small></div>}<button className="bank-primary-button" type="submit" disabled={!recipient || formattedAmount <= 0 || sending}>{sending ? 'Confirmando…' : review ? 'Confirmar transferência' : 'Continuar'}<Icon name="arrow"/></button><p className="bank-virtual-note"><Icon name="info"/> Saldo virtual, sem conversão ou saque em dinheiro real.</p></form></section>}
        {page === 'admin' && <section className="bank-page"><PageTitle eyebrow="ADMINISTRAÇÃO DA COMUNIDADE" title="Banco / Carteiras" subtitle="Gerencie limites e ajustes do saldo virtual dos membros."/>{!data.canManage ? <p className="bank-limit-empty">Esta área está disponível apenas para administradores da comunidade.</p> : <><section className="bank-bulk-credit"><div><small>CRÉDITO EM LOTE</small><h2>Adicionar saldo a todos</h2><p>Crédito para os {adminSummary.memberCount} membros ativos desta comunidade. O ajuste individual continua disponível em cada carteira.</p></div><form onSubmit={(event) => void submitBulkCredit(event)}><label>Valor por carteira<div className="bank-amount-input"><span>US$</span><input type="number" min="0.01" step="0.01" max="1000000" value={bulkCredit.amount} onChange={(event) => { bulkCreditKey.current = null; setBulkReview(false); setBulkCredit({ ...bulkCredit, amount: event.target.value }); }} placeholder="0,00" required/></div></label><label>Motivo do crédito<input className="bank-standard-input" value={bulkCredit.reason} onChange={(event) => { bulkCreditKey.current = null; setBulkReview(false); setBulkCredit({ ...bulkCredit, reason: event.target.value }); }} placeholder="Ex.: crédito mensal" maxLength={160} minLength={3} required/></label>{bulkReview && <div className="bank-bulk-review"><strong>Revisar crédito total</strong><span>{adminSummary.memberCount} membros × {money(bulkAmountCents)} = <b>{money(bulkAmountCents * adminSummary.memberCount)}</b></span><small>O mesmo valor será adicionado a cada carteira ativa deste universo.</small></div>}<div className="bank-bulk-actions"><button className="bank-primary-button" type="submit" disabled={bulkSubmitting || !adminSummary.memberCount || adminSummary.memberCount > adminSummary.maxBulkMembers || bulkAmountCents <= 0 || bulkCredit.reason.trim().length < 3}>{bulkSubmitting ? 'Aplicando crédito…' : bulkReview ? `Confirmar crédito para ${adminSummary.memberCount} membros` : 'Revisar crédito em lote'}</button>{bulkReview && <button type="button" onClick={() => { bulkCreditKey.current = null; setBulkReview(false); }}>Cancelar</button>}</div>{adminSummary.memberCount > adminSummary.maxBulkMembers && <p className="bank-bulk-limit-note">O crédito atômico em lote está limitado a {adminSummary.maxBulkMembers} membros por operação.</p>}{bulkMessage && <p className="bank-bulk-success" role="status">{bulkMessage}</p>}</form></section><section className="bank-bulk-credit bank-bulk-withdraw"><div><small>RETIRADA EM LOTE</small><h2>Ajuste geral de saldo</h2><p>Retire todo o saldo ou aplique um desconto, como imposto comunitário, para os membros elegíveis. Cada débito fica registrado no histórico e na auditoria.</p></div><form onSubmit={(event) => void submitBulkWithdrawal(event)}><label>Tipo de retirada<select className="bank-standard-input" value={bulkWithdrawMode} onChange={(event) => { bulkWithdrawKey.current = null; setBulkWithdrawReview(false); setBulkWithdrawMode(event.target.value as 'all' | 'fixed'); }}><option value="all">Retirar todo o saldo de cada membro</option><option value="fixed">Descontar um valor por membro</option></select></label>{bulkWithdrawMode === 'fixed' && <label>Valor por membro<div className="bank-amount-input"><span>US$</span><input type="number" min="0.01" step="0.01" max="1000000" value={bulkWithdrawAmount} onChange={(event) => { bulkWithdrawKey.current = null; setBulkWithdrawReview(false); setBulkWithdrawAmount(event.target.value); }} placeholder="0,00" required/></div></label>}<label>Motivo do ajuste<input className="bank-standard-input" value={bulkWithdrawReason} onChange={(event) => { bulkWithdrawKey.current = null; setBulkWithdrawReview(false); setBulkWithdrawReason(event.target.value); }} placeholder="Ex.: ajuste geral das carteiras" maxLength={160} minLength={3} required/></label>{bulkWithdrawReview && <div className="bank-bulk-review"><strong>{bulkWithdrawMode === 'all' ? 'Revisar retirada total' : 'Revisar desconto por membro'}</strong><span>{adminSummary.withdrawMemberCount} carteiras · total <b>{money(adminSummary.withdrawTotalCents)}</b></span><small>{bulkWithdrawMode === 'all' ? 'O saldo atual será retirado de cada carteira com valor disponível.' : `${money(Math.round(Number(bulkWithdrawAmount.replace(',', '.')) * 100))} será debitado de todos os membros; quem não tiver saldo ficará negativo e os próximos créditos abaterão a dívida.`} Os valores serão recalculados ao confirmar.</small></div>}<div className="bank-bulk-actions"><button className="bank-primary-button" type="submit" disabled={bulkWithdrawSubmitting || (bulkWithdrawMode === 'all' ? adminSummary.withdrawMemberCount === 0 : adminSummary.memberCount === 0) || adminSummary.memberCount > adminSummary.maxBulkMembers || bulkWithdrawReason.trim().length < 3 || (bulkWithdrawMode === 'fixed' && (!Number.isFinite(Number(bulkWithdrawAmount.replace(',', '.'))) || Number(bulkWithdrawAmount.replace(',', '.')) <= 0))}>{bulkWithdrawSubmitting ? 'Aplicando ajuste…' : bulkWithdrawReview ? 'Confirmar ajuste para todos' : 'Revisar ajuste em lote'}</button>{bulkWithdrawReview && <button type="button" onClick={() => { bulkWithdrawKey.current = null; setBulkWithdrawReview(false); }}>Cancelar</button>}</div>{adminSummary.memberCount > adminSummary.maxBulkMembers && <p className="bank-bulk-limit-note">A retirada atômica em lote está limitada a {adminSummary.maxBulkMembers} membros por operação.</p>}{bulkWithdrawMessage && <p className="bank-bulk-success" role="status">{bulkWithdrawMessage}</p>}</form></section><label className="bank-admin-search"><Icon name="search"/><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Buscar membros"/></label><div className="bank-admin-list">{adminPeople.map((person) => <article key={person.id}><PersonAvatar person={person}/><span><strong>{person.displayName}</strong><small>@{person.username} · Saldo {money(person.wallet?.balanceCents ?? 0)}</small></span><button onClick={() => setActiveAdminPerson(person)}>Gerenciar</button></article>)}{!adminPeople.length && <p className="bank-limit-empty">Nenhum membro encontrado.</p>}</div><section className="bank-admin-audit"><h2>Auditoria recente do Banco</h2>{adminAudit.map((item) => <article key={item.id}><span><strong>{item.action.replace('bank.', '').replaceAll('_', ' ')}</strong><small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small></span><p>{typeof item.details.totalCents === 'number' ? `Total ${item.action === 'bank.bulk_debit' ? 'retirado' : 'creditado'}: ${money(item.details.totalCents)} · ${typeof item.details.recipientCount === 'number' ? item.details.recipientCount : 0} carteiras${typeof item.details.reason === 'string' ? ` · ${item.details.reason}` : ''}` : typeof item.details.reason === 'string' ? item.details.reason : typeof item.details.newLimitCents === 'number' ? `Novo limite: ${money(item.details.newLimitCents)}` : `Ajuste: ${money(typeof item.details.amountCents === 'number' ? item.details.amountCents : 0)}`}</p></article>)}{!adminAudit.length && <p className="bank-limit-empty">Nenhuma ação administrativa registrada.</p>}</section></>}</section>}
      </>}
    </main>
    {['home', 'history', 'wallet'].includes(page) && selected && <TransactionDetail transaction={selected} community={data?.community.name ?? ''} onClose={() => setSelected(null)}/>}
    {activeAdminPerson && <div className="bank-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setActiveAdminPerson(null); }}><section className="bank-modal" role="dialog" aria-modal="true" aria-labelledby="bank-admin-title"><button className="bank-modal-close" onClick={() => setActiveAdminPerson(null)} aria-label="Fechar"><Icon name="close"/></button><h2 id="bank-admin-title">{activeAdminPerson.displayName}</h2><p>@{activeAdminPerson.username} · carteira de {data?.community.name}</p><label>Limite mensal da carteira<input id="bank-admin-limit" type="number" min="0" step="0.01" defaultValue={activeAdminPerson.wallet?.limitCents === null || !activeAdminPerson.wallet ? '' : (activeAdminPerson.wallet.limitCents / 100).toFixed(2)} placeholder="Ex.: 2000,00"/></label><button className="bank-primary-button" onClick={() => { const input = document.getElementById('bank-admin-limit') as HTMLInputElement; const value = input.value.trim() === '' ? 0 : Math.round(Number(input.value.replace(',', '.')) * 100); void updateLimit(activeAdminPerson, value); }}>Salvar limite</button><form className="bank-admin-adjustment" onSubmit={(event) => void saveAdjustment(event)}><h3>Ajustar saldo</h3><select value={adjustment.direction} onChange={(event) => setAdjustment({ ...adjustment, direction: event.target.value, amount: '' })}><option value="credit">Adicionar saldo</option><option value="debit">Debitar valor definido</option><option value="withdraw_all">Retirar todo o saldo</option></select>{adjustment.direction !== 'withdraw_all' && <input type="number" min="0.01" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} placeholder="Valor em US$" required/>}{adjustment.direction === 'withdraw_all' && <small className="bank-admin-withdraw-note">Saldo atual: {money(activeAdminPerson.wallet?.balanceCents ?? 0)}. O valor será recalculado no servidor no momento do ajuste.</small>}<input value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} placeholder="Motivo obrigatório" maxLength={160} required minLength={3}/><button className="bank-primary-button" disabled={adjustment.direction === 'withdraw_all' && !(activeAdminPerson.wallet?.balanceCents ?? 0)}>{adjustment.direction === 'withdraw_all' ? 'Retirar saldo e registrar ajuste' : 'Registrar ajuste'}</button></form></section></div>}
  </div>;
}

function PageTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <div className="bank-page-title"><small>{eyebrow}</small><h1>{title}</h1><p>{subtitle}</p></div>; }
function transactionTitle(transaction: Transaction) { if (transaction.type === 'TRANSFER') return `Transferência ${transaction.direction === 'in' ? 'recebida' : 'enviada'}`; if (transaction.type === 'ADMIN_CREDIT' || transaction.type === 'SALARY') return 'Crédito administrativo'; if (transaction.type === 'ADMIN_TAX') return 'Imposto comunitário'; if (transaction.type === 'ADMIN_DEBIT') return 'Ajuste administrativo'; if (transaction.type === 'REFUND') return 'Reembolso'; return transaction.type === 'PAYMENT' ? 'Pagamento virtual' : 'Movimentação'; }
function CommunityCard({ community, holder, last4, compact = false }: { community: string; holder: string; last4: string; compact?: boolean }) { return <div className={`bank-virtual-card ${compact ? 'compact' : ''}`}><div className="bank-card-brand"><VybeLogo variant="symbol" className="bank-card-mark"/><span><b>VYBE</b><small>{community}</small></span><Icon name="chevron"/></div><div className="bank-card-chip"/><div className="bank-card-number">**** **** **** {last4}</div><div className="bank-card-holder">{holder.toLocaleUpperCase('pt-BR')}</div><span className="bank-card-wave">)))</span></div>; }
function TransactionRows({ items, selectedId, onSelect }: { items: Transaction[]; selectedId?: string; onSelect: (transaction: Transaction) => void }) { if (!items.length) return <p className="bank-empty-transactions">Nenhuma movimentação ainda.</p>; return <div className="bank-transaction-rows">{items.map((item) => <button className={`bank-transaction-row ${selectedId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => onSelect(item)}><span className={`bank-transaction-icon ${item.direction}`}><Icon name={item.direction === 'in' ? 'down' : 'up'}/></span><span className="bank-transaction-name"><strong>{transactionTitle(item)}</strong><small>{item.type === 'ADMIN_CREDIT' ? 'De: ' : item.type === 'ADMIN_DEBIT' || item.type === 'ADMIN_TAX' ? 'Motivo: ' : item.direction === 'in' ? 'De: ' : 'Para: '}{item.other?.displayName ?? (item.description || 'Comunidade')}</small></span><time>{transactionTime(item.createdAt)}</time><strong className={`bank-transaction-amount ${item.direction}`}>{item.direction === 'in' ? '+' : '−'} {money(item.amountCents)}</strong></button>)}</div>; }
function TransactionDetail({ transaction, community, onClose }: { transaction: Transaction; community: string; onClose: () => void }) { return <aside className="bank-detail-panel"><div className="bank-receipt-brand"><VybeLogo variant="full"/></div><header><button onClick={onClose} aria-label="Voltar"><Icon name="back"/></button><h2>Detalhes da transação</h2></header><div className="bank-detail-summary"><span className={`bank-detail-direction ${transaction.direction}`}><Icon name={transaction.direction === 'in' ? 'down' : 'up'}/></span><h3>{transactionTitle(transaction)}</h3><strong className={transaction.direction}>{transaction.direction === 'in' ? '+' : '−'} {money(transaction.amountCents)}</strong><p>{transaction.type === 'ADMIN_CREDIT' ? 'Crédito de: ' : transaction.type === 'ADMIN_DEBIT' || transaction.type === 'ADMIN_TAX' ? 'Motivo: ' : transaction.direction === 'in' ? 'De: ' : 'Para: '}{transaction.other?.displayName ?? (transaction.description || 'Comunidade')}</p><small>{dateTime(transaction.createdAt)}</small></div><dl className="bank-detail-fields"><div><dt>Status</dt><dd><i/> {transaction.status === 'COMPLETED' ? transaction.direction === 'in' ? 'Recebido' : 'Concluída' : transaction.status}</dd></div><div><dt>Tipo</dt><dd>{transaction.type === 'TRANSFER' ? 'Transferência' : transactionTitle(transaction)}</dd></div><div><dt>{transaction.direction === 'in' ? 'Origem' : 'Destino'}</dt><dd>{transaction.other?.displayName ?? 'Comunidade'}{transaction.other && <small>@{transaction.other.username}</small>}</dd></div><div><dt>Comunidade</dt><dd>{community}</dd></div><div><dt>ID da transação</dt><dd>{transaction.reference}</dd></div>{transaction.description && <div><dt>Descrição</dt><dd>{transaction.description}</dd></div>}</dl><button className="bank-receipt-button" onClick={() => window.print()}><Icon name="receipt"/> Ver comprovante</button></aside>; }
function CommunityBanner({ name, logo, cover }: { name: string; logo: string; cover: string }) { return <section className="bank-community-banner">{cover ? <img className="bank-banner-photo" src={cover} alt=""/> : logo ? <img className="bank-banner-photo" src={logo} alt=""/> : <span className="bank-community-icon"><Icon name="bank"/></span>}<div><strong>{name}</strong><p>Sua vida financeira dentro da comunidade, de forma segura e prática.</p></div><span className="bank-banner-note">Economia virtual do universo</span></section>; }
