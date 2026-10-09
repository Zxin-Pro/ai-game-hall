import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { useNet } from '../store/net';
import { demoCards, demoGame } from '../data/demo';
import type { GameCard, GameDetail } from '../types';

/* ------------------------------------------------------------------ */
/* api：统一请求层                                                       */
/*  · access/refresh 双 token，401 自动刷新一次再重试                    */
/*  · 所有 AI 调用都在后端，这里永远不碰任何 API Key                     */
/* ------------------------------------------------------------------ */

const EXTRA = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

/** 真机调试时改成你电脑的局域网 IP，模拟器用 10.0.2.2 */
export const BASE_URL = EXTRA.apiBaseUrl ?? 'http://10.0.2.2:8787';

const ACCESS_KEY = 'agh.access';
const REFRESH_KEY = 'agh.refresh';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export async function loadTokens() {
  accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  return { accessToken, refreshToken };
}

export async function saveTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  if (access) await SecureStore.setItemAsync(ACCESS_KEY, access);
  else await SecureStore.deleteItemAsync(ACCESS_KEY);
  if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  else await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export const getAccessToken = () => accessToken;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function refreshOnce(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) { await saveTokens(null, null); return false; }
    const j = (await res.json()) as { access: string; refresh: string };
    await saveTokens(j.access, j.refresh);
    return true;
  } catch {
    return false;
  }
}

type ReqOpts = {
  method?: string;
  body?: unknown;
  /** 跳过自动刷新（登录注册用） */
  noAuth?: boolean;
  /** 用于上传等自定义 body */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
};

export async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (!opts.rawBody) headers['content-type'] = 'application/json';
    if (!opts.noAuth && accessToken) headers.authorization = `Bearer ${accessToken}`;
    return fetch(`${BASE_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  };

  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && !opts.noAuth) {
      const ok = await refreshOnce();
      if (ok) res = await doFetch();
    }
  } catch (e) {
    // 连不上服务器（不是 4xx/5xx，是根本连不上）
    netDown(e instanceof Error ? e.message : '网络不可达');
    throw new OfflineError(e instanceof Error ? e.message : '网络不可达');
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `请求失败 ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  netUp();
  return data as T;
}

/** 服务器可达但没有登录态之类的情况，不算离线 */
export class OfflineError extends Error {
  constructor(message: string) { super(message); }
}

function netUp() {
  useNet.getState().setOnline();
}

