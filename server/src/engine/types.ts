/**
 * =====================================================================
 *  GameEngine —— 整个 App 唯一的「业务核心」
 * ---------------------------------------------------------------------
 *  原则：不为任何单个游戏写独立逻辑。
 *  只写 1 个通用引擎接口 + N 份 config JSON，引擎读 config 驱动游戏。
 *  5 种 engine_type 只是 5 份「同一接口的不同实现」。
 *
 *  实现者必须保证：
 *   1. 私有信息隔离 —— getVisibleMessages / buildPrompt 决定 AI 能看到什么
 *   2. 一切状态可序列化 —— 存进 game_states.state_json，能回放、能恢复
 *   3. 不自行发网络请求 —— 引擎是纯函数，LLM 调用由 scheduler 负责
 * =====================================================================
 */

import type { Action, EventLog, WinResult } from './engine.js';

export type EngineType =
  | 'hidden_role'    // 狼人杀、谁是卧底
  | 'group_chat'     // 恋爱模拟、海龟汤
  | 'debate'         // 模拟法庭
  | 'negotiation'    // 商业谈判
  | 'simulation';    // 创业公司

export type RoomStatus = 'waiting' | 'running' | 'voting' | 'finished' | 'archived';

/* ------------------------------------------------------------------ */
/* Config：7 份 JSON 的共同形状                                        */
/* ------------------------------------------------------------------ */

export interface ConfigPhase {
  /** 阶段 key，如 'night' 'speak' 'vote' */
  key: string;
  /** 展示名，如「天黑请闭眼」 */
  name: string;
  /**
   * 阶段调度方式：
   *  - 'narration'   只有系统旁白，不产生 AI 动作
   *  - 'sequential'  按座位一个个来（发言）
   *  - 'parallel'    同时行动，结果统一结算（夜晚技能、出价）
   *  - 'vote'        全员投票，聚合票型
   *  - 'user_turn'   等用户输入（恋爱、海龟汤提问）
   */
  mode: 'narration' | 'sequential' | 'parallel' | 'vote' | 'user_turn';
  /** 哪些座位参与（不写 = 全部存活者） */
  actors?:
    | 'all' | 'alive' | 'host' | 'custom'
    | 'plaintiff' | 'defendant' | 'lawyers' | 'witness' | 'jury'
    | 'role:wolf' | 'role:seer' | 'role:judge';
  /** 该阶段允许的 action 类型，UI 动态操作栏直接读它 */
  allowActions?: string[];
  /** 该阶段每个 AI 最多说几段话 */
  speaksPerActor?: number;
  /** 是否可以说悄悄话（不进公共流） */
  secret?: boolean;
  /** 进入阶段时自动播报的系统消息 */
  narration?: string;
}

export interface ConfigRole {
  key: string;
  name: string;
  /** 阵营，用于胜负判定：'wolf'|'good'|'neutral'|'civilian'|'undercover'|'judge' */
  camp: string;
  count: number;
  isAi: boolean;
  identity: string;
  goal: string;
  personality: string;
  knowledge: string;
  taboo: string;
  speakingStyle: string;
  model?: string;
  avatar?: string;
}

export interface GameConfig {
  id: string;
  name: string;
  description: string;
  cover?: string;
  engineType: EngineType;
  minPlayers: number;
  maxPlayers: number;
  /** 硬性轮次上限，成本控制第一道闸 */
  maxRounds: number;
  /** 用户是否参战（恋爱=主角，狼人杀=围观+插话） */
  userRole: 'player' | 'spectator' | 'host';
  topicPool: string[];
  roles: ConfigRole[];
  phases: ConfigPhase[];
  /** 胜负判定用的额外参数 */
  winCondition: Record<string, unknown>;
  /** 关键词表：用于情绪系统、卧底词对等 */
  data?: Record<string, unknown>;
  rules: string[];
  uiSchema: UiSchema;
  costs?: {
    maxOutputTokens?: number;
    contextWindow?: number;
    summaryModel?: string;
  };
}

/* ------------------------------------------------------------------ */
/* UI Schema：客户端底部操作栏按它动态渲染                              */
/* ------------------------------------------------------------------ */

export interface UiAction {
  key: string;                       // 'vote' | 'offer' | 'objection'
  label: string;                     // '投票'
  kind: 'text' | 'pick_player' | 'pick_option' | 'number' | 'instant';
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** 只有满足条件时才显示 */
  when?: { phase?: string[]; onlyRole?: string[]; onlyAlive?: boolean };
}

export interface UiSchema {
  theme: string;                     // 'dark' | 'noir' | 'court' | 'neon'
  accent: string;                    // 主色
  bubbleStyle: 'chat' | 'court' | 'deal';
  showSeats: boolean;
  actions: UiAction[];
  systemMessageStyle: 'center';
}

/* ------------------------------------------------------------------ */
/* 玩家 / 状态                                                         */
/* ------------------------------------------------------------------ */

export interface PlayerState {
  id: string;                        // room_players.id
  seat: number;
  name: string;
  avatar?: string;
  isAi: boolean;
  userId?: string | null;
  roleKey: string;
  camp: string;
  alive: boolean;
  model?: string;
  /** 私有信息，绝不外泄：狼队友、查验结果、药水、底线… */
  private: Record<string, unknown>;
  /** 公开分：好感度 / 估值 / 支持率 */
  score: number;
}

export interface GameState {
  roomId: string;
  gameId: string;
  engineType: EngineType;
  round: number;
  phase: string;
  phaseIndex: number;
  status: RoomStatus;
  players: PlayerState[];
  /** 引擎私有黑板，随便塞，会被 JSON 序列化 */
  data: Record<string, unknown>;
  /** 已发生的公共事件摘要，喂给 context 时先用它省 token */
  log: EventLog[];
  /** 待结算的动作（parallel/vote 阶段收集） */
  pending: Action[];
  /** 轮次到头的判定 */
  finished: boolean;
  winner?: WinResult;
}
