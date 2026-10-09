import { create } from 'zustand';
import { api } from '../lib/api';
import { RoomSocket } from '../lib/ws';
import { haptic } from '../lib/ui';
import type { ChatMessage, RoomInfo, RoomPlayer, SummaryCard, UiSchema } from '../types';

/* ------------------------------------------------------------------ */
/* 房间状态：消息流、玩家、阶段、流式缓冲                                 */
/* ------------------------------------------------------------------ */

interface RoomState {
  roomId: string | null;
  room: RoomInfo | null;
  players: RoomPlayer[];
  messages: ChatMessage[];
  uiSchema: UiSchema | null;
  summary: SummaryCard | null;
  connected: boolean;
  waitingForMe: boolean;
  paused: boolean;
  loading: boolean;
  error: string | null;
  /** 我在这个房间的座位 id，null 表示纯围观 */
  myPlayerId: string | null;

  socket: RoomSocket | null;

  enter: (roomId: string) => Promise<void>;
  leave: () => Promise<void>;
  setMyPlayerId: (id: string | null) => void;
  send: (text: string) => Promise<void>;
  act: (kind: string, payload?: { targetId?: string; text?: string; amount?: number; option?: string }) => Promise<void>;
  togglePause: () => Promise<void>;
  refresh: () => Promise<void>;

  /** 内部：本地插入一条 */
  pushLocal: (m: ChatMessage) => void;
}

let localSeq = 1_000_000;   // 本地临时消息用大序号，避免和服务器 seq 撞

