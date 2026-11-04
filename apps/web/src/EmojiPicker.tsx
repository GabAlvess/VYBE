import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Categories as PickerCategory, EmojiClickData } from 'emoji-picker-react';
import portugueseEmojiData from 'emoji-picker-react/data/emojis-pt';
import { MaterialIcon } from './MaterialIcon';
import { insertUnicodeText } from '@vybe/shared';
import './EmojiPicker.css';

type EditableTextElement = HTMLTextAreaElement | HTMLInputElement;
const EmojiPickerView = lazy(() => import('emoji-picker-react'));

export function useEmojiInsertion(
  inputRef: RefObject<EditableTextElement | null>,
  value: string,
  onChange: (value: string) => void,
) {
  const selection = useRef<{ start: number; end: number } | null>(null);

  function captureSelection() {
    const input = inputRef.current;
    if (input) selection.current = { start: input.selectionStart ?? value.length, end: input.selectionEnd ?? value.length };
  }

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    const start = selection.current?.start ?? input?.selectionStart ?? value.length;
    const end = selection.current?.end ?? input?.selectionEnd ?? value.length;
    const inserted = insertUnicodeText(value, emoji, start, end);
    onChange(inserted.value);
    const cursor = inserted.cursor;
    selection.current = { start: cursor, end: cursor };
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  }

  return { captureSelection, insertEmoji };
}

const categories: Array<{ category: PickerCategory; name: string; icon: string }> = [
  { category: 'suggested' as PickerCategory, name: 'Recentes', icon: '🕘' },
  { category: 'smileys_people' as PickerCategory, name: 'Pessoas e emoções', icon: '😀' },
  { category: 'animals_nature' as PickerCategory, name: 'Animais e natureza', icon: '🐶' },
  { category: 'food_drink' as PickerCategory, name: 'Comida', icon: '🍕' },
  { category: 'activities' as PickerCategory, name: 'Atividades', icon: '⚽' },
  { category: 'travel_places' as PickerCategory, name: 'Viagens', icon: '✈️' },
  { category: 'objects' as PickerCategory, name: 'Objetos', icon: '💡' },
  { category: 'symbols' as PickerCategory, name: 'Símbolos', icon: '🎉' },
];

const RECENTS_KEY = 'vybe:recent-emojis:v1';
const RECENTS_LIMIT = 20;
const DEFAULT_EMOJIS = ['1f60a', '2764-fe0f', '1f602', '1f970', '1f44d', '1f64f', '1f389', '1f49a', '1f914', '1f60d'];

function readRecentEmojis() {
  try {
    const recent = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(recent) && recent.length ? recent.filter((item): item is string => typeof item === 'string').slice(0, RECENTS_LIMIT) : DEFAULT_EMOJIS;
  } catch { return []; }
}

export function EmojiButton({ onSelect, onBeforeOpen, label = 'Adicionar emoji', className = '' }: { onSelect: (emoji: string) => void; onBeforeOpen: () => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [recent, setRecent] = useState<string[]>(readRecentEmojis);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const positionPopup = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const popup = popoverRef.current;
      if (!anchor || !popup) return;
      const width = Math.min(360, window.innerWidth - 24);
      const height = popup.getBoundingClientRect().height || 360;
      const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
      const above = anchor.top - height - 8;
      const top = above >= 12 ? above : Math.min(anchor.bottom + 8, window.innerHeight - height - 12);
      setPopupPosition({ top: Math.max(12, top), left, width });
    };
    positionPopup();
    window.addEventListener('resize', positionPopup);
    window.addEventListener('scroll', positionPopup, true);
    return () => {
      window.removeEventListener('resize', positionPopup);
      window.removeEventListener('scroll', positionPopup, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  function chooseEmoji(data: EmojiClickData) {
    const next = [data.unified, ...recent.filter((item) => item !== data.unified)].slice(0, RECENTS_LIMIT);
    setRecent(next);
    try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* Recents are an optional convenience. */ }
    setOpen(false);
    onSelect(data.emoji);
  }

  return <span className={`vybe-emoji-anchor ${className}`} ref={rootRef}>
    <button ref={buttonRef} type="button" className="vybe-emoji-trigger" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onMouseDown={(event) => { onBeforeOpen(); event.preventDefault(); }} onClick={() => setOpen((value) => !value)}><MaterialIcon name="sentiment_satisfied"/></button>
    {open && createPortal(<span ref={popoverRef} className={`vybe-emoji-popover ${className}`} role="dialog" aria-label="Seletor de emojis" style={popupPosition ? { top: popupPosition.top, left: popupPosition.left, width: popupPosition.width } : undefined}><Suspense fallback={<span className="emoji-loading">Carregando emojis…</span>}><EmojiPickerView
      theme="light"
      emojiStyle="native"
      emojiData={portugueseEmojiData}
      categories={categories}
      suggestedEmojis={recent}
      searchPlaceholder="Buscar emoji…"
      searchLabel="Buscar emoji"
      searchClearButtonLabel="Limpar busca"
      labels={{ searchResultsNone: 'Nenhum emoji encontrado', searchResultsOne: '%n emoji encontrado', searchResultsMany: '%n emojis encontrados', categoryNavigation: 'Categorias de emojis', reactions: 'Reações', expandReactions: 'Mais emojis', loading: 'Carregando emojis…' }}
      previewConfig={{ showPreview: false }}
      width={340}
      height={340}
      onEmojiClick={chooseEmoji}
    /></Suspense></span>, document.body)}
  </span>;
}
