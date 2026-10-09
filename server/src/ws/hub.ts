import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { logger } from '../logger.js';
import { verifyAccessToken } from '../plugins/auth.js';

/* ------------------------------------------------------------------ */
/* WS Hub：按房间分组的广播中心                                          */
/*  · 鉴权走 query token（移动端 WS 不好带 header）                      */
/*  · 只广播，不驱动游戏逻辑（逻辑在 RoomRuntime）                       */
/* ------------------------------------------------------------------ */

interface Client {
  ws: WebSocket;
  userId: string;
  nickname: string;
  rooms: Set<string>;
  alive: boolean;
  lastPong: number;
}

export class WsHub {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, Client>();
  private roomIndex = new Map<string, Set<WebSocket>>();
  private heartbeat: NodeJS.Timeout | null = null;

  attach(app: FastifyInstance) {
    const wss = new WebSocketServer({ server: app.server, path: '/ws' });
    this.wss = wss;

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/ws', 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      const payload = verifyAccessToken(token);
      if (!payload) {
        ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
        ws.close(4001, 'unauthorized');
        return;
      }
      const client: Client = {
        ws, userId: payload.sub, nickname: payload.nickname ?? '',
        rooms: new Set(), alive: true, lastPong: Date.now(),
      };
      this.clients.set(ws, client);

      ws.send(JSON.stringify({ type: 'hello', userId: client.userId, serverTime: Date.now() }));

      ws.on('message', (raw) => this.onMessage(client, raw.toString()));
      ws.on('pong', () => { client.lastPong = Date.now(); });
      ws.on('close', () => this.drop(ws));
      ws.on('error', () => this.drop(ws));
    });

    // 心跳：30s 一次，60s 没响应就断开，让客户端重连
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      for (const [ws, c] of this.clients) {
        if (now - c.lastPong > 60000) { ws.terminate(); this.drop(ws); continue; }
        try { ws.ping(); } catch { /* noop */ }
      }
    }, 30000);

    app.addHook('onClose', async () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      wss.close();
    });

    logger.info('WS Hub 已挂载于 /ws');
  }

  private onMessage(client: Client, raw: string) {
    let msg: { type?: string; roomId?: string; seq?: number };
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'subscribe': {
        if (!msg.roomId) return;
        this.join(client, msg.roomId);
        client.ws.send(JSON.stringify({ type: 'subscribed', roomId: msg.roomId }));
        break;
      }
      case 'unsubscribe': {
        if (msg.roomId) this.leave(client, msg.roomId);
        break;
      }
      case 'ping': {
        client.ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
        break;
      }
      default:
        break;
    }
  }

  private join(client: Client, roomId: string) {
    client.rooms.add(roomId);
    if (!this.roomIndex.has(roomId)) this.roomIndex.set(roomId, new Set());
    this.roomIndex.get(roomId)!.add(client.ws);
  }

  private leave(client: Client, roomId: string) {
    client.rooms.delete(roomId);
    this.roomIndex.get(roomId)?.delete(client.ws);
  }

  private drop(ws: WebSocket) {
    const c = this.clients.get(ws);
    if (!c) return;
    for (const roomId of c.rooms) this.roomIndex.get(roomId)?.delete(ws);
    this.clients.delete(ws);
  }

  /** 广播给某个房间内的所有连接 */
  broadcast(roomId: string, event: Record<string, unknown>) {
    const set = this.roomIndex.get(roomId);
    if (!set?.size) return;
    const data = JSON.stringify(event);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); } catch { /* noop */ }
      }
    }
  }

  /** 给指定用户单独推送（邀请、结果通知） */
  sendToUser(userId: string, event: Record<string, unknown>) {
    const data = JSON.stringify(event);
    for (const c of this.clients.values()) {
      if (c.userId === userId && c.ws.readyState === WebSocket.OPEN) {
        try { c.ws.send(data); } catch { /* noop */ }
      }
    }
  }

  stats() {
    return { connections: this.clients.size, rooms: this.roomIndex.size };
  }
}

export const wsHub = new WsHub();
