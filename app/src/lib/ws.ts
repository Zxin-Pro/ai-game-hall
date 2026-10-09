import { BASE_URL, getAccessToken } from './api';
import type { WsEvent } from '../types';

/* ------------------------------------------------------------------ */
/* 房间 WebSocket：断线自动重连 + 指数退避                               */
/* ------------------------------------------------------------------ */

type Handler = (e: WsEvent) => void;

export class RoomSocket {
  private ws: WebSocket | null = null;
  private roomId: string;
  private handlers = new Set<Handler>();
  private retry = 0;
  private closedByUser = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  on(fn: Handler) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private emit(e: WsEvent) {
    for (const h of this.handlers) h(e);
  }

  connect() {
    this.closedByUser = false;
    const token = getAccessToken() ?? '';
    const url = `${BASE_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retry = 0;
      this.send({ type: 'subscribe', roomId: this.roomId });
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25000);
      this.emit({ type: 'subscribed', roomId: this.roomId });
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as WsEvent;
        this.emit(data);
      } catch {
        /* ignore */
      }
    };

    this.ws.onerror = () => { /* onclose 会接上 */ };

    this.ws.onclose = () => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.retry += 1;
    // 1s, 2s, 4s, 8s, 最多 15s
    const wait = Math.min(1000 * 2 ** (this.retry - 1), 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  private send(obj: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.closedByUser = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
