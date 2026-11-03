export const apiInfo = {
  name: 'VYBE',
  version: '0.1.0',
} as const;

export const VERIFICATION_PRICE_BRL = 29.9;

export const LEGAL_TERMS_VERSION = '1.0';
export const LEGAL_PRIVACY_VERSION = '1.0';
export const LEGAL_LAST_UPDATED = '31 de outubro de 2026';

export const ACCOUNT_GENDER_VALUES = [
  'WOMAN', 'MAN', 'NON_BINARY', 'GENDER_FLUID', 'AGENDER', 'BIGENDER', 'DEMIGENDER',
  'GENDERQUEER', 'TWO_SPIRIT', 'QUESTIONING', 'CUSTOM', 'PREFER_NOT_TO_SAY',
] as const;
export type AccountGender = typeof ACCOUNT_GENDER_VALUES[number];

export const GREETING_PREFERENCE_VALUES = ['FEMININE', 'MASCULINE', 'NEUTRAL', 'CUSTOM'] as const;
export type GreetingPreference = typeof GREETING_PREFERENCE_VALUES[number];

export function accountGreetingLabel(preference: GreetingPreference, customGreeting = '') {
  if (preference === 'FEMININE') return 'BEM-VINDA DE VOLTA';
  if (preference === 'MASCULINE') return 'BEM-VINDO DE VOLTA';
  if (preference === 'NEUTRAL') return 'QUE BOM TER VOCÊ DE VOLTA';
  return customGreeting.trim();
}

export function validateAccountProfilePreferences(gender: unknown, customGender: unknown, greetingPreference: unknown, customGreeting: unknown) {
  const genderValid = typeof gender === 'string' && ACCOUNT_GENDER_VALUES.includes(gender as AccountGender);
  const customGenderText = typeof customGender === 'string' ? customGender.trim() : '';
  const customGenderValid = customGenderText.length <= 80 && (gender !== 'CUSTOM' || customGenderText.length >= 2);
  const preferenceValid = typeof greetingPreference === 'string' && GREETING_PREFERENCE_VALUES.includes(greetingPreference as GreetingPreference);
  const customGreetingText = typeof customGreeting === 'string' ? customGreeting.trim() : '';
  const customGreetingValid = customGreetingText.length <= 80 && (greetingPreference !== 'CUSTOM' || customGreetingText.length >= 2);
  return { valid: genderValid && customGenderValid && preferenceValid && customGreetingValid, genderValid, customGenderValid, preferenceValid, customGreetingValid };
}

export function mapLegacyAccountGender(value: unknown): { gender: AccountGender; customGender?: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mappings: Record<string, AccountGender> = {
    female: 'WOMAN', woman: 'WOMAN', mulher: 'WOMAN', feminino: 'WOMAN', feminine: 'WOMAN',
    male: 'MAN', man: 'MAN', homem: 'MAN', masculino: 'MAN', masculine: 'MAN',
    non_binary: 'NON_BINARY', nonbinary: 'NON_BINARY', 'não_binário': 'NON_BINARY', nao_binario: 'NON_BINARY',
    gender_fluid: 'GENDER_FLUID', agender: 'AGENDER', bigender: 'BIGENDER', demigender: 'DEMIGENDER',
    genderqueer: 'GENDERQUEER', two_spirit: 'TWO_SPIRIT', questioning: 'QUESTIONING',
    prefer_not_to_say: 'PREFER_NOT_TO_SAY', 'prefiro_não_informar': 'PREFER_NOT_TO_SAY', prefiro_nao_informar: 'PREFER_NOT_TO_SAY',
  };
  const gender = mappings[normalized];
  return gender ? { gender } : { gender: 'CUSTOM', customGender: value.trim().slice(0, 80) };
}

export function insertUnicodeText(value: string, inserted: string, start: number, end = start) {
  const from = Math.max(0, Math.min(value.length, start));
  const to = Math.max(from, Math.min(value.length, end));
  const next = `${value.slice(0, from)}${inserted}${value.slice(to)}`;
  const cursor = from + inserted.length;
  return { value: next, cursor };
}
export * from './vybeFonts.js';
