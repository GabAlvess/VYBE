import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import { getVybeFont, normalizeVybeFontId, VYBE_FONTS, VYBE_FONT_CATEGORIES, VYBE_DEFAULT_FONT_ID, type VybeFontCategory } from '@vybe/shared';
import './ProfileFontPicker.css';

type AppKey = 'SOCIAL' | 'ECHO' | 'MATCH';
type Props = {
  app: AppKey;
  profileId: string;
  communityId: string;
  currentFont: string;
  profileName?: string;
  title?: string;
  description?: string;
  resetLabel?: string;
  onChange: (fontId: string) => void;
};

const MAX_VISIBLE_FONTS = 12;
const loadedFontIds = new Set<string>();

export function loadVybeGoogleFont(fontId: string) {
  const font = getVybeFont(fontId);
  if (!font || loadedFontIds.has(font.id) || typeof document === 'undefined') return;
  loadedFontIds.add(font.id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}&display=swap`;
  link.dataset.vybeFont = font.id;
  link.onerror = () => loadedFontIds.delete(font.id);
  document.head.append(link);
}

function scopedStorageKey(kind: 'favorites' | 'recent', app: AppKey, profileId: string, communityId: string) {
  return `vybe:font-picker:${kind}:${communityId}:${profileId}:${app}`;
}

function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && getVybeFont(item) !== null) : [];
  } catch { return []; }
}

export function ProfileFontPicker({ app, profileId, communityId, currentFont, profileName, title = 'Escolha sua fonte', description, resetLabel = 'Restaurar fonte padrão', onChange }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VybeFontCategory | 'all' | 'favorites' | 'recent'>('all');
  const favoritesKey = scopedStorageKey('favorites', app, profileId, communityId);
  const recentKey = scopedStorageKey('recent', app, profileId, communityId);
  const [favorites, setFavorites] = useState<string[]>(() => readIds(favoritesKey));
  const [recent, setRecent] = useState<string[]>(() => readIds(recentKey));
  const normalizedCurrentFont = normalizeVybeFontId(currentFont);
  const activeFont = getVybeFont(normalizedCurrentFont);
  const previewName = profileName?.trim() || 'Seu nome no VYBE';

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return VYBE_FONTS.filter((font) => {
      const matchesCategory = category === 'all' || category === 'favorites'
        ? category !== 'favorites' || favorites.includes(font.id)
        : category === 'recent' ? recent.includes(font.id) : font.categories.includes(category);
      return matchesCategory && (!needle || font.family.toLocaleLowerCase('pt-BR').includes(needle));
    });
  }, [category, favorites, query, recent]);
  const visibleFonts = filtered.slice(0, MAX_VISIBLE_FONTS);

  useEffect(() => {
    if (activeFont) loadVybeGoogleFont(activeFont.id);
    visibleFonts.forEach((font) => loadVybeGoogleFont(font.id));
  }, [activeFont?.id, visibleFonts.map((font) => font.id).join('|')]);

  function choose(fontId: string) {
    const normalized = normalizeVybeFontId(fontId);
    onChange(normalized);
    if (normalized !== VYBE_DEFAULT_FONT_ID) {
      const next = [normalized, ...recent.filter((id) => id !== normalized)].slice(0, 8);
      setRecent(next);
      try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* armazenamento local opcional */ }
    }
  }

  function toggleFavorite(fontId: string) {
    const next = favorites.includes(fontId) ? favorites.filter((id) => id !== fontId) : [fontId, ...favorites];
    setFavorites(next);
    try { localStorage.setItem(favoritesKey, JSON.stringify(next)); } catch { /* armazenamento local opcional */ }
  }

  return <section className="vybe-font-picker" data-app={app} data-profile-id={profileId} data-community-id={communityId} aria-label={`Fontes do ${app}`}>
    <header className="vybe-font-picker-heading"><div><strong>{title}</strong><small>{description ?? `Prévia de como seu nome aparece no ${app === 'SOCIAL' ? 'Social' : app === 'ECHO' ? 'Echo' : 'Match'}.`}</small></div><button type="button" className="vybe-font-reset" onClick={() => choose(VYBE_DEFAULT_FONT_ID)} disabled={normalizedCurrentFont === VYBE_DEFAULT_FONT_ID}>{resetLabel}</button></header>
    <div className="vybe-font-current"><span>Fonte atual</span><strong>{activeFont?.family ?? 'Padrão VYBE'}</strong><span className="vybe-font-current-preview" style={activeFont ? { fontFamily: `"${activeFont.family}", sans-serif` } : undefined}>{previewName}</span></div>
    <label className="vybe-font-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Pesquisar pelo nome da fonte..." aria-label="Buscar fonte"/><kbd>{filtered.length}</kbd></label>
    <nav className="vybe-font-categories" aria-label="Categorias de fontes">
      <button type="button" className={category === 'all' ? 'is-active' : ''} onClick={() => setCategory('all')}>Todas</button>
      {VYBE_FONT_CATEGORIES.map((item) => <button key={item.id} type="button" className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      <button type="button" className={category === 'favorites' ? 'is-active' : ''} onClick={() => setCategory('favorites')}>Favoritas</button>
      <button type="button" className={category === 'recent' ? 'is-active' : ''} onClick={() => setCategory('recent')}>Recentes</button>
    </nav>
    <div className="vybe-font-grid" aria-live="polite">
      {visibleFonts.map((font) => <article className={`vybe-font-option${normalizedCurrentFont === font.id ? ' is-selected' : ''}`} key={font.id}>
        <button type="button" className="vybe-font-select" aria-pressed={normalizedCurrentFont === font.id} onClick={() => choose(font.id)}>
          <strong style={{ fontFamily: `"${font.family}", sans-serif` }}>{font.family}</strong>
          {normalizedCurrentFont === font.id && <i aria-label="Fonte selecionada">✓</i>}
        </button>
        <button type="button" className={`vybe-font-favorite${favorites.includes(font.id) ? ' is-favorite' : ''}`} aria-label={favorites.includes(font.id) ? `Remover ${font.family} das favoritas` : `Adicionar ${font.family} às favoritas`} aria-pressed={favorites.includes(font.id)} onClick={() => toggleFavorite(font.id)}>★</button>
      </article>)}
      {filtered.length === 0 && <p className="vybe-font-empty">Nenhuma fonte encontrada nesta busca.</p>}
    </div>
    <small className="vybe-font-loading-note">As prévias carregam sob demanda. Se uma fonte não estiver disponível, o VYBE usa a fonte padrão.</small>
  </section>;
}

type FontProfile = { verified?: boolean; profileCustomization?: { primaryFontId?: string; secondaryFontId?: string; nameFont?: string; fontId?: string } };
export function ProfileFontText({ character, role, as: Tag = 'span', className, children }: { character?: FontProfile | null; role: 'primary' | 'secondary'; as?: ElementType; className?: string; children: ReactNode }) {
  const custom = character?.profileCustomization;
  const fontId = role === 'primary' ? custom?.primaryFontId ?? custom?.nameFont ?? custom?.fontId : custom?.secondaryFontId;
  const font = character?.verified ? getVybeFont(normalizeVybeFontId(fontId)) : null;
  useEffect(() => { if (font) loadVybeGoogleFont(font.id); }, [font?.id]);
  return <Tag className={className} style={font ? { fontFamily: `"${font.family}", var(--vybe-profile-font, sans-serif)` } : undefined}>{children}</Tag>;
}
