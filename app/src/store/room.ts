import { create } from 'zustand';
import { api, OfflineError } from '../lib/api';
import { RoomSocket } from '../lib/ws';
import { haptic } from '../lib/ui';
import { demoGame } from '../data/demo';
import { buildDemoScript, type DemoEvent } from '../lib/demoRoom';
import type { ChatMessage, RoomInfo, RoomPlayer, SummaryCard, UiSchema } from '../types';

/* ------------------------------------------------------------------ */
/* 房间状态：消息流、玩家、阶段、流式缓冲                                 */
/* 离线时自动进入演示模式：用脚本化对局把界面跑起来                        */
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
  /** 演示模式：没有后端，放脚本对局 */
  demo: boolean;

  socket: RoomSocket | null;

  enter: (roomId: string, demoGameId?: string) => Promise<void>;
  leave: () => Promise<void>;
  setMyPlayerId: (id: string | null) => void;
  send: (text: string) => Promise<void>;
  act: (kind: string, payload?: { targetId?: string; text?: string; amount?: number; option?: string }) => Promise<void>;
  togglePause: () => Promise<void>;
  refresh: () => Promise<void>;
}

let demoTimers: ReturnType<typeof setTimeout>[] = [];
let demoSeq = 1;

function clearDemo() {
  for (const t of demoTimers) clearTimeout(t);
  demoTimers = [];
  demoSeq = 1;
}

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
  demo: false,
  socket: null,

  setMyPlayerId: (id) => set({ myPlayerId: id }),

  enter: async (roomId, demoGameId) => {
    set({ loading: true, error: null, roomId, messages: [], summary: null, demo: false });

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
        messages: normalizeMessages(messages, norm),
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
      // 后端连不上 → 切演示
      if (e instanceof OfflineError && demoGameId) {
        startDemo(set, demoGameId);
        return;
      }
      set({ loading: false, error: e instanceof Error ? e.message : '进房失败' });
      return;
    }

    // 2) 挂 WebSocket
    const sock = new RoomSocket(roomId);
    sock.on((e) => handleWs(e, get, set));
    sock.connect();
    set({ socket: sock });
  },

  leave: async () => {
    const { socket, roomId, demo } = get();
    socket?.close();
    if (demo) clearDemo();
    if (roomId && !demo) { try { await api.leave(roomId); } catch { /* ignore */ } }
    set({
      socket: null, roomId: null, room: null, players: [], messages: [],
      summary: null, connected: false, waitingForMe: false, error: null,
      myPlayerId: null, demo: false,
    });
  },

  send: async (text) => {
    const { roomId, demo, demo: isDemo } = get();
    if (!roomId || !text.trim()) return;

    if (isDemo) {
      // 演示模式：把用户的话插进流里，再让某个角色随口接一句
      const { players, room } = get();
      const me = players.find((p) => p.user_id)?.name ?? '你';
      appendMessage(set, {
        senderType: 'user', senderName: me, content: text.trim(),
        round: room?.round ?? 1, phase: room?.phase ?? 'talk',
      });
      const responder = players[Math.floor(Math.random() * players.length)];
      if (responder) {
        const t = setTimeout(() => {
          appendMessage(set, {
            senderType: 'ai', senderId: responder.id, senderName: responder.name,
            content: `（接住）${text.trim().slice(0, 8)}……你这么说我就有点想法了`,
            round: get().room?.round ?? 1, phase: get().room?.phase ?? 'talk',
            avatar: responder.avatar, isAi: true,
          });
          haptic.light();
        }, 1400);
        demoTimers.push(t);
      }
      haptic.light();
      return;
    }

    await api.interject(roomId, text.trim());
    haptic.light();
    set({ waitingForMe: false });
    void demo;
  },

  act: async (kind, payload) => {
    const { roomId, demo } = get();
    if (!roomId) return;
    haptic.medium();
    set({ waitingForMe: false });
    if (demo) {
      appendMessage(set, {
        senderType: 'system', senderName: '系统',
        content: `你执行了「${kind}」（演示模式，真机上会由规则引擎结算）`,
        round: get().room?.round ?? 1, phase: get().room?.phase ?? '',
      });
      return;
    }
    await api.action(roomId, { kind, ...payload });
  },

  togglePause: async () => {
    const { roomId, paused, demo } = get();
    if (!roomId) return;
    if (demo) { set({ paused: !paused }); return; }
    if (paused) await api.resume(roomId); else await api.pause(roomId);
    set({ paused: !paused });
  },

  refresh: async () => {
    const { roomId, messages, demo } = get();
    if (!roomId || demo) return;
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
          ...normalizeMessages(fresh, norm).filter((nm) => !s.messages.some((om) => om.seq === nm.seq)),
        ],
      }));
    } catch { /* 网络抖一下就算了 */ }
  },
}));

