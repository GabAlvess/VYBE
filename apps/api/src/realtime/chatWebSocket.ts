import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { Account, Character, Session } from '../models/Social.js';
import { Community } from '../models/Community.js';
import { CommunitySanction } from '../models/CommunitySanction.js';
import { VybeAccount } from '../models/VybeAccount.js';
import { VybeSession } from '../models/VybeSession.js';
import { hashSessionToken, tenantSlugForHost } from '../middleware/tenant.js';

type SocketIdentity = { tenantId: string; profileId: string };
type ConnectedSocket = SocketIdentity & { socket: WebSocket };
type RealtimeEvent = { type: string; [key: string]: unknown };

const peers = new Set<ConnectedSocket>();
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });

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
        const peer = { ...identity, socket: ws };
        peers.add(peer);
        const heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30_000);
        ws.on('close', () => { clearInterval(heartbeat); peers.delete(peer); });
        ws.on('error', () => { clearInterval(heartbeat); peers.delete(peer); });
        ws.send(JSON.stringify({ type: 'ready' }));
      });
    }).catch(() => { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); });
  });
}

export function closeChatWebSockets() {
  for (const peer of peers) peer.socket.close(1001, 'Server encerrando conexão');
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
