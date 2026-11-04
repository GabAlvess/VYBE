export type ConversationRealtimeEvent = {
  type: string;
  tenantId?: string;
  conversationId?: string;
  matchId?: string;
  serverId?: string;
  channelId?: string;
  messageId?: string;
  profileId?: string;
  online?: boolean;
  profileIds?: string[];
  otherProfileId?: string;
  typing?: boolean;
  targetProfileId?: string;
  callId?: string;
  payload?: unknown;
};

const activeSockets = new Set<WebSocket>();
const queuedEvents: string[] = [];

export function sendConversationRealtime(event: ConversationRealtimeEvent) {
  const socket = [...activeSockets].find((item) => item.readyState === WebSocket.OPEN);
  const serialized = JSON.stringify(event);
  if (socket) { socket.send(serialized); return true; }
  queuedEvents.push(serialized);
  return false;
}

export function connectConversationRealtime(onEvent: (event: ConversationRealtimeEvent) => void) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  const connect = () => {
    if (stopped) return;
    const url = new URL('/api/ws/conversations', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.onopen = () => {
      if (!socket) return;
      activeSockets.add(socket);
      while (queuedEvents.length && socket.readyState === WebSocket.OPEN) socket.send(queuedEvents.shift()!);
    };
    socket.onmessage = (message) => {
      try { onEvent(JSON.parse(String(message.data)) as ConversationRealtimeEvent); } catch { /* Ignore malformed events. */ }
    };
    socket.onclose = () => { if (socket) activeSockets.delete(socket); if (!stopped) retryTimer = window.setTimeout(connect, 1500); };
    socket.onerror = () => socket?.close();
  };
  connect();
  return () => {
    stopped = true;
    window.clearTimeout(retryTimer);
    if (socket) activeSockets.delete(socket);
    socket?.close();
  };
}
