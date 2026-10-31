import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import type { AccountDocument, CharacterDocument, SessionFields } from '../models/Social.js';
import { Account, Character, Session } from '../models/Social.js';
import type { CommunityDocument } from '../models/Community.js';
import { Community } from '../models/Community.js';
import { CommunitySanction } from '../models/CommunitySanction.js';

export function tenantSlugForHost(hostname: string, development = process.env.NODE_ENV === 'development', developmentSlug = process.env.VYBE_DEV_TENANT_SLUG ?? 'community') {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (development && ['localhost', '127.0.0.1'].includes(host)) return developmentSlug;
  if (!host.endsWith('.vybe.com.br')) return undefined;
  const prefix = host.slice(0, -'.vybe.com.br'.length);
  return prefix && !prefix.includes('.') ? prefix : undefined;
}

export function tenantScope<T extends Record<string, unknown>>(tenantId: mongoose.Types.ObjectId, filters: T = {} as T) {
  return { ...filters, tenantId };
}

declare global {
  namespace Express {
    interface Request {
      vybeTenant?: CommunityDocument;
      vybeSession?: SessionFields;
      vybeAccount?: AccountDocument;
      vybeCharacter?: CharacterDocument;
    }
  }
}

export async function resolveTenant(request: Request, response: Response, next: NextFunction) {
  if ((!request.path.startsWith('/api/') && !request.path.startsWith('/media/')) || request.path === '/api/health' || request.path === '/api/ready') { next(); return; }
  const host = request.hostname.toLowerCase().replace(/\.$/, '');
  const platformHosts = new Set(['vybe.com.br', 'www.vybe.com.br']);
  if (platformHosts.has(host)) { next(); return; }

  const subdomain = tenantSlugForHost(host);

  if (!subdomain) {
    response.status(404).json({ error: 'Comunidade não encontrada para este domínio.' });
    return;
  }
  if (mongoose.connection.readyState !== 1) {
    response.status(503).json({ error: 'Banco de dados indisponível.' });
    return;
  }
  const tenant = await Community.findOne({ subdomain, status: 'active' });
  if (!tenant) { response.status(404).json({ error: 'Comunidade não encontrada para este domínio.' }); return; }
  request.vybeTenant = tenant;
  next();
}

export function requireTenant(request: Request, response: Response, next: NextFunction) {
  if (!request.vybeTenant) {
    response.status(404).json({ error: 'Este recurso pertence a uma comunidade.' });
    return;
  }
  next();
}

export async function requireSession(request: Request, response: Response, next: NextFunction) {
  const tenant = request.vybeTenant;
  if (!tenant) { response.status(404).json({ error: 'Este recurso pertence a uma comunidade.' }); return; }
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('vybe_session='));
  const token = cookie?.slice('vybe_session='.length);
  if (!token) { response.status(401).json({ error: 'Sessão necessária.' }); return; }
  const tokenHash = createHash('sha256').update(decodeURIComponent(token)).digest('hex');
  const session = await Session.findOne({ tenantId: tenant._id, tokenHash, expiresAt: { $gt: new Date() } });
  if (!session) { response.status(401).json({ error: 'Sessão inválida ou expirada.' }); return; }
  const account = await Account.findOne({ _id: session.accountId, tenantId: tenant._id });
  if (!account) { response.status(401).json({ error: 'Conta indisponível.' }); return; }
  if (account.status !== 'active') {
    const sanction = await CommunitySanction.findOne({ tenantId: tenant._id, accountId: account._id, status: 'active' });
    if (!sanction) { response.status(401).json({ error: 'Conta indisponível.' }); return; }
    if (sanction.endsAt && sanction.endsAt <= new Date()) {
      sanction.status = 'expired';
      account.status = 'active';
      await Promise.all([sanction.save(), account.save()]);
    } else {
      response.status(403).json({ error: sanction.action === 'ban' ? 'Seu acesso a esta comunidade foi banido.' : 'Seu acesso a esta comunidade está suspenso.' });
      return;
    }
  }
  const character = await Character.findOne({ _id: session.characterId, tenantId: tenant._id, accountId: account._id });
  if (!character) { response.status(401).json({ error: 'Personagem indisponível.' }); return; }
  request.vybeSession = session;
  request.vybeAccount = account;
  request.vybeCharacter = character;
  next();
}

export function setSessionCookie(response: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `vybe_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
}

export function clearSessionCookie(response: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `vybe_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