/* ------------------------------ WebSocket ------------------------------ */

function handleWs(
  e: Record<string, unknown> & { type: string },
  get: () => RoomState,
  set: (p: Partial<RoomState> | ((s: RoomState) => Partial<RoomState>)) => void,
) {
  switch (e.type) {
    case 'subscribed':
      set({ connected: true });
      break;

    case 'room.phase':
      set((s) => ({
        room: s.room
          ? { ...s.room, round: e.round as number, phase: e.phase as string, status: e.status as RoomInfo['status'] }
          : s.room,
        waitingForMe: false,
      }));
      break;

    case 'room.wait_user':
      set({ waitingForMe: true });
      haptic.call();
      break;

    case 'room.paused': set({ paused: true }); break;
    case 'room.resumed': set({ paused: false }); break;

    case 'room.finished':
      set({ summary: e.summary as SummaryCard, waitingForMe: false });
      haptic.success();
      break;

    case 'message.created': {
      const seq = e.seq as number;
      if (e.system && e.content) {
        set((s) => ({
          messages: [...s.messages, {
            id: `sys-${seq}`, seq, senderType: 'system', senderId: null,
            senderName: '系统', content: e.content as string,
            round: s.room?.round ?? 0, phase: s.room?.phase ?? '',
            visibleTo: null, createdAt: new Date().toISOString(),
          }],
        }));
        haptic.light();
      } else {
        void get().refresh();
      }
      break;
    }

    case 'message.stream.start': {
      const seq = e.seq as number;
      set((s) => ({
        messages: [
          ...s.messages.filter((m) => !m.streaming),
          {
            id: `stream-${seq}`, seq, senderType: 'ai' as const, senderId: e.senderId as string,
            senderName: e.name as string, content: '', round: s.room?.round ?? 0,
            phase: s.room?.phase ?? '', visibleTo: null,
            createdAt: new Date().toISOString(), streaming: true,
            avatar: s.players.find((p) => p.id === e.senderId)?.avatar ?? null, isAi: true,
          },
        ],
      }));
      break;
    }

    case 'message.stream.delta': {
      const seq = e.seq as number;
      const delta = e.delta as string;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.seq === seq && m.streaming ? { ...m, content: m.content + delta } : m),
      }));
      break;
    }

    case 'message.stream.end': {
      const seq = e.seq as number;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.seq === seq
            ? {
                ...m, content: e.content as string, streaming: false,
                meta: e.meta as ChatMessage['meta'],
                visibleTo: e.secret ? [] : m.visibleTo,
              }
            : m),
      }));
      break;
    }

    default:
      break;
  }
}

/* ------------------------------ 演示模式 ------------------------------ */

