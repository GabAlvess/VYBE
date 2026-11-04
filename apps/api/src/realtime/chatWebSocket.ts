import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { Account, Character, Session } from '../models/Social.js';
import { Community } from '../models/Community.js';
import { CommunitySanction } from '../models/CommunitySanction.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeSession } from '../models/VybeSession.js';
import { Conversation } from '../models/Conversation.js';
import { hashSessionToken, tenantSlugForHost } from '../middleware/tenant.js';

type SocketIdentity = { tenantId: string; profileId: string };
type ConnectedSocket = SocketIdentity & { socket: WebSocket; heartbeat?: NodeJS.Timeout; alive?: boolean };
type RealtimeEvent = { type: string; [key: string]: unknown };

const peers = new Set<ConnectedSocket>();
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function removePeer(peer: ConnectedSocket) {
  if (!peers.delete(peer)) return;
  if (peer.heartbeat) clearInterval(peer.heartbeat);
  if (!getOnlineProfileIds(peer.tenantId).includes(peer.profileId)) emitPresence(peer.tenantId, peer.profileId, false);
}

export function disconnectProfile(tenantId: string, profileId: string) {
  for (const peer of [...peers]) {
    if (peer.tenantId !== tenantId || peer.profileId !== profileId) continue;
    peer.socket.terminate();
    removePeer(peer);
  }
}

function cookieValue(header: string | undefined, name: string) {
  const match = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!match) return '';
  try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return ''; }
}

async function authenticate(request: import('node:http').IncomingMessage): Promise<SocketIdentity | null> {
  const host = request.headers['x-forwarded-host']?.toString().split(',')[0]?.trim() || request.headers.host || '';
  const origin = request.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== host && origin !== process.env.WEB_ORIGIN) return null; } catch { return null; }
  }
  const hostname = new URL(`http://${host}`).hostname;
  const subdomain = tenantSlugForHost(hostname);
  if (!subdomain) return null;
  const community: any = await Community.findOne({ subdomain, status: 'active' }).select('_id settings').lean();
  if (!community || (community.settings?.features?.messages === false && community.settings?.features?.conversations === false)) return null;

  const sessionToken = cookieValue(request.headers.cookie, 'vybe_session');
  const globalToken = cookieValue(request.headers.cookie, 'vybe_account_session');
  if (sessionToken) {
    const session = await Session.findOne({ tenantId: community._id, tokenHash: hashSessionToken(sessionToken), expiresAt: { $gt: new Date() } }).lean();
    if (session) {
      const account = await Account.findOne({ _id: session.accountId, tenantId: community._id, status: 'active' }).select('_id').lean();
      const profile = account && await Character.findOne({ _id: session.characterId, accountId: account._id, tenantId: community._id }).select('_id').lean();
      if (account && profile) return { tenantId: community._id.toString(), profileId: profile._id.toString() };
    }
  }
  if (!globalToken) return null;
  const globalSession: any = await VybeSession.findOne({ tokenHash: hashSessionToken(globalToken), expiresAt: { $gt: new Date() } }).lean();
  const globalAccount: any = globalSession && await VybeAccount.findOne({ _id: globalSession.accountId, status: 'active' }).select('_id email').lean();
  const account = globalAccount && await Account.findOne({ tenantId: community._id, status: 'active', $or: [{ globalAccountId: globalAccount._id }, { email: globalAccount.email }] }).select('_id').lean();
  const profile = account && await Character.findOne({ tenantId: community._id, accountId: account._id }).select('_id').lean();
  if (!account || !profile) return null;
  const sanction = await CommunitySanction.findOne({ tenantId: community._id, accountId: account._id, status: 'active' }).lean();
  if (sanction && (!sanction.endsAt || sanction.endsAt > new Date())) return null;
  return { tenantId: community._id.toString(), profileId: profile._id.toString() };
}

