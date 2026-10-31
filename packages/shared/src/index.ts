export const apiInfo = {
  name: 'VYBE',
  version: '0.1.0',
} as const;

export const VERIFICATION_PRICE_BRL = 29.9;

export const LEGAL_TERMS_VERSION = '1.0';
export const LEGAL_PRIVACY_VERSION = '1.0';
export const LEGAL_LAST_UPDATED = '31 de outubro de 2026';

export function insertUnicodeText(value: string, inserted: string, start: number, end = start) {
  const from = Math.max(0, Math.min(value.length, start));
  const to = Math.max(from, Math.min(value.length, end));
  const next = `${value.slice(0, from)}${inserted}${value.slice(to)}`;
  const cursor = from + inserted.length;
  return { value: next, cursor };
}
