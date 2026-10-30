/**
 * Live room (Cloudflare Durable Object). One room, shared by every open page.
 *
 * Browsers connect with a WebSocket at /api/live. After every save the Worker tells the room the new change
 * counter and the room forwards it to everyone who is connected, so open pages update at once. The messages carry
 * only that counter (no names, no emails); the pages then ask the normal API for the data.
 *
 * Uses WebSocket hibernation: while nothing is happening the room sleeps and costs nothing, even with pages
 * connected. "ping" from a page is answered with "pong" without waking the room.
 */
const MAX_CONNECTIONS = 100; // beyond this a page simply keeps using its 15-second checks

export class LiveRoom {
  constructor(state, env) {
    this.state = state;
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/notify') { // only the Worker calls this, never a browser
      const msg = JSON.stringify({ rev: await request.text() });
      this.state.getWebSockets().forEach((ws) => { try { ws.send(msg); } catch (e) { /* that page went away */ } });
      return new Response('ok');
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket connection', { status: 426 });
    if (this.state.getWebSockets().length >= MAX_CONNECTIONS) return new Response('Busy', { status: 503 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage() { /* pings are answered automatically; pages send nothing else */ }
  webSocketClose(ws, code) { try { ws.close(code && code !== 1005 ? code : 1000, 'bye'); } catch (e) { /* already closed */ } }
  webSocketError() { /* the page will reconnect by itself */ }
}