export function attachChatWebSocket(server: Server) {
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/api/ws/conversations') { socket.destroy(); return; }
    void authenticate(request).then((identity) => {
      if (!identity) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
      websocketServer.handleUpgrade(request, socket, head, (ws) => {
        const peer: ConnectedSocket = { ...identity, socket: ws, alive: true };
        const wasOnline = getOnlineProfileIds(identity.tenantId).includes(identity.profileId);
        peers.add(peer);
        ws.send(JSON.stringify({ type: 'presence:snapshot', profileIds: getOnlineProfileIds(identity.tenantId) }));
        if (!wasOnline) emitPresence(identity.tenantId, identity.profileId, true);
        peer.heartbeat = setInterval(() => {
          if (!peer.alive) { ws.terminate(); removePeer(peer); return; }
          peer.alive = false;
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, 30_000);
        ws.on('pong', () => { peer.alive = true; });
        ws.on('close', () => removePeer(peer));
        ws.on('error', () => removePeer(peer));
        ws.on('message', (raw) => {
          void (async () => {
            let event: any;
            try { event = JSON.parse(raw.toString()); } catch { return; }
            const allowedTypes = new Set(['call:offer', 'call:answer', 'call:ice', 'call:reject', 'call:end']);
            if (!event || !allowedTypes.has(event.type) || typeof event.conversationId !== 'string' || !/^[a-f\d]{24}$/i.test(event.conversationId) || typeof event.targetProfileId !== 'string' || !/^[a-f\d]{24}$/i.test(event.targetProfileId) || typeof event.callId !== 'string' || event.callId.length > 80) return;
            if (event.payload !== undefined && JSON.stringify(event.payload).length > 48 * 1024) return;
            if (event.type === 'call:offer' || event.type === 'call:answer') {
              const description = event.payload?.description;
              if (!description || !['offer', 'answer'].includes(description.type) || typeof description.sdp !== 'string' || description.sdp.length > 40 * 1024) return;
            }
            if (event.type === 'call:ice') {
              const candidate = event.payload;
              if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096) return;
            }
            const conversation: any = await Conversation.findOne({ _id: event.conversationId, tenantId: identity.tenantId, kind: 'direct' }).select('participants').lean();
            if (!conversation) return;
            const activeIds = conversation.participants.filter((participant: any) => !participant.leftAt).map((participant: any) => participant.profileId.toString());
            if (!activeIds.includes(identity.profileId) || !activeIds.includes(event.targetProfileId) || event.targetProfileId === identity.profileId) return;
            const data = JSON.stringify({ type: event.type, conversationId: event.conversationId, profileId: identity.profileId, callId: event.callId, payload: event.payload });
            let delivered = false;
            for (const recipient of peers) if (recipient.tenantId === identity.tenantId && recipient.profileId === event.targetProfileId && recipient.socket.readyState === WebSocket.OPEN) { recipient.socket.send(data); delivered = true; }
            if (!delivered && event.type === 'call:offer') ws.send(JSON.stringify({ type: 'call:unavailable', conversationId: event.conversationId, callId: event.callId }));
          })().catch(() => undefined);
        });
        ws.send(JSON.stringify({ type: 'ready' }));
      });
    }).catch(() => { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); });
  });
}

export function closeChatWebSockets() {
  for (const peer of peers) peer.socket.close(1001, 'Server encerrando conexão');
}

export function getOnlineProfileIds(tenantId: string) {
  return [...new Set([...peers].filter((peer) => peer.tenantId === tenantId && peer.socket.readyState === WebSocket.OPEN).map((peer) => peer.profileId))];
}

function emitPresence(tenantId: string, profileId: string, online: boolean) {
  const data = JSON.stringify({ type: 'presence:update', profileId, online });
  for (const peer of peers) if (peer.tenantId === tenantId && peer.socket.readyState === WebSocket.OPEN) peer.socket.send(data);
}

export function emitToProfiles(tenantId: string, profileIds: Array<string | { toString(): string }>, event: RealtimeEvent) {
  const recipients = new Set(profileIds.map((id) => id.toString()));
  const data = JSON.stringify(event);
  for (const peer of peers) {
    if (peer.tenantId === tenantId && recipients.has(peer.profileId) && peer.socket.readyState === WebSocket.OPEN) peer.socket.send(data);
  }
}

export function emitToCommunity(tenantId: string, event: RealtimeEvent) {
  const data = JSON.stringify(event);
  for (const peer of peers) if (peer.tenantId === tenantId && peer.socket.readyState === WebSocket.OPEN) peer.socket.send(data);
}