function netDown(reason: string) {
  useNet.getState().setOffline(reason);
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/* ------------------------------ 具体接口 ------------------------------ */

export const api = {
  register: (body: { nickname: string; password: string; inviteCode?: string; deviceFingerprint?: string }) =>
    request<{ user: { id: string; nickname: string; avatar: string | null }; access: string; refresh: string }>(
      '/api/auth/register', { method: 'POST', body, noAuth: true },
    ),

  login: (body: { nickname: string; password: string; deviceFingerprint?: string }) =>
    request<{ user: { id: string; nickname: string; avatar: string | null }; access: string; refresh: string }>(
      '/api/auth/login', { method: 'POST', body, noAuth: true },
    ),

  logout: (refresh: string | null) =>
    request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: { refresh } }),

  games: async () => {
    try {
      return await request<{ games: GameCard[] }>('/api/games');
    } catch (e) {
      if (e instanceof OfflineError) {
        return { games: demoCards(), offline: true } as { games: GameCard[] };
      }
      throw e;
    }
  },

  game: async (id: string) => {
    try {
      return await request<GameDetail>(`/api/games/${id}`);
    } catch (e) {
      if (e instanceof OfflineError) {
        const g = demoGame(id);
        if (!g) throw e;
        return g as unknown as GameDetail;
      }
      throw e;
    }
  },

  stats: async () => {
    try {
      return await request<{ rooms: string; running: string; messages: string; users: string }>('/api/stats');
    } catch (e) {
      if (e instanceof OfflineError) return { rooms: '0', running: '0', messages: '0', users: '0' };
      throw e;
    }
  },

  createRoom: (body: {
    gameId: string;
    topic?: string;
    roleKeys?: string[];
    modelOverrides?: Record<string, string>;
    joinAsPlayer?: boolean;
    roundLimit?: number;
  }) => request<{ roomId: string; topic: string; seats: unknown[]; maxRounds: number }>(
    '/api/rooms', { method: 'POST', body },
  ),

  room: (id: string) => request<{ room: import('../types').RoomInfo; players: import('../types').RoomPlayer[] }>(
    `/api/rooms/${id}`,
  ),

  roomMessages: (id: string, after = 0) =>
    request<{ messages: import('../types').ChatMessage[] }>(`/api/rooms/${id}/messages?after=${after}`),

  startRoom: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}/start`, { method: 'POST' }),

  interject: (id: string, text: string) =>
    request<{ ok: boolean }>(`/api/rooms/${id}/interject`, { method: 'POST', body: { text } }),

  action: (id: string, body: { kind: string; targetId?: string; text?: string; amount?: number; option?: string }) =>
    request<{ ok: boolean }>(`/api/rooms/${id}/action`, { method: 'POST', body }),

  pause: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}/resume`, { method: 'POST' }),
  leave: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}/leave`, { method: 'POST' }),

  summary: (id: string) =>
    request<{ summary: import('../types').SummaryCard; shareImageUrl: string | null }>(`/api/rooms/${id}/summary`),

  /** 上传图片（分享图 / 头像），成功后拿到可访问的 URL */
  uploadImage: async (uri: string): Promise<{ url: string }> => {
    const form = new FormData();
    const name = uri.split('/').pop() ?? 'share.png';
    form.append('file', {
      uri,
      name,
      type: 'image/png',
    } as unknown as Blob);
    return request<{ url: string }>('/api/uploads', {
      method: 'POST',
      rawBody: form,
      headers: {},   // 让 RN 自己带 multipart boundary
    });
  },

  saveShareImage: (id: string, url: string) =>
    request<{ ok: boolean; url: string }>(`/api/rooms/${id}/share-image`, { method: 'POST', body: { url } }),

  replay: (id: string) =>
    request<{
      room: import('../types').RoomInfo;
      players: { id: string; name: string; avatar: string | null; ai_role_id: string | null; seat: number }[];
      timeline: { seq: number; sender_type: string; sender_id: string | null; content: string; round: number; phase: string; meta_json: Record<string, unknown> }[];
    }>(`/api/rooms/${id}/replay`),

  myRooms: () => request<{ rooms: Record<string, unknown>[] }>('/api/rooms'),

  history: () => request<{ items: import('../types').HistoryItem[] }>('/api/me/history'),

  me: () => request<{
    user: { id: string; nickname: string; avatar: string | null };
    today: { gamesPlayed: number; tokensUsed: number };
    note: string;
    globalTokensToday: number;
  }>('/api/me'),

  updateMe: (body: { nickname?: string; avatar?: string; pushToken?: string }) =>
    request<{ ok: boolean }>('/api/me', { method: 'PATCH', body }),

  memories: () => request<{ memories: { id: string; key: string; value: string }[] }>('/api/me/memories'),

  addMemory: (key: string, value: string) =>
    request<{ ok: boolean }>('/api/me/memories', { method: 'POST', body: { key, value } }),

  deleteMemory: (id: string) => request<{ ok: boolean }>(`/api/me/memories/${id}`, { method: 'DELETE' }),

  report: (messageId: string, reason: string, detail?: string) =>
    request<{ ok: boolean; message: string }>('/api/reports', { method: 'POST', body: { messageId, reason, detail } }),

  playtimePolicy: () =>
    request<{ remindAfterMinutes: number; remindText: string; ageRating: string }>('/api/me/playtime-policy'),
};
