import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ChangeEvent, type KeyboardEvent, type CSSProperties, type ReactNode } from 'react';
import { applyFormatting, parseFormattedText, type FormattedTextNode, type FormattingAction } from '@vybe/shared';
import { MaterialIcon } from './MaterialIcon';
import './TextFormatting.css';

function FormattedNode({ node, index }: { node: FormattedTextNode; index: number }) {
  if (node.type === 'text') return <span key={index}>{node.text}</span>;
  if (node.type === 'link') return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">{node.text}</a>;
  if (node.type === 'codeBlock') return <pre key={index} className="vybe-format-code-block"><code>{node.text}</code></pre>;
  const children = node.children.map((child, childIndex) => <FormattedNode key={childIndex} node={child} index={childIndex}/>);
  if (node.type === 'paragraph') return <p key={index}>{children}</p>;
  if (node.type === 'blockquote') return <blockquote key={index}>{children}</blockquote>;
  if (node.type === 'strong') return <strong key={index}>{children}</strong>;
  if (node.type === 'emphasis') return <em key={index}>{children}</em>;
  if (node.type === 'underline') return <u key={index}>{children}</u>;
  if (node.type === 'strike') return <s key={index}>{children}</s>;
  if (node.type === 'inlineCode') return <code key={index} className="vybe-format-inline-code">{children}</code>;
  return <Spoiler key={index}>{children}</Spoiler>;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return <button className={`vybe-format-spoiler${revealed ? ' is-revealed' : ''}`} type="button" aria-expanded={revealed} aria-label={revealed ? 'Ocultar spoiler' : 'Revelar spoiler'} onClick={() => setRevealed((value) => !value)}>{revealed ? children : <span aria-hidden="true">{children}</span>}</button>;
}

export function FormattedText({ text, className = '' }: { text: string; className?: string }) {
  const nodes = parseFormattedText(text);
  return <div className={`vybe-formatted-text ${className}`.trim()}>{nodes.map((node, index) => <FormattedNode key={index} node={node} index={index}/>)}</div>;
}

type TextFormattingEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
  rows?: number;
  name?: string;
  className?: string;
  textareaClassName?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  'aria-label'?: string;
};

const actions: Array<{ id: FormattingAction; label: string; icon?: string; symbol?: string }> = [
  { id: 'bold', label: 'Negrito', symbol: 'B' }, { id: 'italic', label: 'Itálico', symbol: 'I' },
  { id: 'underline', label: 'Sublinhado', symbol: 'U' }, { id: 'strike', label: 'Riscado', symbol: 'S' },
  { id: 'quote', label: 'Citação', symbol: '❝' }, { id: 'code', label: 'Código', symbol: '</>' },
  { id: 'spoiler', label: 'Spoiler', icon: 'visibility_off' },
];

const shortcutActions: Record<string, FormattingAction> = { b: 'bold', i: 'italic', u: 'underline' };

export const TextFormattingEditor = forwardRef<HTMLTextAreaElement, TextFormattingEditorProps>(function TextFormattingEditor({ value, onChange, placeholder, maxLength, disabled, required, rows = 2, name, className = '', textareaClassName = '', onKeyDown, onBlur, onFocus, 'aria-label': ariaLabel }, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement);

  const updateToolbar = useCallback(() => {
    const field = textareaRef.current;
    if (!field || field.disabled || field.selectionStart === field.selectionEnd) { selectionRef.current = null; setToolbar(null); return; }
    const start = field.selectionStart;
    const end = field.selectionEnd;
    selectionRef.current = { start, end };
    const rect = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    const mirror = document.createElement('div');
    const copied = ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','textTransform','textIndent','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','boxSizing','wordSpacing','tabSize'] as const;
    copied.forEach((key) => { (mirror.style as unknown as Record<string, string>)[key] = (style as unknown as Record<string, string>)[key]; });
    mirror.style.position = 'fixed'; mirror.style.left = `${rect.left}px`; mirror.style.top = `${rect.top - field.scrollTop}px`;
    mirror.style.width = `${rect.width}px`; mirror.style.height = 'auto'; mirror.style.minHeight = '0'; mirror.style.maxHeight = 'none';
    mirror.style.overflow = 'hidden'; mirror.style.visibility = 'hidden'; mirror.style.whiteSpace = 'pre-wrap'; mirror.style.overflowWrap = 'break-word'; mirror.style.pointerEvents = 'none';
    const before = field.value.slice(0, start);
    mirror.append(document.createTextNode(before || ''));
    const selected = document.createElement('span'); selected.textContent = field.value.slice(start, end) || '\u200b'; mirror.append(selected);
    document.body.append(mirror);
    const selectionRect = selected.getBoundingClientRect();
    mirror.remove();
    const width = Math.min(338, window.innerWidth - 16);
    const left = Math.max(8, Math.min(selectionRect.left + selectionRect.width / 2 - width / 2, window.innerWidth - width - 8));
    const top = Math.max(8, selectionRect.top - 48);
    setToolbar({ top, left });
  }, []);

  const applyAction = (action: FormattingAction) => {
    const field = textareaRef.current;
    const selection = selectionRef.current;
    if (!field || !selection) return;
    const result = applyFormatting(value, selection.start, selection.end, action);
    onChange(result.value);
    setToolbar(null);
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(result.selectionStart, result.selectionEnd); selectionRef.current = { start: result.selectionStart, end: result.selectionEnd }; updateToolbar(); });
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => { onChange(event.currentTarget.value); requestAnimationFrame(updateToolbar); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = (event.metaKey || event.ctrlKey) && !event.altKey ? shortcutActions[event.key.toLowerCase()] : undefined;
    if (action) {
      event.preventDefault();
      const field = event.currentTarget;
      const result = applyFormatting(value, field.selectionStart, field.selectionEnd, action);
      onChange(result.value);
      requestAnimationFrame(() => { field.focus(); field.setSelectionRange(result.selectionStart, result.selectionEnd); updateToolbar(); });
      return;
    }
    onKeyDown?.(event);
  };

  return <div className={`vybe-format-editor ${className}`.trim()}>
    <textarea ref={textareaRef} value={value} onChange={handleChange} onSelect={updateToolbar} onMouseUp={updateToolbar} onKeyUp={updateToolbar} onBlur={() => { setToolbar(null); onBlur?.(); }} onFocus={onFocus} onKeyDown={handleKeyDown} placeholder={placeholder} maxLength={maxLength} disabled={disabled} required={required} rows={rows} name={name} aria-label={ariaLabel} className={textareaClassName}/>
    {toolbar && <div className="vybe-format-toolbar" role="toolbar" aria-label="Formatação de texto" style={{ top: toolbar.top, left: toolbar.left } as CSSProperties} onMouseDown={(event) => event.preventDefault()}>{actions.map((action) => <button key={action.id} type="button" title={action.label} aria-label={action.label} onClick={() => applyAction(action.id)}>{action.icon ? <MaterialIcon name={action.icon}/> : <span className={`vybe-format-symbol is-${action.id}`}>{action.symbol}</span>}</button>)}</div>}
  </div>;
});