function startDemo(
  set: (p: Partial<RoomState> | ((s: RoomState) => Partial<RoomState>)) => void,
  gameId: string,
) {
  clearDemo();
  const game = demoGame(gameId);
  if (!game) {
    set({ loading: false, error: '离线数据里没有这个游戏' });
    return;
  }

  const players: RoomPlayer[] = game.roles.flatMap((r) =>
    Array.from({ length: Math.min(r.count, 2) }, (_, i) => ({
      id: `${r.key}-${i}`,
      seat: 0,
      name: r.count > 1 ? `${r.name}${i + 1}` : r.name,
      avatar: `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(game.id + r.key + i)}`,
      isAi: true,
      alive: true,
      roleKey: r.key,
      score: 0,
      user_id: null,
    })),
  ).map((p, i) => ({ ...p, seat: i }));

  // 演示时给用户一个「旁观席」
  const meSeat = players.length;
  players.push({
    id: 'me', seat: meSeat, name: '你',
    avatar: `https://api.dicebear.com/7.x/thumbs/png?seed=me`,
    isAi: false, alive: true, roleKey: 'spectator', score: 0, user_id: 'me',
  });

  const room: RoomInfo = {
    id: 'demo',
    game_id: game.id,
    game_name: game.name,
    engine_type: game.engineType,
    ui_schema_json: game.uiSchema,
    status: 'running',
    topic: game.topicPool[0] ?? '演示对局',
    round: 1,
    phase: game.phases[0]?.key ?? 'init',
    seq: 0,
    tokens_used: 0,
  };

  set({
    room, players, uiSchema: game.uiSchema, loading: false,
    demo: true, connected: true, myPlayerId: 'me', messages: [],
  });

  // 按脚本逐条播放
  const script: DemoEvent[] = buildDemoScript(game);
  let acc = 600;
  script.forEach((ev, idx) => {
    acc += ev.after;
    const t = setTimeout(() => {
      const id = ev.type === 'ai'
        ? players.find((p) => p.name === ev.name)?.id ?? null
        : ev.type === 'user' ? 'me' : null;

      if (ev.type === 'system') {
        set((s) => ({
          room: s.room ? { ...s.room, round: ev.round, phase: ev.phase } : s.room,
          messages: [...s.messages, {
            id: `demo-${idx}`, seq: demoSeq++, senderType: 'system', senderId: null,
            senderName: '系统', content: ev.content, round: ev.round, phase: ev.phase,
            visibleTo: null, createdAt: new Date().toISOString(),
          }],
        }));
        haptic.light();
        return;
      }

      // AI 台词：先插一条空的，再逐字填
      set((s) => ({
        room: s.room ? { ...s.room, round: ev.round, phase: ev.phase } : s.room,
        messages: [...s.messages, {
          id: `demo-${idx}`, seq: demoSeq++, senderType: 'ai', senderId: id,
          senderName: ev.name, content: '', round: ev.round, phase: ev.phase,
          visibleTo: null, createdAt: new Date().toISOString(),
          streaming: true,
          avatar: players.find((p) => p.id === id)?.avatar ?? null, isAi: true,
        }],
      }));

      const text = ev.content;
      const speed = ev.charDelay ?? 28;
      for (let c = 1; c <= text.length; c++) {
        const tt = setTimeout(() => {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === `demo-${idx}` ? { ...m, content: text.slice(0, c) } : m),
          }));
        }, c * speed);
        demoTimers.push(tt);
      }
      const done = setTimeout(() => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === `demo-${idx}` ? { ...m, streaming: false } : m),
        }));
      }, text.length * speed + 60);
      demoTimers.push(done);
    }, acc);
    demoTimers.push(t);
  });
}

function appendMessage(
  set: (p: Partial<RoomState> | ((s: RoomState) => Partial<RoomState>)) => void,
  m: {
    senderType: ChatMessage['senderType']; senderId?: string | null; senderName: string;
    content: string; round: number; phase: string; avatar?: string | null; isAi?: boolean;
  },
) {
  set((s) => ({
    messages: [...s.messages, {
      id: `local-${demoSeq}`, seq: demoSeq++,
      senderType: m.senderType, senderId: m.senderId ?? null, senderName: m.senderName,
      content: m.content, round: m.round, phase: m.phase, visibleTo: null,
      createdAt: new Date().toISOString(), avatar: m.avatar ?? null, isAi: m.isAi ?? false,
    }],
  }));
}

/* ------------------------------ 工具 ------------------------------ */

function normalizePlayers(players: RoomPlayer[]): RoomPlayer[] {
  return players.map((p) => ({ ...p, isAi: p.isAi ?? p.is_ai ?? true }));
}

/**
 * 服务端返回的消息缺 senderName/avatar，这里补上。
 * 私有消息（visibleTo 非 null）就直接丢掉 —— 前端也不该看到。
 */
function normalizeMessages(list: ChatMessage[], players: RoomPlayer[]): ChatMessage[] {
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
      };
    });
}
