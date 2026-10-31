export function normalizeJoinUsername(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase();
}

export function normalizePhotoplayerName(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

export function validateJoinAge(age: unknown, minimumAge: number) {
  return Number.isInteger(age) && typeof age === 'number' && age >= minimumAge && age <= 100;
}

export function validateJoinText(value: unknown, min: number, max: number) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

export function validateJoinUsername(value: unknown, minimumLength: number, maximumLength: number) {
  if (typeof value !== 'string') return false;
  const normalized = normalizeJoinUsername(value);
  return normalized.length >= minimumLength && normalized.length <= maximumLength && /^[a-z0-9._]+$/.test(normalized);
}
