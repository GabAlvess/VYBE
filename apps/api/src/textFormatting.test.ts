import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFormatting, parseFormattedText, sanitizeFormattedText } from '@vybe/shared';

test('safe formatter parses every supported inline style and spoilers', () => {
  const nodes = parseFormattedText('**bold** *italic* __underline__ ~~strike~~ ||spoiler|| `const x = 1`');
  assert.deepEqual(nodes[0]?.type, 'paragraph');
  const marks = nodes[0]?.type === 'paragraph' ? nodes[0].children.map((node) => node.type) : [];
  assert.deepEqual(marks, ['strong', 'text', 'emphasis', 'text', 'underline', 'text', 'strike', 'text', 'spoiler', 'text', 'inlineCode']);
});

test('quotes, fenced code, URLs, mentions, emoji and legacy plain text remain readable', () => {
  const nodes = parseFormattedText('Olá 😀 @everyone https://example.com\n> citação\n```\n<script>alert(1)</script>\n```');
  const types = nodes.map((node) => node.type);
  assert.deepEqual(types, ['paragraph', 'blockquote', 'codeBlock']);
  assert.equal(nodes[0]?.type === 'paragraph' && nodes[0].children.some((node) => node.type === 'link'), true);
  assert.equal(nodes[2]?.type === 'codeBlock' && nodes[2].text, '<script>alert(1)</script>');
  assert.equal(parseFormattedText('texto antigo')[0]?.type, 'paragraph');
  assert.equal(parseFormattedText('[x](javascript:alert(1))')[0]?.type, 'paragraph');
});

test('only selected text is formatted and wrappers can be toggled off', () => {
  const formatted = applyFormatting('Olá mundo!', 4, 9, 'bold');
  assert.equal(formatted.value, 'Olá **mundo**!');
  assert.deepEqual(applyFormatting(formatted.value, 4, 13, 'bold'), { value: 'Olá mundo!', selectionStart: 4, selectionEnd: 9 });
  assert.equal(applyFormatting('linha 1\nlinha 2', 0, 15, 'quote').value, '> linha 1\n> linha 2');
  assert.equal(applyFormatting('antes frase depois', 6, 11, 'quote').value, 'antes \n> frase\n depois');
  assert.equal(applyFormatting('a\nb', 0, 3, 'code').value, '```\na\nb\n```');
});

test('server safe text normalization preserves formatting and rejects oversized input', () => {
  assert.equal(sanitizeFormattedText('  **oi**\r\n😀\u0000  ', 30), '**oi**\n😀');
  assert.equal(sanitizeFormattedText('texto grande', 4), null);
  assert.equal(sanitizeFormattedText('<img src=x onerror=alert(1)>', 40), '<img src=x onerror=alert(1)>');
  assert.equal(sanitizeFormattedText(null, 100), null);
});
