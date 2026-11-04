export type FormattingMark = 'strong' | 'emphasis' | 'underline' | 'strike' | 'spoiler' | 'inlineCode';
export type FormattedTextNode =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'paragraph' | 'blockquote'; children: FormattedTextNode[] }
  | { type: FormattingMark; children: FormattedTextNode[] }
  | { type: 'codeBlock'; text: string };

const inlineMarks: Array<[string, FormattingMark]> = [
  ['**', 'strong'], ['__', 'underline'], ['~~', 'strike'], ['||', 'spoiler'], ['*', 'emphasis'], ['_', 'emphasis'], ['`', 'inlineCode'],
];

function parseInline(source: string): FormattedTextNode[] {
  const nodes: FormattedTextNode[] = [];
  let plain = '';
  const flush = () => { if (plain) { nodes.push({ type: 'text', text: plain }); plain = ''; } };
  for (let index = 0; index < source.length;) {
    if (source[index] === '\\' && index + 1 < source.length) { plain += source[index + 1]; index += 2; continue; }
    let match: { token: string; mark: FormattingMark; close: number } | undefined;
    for (const [token, mark] of inlineMarks) {
      if (!source.startsWith(token, index)) continue;
      const close = source.indexOf(token, index + token.length);
      if (close > index + token.length) { match = { token, mark, close }; break; }
    }
    if (!match) {
      const urlMatch = source.slice(index).match(/^https?:\/\/[^\s<>]+/i);
      if (urlMatch) {
        const raw = urlMatch[0];
        const hrefText = raw.replace(/[),.!?;:]+$/, '');
        try { const url = new URL(hrefText); if (url.protocol === 'http:' || url.protocol === 'https:') { flush(); nodes.push({ type: 'link', text: hrefText, href: url.href }); index += hrefText.length; continue; } } catch { /* Treat malformed URLs as plain text. */ }
      }
      plain += source[index]; index += 1; continue;
    }
    flush();
    const content = source.slice(index + match.token.length, match.close);
    nodes.push({ type: match.mark, children: match.mark === 'inlineCode' ? [{ type: 'text', text: content }] : parseInline(content) });
    index = match.close + match.token.length;
  }
  flush();
  return nodes;
}

/** Parse the VYBE safe Markdown subset. It produces data nodes only; HTML is never interpreted. */
export function parseFormattedText(source: string): FormattedTextNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const nodes: FormattedTextNode[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) { nodes.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) }); paragraph = []; }
  };
  for (let index = 0; index < lines.length;) {
    if (/^\s*```/.test(lines[index])) {
      flushParagraph();
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      nodes.push({ type: 'codeBlock', text: code.join('\n') });
      continue;
    }
    if (/^\s*> ?/.test(lines[index])) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && /^\s*> ?/.test(lines[index])) quoted.push(lines[index++].replace(/^\s*> ?/, ''));
      nodes.push({ type: 'blockquote', children: parseInline(quoted.join('\n')) });
      continue;
    }
    paragraph.push(lines[index++]);
  }
  flushParagraph();
  return nodes;
}

/** Keeps formatted content as inert text while removing invalid control characters. */
export function sanitizeFormattedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (normalized.length > maxLength) return null;
  return normalized.trim();
}

export type FormattingAction = 'bold' | 'italic' | 'underline' | 'strike' | 'quote' | 'code' | 'spoiler';
const wrappers: Partial<Record<FormattingAction, [string, string]>> = {
  bold: ['**', '**'], italic: ['*', '*'], underline: ['__', '__'], strike: ['~~', '~~'], code: ['`', '`'], spoiler: ['||', '||'],
};

export function applyFormatting(value: string, selectionStart: number, selectionEnd: number, action: FormattingAction) {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selected = value.slice(start, end);
  if (action === 'quote') {
    const before = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const after = end < value.length && value[end] !== '\n' ? '\n' : '';
    const quoted = selected.split('\n').map((line) => `> ${line}`).join('\n');
    const result = value.slice(0, start) + before + quoted + after + value.slice(end);
    return { value: result, selectionStart: start + before.length, selectionEnd: start + before.length + quoted.length };
  }
  const [prefix, suffix] = wrappers[action]!;
  if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
    const unwrapped = selected.slice(prefix.length, selected.length - suffix.length);
    const result = value.slice(0, start) + unwrapped + value.slice(end);
    return { value: result, selectionStart: start, selectionEnd: start + unwrapped.length };
  }
  const blockCode = action === 'code' && selected.includes('\n');
  const before = blockCode && start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const after = blockCode && end < value.length && value[end] !== '\n' ? '\n' : '';
  const open = blockCode ? '```\n' : prefix;
  const close = blockCode ? '\n```' : suffix;
  const wrapped = `${before}${open}${selected}${close}${after}`;
  return { value: value.slice(0, start) + wrapped + value.slice(end), selectionStart: start + before.length + open.length, selectionEnd: start + before.length + open.length + selected.length };
}

export function hasFormattingSyntax(value: string): boolean {
  return /(?:\*\*|__|~~|\|\||`|^\s*> )/m.test(value);
}
