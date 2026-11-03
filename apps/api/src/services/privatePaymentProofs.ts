import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const privateDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../private/vybe-plus-proofs');
const signatures = {
  'image/png': (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'application/pdf': (bytes: Buffer) => bytes.subarray(0, 5).toString() === '%PDF-',
} as const;

export type PaymentProofMimeType = keyof typeof signatures;
export function parsePaymentProof(dataUrl: unknown): { bytes: Buffer; mimeType: PaymentProofMimeType; extension: 'png' | 'jpg' | 'pdf' } {
  if (typeof dataUrl !== 'string' || dataUrl.length > 7_000_000) throw new Error('Envie um comprovante de até 5 MB.');
  const match = dataUrl.match(/^data:(image\/png|image\/jpeg|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('O comprovante deve ser PNG, JPG ou PDF.');
  const mimeType = match[1] as PaymentProofMimeType;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('O comprovante deve ter até 5 MB.');
  if (!signatures[mimeType](bytes)) throw new Error('O conteúdo do arquivo não corresponde ao formato declarado.');
  return { bytes, mimeType, extension: mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'pdf' };
}

export async function savePaymentProof(bytes: Buffer, extension: 'png' | 'jpg' | 'pdf') {
  const id = randomBytes(16).toString('hex');
  const filename = `${id}.${extension}`;
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(privateDirectory, filename), bytes, { flag: 'wx', mode: 0o600 });
  return { id, filename };
}

export async function readPaymentProof(filename: string) {
  if (!/^[a-f0-9]{32}\.(png|jpg|pdf)$/.test(filename)) throw new Error('Comprovante não encontrado.');
  return readFile(resolve(privateDirectory, filename));
}