export const useRoom = create<RoomState>((set, get) => ({
  roomId: null,
  room: null,
  players: [],
  messages: [],
  uiSchema: null,
  summary: null,
  connected: false,
  waitingForMe: false,
  paused: false,
  loading: false,
  error: null,
  myPlayerId: null,
  socket: null,

  pushLocal: (m) => set((s) => ({ messages: [...s.messages, m] })),

  enter: async (roomId) => {
    set({ loading: true, error: null, roomId, messages: [], summary: null });

    // 1) 拉房间 + 全量消息
    try {
      const [{ room, players }, { messages }] = await Promise.all([
        api.room(roomId),
        api.roomMessages(roomId, 0),
      ]);
      const norm = normalizePlayers(players);
      set({
        room,
        players: norm,
        messages: normalizeMessages(messages, norm, room.ui_schema_json),
        uiSchema: room.ui_schema_json,
        paused: room.status === 'finished',
        loading: false,
      });
      if (room.status === 'finished') {
        try {
          const { summary } = await api.summary(roomId);
          set({ summary });
        } catch { /* 可能还没结算 */ }
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '进房失败' });
      return;
    }

    // 2) 挂 WebSocket
    const sock = new RoomSocket(roomId);
    sock.on((e) => {
      const st = get();
      switch (e.type) {
        case 'subscribed':
          set({ connected: true });
          break;

        case 'room.phase': {
          set((s) => ({
            room: s.room ? { ...s.room, round: e.round, phase: e.phase, status: e.status } : s.room,
            waitingForMe: false,
          }));
          break;
        }

        case 'room.wait_user':
          set({ waitingForMe: true });
          haptic.call();
          break;

        case 'room.paused': set({ paused: true }); break;
        case 'room.resumed': set({ paused: false }); break;

        case 'room.finished':
          set({ summary: e.summary, waitingForMe: false });
          haptic.success();
          break;

        case 'message.created': {
          if (e.system && e.content) {
            set((s) => ({
              messages: [...s.messages, {
                id: `sys-${e.seq}`, seq: e.seq, senderType: 'system', senderId: null,
                senderName: '系统', content: e.content!, round: s.room?.round ?? 0,
                phase: s.room?.phase ?? '', visibleTo: null, createdAt: new Date().toISOString(),
              }],
            }));
            haptic.light();
          } else {
            // 服务器落库了但我们还没有 → 拉一次增量
            void st.refresh();
          }
          break;
        }

        case 'message.stream.start': {
          set((s) => ({
            messages: [
              ...s.messages.filter((m) => !m.streaming),
              {
                id: `stream-${e.seq}`, seq: e.seq, senderType: 'ai', senderId: e.senderId,
                senderName: e.name, content: '', round: s.room?.round ?? 0,
                phase: s.room?.phase ?? '', visibleTo: null,
                createdAt: new Date().toISOString(), streaming: true,
                avatar: playerAvatar(s.players, e.senderId), isAi: true,
              },
            ],
          }));
          break;
        }

        case 'message.stream.delta': {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.seq === e.seq && m.streaming ? { ...m, content: m.content + e.delta } : m),
          }));
          break;
        }

        case 'message.stream.end': {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.seq === e.seq ? { ...m, content: e.content, streaming: false, meta: e.meta, visibleTo: e.secret ? [] : m.visibleTo } : m),
          }));
          break;
        }

        default:
          break;
      }
    });
    sock.connect();
    set({ socket: sock });
  },

  leave: async () => {
    const { socket, roomId } = get();
    socket?.close();
    if (roomId) { try { await api.leave(roomId); } catch { /* ignore */ } }
    set({
      socket: null, roomId: null, room: null, players: [], messages: [],
      summary: null, connected: false, waitingForMe: false, error: null, myPlayerId: null,
    });
  },

  setMyPlayerId: (id) => set({ myPlayerId: id }),

  send: async (text) => {
    const { roomId } = get();
    if (!roomId || !text.trim()) return;
    await api.interject(roomId, text.trim());
    haptic.light();
    set({ waitingForMe: false });
  },

  act: async (kind, payload) => {
    const { roomId } = get();
    if (!roomId) return;
    await api.action(roomId, { kind, ...payload });
    haptic.medium();
    set({ waitingForMe: false });
  },

  togglePause: async () => {
    const { roomId, paused } = get();
    if (!roomId) return;
    if (paused) await api.resume(roomId); else await api.pause(roomId);
    set({ paused: !paused });
  },

  refresh: async () => {
    const { roomId, messages } = get();
    if (!roomId) return;
    const maxSeq = Math.max(0, ...messages.filter((m) => m.seq < 1_000_000).map((m) => m.seq));
    try {
      const { room, players } = await api.room(roomId);
      const { messages: fresh } = await api.roomMessages(roomId, maxSeq);
      const norm = normalizePlayers(players);
      set((s) => ({
        room,
        players: norm,
        messages: [
          ...s.messages,
          ...normalizeMessages(fresh, norm, room.ui_schema_json).filter(
            (nm) => !s.messages.some((om) => om.seq === nm.seq),
          ),
        ],
      }));
    } catch { /* 网络抖一下就算了 */ }
  },
}));

/* ------------------------------ 工具 ------------------------------ */

function normalizePlayers(players: RoomPlayer[]): RoomPlayer[] {
  return players.map((p) => ({ ...p, isAi: p.isAi ?? p.is_ai ?? true }));
}

function playerAvatar(players: RoomPlayer[], id: string | null) {
  if (!id) return null;
  return players.find((p) => p.id === id)?.avatar ?? null;
}

/**
 * 服务端返回的消息缺 senderName/avatar，这里补上。
 * 私有消息（visibleTo 非 null）如果和我无关，直接丢掉 —— 前端也不该看到。
 */
function normalizeMessages(
  list: ChatMessage[],
  players: RoomPlayer[],
  _ui: UiSchema,
): ChatMessage[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  return list
    .filter((m) => m.visibleTo === null)
    .map((m) => {
      const p = m.senderId ? byId.get(m.senderId) : null;
      return {
        ...m,
        senderName: m.senderType === 'system' || m.senderType === 'judge' ? '系统' : (p?.name ?? m.senderName ?? '?'),
        avatar: p?.avatar ?? null,
        isAi: p?.isAi ?? false,
        meta: (m as unknown as { meta?: ChatMessage['meta'] }).meta,
      };
    });
}
