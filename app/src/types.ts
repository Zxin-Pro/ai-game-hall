/* ------------------------------------------------------------------ */
/* 前后端共享的数据形状（与 server/src/engine/types.ts 对齐）            */
/* ------------------------------------------------------------------ */

export type EngineType =
  | 'hidden_role' | 'group_chat' | 'debate' | 'negotiation' | 'simulation';

export type RoomStatus = 'waiting' | 'running' | 'voting' | 'finished' | 'archived';

export interface User {
  id: string;
  nickname: string;
  avatar: string | null;
  createdAt?: string;
}

export interface GameCard {
  id: string;
  name: string;
  description: string;
  cover: string | null;
  minPlayers: number;
  maxPlayers: number;
  engineType: EngineType;
  roles: GameRole[];
  roundLimit: number;
}

export interface GameRole {
  key: string;
  name: string;
  camp: string;
  count: number;
  isAi: boolean;
  identity: string;
  personality: string;
  model?: string;
  avatar?: string;
}

export interface UiAction {
  key: string;
  label: string;
  kind: 'text' | 'pick_player' | 'pick_option' | 'number' | 'instant';
  options?: { value: string; label: string }[];
  placeholder?: string;
  when?: { phase?: string[]; onlyRole?: string[]; onlyAlive?: boolean };
}

export interface UiSchema {
  theme: string;
  accent: string;
  bubbleStyle: 'chat' | 'court' | 'deal';
  showSeats: boolean;
  actions: UiAction[];
  systemMessageStyle: 'center';
}

export interface GameDetail extends Omit<GameCard, 'roundLimit'> {
  maxRounds?: number;
  userRole?: 'player' | 'spectator' | 'host';
  rules: string[];
  phases: { key: string; name: string; mode: string; narration?: string }[];
  uiSchema: UiSchema;
  topicPool: string[];
}

export interface RoomPlayer {
  id: string;
  seat: number;
  name: string;
  avatar: string | null;
  is_ai?: boolean;
  isAi?: boolean;
  alive: boolean;
  ai_role_id?: string | null;
  roleKey?: string;
  score?: number;
  user_id?: string | null;
}

export interface ChatMessage {
  id: string;
  seq: number;
  senderType: 'user' | 'ai' | 'system' | 'judge';
  senderId: string | null;
  senderName: string;
  content: string;
  round: number;
  phase: string;
  visibleTo: number[] | null;
  createdAt: string;
  avatar?: string | null;
  isAi?: boolean;
  meta?: MessageMeta;
  /** 本地态：正在流式接收 */
  streaming?: boolean;
}

export interface MessageMeta {
  kind?: string;
  model?: string;
  ttftMs?: number;
  genMs?: number;
  tokens?: number;
  totalTokens?: number;
  rate?: number;
  estimated?: boolean;
  action?: unknown;
}

export interface RoomInfo {
  id: string;
  game_id: string;
  game_name: string;
  engine_type: EngineType;
  ui_schema_json: UiSchema;
  status: RoomStatus;
  topic: string;
  round: number;
  phase: string;
  seq: number;
  tokens_used: number;
}

export interface SummaryCard {
  title: string;
  winner: string;
  highlights: string[];
  stats: { label: string; value: string }[];
  mvp?: { name: string; reason: string };
  review: string[];
  shareText: string;
  replayUrl: string;
}

export interface HistoryItem {
  id: string;
  game_id: string;
  game_name: string;
  topic: string;
  round: number;
  finished_at: string;
  result_json: SummaryCard | null;
  share_image_url: string | null;
}

/* ------------------------------ WS 事件 ------------------------------ */

export type WsEvent =
  | { type: 'hello'; userId: string; serverTime: number }
  | { type: 'subscribed'; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number }
  | { type: 'room.phase'; roomId: string; round: number; phase: string; phaseName: string; status: RoomStatus }
  | { type: 'room.paused'; roomId: string }
  | { type: 'room.resumed'; roomId: string }
  | { type: 'room.wait_user'; roomId: string }
  | { type: 'room.finished'; roomId: string; summary: SummaryCard }
  | { type: 'message.created'; roomId: string; seq: number; system?: boolean; content?: string }
  | { type: 'message.stream.start'; roomId: string; seq: number; senderId: string; name: string }
  | { type: 'message.stream.delta'; roomId: string; seq: number; delta: string }
  | {
      type: 'message.stream.end'; roomId: string; seq: number; content: string;
      kind?: string; secret?: boolean;
      meta?: { ttftMs: number; genMs: number; tokens: number; rate: number; model: string };
    }
  | { type: 'action.accepted'; roomId: string; kind: string };
