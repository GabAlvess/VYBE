export type ConversationRealtimeEvent = {
  type: string;
  tenantId?: string;
  conversationId?: string;
  matchId?: string;
  channelId?: string;
  messageId?: string;
  profileId?: string;
  otherProfileId?: string;
  typing?: boolean;
};

export function connectConversationRealtime(onEvent: (event: ConversationRealtimeEvent) => void) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  const connect = () => {
    if (stopped) return;
    const url = new URL('/api/ws/conversations', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.onmessage = (message) => {
      try { onEvent(JSON.parse(String(message.data)) as ConversationRealtimeEvent); } catch { /* Ignore malformed events. */ }
    };
    socket.onclose = () => { if (!stopped) retryTimer = window.setTimeout(connect, 1500); };
    socket.onerror = () => socket?.close();
  };
  connect();
  return () => {
    stopped = true;
    window.clearTimeout(retryTimer);
    socket?.close();
  };
}
