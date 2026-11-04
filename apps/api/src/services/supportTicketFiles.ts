import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const privateRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads/support-private');
const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
export type SupportFile = { storageName: string; name: string; mimeType: string; size: number };

function signatureIsValid(mime: string, bytes: Buffer) {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  return false;
}

export async function saveSupportFiles(ticketId: string, value: unknown): Promise<SupportFile[]> {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error('Anexe até 3 arquivos por mensagem.');
  const folder = resolve(privateRoot, ticketId);
  const prepared: Array<{ bytes: Buffer; mimeType: string; name: string; extension: string }> = [];
  let total = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') throw new Error('Anexo inválido.');
    const item = entry as Record<string, unknown>;
    if (typeof item.dataUrl !== 'string' || item.dataUrl.length > 7_100_000 || typeof item.name !== 'string') throw new Error('Arquivo inválido ou maior que 5 MB.');
    const match = item.dataUrl.match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || !allowed.has(match[1].toLowerCase())) throw new Error('Use PNG, JPG, WebP ou PDF.');
    const mimeType = match[1].toLowerCase(); const bytes = Buffer.from(match[2], 'base64');
    total += bytes.length;
    if (!bytes.length || bytes.length > 5 * 1024 * 1024 || total > 10 * 1024 * 1024 || !signatureIsValid(mimeType, bytes)) throw new Error('Arquivo inválido; cada anexo deve ter até 5 MB e o conteúdo precisa corresponder ao formato.');
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1];
    prepared.push({ bytes, mimeType, extension, name: item.name.trim().replace(/[\\/\0-\x1f]/g, '_').slice(0, 180) || `anexo.${extension}` });
  }
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const saved: SupportFile[] = [];
  try {
    for (const item of prepared) {
      const storageName = `${randomBytes(20).toString('hex')}.${item.extension}`;
      await writeFile(resolve(folder, storageName), item.bytes, { flag: 'wx', mode: 0o600 });
      saved.push({ storageName, name: item.name, mimeType: item.mimeType, size: item.bytes.length });
    }
    return saved;
  } catch (error) {
    await Promise.all(saved.map((file) => rm(resolve(folder, file.storageName), { force: true })));
    throw error;
  }
}

export async function readSupportFile(ticketId: string, storageName: string) {
  if (!/^[a-f0-9]{40}\.(png|jpg|webp|pdf)$/.test(storageName)) throw new Error('Arquivo não encontrado.');
  return readFile(resolve(privateRoot, ticketId, storageName));
}
